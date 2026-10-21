import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';
import { describe, expect, it } from 'vitest';
import appJson from '../app.json';
import createConfig from '../app.config';

const root = resolve(__dirname, '..');
const config = createConfig({
  config: appJson.expo as ExpoConfig,
  projectRoot: root,
  staticConfigPath: null,
  packageJsonPath: null,
});

describe('resolved Expo config icons', () => {
  it('sets the app icon, adaptive icon and favicon', () => {
    expect(config.icon).toBe('./assets/icon/icon.png');
    expect(config.android?.adaptiveIcon?.foregroundImage).toBe(
      './assets/icon/adaptive-foreground.png',
    );
    expect(config.android?.adaptiveIcon?.backgroundImage).toBe(
      './assets/icon/adaptive-background.png',
    );
    expect(config.web?.favicon).toBe('./assets/icon/favicon.png');
  });

  it('references only files that exist', () => {
    const paths = [
      config.icon,
      config.android?.adaptiveIcon?.foregroundImage,
      config.android?.adaptiveIcon?.backgroundImage,
      config.web?.favicon,
    ];
    for (const path of paths) {
      expect(path).toBeTypeOf('string');
      expect(existsSync(resolve(root, path as string)), `${path} missing`).toBe(true);
    }
  });
});

describe('resolved Expo config updates', () => {
  const resolveWith = (serverUrl: string | undefined) => {
    const previous = process.env.EXPO_PUBLIC_SERVER_URL;
    if (serverUrl === undefined) delete process.env.EXPO_PUBLIC_SERVER_URL;
    else process.env.EXPO_PUBLIC_SERVER_URL = serverUrl;
    try {
      return createConfig({
        config: appJson.expo as ExpoConfig,
        projectRoot: root,
        staticConfigPath: null,
        packageJsonPath: null,
      });
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_SERVER_URL;
      else process.env.EXPO_PUBLIC_SERVER_URL = previous;
    }
  };

  it('points updates at the server manifest endpoint', () => {
    const { updates } = resolveWith('https://sem.example.org/');
    expect(updates?.url).toBe('https://sem.example.org/api/updates/manifest');
    expect(updates?.enabled).toBe(true);
  });

  it('checks on load without waiting for the download', () => {
    const { updates } = resolveWith('https://sem.example.org');
    expect(updates?.checkAutomatically).toBe('ON_LOAD');
    expect(updates?.fallbackToCacheTimeout).toBe(0);
  });

  it('uses the fingerprint runtime version policy', () => {
    expect(resolveWith('https://sem.example.org').runtimeVersion).toEqual({
      policy: 'fingerprint',
    });
  });

  it('requires code signing with the committed certificate', () => {
    const { updates } = resolveWith('https://sem.example.org');
    expect(updates?.codeSigningCertificate).toBe('./certs/certificate.pem');
    expect(updates?.codeSigningMetadata).toEqual({ keyid: 'main', alg: 'rsa-v1_5-sha256' });
    expect(existsSync(resolve(root, updates?.codeSigningCertificate as string))).toBe(true);
  });

  it('disables updates when no server URL is configured', () => {
    const { updates } = resolveWith(undefined);
    expect(updates?.enabled).toBe(false);
    expect(updates?.url).toBeUndefined();
  });
});
