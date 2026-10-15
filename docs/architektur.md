# sem.app — Architekturkonzept

Stand: 2026-10-15 · Status: Entwurf v0.1

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
| Scan | Dokumente scannen bzw. hochladen, Ablage im synOCR-Eingang auf dem NAS | Archiv der Originale, Verlauf |
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
 Android-App ─┐                       ┌─ synOCR-Eingang (Bind-Mount, rw)
              ├─HTTPS─▶ sem-server ───┼─ Originale-Archiv (Bind-Mount, rw)
 Browser ─────┘   (Container auf      ├─ Haus-Modell-Artefakte (ro)
                   der DS225+)        └─ Home Assistant (REST, später)
       ▲
       └─ von unterwegs nur per VPN (UniFi UCG-Max)
```

* `sem-server` liefert API **und** die Web-Version der App aus. Ein Container.
* HTTPS über den DSM-Reverse-Proxy mit Zertifikat (Pflicht für sicheren
  Kontext im Browser: Kamera, Service Worker).
* Anmeldung auch hinter dem VPN.

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

Daraus folgt die Kopplung:

* Das `home`-Repo veröffentlicht `viewer.html`, `viewer.css`, `viewer/`,
  `haus.glb` und `haus.meta.json` als versioniertes Paket (z. B.
  GitHub-Release). Der Build läuft dort lokal (Windows, `.venv`); eine
  CI-Pipeline im `home`-Repo ist eine spätere Option.
* `sem-server` stellt eine bestimmte Version bereit (Bind-Mount, nur lesend).
* Die Factory fasst das `home`-Repo **nie** an.

Offene Punkte am Viewer (im `home`-Repo zu lösen, nicht in sem.app):

* three.js kommt per Import-Map von unpkg — braucht Internet. Für die App
  sollte es mitgeliefert werden (Vendoring).
* Google Fonts werden extern geladen — ebenso.

### 5.2 Scan

* Android: nativer Dokumentenscanner (ML Kit Document Scanner, Kanten- und
  Perspektivkorrektur). Web: Datei-Upload / Drag & Drop.
* Upload an `sem-server`, der
  1. das Original mit SHA-256 im Archiv ablegt,
  2. die Datei **atomar** in den synOCR-Eingang schreibt (temporärer Name,
     danach Umbenennen), damit synOCR nie eine halbe Datei greift.
* Die OCR selbst bleibt bei synOCR.

## 6. Zielumgebung (NAS)

| Merkmal | Wert | Folge |
|---|---|---|
| Gerät | Synology DS225+, DSM 7.4.1 | Container Manager (Compose-Projekt) |
| CPU | Intel Celeron J4125, **ohne AVX/AVX2** | keine Binaries mit AVX-Voraussetzung |
| RAM | 10 GB | unkritisch |
| Platten | 5 TB, 3 TB frei | Archiv der Originale möglich |
| Nachbarn | synOCR, Calibre, Jellyfin | eigener DSM-Benutzer für den Container |

Image: `linux/amd64`, Node.js LTS. Bun und ML-Bibliotheken nur nach Prüfung
(viele Builds setzen AVX2 voraus).

## 7. Repository-Struktur

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
├─ docs/
├─ AGENTS.md           Regeln für alle Agents (eine Quelle)
├─ CLAUDE.md           Verweis auf AGENTS.md
└─ .github/
   ├─ copilot-instructions.md   Verweis auf AGENTS.md
   └─ workflows/
```

pnpm-Workspaces, `strict: true`, ESLint, Vitest in jedem Paket.

## 8. Factory

### 8.1 Ablauf

```
Issue + Label "factory"
  → Agent (Claude Code oder Copilot CLI, headless) → Branch + PR
  → Gates: Typecheck · Lint · Unit · Build · E2E Web · Holdout · AVX-Smoke
  → Review-Agent
  → Merge (anfangs durch Sven; später automatisch, wenn die Pass-Rate stabil ist)
  → Image nach GHCR → Deployment aufs NAS (anfangs manuell)
```

### 8.2 Agent-Austauschbarkeit

* Gates sind reine GitHub Actions und kennen den Agent nicht.
* Instruktionen nur in `AGENTS.md`; `CLAUDE.md` und
  `.github/copilot-instructions.md` verweisen darauf.
* Ein Adapter-Skript (`tools/run-agent`) kapselt die Unterschiede:
  Claude Code (`claude-code-action`, OAuth-Token des Pro-Abos) oder
  Copilot CLI (`copilot -p … --no-ask-user`).
* Das Pro-Abo wird nur mit offiziellen Anthropic-Werkzeugen genutzt.

### 8.3 Holdout-Szenarien

Akzeptanzszenarien in einem **separaten privaten Repo** (`sem.app-holdout`),
auf das Coding-Agents keinen Zugriff haben. Ein eigener Workflow lässt sie
gegen das gebaute Artefakt laufen. Erste Kandidaten:

* Scan-Upload landet genau einmal, vollständig und unter erwartetem Namen im
  Eingangsordner; das Original liegt mit korrekter Prüfsumme im Archiv.
* Ein abgebrochener Upload hinterlässt nichts im Eingangsordner.
* Der eingebettete Viewer zeigt dieselben Bauteile wie `haus_viewer.html`
  (Anzahl je Geschoss und Gruppe).
* Messwerte erreichen den Viewer nur über das Protokoll; ein Wert älter als
  eine Stunde wird als alt markiert.

### 8.4 Verifikation

* Der Großteil der Flows wird gegen die **Web-Version** mit Playwright
  geprüft (schnell, kein Emulator).
* Der Android-Emulator nur für native Teile (Scanner, WebView-Brücke).
* AVX-Smoke: Das fertige Image startet unter QEMU mit einem CPU-Modell ohne
  AVX und beantwortet `/health`.

### 8.5 Messen (das eigentliche Ergebnis)

Pro Issue erfassen: Agent, Modell, Tokens bzw. geschätzte Kosten,
Laufzeit, Anzahl Fix-Runden, Gate-Ergebnisse, Holdout-Pass-Rate, ob ein
Mensch eingreifen musste. Dazu: wie oft das 5-Stunden- bzw. Wochenlimit
des Abos erreicht wurde.

### 8.6 Leitplanken

* Agents dürfen `.github/workflows/`, `AGENTS.md`, Secrets und
  Branch-Protection nicht ändern (CODEOWNERS + Pfad-Check als Gate).
* Kein Self-Hosted-Runner im Heimnetz.
* `--max-turns`, Job-Timeouts, Concurrency-Limit.
* Nur minimale Workflow-Rechte.

## 9. Phasen

1. **Gerüst** (interaktiv mit Claude Code): Monorepo, Gates, `/health`,
   leere App-Hülle mit Modulnavigation, Container-Build.
2. **Scan** über die Factory: Upload-Endpunkt, atomare Ablage, Archiv;
   App-Modul Web, dann Android.
3. **Haus**: Viewer-Paket aus dem `home`-Repo bereitstellen, Einbettung
   Web und Android.
4. **Home Assistant**: Messwerte über `sem-server` an den Viewer.
5. Autonomie erhöhen: Auto-Merge, automatisches Deployment.

## 10. Offene Fragen

* Anmeldung: lokale Konten in sem-server, Synology-SSO oder etwas anderes?
* Verteilung der APK: Sideload aus GitHub-Release oder Play Console
  (interner Testtrack)?
* Pfade auf dem NAS: synOCR-Eingangsordner, Archivordner.
* Wo baut das `home`-Repo seine Viewer-Pakete (lokal oder CI)?
