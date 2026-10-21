# Over-the-Air-Updates (expo-updates)

Stand: Entwurf, 2026-10-20

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
  Zurückrollen: älteres Image-Tag. Es gibt immer genau ein aktuelles Update.
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
