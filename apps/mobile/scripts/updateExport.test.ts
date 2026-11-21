import { describe, expect, it } from 'vitest';
import type { ExpoConfig } from 'expo/config';
import { clientConfig, parseRuntimeVersion, updatesEnabled } from './updateExport';

describe('parseRuntimeVersion', () => {
  it('reads the runtime version from the CLI output', () => {
    const stdout = JSON.stringify({ runtimeVersion: 'abc123', fingerprintSources: [] });
    expect(parseRuntimeVersion(stdout)).toBe('abc123');
  });

  it('rejects output without JSON', () => {
    expect(() => parseRuntimeVersion('Error: boom')).toThrow(/no JSON/);
  });

  it('rejects JSON without a runtime version', () => {
    expect(() => parseRuntimeVersion('{"runtimeVersion":null}')).toThrow(/no runtime version/);
  });
});

const app = (config: Partial<ExpoConfig>): ExpoConfig => ({
  name: 'sem',
  slug: 'sem-app',
  ...config,
});

describe('updatesEnabled', () => {
  it('is true only with enabled updates and a URL', () => {
    const url = 'https://sem.example/api/updates/manifest';
    expect(updatesEnabled(app({ updates: { enabled: true, url } }))).toBe(true);
    expect(updatesEnabled(app({ updates: { enabled: false, url } }))).toBe(false);
    expect(updatesEnabled(app({ updates: { enabled: true } }))).toBe(false);
    expect(updatesEnabled(app({}))).toBe(false);
  });
});

describe('clientConfig', () => {
  it('replaces the runtime version policy with the resolved version', () => {
    const config = app({
      version: '1.2.3',
      runtimeVersion: { policy: 'fingerprint' },
      extra: { gitCommit: 'abc1234' },
    });
    expect(clientConfig(config, 'f00')).toEqual({
      name: 'sem',
      slug: 'sem-app',
      version: '1.2.3',
      runtimeVersion: 'f00',
      extra: { gitCommit: 'abc1234' },
    });
  });
});
