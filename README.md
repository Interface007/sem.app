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
