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
