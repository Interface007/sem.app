import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface BabelConfig {
  presets: string[];
  ignore: ((filename: string | undefined) => boolean)[];
}

const require = createRequire(import.meta.url);
const babelConfig = require('../babel.config.js') as (api: {
  cache: (on: boolean) => void;
}) => BabelConfig;
const config = babelConfig({ cache: () => undefined });
const ignored = (filename: string | undefined): boolean =>
  config.ignore.some((test) => test(filename));

describe('babel.config.js', () => {
  it('keeps the Expo preset', () => {
    expect(config.presets).toEqual(['expo/internal/babel-preset']);
  });

  it('leaves the prebuilt maplibre-gl bundle untouched (worker is built from its source)', () => {
    expect(
      ignored(
        '/repo/node_modules/.pnpm/maplibre-gl@5.24.1/node_modules/maplibre-gl/dist/maplibre-gl.js',
      ),
    ).toBe(true);
    expect(ignored('C:\\repo\\node_modules\\maplibre-gl\\dist\\maplibre-gl.js')).toBe(true);
  });

  it('transforms everything else', () => {
    expect(ignored('/repo/apps/mobile/src/components/FamilyMap.tsx')).toBe(false);
    expect(ignored('/repo/node_modules/react-native/index.js')).toBe(false);
    expect(ignored(undefined)).toBe(false);
  });
});
