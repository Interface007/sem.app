# AGENTS.md — Regeln für alle Agents in sem.app

Diese Datei ist die **einzige** Quelle für Agent-Anweisungen. `CLAUDE.md` und
`.github/copilot-instructions.md` verweisen nur hierher. Hintergrund und
Begründungen: `docs/architektur.md`.

## Projekt in einem Satz

Persönliche App (Android + Browser) mit Modulen wie Haus-Modell und
Dokumentenscan, Backend als Container auf einer Synology-NAS im Heimnetz.

## Stack (fest)

* TypeScript überall, `strict: true`. Kein `any` ohne begründenden Kommentar.
* pnpm-Workspaces: `apps/mobile` (Expo, Android + Web), `apps/server`
  (Node.js LTS), `packages/contracts` (zod-Schemas, geteilte Typen).
* Tests: Vitest (Unit), Playwright (`e2e/web`), Maestro (`e2e/android`).

## Harte Randbedingungen

* **Zielplattform des Servers: `linux/amd64`, Intel Celeron J4125 ohne
  AVX/AVX2.** Keine Abhängigkeit mit nativen Binaries ohne Prüfung. Kein Bun.
  Keine ML-/Inferenz-Bibliotheken auf dem Server.
* **API-Verträge leben nur in `packages/contracts`.** App und Server
  importieren von dort; keine doppelt definierten Typen.
* **Dateien für synOCR atomar schreiben**: erst temporärer Name im selben
  Verzeichnis, dann Umbenennen.
* **Der Haus-Viewer ist ein fremdes Artefakt** aus dem Repo `home`. Nicht
  nachbauen, nicht verändern — nur einbetten (iframe bzw. WebView) und über
  das `postMessage`-Protokoll in `packages/contracts` ansprechen.
* **Keine Zugangsdaten im Client.** Tokens (Home Assistant u. a.) bleiben im
  Server.
* Keine neuen Laufzeit-Abhängigkeiten ohne Begründung in der PR-Beschreibung.

## Nicht anfassen

* `.github/workflows/`, `AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`, `CODEOWNERS`
* Secrets, Branch-Protection, Repository-Einstellungen

Wird eine Änderung dort nötig: im PR beschreiben, nicht selbst durchführen.

## Arbeitsweise

* Ein Issue → ein Branch → ein PR. PR-Beschreibung: was, warum, wie getestet.
* Vor dem Abschluss lokal: `pnpm typecheck && pnpm lint && pnpm test`.
* Neue Funktion = neuer Test. Kein Test, der nur `true` prüft.
* Fehler nicht durch Abschwächen von Tests, Typen oder Lint-Regeln beheben.
* Unklare Anforderung: im Issue nachfragen statt raten.

## Sprache

* Code, Bezeichner und Commit-Nachrichten: Englisch.
* Oberflächentexte der App und Dokumentation: Deutsch mit echten Umlauten.
