import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { Health } from '@sem/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';

export type AppConfig = Pick<Config, 'version' | 'commit' | 'webRoot'> & {
  logLevel?: Config['logLevel'];
};

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel ?? 'silent' } });

  // The container health check polls this every 30 s; keep it out of the log.
  app.get('/health', { logLevel: 'warn' }, async () =>
    Health.parse({ status: 'ok', version: config.version, commit: config.commit }),
  );

  if (config.webRoot) {
    await app.register(fastifyStatic, {
      root: path.resolve(config.webRoot),
      wildcard: false,
    });

    // Client-side routes (e.g. /haus) have no file of their own; the app shell
    // handles them. Anything that is not a GET for an HTML page stays a 404.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  return app;
}
