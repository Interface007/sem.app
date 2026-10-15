# sem.app

Persönliche App (Android + Browser) mit Modulen wie Haus-Modell und
Dokumentenscan. Das Backend läuft als Container auf einer Synology-NAS im
Heimnetz.

- Regeln für Agents: [AGENTS.md](AGENTS.md)
- Architektur: [docs/architektur.md](docs/architektur.md)
- Aufbauplan: [docs/phase1.md](docs/phase1.md)

## Aufbau

| Pfad                 | Inhalt                                 |
| -------------------- | -------------------------------------- |
| `apps/mobile`        | Expo-App (Android + Web)               |
| `apps/server`        | Fastify-Server (`sem-server`)          |
| `packages/contracts` | zod-Schemas und geteilte Typen         |
| `e2e/web`            | Playwright-Tests gegen die Web-Version |
| `tools`              | Hilfsskripte (z. B. APK-Installation)  |

## Voraussetzungen

- Node.js 24 (siehe `.nvmrc`)
- pnpm über Corepack: `corepack enable pnpm`
  (unter Windows ohne Adminrechte:
  `corepack enable --install-directory "$env:APPDATA\npm" pnpm`)
- Docker (für das Server-Image)

## Befehle

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm format` formatiert alle Dateien mit Prettier.

E2E-Tests der Web-Version (vorher `pnpm build`):

```sh
pnpm --filter @sem/e2e-web exec playwright install chromium
pnpm e2e
```

## Server-Image

```sh
docker build -f apps/server/Dockerfile --platform linux/amd64 -t sem-server .
docker run --rm -p 8080:8080 sem-server
tools/avx-smoke/run.sh sem-server   # startet das Image unter QEMU ohne AVX
```

Die NAS (Celeron J4125) hat kein AVX. Der AVX-Smoke-Test in CI prüft, dass
das Image dort startet; ein Gegentest belegt, dass eine AVX-Anweisung unter
dem verwendeten CPU-Modell tatsächlich abbricht.
