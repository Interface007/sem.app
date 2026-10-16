# sem.app — Architekturkonzept

Stand: 2026-10-15 · Status: Entwurf v0.2

## 1. Zweck

Eine persönliche App, die mehrere Funktionen rund um Haus und Haushalt bündelt.
Zugleich ist sie das Versuchsobjekt für eine **Software Factory**: KI-Agents
setzen Issues bis zum Pull Request um, automatische Gates entscheiden über den
Merge. Das Budget, das so ein Betrieb braucht, ist ein *Ergebnis* des Projekts,
keine Vorgabe.

Erste Module:

| Modul | Inhalt | Ausbau |
|---|---|---|
| Haus | 3D-Modell aus dem `home`-Repo ansehen | später Messwerte aus Home Assistant |
| Scan | Dokumente scannen bzw. hochladen, Ablage in einem synOCR-Eingang auf dem NAS | Archiv der Originale, Verlauf |
| … | weitere Module nach Bedarf | |

## 2. Zielplattformen

* **Android** (einziges Mobilziel)
* **Browser** am PC

iOS ist ausdrücklich kein Ziel. Damit entfallen macOS-Runner und
Apple-Signierung.

## 3. Technologieentscheidung

Kriterium ist allein die Eignung für das Vorhaben und für die Arbeit der
Factory (Generieren, Refactoring, Erweitern) sowie die Ausführung auf den
Geräten — nicht die Vorlieben oder Kenntnisse des Eigentümers.

**Entscheidung: TypeScript durchgängig.**

* App: React Native mit Expo (Expo Router), daraus Android **und** Web aus
  einer Codebasis (react-native-web).
* Backend: Node.js LTS, TypeScript.
* Gemeinsame Verträge: ein Paket mit zod-Schemas und daraus abgeleiteten
  Typen, genutzt von App und Backend.

Begründung in Kürze:

* Typisierung fängt den Großteil der Agent-Fehler beim Bauen ab. In einer
  Studie zu LLM-generiertem TypeScript waren 94 % der Kompilierfehler
  Typfehler (Mündler et al., *Type-Constrained Code Generation*, arXiv
  2504.09246). Typchecks machen Refactorings sicher.
* TypeScript ist seit 08/2025 die meistgenutzte Sprache auf GitHub
  (Octoverse 2025) — viel Trainingsmaterial, verlässliche Agent-Ergebnisse.
* Eine Sprache für App, Backend und Tests: Ändert ein Agent den API-Vertrag,
  bricht der Build auf beiden Seiten. Keine Vertragsdrift.
* Das 3D-Ökosystem (three.js) lebt in JavaScript, und der vorhandene Viewer
  ist bereits JavaScript (siehe 5.1).

Verworfene Alternativen: Flutter (Dart, schwaches 3D-Ökosystem, keine
gemeinsame Sprache mit dem Backend), nativ Kotlin (eine zweite Codebasis für
Web), .NET MAUI (kleineres Ökosystem, kein vollwertiges Web-Ziel), reine PWA
(schwächerer Kamera-Scan).

## 4. Systemübersicht

```
 Android-App ─┐                         ┌─ DSM-Anmeldung (SYNO.API.Auth)
              ├─HTTPS─▶ sem-server ─────┼─ File Station API (im Kontext
 Browser ─────┘   (Container auf        │    des angemeldeten Benutzers)
                   der DS225+)          └─ Home Assistant (REST, später)
       ▲
       └─ von unterwegs nur per VPN (UniFi UCG-Max)
```

* `sem-server` liefert API **und** die Web-Version der App aus. Ein Container.
* HTTPS über den DSM-Reverse-Proxy unter `https://sem.matzen.familyds.net`
  (Platzhalter-Zertifikat der Synology-DDNS-Adresse, Zugriffsprofil nur
  Heimnetz und VPN). Pflicht für sicheren Kontext im Browser: Kamera,
  Service Worker. Details: `docs/betrieb-nas.md`.
* Der Container braucht **keine** Schreib-Mounts auf Nutzerdaten. Alle
  Dateizugriffe laufen über die File Station API mit der Sitzung des
  angemeldeten DSM-Benutzers (siehe 6).
* Eigener Zustand (Einstellungen, Protokoll) in SQLite auf einem Volume des
  Containers.

## 5. Module

### 5.1 Haus — Wiederverwendung des vorhandenen Viewers

Das `home`-Repo hat bereits einen ausgereiften Viewer: three.js, ES-Module
unter `modell/viewer/*.js`, mit Schnitt, Bauteilbaum, Messen, Begehen,
Fensterzuständen und Messwert-Schildern. Er ist für die Einbettung gebaut —
die Lovelace-Karte `home-assistant/haus-modell-card.js` nutzt ihn als iframe.

**Entscheidung: Der Viewer wird nicht neu geschrieben, sondern eingebettet.**

* Web: iframe. Android: `react-native-webview`.
* Die Schnittstelle existiert schon als `postMessage`-Protokoll:

  | Richtung | Nachricht |
  |---|---|
  | Viewer → Host | `{typ:"haus-modell/entitaeten", entitaeten:[…]}` |
  | Host → Viewer | `{typ:"haus-modell/messwerte", werte:{"sensor.x":{wert,einheit,alter}}}` |

  sem.app übernimmt dieselbe Rolle wie die Lovelace-Karte: Sie holt die Werte
  über `sem-server` aus Home Assistant und reicht sie hinein. Der Viewer kennt
  nie Zugangsdaten — diese Eigenschaft bleibt erhalten.
* In `packages/contracts` wird dieses Protokoll als zod-Schema festgehalten.
  Es ist ein Vertrag zwischen zwei Repos und braucht einen Vertragstest.

Fakten aus dem `home`-Repo, auf die sich sem.app verlässt:

* Quelle der Wahrheit ist `modell/haus.yaml`; Kette
  `build_ifc.py → ifc_to_glb.py → bundle.py` (Python, ifcopenshell).
* glTF-Node-Namen sind exakt die IFC-GlobalId (`use-element-guids`).
* `haus.meta.json` ist ein Objekt `GlobalId → {typ, gruppe, name, geschoss,
  material?, psets?}`.
* GlobalIds sind deterministisch (`GUID_NAMESPACE`), `haus.ids.json` bildet
  `"klasse:ID"` auf `{guid, klasse, name}` ab.
* Home-Assistant-Zuordnungen stehen als `Pset_HomeAssistant` in den Metadaten.
* `*.glb` und `*.meta.json` sind im `home`-Repo **nicht** versioniert.
* Gebaut wird auf Svens Windows-PC (`.venv`, `modell/bauen.py`).

**Kopplung: Viewer-Paket über einen NAS-Ordner.**

* Ein Export im `home`-Repo (Vorbild: `werkzeuge/ha_export.py`, das heute
  schon dieselben Dateien nach Home Assistant kopiert) schreibt nach jedem
  Build ein **versioniertes Paket** in einen NAS-Ordner, etwa
  `…/haus-viewer/2026-10-15T1630/` — über Synology Drive oder eine
  SMB-Freigabe.
* Inhalt: `viewer.html`, `viewer.css`, `viewer/*.js`, `haus.glb`,
  `haus.meta.json`, `haus.ids.json` und zuletzt eine `manifest.json` mit
  Version und SHA-256 jeder Datei.
* `sem-server` nimmt nur Pakete an, deren Manifest vollständig ist und deren
  Prüfsummen stimmen. Ein halb synchronisierter Ordner wird so nie
  ausgeliefert. Der Basisordner ist zur Laufzeit wählbar (siehe 6).
* Die Factory fasst das `home`-Repo **nie** an.

Vorarbeiten im `home`-Repo (dort umzusetzen, nicht in sem.app):

* Export-Ziel „sem" mit Manifest.
* three.js und Schriften mitliefern statt von unpkg bzw. Google Fonts laden.

### 5.2 Scan

* Android: nativer Dokumentenscanner (ML Kit Document Scanner, Kanten- und
  Perspektivkorrektur, Ausgabe als PDF). Web: Datei-Upload / Drag & Drop.
* Beim Scannen wählt man ein **Scan-Ziel** (z. B. „Rechnungen", „Steuer");
  eines ist Vorgabe. Ziele werden in der Web-Version gepflegt (siehe 6).
* Upload an `sem-server`, der im Kontext des angemeldeten Benutzers
  1. optional das Original in den Archivordner legt (Prüfsumme im Namen oder
     im Protokoll),
  2. die Datei **atomar** im Zielordner ablegt: Upload unter
     `.<uuid>.part`, danach Umbenennen in den endgültigen Namen. synOCR sieht
     nie eine halbe Datei.
* Die OCR selbst bleibt bei synOCR. Vor dem ersten Einsatz einmal von Hand
  prüfen, dass synOCR `.part`-Dateien ignoriert.

## 6. Anmeldung und Ordnerwahl

**Entscheidung v1: Anmeldung mit dem DSM-Benutzer über die DSM-Web-API.**

* Die App sendet Benutzername, Passwort und ggf. OTP-Code an `sem-server`.
  Der meldet sich per `SYNO.API.Auth` (Sitzung `FileStation`) am DSM an und
  bekommt eine Sitzungs-ID. Gespeichert wird nur diese Sitzung, **nie** das
  Passwort.
* Alle Dateioperationen laufen über `SYNO.FileStation.*` mit dieser Sitzung.
  Damit gelten automatisch die DSM-Rechte des Benutzers: Er sieht und
  beschreibt nur Freigaben, die ihm in DSM erlaubt sind.
* Das Merken eines Geräts, damit nicht bei jeder Anmeldung ein OTP nötig ist,
  sieht die API vor (Geräte-Token). Im Gerüst verifizieren.
* App-Sitzung: eigenes, kurzlebiges Token von `sem-server` (httpOnly-Cookie im
  Browser, sicherer Speicher auf Android).

Verworfene bzw. zurückgestellte Alternative: **Synology SSO Server** (OIDC,
mit Secure SignIn). Sauberer, weil das Passwort `sem-server` nie erreicht —
aber ein OIDC-Token ergibt keine File-Station-Sitzung. Der Server müsste dann
mit einem eigenen Dienstkonto schreiben und Benutzerrechte selbst
nachbilden. Für v1 zu viel; für später vorgemerkt.

**Ordnerwahl zur Laufzeit (Web-Version, Seite „Einstellungen"):**

* Ordnerbrowser über `SYNO.FileStation.List` (Freigaben, Unterordner) im
  Kontext des Benutzers.
* Einstellbar: Scan-Ziele (Name + Ordner, eines als Vorgabe), Archivordner,
  Basisordner der Viewer-Pakete.
* Gespeichert je Benutzer in `sem-server`. Die Android-App liest sie nur.

**Testbarkeit für die Factory:** Der NAS-Zugriff liegt hinter einer
Schnittstelle `NasGateway` mit zwei Implementierungen: File Station API
(Produktion) und lokales Dateisystem (Tests, Entwicklung). Dazu ein
Vertragstest gegen eine aufgezeichnete bzw. nachgebildete File-Station-API.
Agents arbeiten nie gegen das echte NAS.

## 7. Zielumgebung (NAS)

| Merkmal | Wert | Folge |
|---|---|---|
| Gerät | Synology DS225+, DSM 7.4.1 | Container Manager (Compose-Projekt) |
| CPU | Intel Celeron J4125, **ohne AVX/AVX2** | keine Binaries mit AVX-Voraussetzung |
| RAM | 10 GB | unkritisch |
| Platten | 5 TB, 3 TB frei | Archiv der Originale möglich |
| Nachbarn | synOCR, Calibre, Jellyfin | — |

Image: `linux/amd64`, Node.js LTS. Bun und ML-Bibliotheken nur nach Prüfung
(viele Builds setzen AVX2 voraus).

## 8. Verteilung der Android-App

* GitHub Actions baut die APK (`expo prebuild` + Gradle, kein kostenpflichtiger
  Cloud-Build) und signiert sie mit einem **festen** Release-Schlüssel aus den
  Repository-Secrets. Ohne festen Schlüssel ließe sich kein Update über eine
  installierte Version spielen.
* Die APK wird als GitHub-Release veröffentlicht.
* Installation, Stufe 1: Skript `tools/install-apk.ps1` auf dem PC — lädt die
  neueste APK (`gh release download`) und installiert sie per
  `adb install -r`. Per USB oder kabellos (Android „Wireless Debugging",
  `adb pair` / `adb connect`). Voraussetzung: Entwickleroptionen,
  USB-Debugging, einmalige Freigabe des PC-Schlüssels am Handy.
* Installation, Stufe 2 (optional): Obtainium auf dem Handy beobachtet die
  GitHub-Releases (bei privatem Repo mit lesendem Token) und bietet Updates
  an. Installation mit einem Fingertipp; ganz ohne Bestätigung nur mit
  Shizuku.

## 9. Repository-Struktur

```
sem.app/
├─ apps/
│  ├─ mobile/          Expo: Android + Web
│  └─ server/          Node.js (Fastify oder Hono)
├─ packages/
│  └─ contracts/       zod-Schemas, Typen, Viewer-Protokoll
├─ e2e/
│  ├─ web/             Playwright
│  └─ android/         Maestro
├─ tools/              install-apk.ps1 u. a.
├─ docs/
├─ AGENTS.md           Regeln für alle Agents (eine Quelle)
├─ CLAUDE.md           Verweis auf AGENTS.md
└─ .github/
   ├─ copilot-instructions.md   Verweis auf AGENTS.md
   └─ workflows/
```

pnpm-Workspaces, `strict: true`, ESLint, Vitest in jedem Paket.

## 10. Factory

### 10.1 Ablauf

```
Issue + Label "factory"
  → Agent (Claude Code oder Copilot CLI, headless) → Branch + PR
  → Gates: Typecheck · Lint · Unit · Build · E2E Web · Holdout · AVX-Smoke
  → Review-Agent
  → Merge (anfangs durch Sven; später automatisch, wenn die Pass-Rate stabil ist)
  → Image nach GHCR / APK als Release → Deployment (anfangs manuell)
```

### 10.2 Agent-Austauschbarkeit

* Gates sind reine GitHub Actions und kennen den Agent nicht.
* Instruktionen nur in `AGENTS.md`; `CLAUDE.md` und
  `.github/copilot-instructions.md` verweisen darauf.
* Ein Adapter-Skript (`tools/run-agent`) kapselt die Unterschiede:
  Claude Code (`claude-code-action`, OAuth-Token des Pro-Abos) oder
  Copilot CLI (`copilot -p … --no-ask-user`).
* Das Pro-Abo wird nur mit offiziellen Anthropic-Werkzeugen genutzt.

### 10.3 Holdout-Szenarien

Akzeptanzszenarien in einem **separaten privaten Repo** (`sem.app-holdout`),
auf das Coding-Agents keinen Zugriff haben. Ein eigener Workflow lässt sie
gegen das gebaute Artefakt laufen (mit der lokalen `NasGateway`-Variante).
Erste Kandidaten:

* Scan-Upload landet genau einmal, vollständig und unter erwartetem Namen im
  Zielordner; das Original liegt mit korrekter Prüfsumme im Archiv.
* Ein abgebrochener Upload hinterlässt im Zielordner keine Datei ohne
  `.part`-Endung.
* Ein Benutzer kann keinen Ordner außerhalb seiner Freigaben als Ziel setzen.
* Ein Viewer-Paket mit fehlender Datei oder falscher Prüfsumme wird nicht
  ausgeliefert; das vorherige gültige bleibt aktiv.
* Der eingebettete Viewer zeigt dieselben Bauteile wie `haus_viewer.html`
  (Anzahl je Geschoss und Gruppe).
* Messwerte erreichen den Viewer nur über das Protokoll; ein Wert älter als
  eine Stunde wird als alt markiert.

### 10.4 Verifikation

* Der Großteil der Flows wird gegen die **Web-Version** mit Playwright
  geprüft (schnell, kein Emulator).
* Der Android-Emulator nur für native Teile (Scanner, WebView-Brücke).
* AVX-Smoke: Das fertige Image startet unter QEMU mit einem CPU-Modell ohne
  AVX und beantwortet `/health`.

### 10.5 Messen (das eigentliche Ergebnis)

Pro Issue erfassen: Agent, Modell, Tokens bzw. geschätzte Kosten,
Laufzeit, Anzahl Fix-Runden, Gate-Ergebnisse, Holdout-Pass-Rate, ob ein
Mensch eingreifen musste. Dazu: wie oft das 5-Stunden- bzw. Wochenlimit
des Abos erreicht wurde.

### 10.6 Leitplanken

* Agents dürfen `.github/workflows/`, `AGENTS.md`, Secrets und
  Branch-Protection nicht ändern (CODEOWNERS + Pfad-Check als Gate).
* Kein Self-Hosted-Runner im Heimnetz. Agents erreichen das NAS nie.
* `--max-turns`, Job-Timeouts, Concurrency-Limit.
* Nur minimale Workflow-Rechte.

## 11. Phasen

1. **Gerüst** (interaktiv mit Claude Code): Monorepo, Gates, `/health`,
   leere App-Hülle mit Modulnavigation, Container-Build, APK-Build mit
   festem Schlüssel, `install-apk.ps1`.
2. **Anmeldung und Einstellungen** über die Factory: DSM-Login,
   `NasGateway`, Ordnerbrowser, Scan-Ziele.
3. **Scan**: Upload-Endpunkt, atomare Ablage, Archiv; App-Modul Web, dann
   Android.
4. **Haus**: Export im `home`-Repo (von Hand), Paketprüfung und Einbettung
   in sem.app (Factory).
5. **Home Assistant**: Messwerte über `sem-server` an den Viewer.
6. Autonomie erhöhen: Auto-Merge, automatisches Deployment.

## 12. Offene Fragen

* Ist für den DSM-Benutzer 2FA aktiv? Davon hängt der OTP-Dialog ab.
* Synology Drive oder SMB als Weg vom PC zum Viewer-Ordner?
