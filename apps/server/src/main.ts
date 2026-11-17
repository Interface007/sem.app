import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openSessionStore } from './db/sessions.js';
import { createNasGateway } from './nas/index.js';

const config = loadConfig();

// The logger only exists once the app is built; keep early warnings for it.
const warnings: string[] = [];
const collector = { warn: (message: string) => warnings.push(message) };

const app = await buildApp(config, {
  nasGateway: createNasGateway(config, collector),
  sessionStore: openSessionStore(config.dataDir, collector),
});
for (const message of warnings) app.log.warn(message);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
