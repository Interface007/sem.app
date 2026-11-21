import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HausViewerInfo, LoginResponse } from '@sem/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { LocalNasGateway } from '../nas/local.js';
import { fetchErrorCode, maskViewerKey, redactUrl, safeRelativePath } from './routes.js';

const VIEWER_HTML = '<!doctype html><title>Haus</title>';
const BINARY = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256));
const users = [
  { account: 'anna', password: 'geheim-passwort' },
  { account: 'ben', password: 'ben-passwort' },
];

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
    server.closeAllConnections();
  });
}

describe('house viewer pass-through', () => {
  let source: Server;
  let foreign: Server;
  let seen: Seen[];
  let foreignHits: number;
  let sourceBase: string;
  let app: FastifyInstance;
  let logLines: string[];
  /** What the source sends as Cache-Control; undefined sends none. */
  let sourceCacheControl: string | undefined;
  let sourceEtag: string;
  let sourceBody: string;

  async function build(
    config: { hausViewerBaseUrl?: string | undefined } = { hausViewerBaseUrl: sourceBase },
  ): Promise<FastifyInstance> {
    return buildApp(
      {
        version: '1',
        commit: 'c',
        webRoot: undefined,
        logLevel: 'info',
        hausViewerEntry: 'viewer.html',
        ...config,
      },
      {
        nasGateway: new LocalNasGateway(users),
        logStream: {
          write: (line) => {
            logLines.push(line);
          },
        },
      },
    );
  }

  async function login(account = 'anna'): Promise<Record<string, string>> {
    const password = users.find((u) => u.account === account)?.password;
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: account, password, tokenDelivery: 'body' },
    });
    const token = LoginResponse.parse(response.json()).token;
    return { authorization: `Bearer ${token ?? ''}` };
  }

  async function info(headers: Record<string, string>): Promise<HausViewerInfo> {
    const response = await app.inject({ method: 'GET', url: '/api/haus/viewer', headers });
    expect(response.statusCode).toBe(200);
    return HausViewerInfo.parse(response.json());
  }

  async function viewerPath(headers: Record<string, string>): Promise<string> {
    const result = await info(headers);
    if (!result.available) throw new Error('viewer not available');
    return result.path;
  }

  const keyBase = (path: string): string => path.slice(0, path.indexOf('/viewer.html'));

  beforeEach(async () => {
    seen = [];
    foreignHits = 0;
    logLines = [];
    sourceCacheControl = 'public, max-age=2678400';
    sourceEtag = '"v1"';
    sourceBody = 'export const x = 1;';
    foreign = createServer((_req, res) => {
      foreignHits += 1;
      res.end('foreign');
    });
    const foreignPort = await listen(foreign);
    source = createServer((req, res) => {
      const url = req.url ?? '';
      seen.push({ method: req.method ?? '', url, headers: req.headers });
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Set-Cookie', 'ha=1');
      if (sourceCacheControl !== undefined) res.setHeader('Cache-Control', sourceCacheControl);
      res.setHeader('ETag', sourceEtag);
      const path = url.split('?')[0];
      if (path === '/local/haus/redirect') {
        res.writeHead(302, { Location: `http://127.0.0.1:${foreignPort}/evil` });
        res.end();
      } else if (req.headers['if-none-match'] === sourceEtag) {
        res.writeHead(304).end();
      } else if (path === '/local/haus/viewer.html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : VIEWER_HTML);
      } else if (path === '/local/haus/viewer/x.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(sourceBody);
      } else if (path === '/local/haus/haus.glb') {
        res.setHeader('Content-Type', 'model/gltf-binary');
        res.setHeader('Accept-Ranges', 'bytes');
        const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
        if (range?.[1] !== undefined && range[2] !== undefined) {
          const [from, to] = [Number(range[1]), Number(range[2])];
          res.writeHead(206, { 'Content-Range': `bytes ${from}-${to}/${BINARY.length}` });
          res.end(BINARY.subarray(from, to + 1));
        } else {
          res.end(BINARY);
        }
      } else {
        res.writeHead(404).end('nope');
      }
    });
    const port = await listen(source);
    sourceBase = `http://127.0.0.1:${port}/local/haus/`;
    app = await build();
  });

  afterEach(async () => {
    await app.close();
    await close(source);
    await close(foreign);
  });

  it('requires a session for the info route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/haus/viewer' });
    expect(response.statusCode).toBe(401);
  });

  it('announces a path that can be fetched', async () => {
    const path = await viewerPath(await login());
    expect(path).toMatch(/^\/api\/haus\/viewer\/k\/[\w-]{43}\/viewer\.html\?v=[0-9a-f]{12}$/);
    const response = await app.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(VIEWER_HTML);
    expect(seen.at(-1)?.url).toMatch(/^\/local\/haus\/viewer\.html\?v=[0-9a-f]{12}$/);
  });

  it('keeps the key within a session and uses another one for another session', async () => {
    const anna = await login('anna');
    const first = await viewerPath(anna);
    const second = await viewerPath(anna);
    const other = await viewerPath(await login('ben'));
    expect(second).toBe(first);
    expect(keyBase(other)).not.toBe(keyBase(first));
  });

  it('passes the file through without X-Frame-Options and with the own headers', async () => {
    const base = keyBase(await viewerPath(await login()));
    const response = await app.inject({ method: 'GET', url: `${base}/haus.glb` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-frame-options']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-type']).toBe('model/gltf-binary');
    expect(response.headers['cache-control']).toBe('private, no-cache');
    expect(response.headers.etag).toBe('"v1"');
    expect(response.rawPayload.equals(BINARY)).toBe(true);
  });

  it('answers HEAD without a body', async () => {
    const base = keyBase(await viewerPath(await login()));
    const response = await app.inject({ method: 'HEAD', url: `${base}/viewer.html` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toBe('');
    expect(seen.at(-1)?.method).toBe('HEAD');
  });

  it('passes sub paths and the query on unchanged', async () => {
    const base = keyBase(await viewerPath(await login()));
    const response = await app.inject({ method: 'GET', url: `${base}/viewer/x.js?v=1&a=%20b` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('export const x = 1;');
    expect(seen.at(-1)?.url).toBe('/local/haus/viewer/x.js?v=1&a=%20b');
  });

  it('passes the status of the source on, including 404', async () => {
    const base = keyBase(await viewerPath(await login()));
    const response = await app.inject({ method: 'GET', url: `${base}/missing.glb` });
    expect(response.statusCode).toBe(404);
  });

  it('supports range requests and conditional requests', async () => {
    const base = keyBase(await viewerPath(await login()));
    const ranged = await app.inject({
      method: 'GET',
      url: `${base}/haus.glb`,
      headers: { range: 'bytes=10-19' },
    });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers['content-range']).toBe(`bytes 10-19/${BINARY.length}`);
    expect(ranged.rawPayload.equals(BINARY.subarray(10, 20))).toBe(true);

    const conditional = await app.inject({
      method: 'GET',
      url: `${base}/haus.glb`,
      headers: { 'if-none-match': '"v1"' },
    });
    expect(conditional.statusCode).toBe(304);
  });

  it.each([['public, max-age=3600'], ['no-store'], [undefined]])(
    'forces revalidation when the source sends Cache-Control %s',
    async (value) => {
      sourceCacheControl = value;
      const base = keyBase(await viewerPath(await login()));
      const ok = await app.inject({ method: 'GET', url: `${base}/viewer/x.js` });
      const ranged = await app.inject({
        method: 'GET',
        url: `${base}/haus.glb`,
        headers: { range: 'bytes=0-3' },
      });
      const notModified = await app.inject({
        method: 'GET',
        url: `${base}/viewer/x.js`,
        headers: { 'if-none-match': '"v1"' },
      });
      const missing = await app.inject({ method: 'GET', url: `${base}/missing.glb` });
      const all = [ok, ranged, notModified, missing];
      expect(all.map((r) => r.statusCode)).toEqual([200, 206, 304, 404]);
      for (const response of all) {
        expect(response.headers['cache-control']).toBe('private, no-cache');
      }
      expect(ok.headers.etag).toBe('"v1"');
      expect(notModified.body).toBe('');
    },
  );

  it('serves the new content once the source changed its ETag', async () => {
    const base = keyBase(await viewerPath(await login()));
    const url = `${base}/viewer/x.js`;
    sourceEtag = '"v2"';
    sourceBody = 'export const x = 2;';
    const response = await app.inject({ method: 'GET', url, headers: { 'if-none-match': '"v1"' } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('export const x = 2;');
    expect(response.headers.etag).toBe('"v2"');
    const again = await app.inject({ method: 'GET', url, headers: { 'if-none-match': '"v2"' } });
    expect(again.statusCode).toBe(304);
  });

  it.each([
    ['..', '/../secret'],
    ['encoded ..', '/%2e%2e/secret'],
    ['double encoded ..', '/%252e%252e/secret'],
    ['encoded slash', '/viewer%2f..%2fsecret'],
    ['backslash', '/viewer%5c..%5csecret'],
    ['raw backslash', '/viewer\\x.js'],
    ['absolute URL', '/http://127.0.0.1:1/x'],
    ['encoded absolute URL', '/http%3A%2F%2F127.0.0.1%3A1%2Fx'],
    ['empty segment', '//viewer.html'],
  ])('rejects %s', async (_name, suffix) => {
    const base = keyBase(await viewerPath(await login()));
    const before = seen.length;
    // Over a real socket: `inject` would normalise dot segments and backslashes.
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: new URL(address).port, path: `${base}${suffix}` },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
    expect(seen).toHaveLength(before);
  });

  it('does not pass Authorization or Cookie to the source', async () => {
    const headers = await login();
    const base = keyBase(await viewerPath(headers));
    const response = await app.inject({
      method: 'GET',
      url: `${base}/viewer.html`,
      headers: { ...headers, cookie: 'sem_session=secret', accept: 'text/html' },
    });
    expect(response.statusCode).toBe(200);
    const received = seen.at(-1)?.headers;
    expect(received?.authorization).toBeUndefined();
    expect(received?.cookie).toBeUndefined();
    expect(received?.accept).toBe('text/html');
  });

  it('refuses the key after logout and an invented key', async () => {
    const headers = await login();
    const base = keyBase(await viewerPath(headers));
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    expect(logout.statusCode).toBe(204);

    const old = await app.inject({ method: 'GET', url: `${base}/viewer.html` });
    expect(old.statusCode).toBe(401);
    expect(old.json()).toMatchObject({ error: 'unauthenticated' });
    const invented = await app.inject({
      method: 'GET',
      url: `/api/haus/viewer/k/${'A'.repeat(43)}/viewer.html`,
    });
    expect(invented.statusCode).toBe(401);
  });

  it('reports an unreachable source and answers 502 when passing through', async () => {
    const headers = await login();
    const base = keyBase(await viewerPath(headers));
    await close(source);

    expect(await info(headers)).toEqual({ available: false, reason: 'unreachable' });
    const response = await app.inject({ method: 'GET', url: `${base}/viewer.html` });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: 'haus_unavailable' });
  });

  it('reports a source that answers with an error as unreachable', async () => {
    await app.close();
    app = await build({ hausViewerBaseUrl: `${sourceBase}missing/` });
    expect(await info(await login())).toEqual({ available: false, reason: 'unreachable' });
  });

  it('reports not_configured without a source', async () => {
    await app.close();
    app = await build({ hausViewerBaseUrl: undefined });
    expect(await info(await login())).toEqual({ available: false, reason: 'not_configured' });
  });

  it('does not follow redirects of the source', async () => {
    const base = keyBase(await viewerPath(await login()));
    const response = await app.inject({ method: 'GET', url: `${base}/redirect` });
    expect(response.statusCode).toBe(502);
    expect(foreignHits).toBe(0);
  });

  it('keeps the key out of the log', async () => {
    const headers = await login();
    const path = await viewerPath(headers);
    const base = keyBase(path);
    const key = base.slice(base.lastIndexOf('/') + 1);
    await app.inject({ method: 'GET', url: path });
    await app.inject({ method: 'GET', url: `${base}/haus.glb` });
    await app.inject({ method: 'GET', url: `${base}/../x` });
    await app.inject({ method: 'GET', url: `/api/haus/viewer/k/${key}x/viewer.html` });

    await close(source);
    await app.inject({ method: 'GET', url: `${base}/viewer.html` });
    await app.inject({ method: 'GET', url: `${base}/redirect` });
    await app.inject({ method: 'GET', url: '/api/haus/viewer', headers });

    const log = logLines.join('');
    expect(log).toContain('/api/haus/viewer/k/***/viewer.html');
    expect(log).not.toContain(key);
    expect(log).not.toContain(headers.authorization?.slice(7) ?? 'missing');
  });

  function entriesFor(message: string): Record<string, unknown>[] {
    return logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === message);
  }

  it('logs the cause when the source refuses connections', async () => {
    const headers = await login();
    await close(source);
    expect(await info(headers)).toEqual({ available: false, reason: 'unreachable' });
    const entries = entriesFor('haus viewer probe failed');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 40,
      target: `${sourceBase}viewer.html`,
      error: 'ECONNREFUSED',
    });
    expect(entries[0]?.reqId).toBeDefined();
    expect(typeof entries[0]?.durationMs).toBe('number');
  });

  it('logs the cause for a host that does not resolve', async () => {
    await app.close();
    app = await build({ hausViewerBaseUrl: 'http://user:pw@nicht-vorhanden.invalid/haus/' });
    expect(await info(await login())).toEqual({ available: false, reason: 'unreachable' });
    const entries = entriesFor('haus viewer probe failed');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ target: 'http://nicht-vorhanden.invalid/haus/viewer.html' });
    expect(typeof entries[0]?.error).toBe('string');
    expect(logLines.join('')).not.toContain('pw@');
  });

  it('logs the status when the source answers the probe with 404', async () => {
    await app.close();
    app = await build({ hausViewerBaseUrl: `${sourceBase}missing/` });
    await info(await login());
    const entries = entriesFor('haus viewer probe failed');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 404, target: `${sourceBase}missing/viewer.html` });
  });

  it('logs a refused redirect and a failing source when passing through', async () => {
    const base = keyBase(await viewerPath(await login()));
    await app.inject({ method: 'GET', url: `${base}/redirect` });
    const [redirect] = entriesFor('haus viewer upstream failed');
    expect(redirect).toMatchObject({
      level: 40,
      status: 302,
      target: `${sourceBase}redirect`,
      location: expect.stringContaining('/evil') as unknown,
    });

    await close(source);
    await app.inject({ method: 'GET', url: `${base}/viewer.html` });
    const entries = entriesFor('haus viewer upstream failed');
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ error: 'ECONNREFUSED' });
  });

  it('does not log successful or missing files at warn or above', async () => {
    const base = keyBase(await viewerPath(await login()));
    await app.inject({ method: 'GET', url: `${base}/viewer.html` });
    await app.inject({ method: 'GET', url: `${base}/wp_datenblatt.json` });
    const noisy = logLines
      .map((line) => JSON.parse(line) as { level: number })
      .filter((entry) => entry.level >= 40);
    expect(noisy).toEqual([]);
  });

  it('logs the effective configuration once at startup', async () => {
    const configured = entriesFor('haus viewer configured');
    expect(configured).toHaveLength(1);
    expect(configured[0]).toMatchObject({ level: 30, baseUrl: sourceBase, entry: 'viewer.html' });

    logLines = [];
    await app.close();
    app = await build({ hausViewerBaseUrl: undefined });
    expect(entriesFor('haus viewer disabled')).toHaveLength(1);
    expect(entriesFor('haus viewer configured')).toHaveLength(0);
  });
});

describe('maskViewerKey', () => {
  it.each([
    ['/api/haus/viewer/k/abc/viewer.html?v=1', '/api/haus/viewer/k/***/viewer.html?v=1'],
    ['/api/haus/viewer/k/abc', '/api/haus/viewer/k/***'],
    ['/api/haus/viewer', '/api/haus/viewer'],
    ['/health', '/health'],
  ])('masks %s', (url, expected) => {
    expect(maskViewerKey(url)).toBe(expected);
  });
});

describe('redactUrl', () => {
  it.each([
    ['http://user:secret@ha.local:8123/local/haus/', 'http://ha.local:8123/local/haus/'],
    ['http://user@ha.local/a?v=1', 'http://ha.local/a?v=1'],
    ['http://ha.local/local/haus/viewer.html', 'http://ha.local/local/haus/viewer.html'],
    ['not a url', '[invalid url]'],
  ])('redacts %s', (url, expected) => {
    expect(redactUrl(url)).toBe(expected);
  });
});

describe('fetchErrorCode', () => {
  it('prefers the cause code, then the error name', () => {
    const withCause = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    expect(fetchErrorCode(withCause)).toBe('ENOTFOUND');
    expect(fetchErrorCode(new DOMException('x', 'TimeoutError'))).toBe('TimeoutError');
    expect(fetchErrorCode('weird')).toBe('UnknownError');
  });
});

describe('safeRelativePath', () => {
  it.each(['viewer.html', 'viewer/x.js', 'a%20b.glb', ''])('accepts %j', (value) => {
    expect(safeRelativePath(value)).toBe(value);
  });

  it.each(['..', 'a/../b', '%2e%2e', '%252e%252e', 'a%5cb', 'a\\b', 'a%2fb', '%zz', 'a//b', 'x:y'])(
    'rejects %j',
    (value) => {
      expect(safeRelativePath(value)).toBeUndefined();
    },
  );
});
