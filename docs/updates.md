# Over-the-Air-Updates (expo-updates)

Stand: umgesetzt, 2026-11-21 (Entwurf vom 2026-10-20)

## Ziel

Änderungen, die nur JavaScript und Assets betreffen, erreichen die Android-App
ohne neue APK: Die App lädt beim Start ein neues Update von `sem-server`.
Eine neue APK ist nur noch bei nativen Änderungen nötig.

## Entscheidungen

* **Eigener Update-Server:** `sem-server` implementiert das
  [Expo-Updates-Protokoll v1](https://docs.expo.dev/technical-specs/expo-updates-1/)
  unter `/api/updates/manifest` und `/api/updates/assets/...`. Kein EAS.
* **Das Update steckt im Server-Image.** Der Docker-Build exportiert die App
  (`expo export --platform android`) nach `/app/updates`. Ein Update
  auszurollen heißt also: Image aktualisieren (`docker compose pull && up -d`).
  Zurückrollen: siehe „Ausrollen und Prüfen“. Es gibt immer genau ein
  aktuelles Update.
* **Runtime-Version: Policy `fingerprint`.** Ändert sich nativer Code,
  ändert sich der Fingerprint; der Server liefert für alte APKs dann kein
  Update aus (keine Abstürze durch inkompatible Bundles). Für die neue
  Runtime braucht es eine neue APK.
* **Code-Signing ist Pflicht.** Die App enthält das Zertifikat
  (`apps/mobile/certs/certificate.pem`, öffentlich, im Repo) und akzeptiert
  nur signierte Manifeste. Der private Schlüssel liegt **nur** auf der NAS
  (Datei, nur lesend in den Container eingebunden) und in Svens Backup —
  nie im Repo, nie im Image, nie in CI.
* **Prüfung beim Start** (`checkAutomatically: ON_LOAD`,
  `fallbackToCacheTimeout: 0`): Die App startet sofort mit dem vorhandenen
  Stand, lädt im Hintergrund und nutzt das Update beim nächsten Start.
  Zusätzlich in den Einstellungen: „Nach Updates suchen“ und Anzeige der
  laufenden Update-ID.
* **Ohne Schlüssel kein Update:** Fehlt der private Schlüssel auf dem
  Server, antwortet der Manifest-Endpunkt mit „kein Update“ (HTTP 204) statt
  unsigniert.

## Protokoll-Eckpunkte (für Implementierung und Tests)

* Anfrage-Header: `expo-protocol-version: 1`, `expo-platform: android`,
  `expo-runtime-version`, optional `expo-expect-signature`.
* Antwort `multipart/mixed` mit Teil `manifest` (`id` UUID, `createdAt`,
  `runtimeVersion`, `launchAsset`, `assets` mit `hash` = Base64URL(SHA-256),
  `key`, `contentType`, `url`) und Header `expo-signature`
  (`sig`, `keyid`, `alg="rsa-v1_5-sha256"`).
* Andere Plattform als `android` → 400. Runtime passt nicht → 204.
* Caching: Manifest `private, max-age=0`; Assets
  `public, max-age=31536000, immutable`.

Referenzimplementierung: `github.com/expo/custom-expo-updates-server`.

## Umsetzung im Image

* `apps/server/Dockerfile`, Stufe `updates`: `scripts/export-update.ts` in
  `apps/mobile` ruft `expo export --platform android` auf und schreibt
  daneben `expoConfig.json` (öffentliche App-Konfiguration mit der
  aufgelösten Runtime-Version). Ergebnis liegt im Image unter `/app/updates`,
  `UPDATES_DIR=/app/updates` ist gesetzt.
* Build-Argumente müssen zum APK-Build (`.github/workflows/android.yml`)
  passen:
  * `EXPO_PUBLIC_SERVER_URL` = Repository-Variable `SEM_SERVER_URL`. Sie wird
    ins Bundle eingebaut und bestimmt die Update-URL (geht in den
    Fingerprint ein). **Ohne sie bleibt `/app/updates` leer**, der Server
    antwortet 204 – so bleiben lokale Builds und `holdout.yml` unverändert.
  * `GIT_COMMIT` (optional): erscheint mit dem Update in der Fußzeile der App.
* Das Manifest trägt die App-Konfiguration als `extra.expoClient`, sonst wäre
  `Constants.expoConfig` (Fußzeile mit Version und Commit) im Update leer.

**Offen – braucht Svens OK für `.github/workflows/ci.yml`:** Im Job `image`,
Schritt „Build image“, fehlt
`--build-arg EXPO_PUBLIC_SERVER_URL="${{ vars.SEM_SERVER_URL }}"`. Solange er
fehlt, enthält das Image von `main` kein Update.

## Runtime-Version (Fingerprint)

Untersucht mit `expo-updates runtimeversion:resolve --platform android`
(SDK 57, `@expo/fingerprint` 0.20): Standardmäßig geht die **ganze**
App-Konfiguration in den Fingerprint ein, auch `version` (`APP_VERSION`),
`android.versionCode` (`ANDROID_VERSION_CODE`) und `extra.gitCommit`. Damit
hätte jeder Commit eine eigene Runtime-Version und kein Image hätte je zu
einer installierten APK gepasst.

Deshalb `apps/mobile/fingerprint.config.js` mit `sourceSkips`
`ExpoConfigVersions` und `ExpoConfigExtraSection` (plus die Vorgabe
`PackageJsonAndroidAndIosScriptsIfNotContainRun`). Geprüft:

* gleicher Fingerprint bei verschiedenen `APP_VERSION`,
  `ANDROID_VERSION_CODE`, `GIT_COMMIT`;
* gleicher Fingerprint vor und nach `expo prebuild` (wie in `android.yml`)
  und in einer Kopie ohne `.git` mit `pnpm install --filter @sem/mobile...`
  (wie im Docker-Build);
* **anderer** Fingerprint bei anderem `EXPO_PUBLIC_SERVER_URL` – gewollt,
  die Update-URL steckt nativ in der APK.

Weiterhin neue Runtime (also neue APK nötig): native Abhängigkeiten,
Config-Plugins, `app.json`/`app.config.ts` außer Version und `extra`,
Icons, `package.json`-Skripte.

**Übergang:** Alle vor dieser Änderung gebauten APKs
haben einen Fingerprint mit Version und Commit darin und bekommen nie ein
Update. Die erste APK nach dem Merge (wird von `android.yml` automatisch
veröffentlicht) einmal installieren; danach kommen reine JS-Änderungen per
Image.

Die laufende Runtime-Version zeigt die App unter Einstellungen („Runtime:“),
die im Image enthaltene steht in `/app/updates/expoConfig.json`.

## Einrichtung auf der NAS

Einmalig, ergänzend zu `docs/betrieb-nas.md`:

1. Den privaten Schlüssel zu `apps/mobile/certs/certificate.pem` (aus Svens
   Backup) als `/volume1/docker/sem-server/keys/update-signing.pem` ablegen.
   Lesbar für UID 1000 (Benutzer `node` im Container), sonst für niemanden:

   ```sh
   sudo chown 1000:1000 keys/update-signing.pem
   sudo chmod 400 keys/update-signing.pem
   ```

2. In `compose.yaml` (Vorlage: `deploy/nas/compose.yaml`) einschalten:

   ```yaml
   environment:
     UPDATES_PRIVATE_KEY_PATH: /keys/update-signing.pem
     # erste Adresse aus SEM_SERVER_URL, ohne Schrägstrich am Ende
     UPDATES_BASE_URL: https://sem.matzen.familyds.net
   volumes:
     - ./keys/update-signing.pem:/keys/update-signing.pem:ro
   ```

   `UPDATES_DIR` setzt das Image selbst. Ohne `UPDATES_BASE_URL` leitet der
   Server die Asset-URLs aus der Anfrage ab (hinter dem Reverse Proxy nur
   korrekt mit `TRUST_PROXY: 'true'`).

3. Container neu erzeugen: `sudo docker compose up -d --force-recreate`.

## Ausrollen und Prüfen

Ausrollen = neues Image übernehmen:

```sh
cd /volume1/docker/sem-server
sudo docker compose pull
sudo docker compose up -d
```

Prüfen (Runtime-Version aus den Einstellungen der App einsetzen):

```sh
sudo docker exec sem-server cat /app/updates/expoConfig.json | head -c 200
curl -si https://sem.matzen.familyds.net/api/updates/manifest \
  -H 'expo-protocol-version: 1' -H 'expo-platform: android' \
  -H 'expo-runtime-version: <runtime>' | head -n 5
```

`200` mit `multipart/mixed` = Update wird ausgeliefert. `204` = keine
passende Runtime, kein Export im Image oder Schlüssel fehlt/unlesbar (dann
steht „update signing key missing“ im Log). In der App: Einstellungen →
„Nach Updates suchen“; danach zeigt „Update:“ die Update-ID statt
„eingebettet“ und die Fußzeile den Commit des Images.

Zurückrollen: Ein älteres Image-Tag (`sha-<commit>`) hilft nur Geräten, die
das neuere Update noch nicht geladen haben – expo-updates übernimmt kein
Update mit älterem `createdAt` (Zeitpunkt des Exports). Für alle anderen:
Commit auf `main` zurücknehmen, das neue Image bringt ein neues Update.
