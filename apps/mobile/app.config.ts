// Lets the config load TypeScript plugins (see Expo docs on app.config.ts).
import 'tsx/cjs';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withReleaseSigning } from './plugins/release-signing';

/*
 * Static settings live in app.json. Values set at build time:
 *   APP_VERSION           version name, e.g. 0.1.0 (CI: from the tag)
 *   ANDROID_VERSION_CODE  must grow with every release, otherwise
 *                         `adb install -r` refuses the update
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? '1');
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error(`ANDROID_VERSION_CODE must be a positive integer, got "${versionCode}"`);
  }

  return withReleaseSigning({
    ...config,
    name: config.name ?? 'sem',
    slug: config.slug ?? 'sem-app',
    version: process.env.APP_VERSION ?? config.version ?? '0.0.0',
    android: { ...config.android, versionCode },
  });
};
