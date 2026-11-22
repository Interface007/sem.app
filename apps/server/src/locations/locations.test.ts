import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ApiError,
  LocationBoostList,
  LocationBoostResult,
  LocationList,
  LocationReportResult,
  LoginResponse,
} from '@sem/contracts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppConfig } from '../app.js';
import { SqliteSessionStore } from '../db/sessions.js';
import { LocalNasGateway } from '../nas/local.js';
import type { PushOutcome, PushSender } from '../push/fcm.js';
import type { LocationPersistence, StoredLocation } from './store.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const baseConfig: AppConfig = { version: '1', commit: 'c', webRoot: undefined };
const users = [
  { account: 'anna', password: 'anna-passwort' },
  { account: 'ben', password: 'ben-passwort' },
];

class CountingStore extends SqliteSessionStore {
  writes = 0;
  override get locations(): LocationPersistence {
    const inner = super.locations;
    return {
      load: () => inner.load(),
      replaceAll: (rows: readonly StoredLocation[]) => {
        this.writes += 1;
        inner.replaceAll(rows);
      },
    };
  }
}

describe('location API', () => {
  let app: FastifyInstance;
  let time: number;
  let dir: string;
  let store: CountingStore;
  let logs: string[];
  const tokens: Record<string, string> = {};
  let pushes: { token: string; data: Record<string, string>; ttl: number }[];
  let pushOutcome: PushOutcome;
  const pushSender: PushSender = {
    send: (token, data, ttl) => {
      pushes.push({ token, data, ttl });
      return Promise.resolve(pushOutcome);
    },
  };

  async function build(config: AppConfig = baseConfig): Promise<FastifyInstance> {
    const instance = await buildApp(
      { ...config, logLevel: 'info' },
      {
        nasGateway: new LocalNasGateway(users),
        now: () => time,
        sessionStore: store,
        pushSender,
        logStream: { write: (message) => logs.push(message) },
      },
    );
    for (const user of users) {
      const response = await instance.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: user.account, password: user.password, tokenDelivery: 'body' },
      });
      tokens[user.account] = LoginResponse.parse(response.json()).token ?? '';
    }
    return instance;
  }

  const report = (overrides: Record<string, unknown> = {}) => ({
    deviceId: 'device-anna-1',
    deviceName: 'Pixel',
    latitude: 48.123456,
    longitude: 11.654321,
    accuracy: 10,
    recordedAt: new Date(time).toISOString(),
    ...overrides,
  });

  const post = (user: string, body: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/locations',
      payload: body as object,
      headers: { authorization: `Bearer ${tokens[user]}` },
    });
  const list = async (user: string) =>
    LocationList.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/locations',
          headers: { authorization: `Bearer ${tokens[user]}` },
        })
      ).json(),
    ).locations;
  const del = (user: string, deviceId: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/locations/${deviceId}`,
      headers: { authorization: `Bearer ${tokens[user]}` },
    });
  const rows = () => {
    const db = new DatabaseSync(path.join(dir, 'sem.db'));
    try {
      return db.prepare('SELECT username, device_id FROM locations').all();
    } finally {
      db.close();
    }
  };

  beforeEach(async () => {
    time = Date.UTC(2026, 0, 1, 12);
    logs = [];
    pushes = [];
    pushOutcome = 'sent';
    dir = await mkdtemp(path.join(tmpdir(), 'sem-loc-'));
    store = new CountingStore(path.join(dir, 'sem.db'));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    app = await build();
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  it('answers 401 on all routes without a session', async () => {
    for (const [method, url] of [
      ['POST', '/api/locations'],
      ['GET', '/api/locations'],
      ['DELETE', '/api/locations/device-anna-1'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        ...(method === 'POST' ? { payload: report() } : {}),
      });
      expect(response.statusCode).toBe(401);
      expect(ApiError.parse(response.json()).error).toBe('unauthenticated');
    }
  });

  it("shows a user's report to others with the user from the session and the server time", async () => {
    time += 3000;
    const response = await post(
      'anna',
      report({ recordedAt: new Date(time - 3000).toISOString() }),
    );
    expect(response.statusCode).toBe(204);
    expect(await list('ben')).toEqual([
      {
        user: 'anna',
        deviceId: 'device-anna-1',
        deviceName: 'Pixel',
        latitude: 48.123456,
        longitude: 11.654321,
        accuracy: 10,
        recordedAt: new Date(time - 3000).toISOString(),
        receivedAt: new Date(time).toISOString(),
      },
    ]);
  });

  it('rejects invalid bodies, including a user field', async () => {
    for (const body of [
      report({ user: 'ben' }),
      report({ latitude: 91 }),
      report({ deviceId: 'with space' }),
      { ...report(), accuracy: undefined },
    ]) {
      const response = await post('anna', body);
      expect(response.statusCode).toBe(400);
      expect(ApiError.parse(response.json()).error).toBe('invalid_request');
    }
    expect(await list('anna')).toEqual([]);
  });

  it('rejects bodies over 2 KB', async () => {
    const response = await post('anna', report({ deviceName: 'x'.repeat(3000) }));
    expect(response.statusCode).toBe(400);
  });

  it('replaces the previous report of a device and keeps devices apart', async () => {
    await post('anna', report({ latitude: 1 }));
    time += 1000;
    await post('anna', report({ latitude: 2 }));
    expect(await list('anna')).toMatchObject([{ latitude: 2 }]);
    await post('anna', report({ deviceId: 'device-anna-2', deviceName: 'Tablet' }));
    expect((await list('anna')).map((l) => l.deviceName)).toEqual(['Pixel', 'Tablet']);
  });

  it('sorts by user, then device name', async () => {
    await post('ben', report({ deviceId: 'device-ben-01', deviceName: 'A' }));
    await post('anna', report({ deviceId: 'device-anna-2', deviceName: 'Z' }));
    await post('anna', report({ deviceId: 'device-anna-1', deviceName: 'B' }));
    expect((await list('anna')).map((l) => `${l.user}/${l.deviceName}`)).toEqual([
      'anna/B',
      'anna/Z',
      'ben/A',
    ]);
  });

  it('discards a report older than the stored measurement', async () => {
    await post('anna', report({ latitude: 1 }));
    const response = await post(
      'anna',
      report({ latitude: 2, recordedAt: new Date(time - MINUTE).toISOString() }),
    );
    expect(response.statusCode).toBe(204);
    expect(await list('anna')).toMatchObject([{ latitude: 1 }]);
  });

  it('rejects a measurement 10 minutes in the future but allows 4', async () => {
    const future = await post(
      'anna',
      report({ recordedAt: new Date(time + 10 * MINUTE).toISOString() }),
    );
    expect(future.statusCode).toBe(400);
    const near = await post(
      'anna',
      report({ recordedAt: new Date(time + 4 * MINUTE).toISOString() }),
    );
    expect(near.statusCode).toBe(204);
  });

  it('drops entries after the retention limit from the response and the database', async () => {
    await post('anna', report());
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(rows()).toHaveLength(1);

    time += 24 * HOUR - 1;
    expect(await list('ben')).toHaveLength(1);
    time += 1;
    expect(await list('ben')).toEqual([]);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(rows()).toEqual([]);
  });

  it('honours LOCATION_MAX_AGE_HOURS', async () => {
    await app.close();
    store = new CountingStore(path.join(dir, 'other.db'));
    app = await build({ ...baseConfig, locationMaxAgeHours: 1 });
    await post('anna', report());
    time += HOUR;
    expect(await list('anna')).toEqual([]);
  });

  describe('delete', () => {
    it('removes the own entry, answers 204 for unknown devices', async () => {
      await post('anna', report());
      expect((await del('anna', 'device-anna-1')).statusCode).toBe(204);
      expect(await list('anna')).toEqual([]);
      expect((await del('anna', 'device-anna-1')).statusCode).toBe(204);
    });

    it('answers 403 for a device of another user and keeps the entry', async () => {
      await post('anna', report());
      const response = await del('ben', 'device-anna-1');
      expect(response.statusCode).toBe(403);
      expect(ApiError.parse(response.json()).error).toBe('forbidden');
      expect(await list('ben')).toHaveLength(1);
    });

    it('treats the same deviceId under two users as separate entries', async () => {
      await post('anna', report());
      await post('ben', report());
      expect(await list('anna')).toHaveLength(2);
      expect((await del('ben', 'device-anna-1')).statusCode).toBe(204);
      expect((await list('anna')).map((l) => l.user)).toEqual(['anna']);
    });

    it('rejects a malformed device id', async () => {
      expect((await del('anna', 'x')).statusCode).toBe(400);
    });
  });

  describe('persistence', () => {
    it('writes at most once per interval for 100 reports', async () => {
      for (let i = 0; i < 100; i += 1) {
        time += 100;
        await post('anna', report({ latitude: i % 90 }));
      }
      expect(store.writes).toBe(0);
      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(store.writes).toBe(1);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(store.writes).toBe(1);
    });

    it('restores the latest state after a restart with the same database', async () => {
      await post('anna', report({ latitude: 1 }));
      await post('anna', report({ latitude: 2 }));
      await app.close();

      store = new CountingStore(path.join(dir, 'sem.db'));
      app = await build();
      expect(await list('ben')).toMatchObject([{ user: 'anna', latitude: 2 }]);
    });

    it('adds the push token column to a database of schema version 3', async () => {
      await app.close();
      const file = path.join(dir, 'v3.db');
      const db = new DatabaseSync(file);
      db.exec(`
        CREATE TABLE sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL, sid TEXT NOT NULL, created_at INTEGER NOT NULL,
          extended_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, viewer_key TEXT);
        CREATE TABLE locations (username TEXT NOT NULL, device_id TEXT NOT NULL,
          device_name TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
          accuracy REAL, recorded_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
          PRIMARY KEY (username, device_id));
        PRAGMA user_version = 3;
      `);
      db.prepare('INSERT INTO locations VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        'anna',
        'device-anna-1',
        'Pixel',
        48,
        11,
        null,
        time,
        time,
      );
      db.close();

      store = new CountingStore(file);
      app = await build();
      expect(await list('ben')).toMatchObject([{ user: 'anna', latitude: 48 }]);
      await post('anna', report({ pushToken: 'token-anna' }));
      await vi.advanceTimersByTimeAsync(60 * 1000);
      const check = new DatabaseSync(file, { readOnly: true });
      expect(check.prepare('SELECT push_token FROM locations').all()).toEqual([
        { push_token: 'token-anna' },
      ]);
      check.close();
    });

    it('does not restore entries that expired while the server was down', async () => {
      await post('anna', report());
      await app.close();

      time += 25 * HOUR;
      store = new CountingStore(path.join(dir, 'sem.db'));
      app = await build();
      expect(await list('ben')).toEqual([]);
    });
  });

  describe('boost', () => {
    const auth = (user: string) => ({ authorization: `Bearer ${tokens[user]}` });
    const boost = (user: string, deviceId = 'device-anna-1') =>
      app.inject({ method: 'PUT', url: `/api/locations/${deviceId}/boost`, headers: auth(user) });
    const endBoost = (user: string, deviceId = 'device-anna-1') =>
      app.inject({
        method: 'DELETE',
        url: `/api/locations/${deviceId}/boost`,
        headers: auth(user),
      });
    const boostList = async (user: string) =>
      LocationBoostList.parse(
        (
          await app.inject({ method: 'GET', url: '/api/locations/boosts', headers: auth(user) })
        ).json(),
      ).boosts;

    it('answers 401 without a session', async () => {
      for (const [method, url] of [
        ['PUT', '/api/locations/device-anna-1/boost'],
        ['DELETE', '/api/locations/device-anna-1/boost'],
        ['GET', '/api/locations/boosts'],
      ] as const) {
        expect((await app.inject({ method, url })).statusCode).toBe(401);
      }
    });

    it('lets another user boost a device for 10 minutes and pushes it', async () => {
      await post('anna', report({ pushToken: 'token-anna' }));
      const response = await boost('ben');
      expect(response.statusCode).toBe(200);
      const until = new Date(time + 10 * MINUTE).toISOString();
      expect(LocationBoostResult.parse(response.json())).toEqual({
        boostUntil: until,
        pushed: true,
      });
      expect(pushes).toEqual([
        { token: 'token-anna', data: { type: 'location-boost', boostUntil: until }, ttl: 600 },
      ]);
      expect(await boostList('anna')).toEqual([{ deviceId: 'device-anna-1', boostUntil: until }]);
    });

    it('reports pushed false without a token or when FCM fails', async () => {
      await post('anna', report({ pushToken: null }));
      expect(LocationBoostResult.parse((await boost('ben')).json()).pushed).toBe(false);
      expect(pushes).toEqual([]);

      await post('anna', report({ pushToken: 'token-anna' }));
      pushOutcome = 'failed';
      expect(LocationBoostResult.parse((await boost('ben')).json()).pushed).toBe(false);
    });

    it('forgets a token that FCM reports as unregistered', async () => {
      await post('anna', report({ pushToken: 'token-anna' }));
      pushOutcome = 'invalid_token';
      await boost('ben');
      pushOutcome = 'sent';
      await boost('ben');
      expect(pushes).toHaveLength(1);
    });

    it('keeps the stored token when a report omits the field', async () => {
      await post('anna', report({ pushToken: 'token-anna' }));
      time += 1000;
      await post('anna', report());
      await boost('ben');
      expect(pushes.map((p) => p.token)).toEqual(['token-anna']);
    });

    it('answers 404 for a device without a position and 400 for a malformed id', async () => {
      expect((await boost('ben')).statusCode).toBe(404);
      expect(ApiError.parse((await boost('ben')).json()).error).toBe('not_found');
      expect((await boost('ben', 'x')).statusCode).toBe(400);
    });

    it('tells the device about the boost in the report answer until it ends', async () => {
      await post('anna', report({ pushToken: 'token-anna' }));
      const first = await post('anna', report({ pushToken: 'token-anna' }));
      expect(first.statusCode).toBe(200);
      expect(LocationReportResult.parse(first.json())).toEqual({ boostUntil: null });

      await boost('ben');
      const boosted = LocationReportResult.parse(
        (await post('anna', report({ pushToken: 'token-anna' }))).json(),
      );
      expect(boosted.boostUntil).toBe(new Date(time + 10 * MINUTE).toISOString());

      time += 10 * MINUTE;
      const ended = await post('anna', report({ pushToken: 'token-anna' }));
      expect(LocationReportResult.parse(ended.json())).toEqual({ boostUntil: null });
      expect(await boostList('ben')).toEqual([]);
    });

    it('ends a boost on request', async () => {
      await post('anna', report({ pushToken: 'token-anna' }));
      await boost('ben');
      expect((await endBoost('ben')).statusCode).toBe(204);
      expect(await boostList('ben')).toEqual([]);
      const answer = await post('anna', report({ pushToken: 'token-anna' }));
      expect(LocationReportResult.parse(answer.json())).toEqual({ boostUntil: null });
    });

    it('keeps answering 204 to apps that send no token field', async () => {
      await post('anna', report());
      await boost('ben');
      const response = await post('anna', report());
      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
    });

    it('never exposes the push token', async () => {
      await post('anna', report({ pushToken: 'token-anna' }));
      await boost('ben');
      const listed = await app.inject({
        method: 'GET',
        url: '/api/locations',
        headers: auth('ben'),
      });
      expect(listed.body).not.toContain('token-anna');
      expect(logs.join('')).not.toContain('token-anna');
    });

    it('persists the push token across a restart', async () => {
      await post('anna', report({ pushToken: 'token-anna' }));
      await app.close();
      store = new CountingStore(path.join(dir, 'sem.db'));
      app = await build();
      await boost('ben');
      expect(pushes.map((p) => p.token)).toEqual(['token-anna']);
    });
  });

  it('keeps coordinates out of the log', async () => {
    await post('anna', report());
    await list('ben');
    await del('anna', 'device-anna-1');
    const log = logs.join('');
    expect(log).toContain('/api/locations');
    expect(log).not.toContain('48.123456');
    expect(log).not.toContain('11.654321');
  });
});
