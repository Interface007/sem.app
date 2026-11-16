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
