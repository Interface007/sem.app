import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { Health } from '@sem/contracts';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { registerAuth, sendError } from './auth/routes.js';
import { SessionService } from './auth/session-service.js';
import type { Config } from './config.js';
import { SqliteSessionStore, type SessionStore } from './db/sessions.js';
import { UnconfiguredNasGateway, type NasGateway } from './nas/index.js';
import { maskViewerKey, registerHausRoutes } from './haus/routes.js';
import { registerLocationRoutes } from './locations/routes.js';
import { MemoryLocationStore } from './locations/store.js';
import { registerUpdateRoutes } from './updates.js';

export type AppConfig = Pick<Config, 'version' | 'commit' | 'webRoot'> &
  Partial<
    Pick<
      Config,
      | 'updatesDir'
      | 'updatesPrivateKeyPath'
      | 'updatesBaseUrl'
      | 'sessionTtlDays'
      | 'trustProxy'
      | 'hausViewerBaseUrl'
      | 'hausViewerEntry'
      | 'locationMaxAgeHours'
      | 'locationFlushSeconds'
    >
  > & {
    logLevel?: Config['logLevel'];
  };

export interface AppDeps {
  nasGateway?: NasGateway;
  /** Closed together with the app. In-memory if omitted. */
  sessionStore?: SessionStore;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Destination of the log output; stdout if omitted. */
  logStream?: { write(message: string): void };
}

const HOUR_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = HOUR_MS;

export async function buildApp(config: AppConfig, deps: AppDeps = {}): Promise<FastifyInstance> {
  const logLevel = config.logLevel ?? 'silent';
  // The viewer key is part of the URL path and must not reach the log.
  const serializers = {
    req: (request: FastifyRequest) => ({
      method: request.method,
      url: maskViewerKey(request.url),
      host: request.host,
      remoteAddress: request.ip,
      remotePort: request.socket.remotePort ?? 0,
    }),
  };
  const app = Fastify({
    logger:
      deps.logStream === undefined
        ? { level: logLevel, serializers }
        : { level: logLevel, serializers, stream: deps.logStream },
    trustProxy: config.trustProxy ?? false,
  });

  // Uniform error format below /api; everything else keeps Fastify's default.
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (request.url.startsWith('/api/') && status >= 400 && status < 500) {
      return sendError(reply, 400, 'invalid_request');
    }
    return reply.send(error);
  });

  const now = deps.now ?? Date.now;
  const store = deps.sessionStore ?? new SqliteSessionStore(':memory:');
  const sessions = new SessionService(store, now, config.sessionTtlDays ?? 30);
  sessions.deleteExpired();
  const cleanup = setInterval(() => {
    sessions.deleteExpired();
  }, CLEANUP_INTERVAL_MS);
  cleanup.unref();
  const locations = new MemoryLocationStore({
    persistence: store.locations,
    now,
    maxAgeMs: (config.locationMaxAgeHours ?? 24) * HOUR_MS,
  });
  const locationFlush = setInterval(
    () => {
      try {
        locations.tick();
      } catch {
        // Not logged with details; the next tick retries.
        app.log.error('writing locations failed');
      }
    },
    (config.locationFlushSeconds ?? 60) * 1000,
  );
  locationFlush.unref();
  app.addHook('onClose', async () => {
    clearInterval(cleanup);
    clearInterval(locationFlush);
    // Locations first: they are written to the database that `store` closes.
    try {
      locations.close();
    } finally {
      store.close();
    }
  });

  // The container health check polls this every 30 s; keep its requests out
  // of the log, but never log more than configured.
  const quiet = ['error', 'fatal', 'silent'].includes(logLevel) ? logLevel : 'warn';
  app.get('/health', { logLevel: quiet }, async () =>
    Health.parse({ status: 'ok', version: config.version, commit: config.commit }),
  );

  registerAuth(app, { nasGateway: deps.nasGateway ?? new UnconfiguredNasGateway(), sessions, now });

  registerHausRoutes(app, {
    baseUrl: config.hausViewerBaseUrl,
    entry: config.hausViewerEntry ?? 'viewer.html',
    sessions,
  });

  registerLocationRoutes(app, { store: locations, now });

  registerUpdateRoutes(app, {
    dir: config.updatesDir,
    privateKeyPath: config.updatesPrivateKeyPath,
    baseUrl: config.updatesBaseUrl,
  });

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
