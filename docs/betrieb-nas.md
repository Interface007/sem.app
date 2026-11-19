# Betrieb auf der NAS

Stand Phase 1: `sem-server` liefert `/health` und die Web-Version der App.
Er braucht noch keine Ordner auf der NAS (Anmeldung und File Station kommen
in Phase 2).

## Einmalig einrichten

### 1. Zugriff auf das Image (GHCR)

Das Image liegt unter `ghcr.io/interface007/sem-server` und ist privat,
solange das Repo privat ist. Die NAS braucht dafür ein Token:

1. GitHub → Settings → Developer settings → Personal access tokens →
   **Tokens (classic)** → Generate new token. Nur Scope `read:packages`,
   mit Ablaufdatum. (Die Container-Registry akzeptiert keine
   Fine-grained-Tokens.)
2. DSM → Systemsteuerung → Terminal & SNMP → SSH aktivieren.
3. Per SSH an der NAS anmelden (Benutzer der Gruppe `administrators`):
   ```sh
   sudo docker login ghcr.io -u Interface007
   ```
   Als Passwort das Token einfügen.
4. SSH wieder deaktivieren, wenn nicht anderweitig gebraucht.

### 2. Projektordner

In File Station im freigegebenen Ordner `docker` den Ordner `sem-server`
anlegen und `deploy/nas/compose.yaml` aus diesem Repo hineinlegen.

### 3. Projekt im Container Manager

Container Manager → Projekt → Erstellen:

* Projektname: `sem-server`
* Pfad: `/docker/sem-server`
* Quelle: vorhandene `compose.yaml` verwenden
* Web-Portal über Web Station: nein

Fertigstellen; das Image wird geladen und der Container gestartet.

Prüfen im Browser (im Heimnetz): `http://<NAS-IP>:8085/health` liefert
`{"status":"ok",…}`, `http://<NAS-IP>:8085/` zeigt die App.

Den Port `8085` vorher auf Kollisionen prüfen (Calibre, Jellyfin, DSM);
bei Bedarf nur die linke Zahl in `compose.yaml` ändern.

## Aktualisieren

Jeder Merge auf `main` schiebt ein neues Image mit den Tags `latest` und
`sha-<commit>`. Übernehmen per SSH:

```sh
cd /volume1/docker/sem-server
sudo docker compose pull
sudo docker compose up -d
```

(Auf älteren DSM-Ständen heißt der Befehl `docker-compose`.) Die
angezeigte Version und der Commit stehen in der Fußzeile der App und in
`/health`.

**Zurückrollen:** in `compose.yaml` `latest` durch `sha-<commit>` einer
früheren Version ersetzen, dann dieselben zwei Befehle.

## Anmeldung am DSM

`sem-server` kann DSM-Benutzer über `SYNO.API.Auth` anmelden (Sitzung
`FileStation`). Gespeichert wird nur die DSM-Sitzung, nie das Passwort.
Ohne die folgenden Variablen startet der Server trotzdem; Anmeldungen
schlagen dann mit „nicht verfügbar“ fehl.

| Variable | Bedeutung |
|---|---|
| `NAS_GATEWAY` | `dsm` (Betrieb) oder `local` (nur Tests/Entwicklung); leer = keine Anmeldung |
| `DSM_URL` | Pflicht bei `dsm`, Adresse des DSM aus Sicht des Containers |
| `LOCAL_USERS` | Pflicht bei `local`, `name:passwort,name2:passwort2` |

Beispiel in `compose.yaml`:

```yaml
    environment:
      NAS_GATEWAY: dsm
      DSM_URL: http://172.17.0.1:5000
```

* `172.17.0.1` ist die Docker-Bridge der NAS; der Verkehr verlässt das Gerät
  nicht. Bitte prüfen, dass der Container das DSM darüber erreicht.
* Aus Sicht des DSM kommen alle Anmeldungen von der Container-Adresse.
  Damit die automatische Blockierung nicht den Server aussperrt, die
  Container-Adresse in DSM → Sicherheit → Schutz in die Zulassungsliste
  aufnehmen.
* Bei `https` mit selbstsigniertem Zertifikat schlägt die Prüfung fehl; die
  Zertifikatsprüfung wird bewusst nicht abgeschaltet.
* `local` ist nicht für den Betrieb gedacht; beim Start erscheint eine
  Warnung im Log.

## Sitzungen und Datenordner

Nach der Anmeldung am DSM stellt `sem-server` eine eigene App-Sitzung aus.
Sie liegt in der SQLite-Datei `sem.db` (nur der Hash des Tokens, kein
Passwort) und überlebt damit Neustarts des Containers.

| Variable | Bedeutung |
|---|---|
| `DATA_DIR` | Ordner für `sem.db`, im Beispiel `/data`; ohne Angabe liegen Sitzungen nur im Speicher und der Start warnt |
| `SESSION_TTL_DAYS` | Tage ohne Nutzung bis zum Ablauf, Vorgabe `30` |
| `TRUST_PROXY` | `true` hinter dem DSM-Reverse-Proxy, damit `X-Forwarded-Proto` zählt und das Cookie bei HTTPS `Secure` ist; Vorgabe `false` |

* Der Ordner `docker/sem-server/data` (neben `compose.yaml`) muss vor dem
  ersten Start existieren und für UID 1000 beschreibbar sein: Der Container
  läuft als Benutzer `node` (UID 1000). `read_only: true` bleibt gesetzt, nur
  `/data` ist beschreibbar.
* Wird ein DSM-Konto gesperrt, bleibt eine bestehende App-Sitzung bis zum
  Ablauf gültig. Abhilfe: Datei `sem.db` löschen (alle müssen sich neu
  anmelden) oder `SESSION_TTL_DAYS` verkürzen.
* Nach 5 fehlgeschlagenen Anmeldungen eines Benutzernamens innerhalb von
  10 Minuten antwortet der Server mit „429“, ohne das DSM zu fragen.

## Haus-Viewer aus Home Assistant

`sem-server` kann den Haus-Viewer, der in Home Assistant unter `/local/haus/`
liegt, an angemeldete Benutzer durchreichen. Der Viewer wird dabei nicht
verändert; der Server holt die Dateien ab und liefert sie unter seiner eigenen
Adresse aus (ohne `X-Frame-Options`, damit die App ihn einbetten kann). Ein
Home-Assistant-Token ist nicht nötig, `/local/` ist dort ohne Anmeldung lesbar.

| Variable | Bedeutung |
|---|---|
| `HAUS_VIEWER_BASE_URL` | URL des Ordners, z. B. `http://192.168.1.20:8123/local/haus/`; ein fehlender abschließender `/` wird ergänzt. Ohne Angabe ist die Funktion aus (`not_configured`) |
| `HAUS_VIEWER_ENTRY` | Einstiegsdatei im Ordner, Vorgabe `viewer.html` |

* Der **Container** muss Home Assistant erreichen. Tailscale läuft auf DSM
  üblicherweise im Userspace-Modus; dann kommen Container nicht ins Tailnet
  und lösen `*.ts.net` nicht auf. In dem Fall die LAN-Adresse von Home
  Assistant eintragen.
* Der Client lädt three.js (unpkg) und die Schriften (Google Fonts) weiterhin
  selbst und braucht dafür Internet.
* Jede Sitzung bekommt einen eigenen Schlüssel im Pfad
  (`/api/haus/viewer/k/<schlüssel>/…`). Er erlischt mit der Sitzung und
  berechtigt nur zum Lesen dieser Route. Im Log wird er durch `***` ersetzt.

### Logmeldungen und Fehlersuche

Der Server schreibt (ohne Schlüssel, Token, Cookies und Zugangsdaten aus URLs):

* Beim Start einmal `haus viewer configured` mit `baseUrl` und `entry` bzw.
  `haus viewer disabled`, wenn `HAUS_VIEWER_BASE_URL` fehlt. So sieht man, welche
  Werte der laufende Container wirklich hat.
* `haus viewer probe failed` (Level `warn`), wenn die Prüfung in
  `GET /api/haus/viewer` scheitert, mit `target`, `status` oder `error` und
  `durationMs`.
* `haus viewer upstream failed` (Level `warn`), wenn das Durchreichen scheitert
  (Verbindungsfehler, abgelehnte Weiterleitung mit `location`, Antwort ≥ 500).
  Ein `404` der Quelle steht nur auf Level `debug`, weil der Viewer optionale
  Dateien abfragt.

Häufige Ursachen:

| Eintrag | Bedeutung |
|---|---|
| `error: ENOTFOUND` | Der Container löst den Namen nicht auf, z. B. `*.ts.net` bei Tailscale im Userspace-Modus → LAN-Adresse eintragen |
| `error: ECONNREFUSED`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, `TimeoutError` | Adresse oder Port falsch bzw. nicht erreichbar |
| `status: 404` | `HAUS_VIEWER_ENTRY` oder der Ordner in `HAUS_VIEWER_BASE_URL` ist falsch |

Änderungen an `compose.yaml` greifen erst, wenn der Container neu erzeugt wird
(`docker compose up -d --force-recreate` bzw. Container Manager → Projekt →
Stoppen → Erstellen); ein Neustart reicht nicht. Mit `haus viewer configured`
im Log lässt sich prüfen, ob die neuen Werte angekommen sind.

## HTTPS: `https://sem.matzen.familyds.net`

Die NAS ist bereits über die Synology-DDNS-Adresse `matzen.familyds.net`
erreichbar. sem-server bekommt eine Subdomain davon.

1. **Zertifikat:** Systemsteuerung → Sicherheit → Zertifikat. Das
   vorhandene Let's-Encrypt-Zertifikat für `matzen.familyds.net` ersetzen
   (Hinzufügen → vorhandenes Zertifikat ersetzen → Let's Encrypt) und als
   alternativen Namen `*.matzen.familyds.net` eintragen. Steht der
   Platzhalter dort schon, entfällt der Schritt.
2. **Zugriffsprofil:** Systemsteuerung → Anmeldeportal → Erweitert →
   Zugriffskontrollprofil → Erstellen, z. B. `nur-intern`: Heimnetz und
   VPN-Netz erlauben, alles andere verweigern.
3. **Reverse Proxy:** Systemsteuerung → Anmeldeportal → Erweitert →
   Reverse Proxy → Erstellen.
   * Quelle: HTTPS, Hostname `sem.matzen.familyds.net`, Port 443, HSTS an,
     Zugriffskontrollprofil `nur-intern`
   * Ziel: HTTP, `localhost`, Port `8085`
4. **Zertifikat zuordnen:** Systemsteuerung → Sicherheit → Zertifikat →
   Einstellungen: dem Eintrag `sem.matzen.familyds.net` das
   Platzhalter-Zertifikat zuweisen.
5. **Interner DNS-Eintrag** auf dem UCG-Max: `sem.matzen.familyds.net` →
   LAN-IP der NAS. VPN-Clients müssen diesen DNS-Server nutzen.

Prüfen: `https://sem.matzen.familyds.net/health` im Heimnetz und per VPN
erreichbar, ohne VPN von außen abgewiesen (403).
