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
      version: '0.0.0-dev',
      commit: 'unknown',
    });
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
      version: '0.1.0',
      commit: 'abc1234',
    });
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ WEB_ROOT: '', PORT: '' })).toMatchObject({
      webRoot: undefined,
      port: 8080,
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
