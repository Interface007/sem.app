import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'info',
      webRoot: undefined,
      updatesDir: undefined,
      updatesPrivateKeyPath: undefined,
      updatesBaseUrl: undefined,
      hausViewerBaseUrl: undefined,
      hausViewerEntry: 'viewer.html',
      version: '0.0.0-dev',
      commit: 'unknown',
      nas: { kind: 'none' },
      dataDir: undefined,
      sessionTtlDays: 30,
      locationMaxAgeHours: 24,
      locationFlushSeconds: 60,
      trustProxy: false,
    });
  });

  it('reads location settings', () => {
    expect(
      loadConfig({ LOCATION_MAX_AGE_HOURS: '48', LOCATION_FLUSH_SECONDS: '30' }),
    ).toMatchObject({ locationMaxAgeHours: 48, locationFlushSeconds: 30 });
  });

  it.each([
    { LOCATION_MAX_AGE_HOURS: '0' },
    { LOCATION_FLUSH_SECONDS: '0' },
    { LOCATION_FLUSH_SECONDS: 'x' },
  ])('rejects invalid location settings %j', (env) => {
    expect(() => loadConfig(env)).toThrow(/Invalid configuration/);
  });

  it('reads session settings', () => {
    expect(
      loadConfig({ DATA_DIR: '/data', SESSION_TTL_DAYS: '7', TRUST_PROXY: 'true' }),
    ).toMatchObject({ dataDir: '/data', sessionTtlDays: 7, trustProxy: true });
  });

  it.each([{ SESSION_TTL_DAYS: '0' }, { SESSION_TTL_DAYS: 'x' }, { TRUST_PROXY: 'yes' }])(
    'rejects invalid session settings %j',
    (env) => {
      expect(() => loadConfig(env)).toThrow(/Invalid configuration/);
    },
  );

  it.each([
    ['http://192.168.1.20:8123/local/haus', 'http://192.168.1.20:8123/local/haus/'],
    ['http://192.168.1.20:8123/local/haus/', 'http://192.168.1.20:8123/local/haus/'],
  ])('reads the house viewer folder %s with a trailing slash', (value, expected) => {
    expect(
      loadConfig({ HAUS_VIEWER_BASE_URL: value, HAUS_VIEWER_ENTRY: 'index.html' }),
    ).toMatchObject({ hausViewerBaseUrl: expected, hausViewerEntry: 'index.html' });
  });

  it('rejects a house viewer folder that is not an http(s) URL', () => {
    expect(() => loadConfig({ HAUS_VIEWER_BASE_URL: 'ftp://nas/haus/' })).toThrow(
      /Invalid configuration/,
    );
  });

  it('reads all values from the environment', () => {
    expect(
      loadConfig({
        HOST: '127.0.0.1',
        PORT: '3000',
        LOG_LEVEL: 'debug',
        WEB_ROOT: '/srv/web',
        UPDATES_DIR: '/app/updates',
        UPDATES_PRIVATE_KEY_PATH: '/run/key.pem',
        UPDATES_BASE_URL: 'https://sem.example',
        APP_VERSION: '0.1.0',
        GIT_COMMIT: 'abc1234',
      }),
    ).toEqual({
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'debug',
      webRoot: '/srv/web',
      updatesDir: '/app/updates',
      updatesPrivateKeyPath: '/run/key.pem',
      updatesBaseUrl: 'https://sem.example',
      hausViewerBaseUrl: undefined,
      hausViewerEntry: 'viewer.html',
      version: '0.1.0',
      commit: 'abc1234',
      nas: { kind: 'none' },
      dataDir: undefined,
      sessionTtlDays: 30,
      locationMaxAgeHours: 24,
      locationFlushSeconds: 60,
      trustProxy: false,
    });
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ WEB_ROOT: '', PORT: '' })).toMatchObject({
      webRoot: undefined,
      port: 8080,
    });
  });

  describe('NAS gateway', () => {
    it('selects dsm with a URL', () => {
      expect(loadConfig({ NAS_GATEWAY: 'dsm', DSM_URL: 'http://172.17.0.1:5000' }).nas).toEqual({
        kind: 'dsm',
        url: 'http://172.17.0.1:5000',
      });
    });

    it('selects local and parses users, keeping colons in passwords', () => {
      expect(loadConfig({ NAS_GATEWAY: 'local', LOCAL_USERS: 'anna:geheim,Bob:a:b' }).nas).toEqual({
        kind: 'local',
        users: [
          { account: 'anna', password: 'geheim' },
          { account: 'Bob', password: 'a:b' },
        ],
      });
    });

    it('fails with a clear message for dsm without DSM_URL', () => {
      expect(() => loadConfig({ NAS_GATEWAY: 'dsm' })).toThrow(
        /DSM_URL is required when NAS_GATEWAY=dsm/,
      );
    });

    it('fails with a clear message for local without LOCAL_USERS', () => {
      expect(() => loadConfig({ NAS_GATEWAY: 'local' })).toThrow(
        /LOCAL_USERS is required when NAS_GATEWAY=local/,
      );
    });

    it('rejects malformed LOCAL_USERS without leaking the password', () => {
      expect(() => loadConfig({ NAS_GATEWAY: 'local', LOCAL_USERS: 'secretpw,x:y' })).toThrow(
        /LOCAL_USERS must look like/,
      );
      expect(() => loadConfig({ NAS_GATEWAY: 'local', LOCAL_USERS: 'secretpw,x:y' })).not.toThrow(
        /secretpw/,
      );
    });

    it('rejects an unknown gateway', () => {
      expect(() => loadConfig({ NAS_GATEWAY: 'smb' })).toThrow(/Invalid configuration/);
    });
  });

  it.each([
    ['non-numeric port', { PORT: 'http' }],
    ['port out of range', { PORT: '70000' }],
    ['unknown log level', { LOG_LEVEL: 'verbose' }],
  ])('rejects %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow(/Invalid configuration/);
  });
});
