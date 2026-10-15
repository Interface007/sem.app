# Phase 1 — Gerüst

Ziel: ein lauffähiges, leeres Grundgerüst mit allen Gates, auf dem ab
Phase 2 die Factory arbeitet. Phase 1 läuft **interaktiv** in Claude Code mit
Sven; Workflows und Regeldateien dürfen hier ausdrücklich angelegt werden.

Regeln: `AGENTS.md`. Hintergrund: `docs/architektur.md`.

Arbeitsweise: ein Schritt nach dem anderen, je Schritt erst Plan, dann
Umsetzung, dann Commit. Nach jedem Schritt anhalten und das Ergebnis
zeigen. Ein Schritt ist erst fertig, wenn seine Abnahme erfüllt ist.

## Festlegungen für Phase 1

Damit nicht jeder Lauf neu abwägt:

* Paketmanager: pnpm (über Corepack), Node.js 24 (LTS), `.nvmrc` mit `24`.
  Wechsel auf Node 26 erst, wenn es LTS ist, als eigenes Issue.
* Server-Framework: **Fastify** mit zod-Typen aus `packages/contracts`.
* App: Expo (aktuelles SDK) mit Expo Router, TypeScript-Vorlage.
* Tests: Vitest; E2E Web: Playwright; Android-E2E kommt später (Maestro).
* Container: mehrstufiges Dockerfile, Basis `node:<lts>-slim`,
  `linux/amd64`, läuft als Nicht-Root-Benutzer.

## Schritte

### 1. Monorepo-Grundgerüst
pnpm-Workspace mit `apps/*` und `packages/*`, gemeinsame `tsconfig.base.json`
(`strict: true`), ESLint, Prettier, Vitest. Wurzel-Skripte: `typecheck`,
`lint`, `test`, `build`. `.gitignore`, `.editorconfig`, `README.md`.
**Abnahme:** `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
läuft fehlerfrei durch.

### 2. `packages/contracts`
zod-Schemas für: `Health` (`status`, `version`, `commit`), das
Viewer-Protokoll aus `docs/architektur.md` 5.1 (beide Nachrichtentypen).
Daraus exportierte Typen.
**Abnahme:** Unit-Tests für gültige und ungültige Beispiele beider
Viewer-Nachrichten.

### 3. `apps/server`
Fastify-Server mit `GET /health` (Antwort gegen `Health` validiert). Liefert
später die Web-Version der App als statische Dateien aus (Ordner
konfigurierbar). Konfiguration nur über Umgebungsvariablen, mit zod geprüft.
Dockerfile.
**Abnahme:** Unit-Test für `/health`; `docker build` erzeugt ein Image, das
startet und `/health` beantwortet.

### 4. `apps/mobile`
Expo-App mit Expo Router. Navigation mit vier Bereichen: Start, Haus, Scan,
Einstellungen — alle außer Start als Platzhalter. Start zeigt den Status von
`/health` (Server-URL konfigurierbar). Web-Export wird in das Image aus
Schritt 3 übernommen.
**Abnahme:** `expo export --platform web` baut; Playwright-Test: Startseite
lädt und zeigt „ok“ aus `/health`.

### 5. CI-Gates (`.github/workflows/ci.yml`)
Bei jedem PR und Push auf `main`: install, typecheck, lint, unit, build,
Playwright gegen den laufenden Container, Docker-Build.
**AVX-Smoke:** Das Image (bzw. dessen `node`-Binary) startet unter
QEMU-Benutzermodus mit einem CPU-Modell ohne AVX (z. B. `-cpu Denverton`,
Goldmont-Familie wie der J4125) und beantwortet `/health` bzw. führt einen
Startcheck aus. Ein Gegentest belegt, dass der Check bei einer
AVX-Anweisung tatsächlich fehlschlägt.
**Abnahme:** Workflow läuft auf einem Test-PR grün; Image wird bei Push auf
`main` nach GHCR geschoben.

### 6. Android-Build (`.github/workflows/android.yml`)
`expo prebuild` + Gradle `assembleRelease`, signiert mit dem Schlüssel aus
den Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Bei Tag `v*`: APK als
GitHub-Release. Dazu `tools/install-apk.ps1`: neueste APK per
`gh release download` holen, Gerät per `adb devices` prüfen,
`adb install -r`; Parameter für kabelloses `adb connect`.
**Abnahme:** Release `v0.1.0` enthält eine APK, die per Skript auf Svens
Handy installiert und startet.

### 7. Schutz der Regeldateien
`CODEOWNERS` für `.github/`, `AGENTS.md`, `CLAUDE.md`. Ein Gate, das PRs
mit dem Label `factory` scheitern lässt, wenn sie diese Pfade ändern.
**Abnahme:** Test-PR mit Label und Änderung an `AGENTS.md` wird rot.

### 8. Factory-Verdrahtung
`tools/run-agent` (Adapter Claude Code / Copilot CLI), Workflow
`factory.yml`: Issue mit Label `factory` → Agent → PR. `--max-turns`,
Timeout, Concurrency 1. Pro Lauf eine JSON-Zeile mit Messwerten
(`docs/architektur.md` 10.5) als Artefakt. Gerüst des Holdout-Workflows,
der das private Repo `sem.app-holdout` auscheckt und ausführt.
**Abnahme:** Probe-Issue „Version und Commit in der Fußzeile der App
anzeigen“ wird von der Factory als PR umgesetzt und besteht alle Gates.

## Was Sven von Hand erledigt

Diese Schritte brauchen deine Konten oder dein Gerät und gehören nicht in
einen Agent-Lauf:

* vor Schritt 1: Werkzeuge installieren (siehe unten), diese Dokumente
  committen und pushen.
* vor Schritt 5: Branch-Protection für `main` (PR Pflicht, Status-Checks
  Pflicht, sobald der Workflow existiert).
* vor Schritt 6: Release-Schlüssel erzeugen
  (`keytool -genkeypair -v -keystore sem-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias sem`),
  **sicher aufbewahren** (ohne ihn keine Updates mehr) und als Secrets
  hinterlegen; am Handy USB-Debugging einschalten.
* vor Schritt 8: in Claude Code `/install-github-app` ausführen bzw.
  `claude setup-token` und das Token als Secret `CLAUDE_CODE_OAUTH_TOKEN`
  hinterlegen; privates Repo `sem.app-holdout` anlegen und ein
  Fine-grained-Token mit Lesezugriff nur darauf als Secret hinterlegen.

## Werkzeuge auf dem PC

Node.js LTS, Corepack/pnpm, Git, GitHub CLI (`gh`), Docker Desktop, Claude
Code; für die Installation auf dem Handy die Android Platform Tools (`adb`).
Für lokale Android-Builds zusätzlich **JDK 17** (React Native empfiehlt 17;
neuere JDKs verlangen eine angepasste Gradle-Version) und das Android SDK
(Android Studio). In CI wird JDK 17 fest eingestellt.
