import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ApiError, LoginResponse, SessionResponse } from '@sem/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppDeps } from '../app.js';
import { SqliteSessionStore, type SessionStore } from '../db/sessions.js';
import type { NasGateway, NasLoginFailure, NasLoginResult, NasSession } from '../nas/gateway.js';
import { LocalNasGateway } from '../nas/local.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const baseConfig = { version: '1', commit: 'c', webRoot: undefined };
const users = [
  { account: 'Anna', password: 'geheim-passwort' },
  { account: 'ben', password: 'ben-passwort', otpCode: '482915' },
];

function login(
  app: FastifyInstance,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'anna', password: 'geheim-passwort', tokenDelivery: 'body', ...body },
    headers,
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function loginToken(app: FastifyInstance): Promise<string> {
  const token = LoginResponse.parse((await login(app, {})).json()).token;
  if (token === undefined) throw new Error('no token');
  return token;
}

class SpyGateway implements NasGateway {
  logins: unknown[] = [];
  logouts: NasSession[] = [];
  logoutError: Error | undefined;
  constructor(
    private readonly inner: NasGateway,
    private readonly sid?: string,
  ) {}

  async login(credentials: Parameters<NasGateway['login']>[0]): Promise<NasLoginResult> {
    this.logins.push(credentials);
    const result = await this.inner.login(credentials);
    if (result.ok && this.sid !== undefined) {
      return { ok: true, session: { ...result.session, sid: this.sid } };
    }
    return result;
  }

  logout(session: NasSession): Promise<void> {
    this.logouts.push(session);
    return this.logoutError === undefined
      ? this.inner.logout(session)
      : Promise.reject(this.logoutError);
  }
}

describe('auth API', () => {
  let app: FastifyInstance;
  let gateway: SpyGateway;
  let time: number;
  const deps = (): AppDeps => ({ nasGateway: gateway, now: () => time });

  beforeEach(async () => {
    time = Date.UTC(2026, 0, 1);
    gateway = new SpyGateway(new LocalNasGateway(users));
    app = await buildApp(baseConfig, deps());
  });

  afterEach(async () => {
    await app.close();
  });

  describe('login', () => {
    it('returns a token in the body and the session can be read with it', async () => {
      const response = await login(app, { username: ' Anna ' });
      expect(response.statusCode).toBe(200);
      const body = LoginResponse.parse(response.json());
      expect(body.user).toEqual({ name: 'anna' });
      expect(body.expiresAt).toBe(new Date(time + 30 * DAY).toISOString());
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(response.headers['set-cookie']).toBeUndefined();

      const session = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: bearer(body.token ?? ''),
      });
      expect(session.statusCode).toBe(200);
      expect(SessionResponse.parse(session.json()).user).toEqual({ name: 'anna' });
    });

    it('sets an HttpOnly cookie and no token in the body for cookie delivery', async () => {
      const response = await login(app, { tokenDelivery: 'cookie' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).not.toHaveProperty('token');
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toMatch(/^sem_session=[A-Za-z0-9_-]{43};/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain(`Max-Age=${30 * 86400}`);
      expect(cookie).not.toContain('Secure');

      const session = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: { cookie: cookie.split(';')[0] ?? '' },
      });
      expect(session.statusCode).toBe(200);
    });

    it('sets Secure only for HTTPS behind a trusted proxy', async () => {
      const trusted = await buildApp({ ...baseConfig, trustProxy: true }, deps());
      const https = await login(
        trusted,
        { tokenDelivery: 'cookie' },
        {
          'x-forwarded-proto': 'https',
        },
      );
      expect(String(https.headers['set-cookie'])).toContain('; Secure');
      const http = await login(
        trusted,
        { tokenDelivery: 'cookie' },
        {
          'x-forwarded-proto': 'http',
        },
      );
      expect(String(http.headers['set-cookie'])).not.toContain('Secure');
      await trusted.close();

      const untrusted = await login(
        app,
        { tokenDelivery: 'cookie' },
        {
          'x-forwarded-proto': 'https',
        },
      );
      expect(String(untrusted.headers['set-cookie'])).not.toContain('Secure');
    });

    it('passes the OTP on to the gateway', async () => {
      const response = await login(app, {
        username: 'ben',
        password: 'ben-passwort',
        otp: '482915',
      });
      expect(response.statusCode).toBe(200);
      expect(gateway.logins).toEqual([
        { account: 'ben', password: 'ben-passwort', otpCode: '482915' },
      ]);
    });

    it.each<[NasLoginFailure, number, string]>([
      ['invalid_credentials', 401, 'invalid_credentials'],
      ['otp_required', 401, 'otp_required'],
      ['otp_invalid', 401, 'otp_invalid'],
      ['account_blocked', 403, 'account_blocked'],
      ['unavailable', 503, 'nas_unavailable'],
    ])('maps gateway reason %s to %i %s', async (reason, status, code) => {
      const failing = await buildApp(baseConfig, {
        nasGateway: { login: () => Promise.resolve({ ok: false, reason }), logout: vi.fn() },
      });
      const response = await login(failing, {});
      expect(response.statusCode).toBe(status);
      expect(ApiError.parse(response.json()).error).toBe(code);
      await failing.close();
    });

    it('answers 503 when the gateway throws', async () => {
      const broken = await buildApp(baseConfig, {
        nasGateway: { login: () => Promise.reject(new Error('boom')), logout: vi.fn() },
      });
      const response = await login(broken, {});
      expect(response.statusCode).toBe(503);
      expect(ApiError.parse(response.json()).error).toBe('nas_unavailable');
      await broken.close();
    });

    it('answers 503 nas_unavailable without a configured gateway', async () => {
      const bare = await buildApp(baseConfig);
      const response = await login(bare, {});
      expect(response.statusCode).toBe(503);
      expect(ApiError.parse(response.json()).error).toBe('nas_unavailable');
      await bare.close();
    });

    it.each([
      ['an OTP with 5 digits', { otp: '12345' }],
      ['an empty password', { password: '' }],
      ['an unknown field', { extra: true }],
    ])('rejects %s with 400 and does not ask the gateway', async (_name, body) => {
      const response = await login(app, body);
      expect(response.statusCode).toBe(400);
      expect(ApiError.parse(response.json()).error).toBe('invalid_request');
      expect(gateway.logins).toHaveLength(0);
    });

    it('rejects malformed JSON with the uniform error format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: '{nope',
      });
      expect(response.statusCode).toBe(400);
      expect(ApiError.parse(response.json()).error).toBe('invalid_request');
    });
  });

  describe('rate limit', () => {
    it('blocks a user name after 5 failures without asking the gateway', async () => {
      for (let i = 0; i < 5; i++) {
        expect((await login(app, { password: 'falsch' })).statusCode).toBe(401);
      }
      expect(gateway.logins).toHaveLength(5);

      const blocked = await login(app, { username: 'ANNA' });
      expect(blocked.statusCode).toBe(429);
      expect(ApiError.parse(blocked.json()).error).toBe('rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBe(600);
      expect(gateway.logins).toHaveLength(5);

      // Other user names are unaffected.
      expect(
        (await login(app, { username: 'ben', password: 'ben-passwort', otp: '482915' })).statusCode,
      ).toBe(200);

      // The window passes.
      time += 10 * 60 * 1000 + 1;
      expect((await login(app, {})).statusCode).toBe(200);
    });

    it('is reset by a successful login', async () => {
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 4; i++) await login(app, { password: 'falsch' });
        expect((await login(app, {})).statusCode).toBe(200);
      }
    });

    it('does not count a missing OTP as a failure', async () => {
      for (let i = 0; i < 6; i++) {
        const response = await login(app, { username: 'ben', password: 'ben-passwort' });
        expect(ApiError.parse(response.json()).error).toBe('otp_required');
      }
    });
  });

  describe('session', () => {
    it.each([
      ['without credentials', {}],
      ['with an unknown token', bearer('unbekannt')],
      ['with a malformed header', { authorization: 'Basic abc' }],
    ])('answers 401 unauthenticated %s', async (_name, headers) => {
      const response = await app.inject({ method: 'GET', url: '/api/auth/session', headers });
      expect(response.statusCode).toBe(401);
      expect(ApiError.parse(response.json()).error).toBe('unauthenticated');
    });

    it('protects routes with requireSession and sets request.session', async () => {
      app.get('/api/whoami', { preHandler: app.requireSession }, (request) => ({
        id: request.session.id,
        user: request.session.user,
      }));
      const token = await loginToken(app);
      const anonymous = await app.inject({ method: 'GET', url: '/api/whoami' });
      expect(anonymous.statusCode).toBe(401);
      const named = await app.inject({ method: 'GET', url: '/api/whoami', headers: bearer(token) });
      expect(named.json()).toMatchObject({ user: 'anna' });
    });

    it('keeps /health and the update manifest open', async () => {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      const manifest = await app.inject({ method: 'GET', url: '/api/updates/manifest' });
      expect(manifest.statusCode).not.toBe(401);
    });
  });

  describe('logout', () => {
    it('revokes the session and logs out of the DSM with its sid', async () => {
      const token = await loginToken(app);
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: bearer(token),
      });
      expect(response.statusCode).toBe(204);
      expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
      expect(gateway.logouts).toHaveLength(1);
      expect(gateway.logouts[0]).toMatchObject({ account: 'anna' });
      expect(gateway.logouts[0]?.sid).toBeTruthy();

      const after = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: bearer(token),
      });
      expect(after.statusCode).toBe(401);
    });

    it('still revokes the session if the NAS is unreachable', async () => {
      gateway.logoutError = new Error('unreachable');
      const token = await loginToken(app);
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: bearer(token),
      });
      expect(response.statusCode).toBe(204);
      const after = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: bearer(token),
      });
      expect(after.statusCode).toBe(401);
    });

    it('answers 204 without a valid session', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
      expect(response.statusCode).toBe(204);
      expect(gateway.logouts).toHaveLength(0);
    });
  });

  describe('expiry', () => {
    const session = (token: string) =>
      app.inject({ method: 'GET', url: '/api/auth/session', headers: bearer(token) });

    it('expires a session after 30 days without use', async () => {
      const token = await loginToken(app);
      time += 30 * DAY - 1;
      expect((await session(token)).statusCode).toBe(200);
      time += 30 * DAY;
      expect((await session(token)).statusCode).toBe(401);
    });

    it('honours SESSION_TTL_DAYS', async () => {
      const short = await buildApp({ ...baseConfig, sessionTtlDays: 1 }, deps());
      const token = await loginToken(short);
      time += DAY;
      const response = await short.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: bearer(token),
      });
      expect(response.statusCode).toBe(401);
      await short.close();
    });

    it('is extended by use', async () => {
      const token = await loginToken(app);
      time += 20 * DAY;
      const extended = SessionResponse.parse((await session(token)).json());
      expect(extended.expiresAt).toBe(new Date(time + 30 * DAY).toISOString());
      time += 29 * DAY;
      expect((await session(token)).statusCode).toBe(200);
    });

    it('writes the extension at most once per hour', async () => {
      const store = new SqliteSessionStore(':memory:');
      const extend = vi.spyOn(store, 'extend');
      const counted = await buildApp(baseConfig, { ...deps(), sessionStore: store });
      const token = await loginToken(counted);
      const call = () =>
        counted.inject({ method: 'GET', url: '/api/auth/session', headers: bearer(token) });

      for (let i = 0; i < 20; i++) {
        time += 10 * 1000;
        await call();
      }
      expect(extend).not.toHaveBeenCalled();

      time += HOUR;
      await call();
      expect(extend).toHaveBeenCalledTimes(1);
      time += 10 * 1000;
      await call();
      expect(extend).toHaveBeenCalledTimes(1);
      time += HOUR;
      await call();
      expect(extend).toHaveBeenCalledTimes(2);
      await counted.close();
    });
  });
});

describe('persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sem-db-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const build = (store: SessionStore) =>
    buildApp(baseConfig, {
      nasGateway: new LocalNasGateway(users),
      sessionStore: store,
    });

  it('keeps sessions across a restart and stores neither token nor password', async () => {
    const file = path.join(dir, 'data', 'sem.db');
    const first = await build(new SqliteSessionStore(file));
    const token = await loginToken(first);
    await first.close();

    const second = await build(new SqliteSessionStore(file));
    const response = await second.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);
    await second.close();

    const db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare('SELECT * FROM sessions').all();
    const version = db.prepare('PRAGMA user_version').get();
    db.close();
    expect(rows).toHaveLength(1);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain('geheim-passwort');
    expect(rows[0]).toMatchObject({ username: 'anna' });
    expect(rows[0]).toHaveProperty('token_hash');
    expect(version).toEqual({ user_version: 3 });
  });

  it('refuses a database from a newer version', () => {
    const file = path.join(dir, 'new.db');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => new SqliteSessionStore(file)).toThrow(/newer/);
  });

  it('removes expired sessions', async () => {
    const store = new SqliteSessionStore(':memory:');
    store.create({ id: 'a', tokenHash: 'h1', user: 'u', sid: 's', now: 0, expiresAt: 10 });
    store.create({ id: 'b', tokenHash: 'h2', user: 'u', sid: 's', now: 0, expiresAt: 20 });
    store.deleteExpired(10);
    expect(store.findByTokenHash('h1')).toBeUndefined();
    expect(store.findByTokenHash('h2')?.id).toBe('b');
    store.close();
  });
});

describe('logging', () => {
  it('never writes passwords, OTP codes, tokens or the DSM sid, even on trace', async () => {
    const lines: string[] = [];
    const sid = 'DSM-SID-0f9e8d7c6b5a';
    const app = await buildApp(
      { ...baseConfig, logLevel: 'trace' },
      {
        nasGateway: new SpyGateway(new LocalNasGateway(users), sid),
        logStream: { write: (line) => void lines.push(line) },
      },
    );
    const response = await login(app, {
      username: 'ben',
      password: 'ben-passwort',
      otp: '482915',
      tokenDelivery: 'body',
    });
    const token = LoginResponse.parse(response.json()).token ?? '';
    await app.inject({ method: 'GET', url: '/api/auth/session', headers: bearer(token) });
    await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: `sem_session=${token}` },
    });
    await login(app, { password: 'falsch-passwort-xyz' });
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(token) });
    await app.close();

    const output = lines.join('');
    expect(output).toContain('/api/auth/login');
    for (const secret of ['ben-passwort', '482915', token, sid, 'falsch-passwort-xyz']) {
      expect(output).not.toContain(secret);
    }
  });
});
