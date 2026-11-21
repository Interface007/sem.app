import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { HausViewerInfo } from '@sem/contracts';
import type { FastifyInstance } from 'fastify';
import { sendError } from '../auth/routes.js';
import type { SessionService } from '../auth/session-service.js';

const ROUTE = '/api/haus/viewer';
const KEY_PREFIX = `${ROUTE}/k/`;
/** The source must answer the `HEAD` for `GET /api/haus/viewer` within this time. */
const PROBE_TIMEOUT_MS = 5000;
/** Time until the source starts to answer; the body itself is not limited. */
const HEADERS_TIMEOUT_MS = 30000;

/** Request headers that are passed on to the source; never `Authorization` or `Cookie`. */
const FORWARDED_REQUEST_HEADERS = ['range', 'if-none-match', 'if-modified-since', 'accept'];
/** Response headers taken from the source; everything else is dropped. */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
];

export interface HausDeps {
  /** Folder URL with a trailing slash; the feature is off if unset. */
  baseUrl: string | undefined;
  /** Entry file relative to `baseUrl`. */
  entry: string;
  sessions: SessionService;
}

/** Replaces the key in a viewer URL so that it can be logged. */
export function maskViewerKey(url: string): string {
  return url.replace(/^(\/api\/haus\/viewer\/k\/)[^/?#]*/, '$1***');
}

/**
 * Turns the raw (still encoded) path below the key into a path that stays
 * inside the base folder; `undefined` if it could leave it.
 */
export function safeRelativePath(rawPath: string): string | undefined {
  if (rawPath === '') return '';
  for (const segment of rawPath.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (decoded === '' || decoded === '.' || decoded === '..') return undefined;
    // Rejects double encoding (`%25`), backslashes, an encoded `/`, absolute
    // URLs (`http://…`) and control characters.
    if (/[%\\/:]/.test(decoded)) return undefined;
    if ([...decoded].some((char) => char.charCodeAt(0) < 0x20 || char === '\u007f')) {
      return undefined;
    }
  }
  return rawPath;
}

/** Removes userinfo (`user:password@`) from a URL so that it can be logged. */
export function redactUrl(url: string | URL): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '[invalid url]';
  }
  parsed.username = '';
  parsed.password = '';
  return parsed.href;
}

/** Short reason for a failed `fetch`: the network error code, else the error name. */
export function fetchErrorCode(err: unknown): string {
  const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === 'string' && code !== '') return code;
  return err instanceof Error ? err.name : 'UnknownError';
}

function version(headers: Headers): string {
  const source = headers.get('etag') ?? headers.get('last-modified') ?? '';
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

export function registerHausRoutes(app: FastifyInstance, deps: HausDeps): void {
  const { baseUrl, entry, sessions } = deps;

  if (baseUrl === undefined) {
    app.log.info('haus viewer disabled');
  } else {
    app.log.info({ baseUrl: redactUrl(baseUrl), entry }, 'haus viewer configured');
  }

  app.get(ROUTE, { preHandler: app.requireSession }, async (request, reply) => {
    void reply.header('Cache-Control', 'no-store');
    if (baseUrl === undefined) {
      return HausViewerInfo.parse({ available: false, reason: 'not_configured' });
    }
    const probeTarget = new URL(entry, baseUrl);
    const started = Date.now();
    try {
      const response = await fetch(probeTarget, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) {
        request.log.warn(
          {
            target: redactUrl(probeTarget),
            status: response.status,
            durationMs: Date.now() - started,
          },
          'haus viewer probe failed',
        );
        return HausViewerInfo.parse({ available: false, reason: 'unreachable' });
      }
      const key = sessions.viewerKey(request.session.id);
      const encodedEntry = entry.split('/').map(encodeURIComponent).join('/');
      return HausViewerInfo.parse({
        available: true,
        path: `${KEY_PREFIX}${key}/${encodedEntry}?v=${version(response.headers)}`,
      });
    } catch (err) {
      request.log.warn(
        {
          target: redactUrl(probeTarget),
          error: fetchErrorCode(err),
          durationMs: Date.now() - started,
        },
        'haus viewer probe failed',
      );
      return HausViewerInfo.parse({ available: false, reason: 'unreachable' });
    }
  });

  app.route<{ Params: { key: string } }>({
    method: ['GET', 'HEAD'],
    url: `${KEY_PREFIX}:key/*`,
    handler: async (request, reply) => {
      if (!sessions.isValidViewerKey(request.params.key)) {
        return sendError(reply, 401, 'unauthenticated');
      }
      if (baseUrl === undefined) return sendError(reply, 502, 'haus_unavailable');

      // Work on the raw URL: Fastify has already decoded the wildcard once.
      const raw = request.raw.url ?? '';
      const queryStart = raw.indexOf('?');
      const rawPath = queryStart < 0 ? raw : raw.slice(0, queryStart);
      const query = queryStart < 0 ? '' : raw.slice(queryStart);
      // The key is validated to be plain characters, so its raw length is exact.
      const relative = safeRelativePath(
        rawPath.slice(KEY_PREFIX.length + request.params.key.length + 1),
      );
      if (relative === undefined) return sendError(reply, 400, 'invalid_request');

      const target = new URL(relative + query, baseUrl);
      if (!target.href.startsWith(baseUrl)) return sendError(reply, 400, 'invalid_request');

      const headers = new Headers({ 'accept-encoding': 'identity' });
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = request.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, HEADERS_TIMEOUT_MS);
      let upstream: Response;
      try {
        upstream = await fetch(target, {
          method: request.method,
          headers,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (err) {
        request.log.warn(
          { target: redactUrl(target), error: fetchErrorCode(err) },
          'haus viewer upstream failed',
        );
        return sendError(reply, 502, 'haus_unavailable');
      } finally {
        clearTimeout(timer);
      }
      // Redirects are not followed: they could lead to any host.
      if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
        await upstream.body?.cancel();
        const location = upstream.headers.get('location');
        request.log.warn(
          {
            target: redactUrl(target),
            status: upstream.status,
            ...(location === null ? {} : { location: redactUrl(new URL(location, target)) }),
          },
          'haus viewer upstream failed',
        );
        return sendError(reply, 502, 'haus_unavailable');
      }
      // The viewer asks for optional files (e.g. `wp_datenblatt.json`), so 404 is normal.
      if (upstream.status >= 500) {
        request.log.warn(
          { target: redactUrl(target), status: upstream.status },
          'haus viewer upstream failed',
        );
      } else if (upstream.status === 404) {
        request.log.debug(
          { target: redactUrl(target), status: upstream.status },
          'haus viewer upstream not found',
        );
      }

      void reply.code(upstream.status);
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value === null) continue;
        // The body is already decoded if the source compressed it anyway.
        if (name === 'content-length' && upstream.headers.has('content-encoding')) continue;
        void reply.header(name, value);
      }
      // Always revalidate (`304` via ETag/Last-Modified), whatever the source says.
      void reply
        .header('Cache-Control', 'private, no-cache')
        .header('Content-Security-Policy', "frame-ancestors 'self'")
        .header('Referrer-Policy', 'no-referrer')
        .header('X-Content-Type-Options', 'nosniff');

      if (upstream.body === null || request.method === 'HEAD') {
        await upstream.body?.cancel();
        return reply.send();
      }
      return reply.send(Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>));
    },
  });
}
