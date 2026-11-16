import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createNasGateway } from './nas/index.js';

const config = loadConfig();
const app = await buildApp(config);

// Not wired into the app yet (login routes follow); creating it logs the warning for `local`.
createNasGateway(config, app.log);

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
