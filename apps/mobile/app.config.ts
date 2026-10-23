// Lets the config load TypeScript plugins (see Expo docs on app.config.ts).
import 'tsx/cjs';
import { execSync } from 'node:child_process';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withReleaseSigning } from './plugins/release-signing';

/** Short commit hash of the checkout, `unknown` outside a git repository. */
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/*
 * Static settings live in app.json. Values set at build time:
 *   EXPO_PUBLIC_SERVER_URL  sem-server base URL; updates come from
 *                         <url>/api/updates/manifest (docs/updates.md)
 *   GIT_COMMIT          short commit hash shown in the footer (default: git)
 *   APP_VERSION         version name, e.g. 0.1.0 (CI: from the tag)
 *   ANDROID_VERSION_CODE  must grow with every release, otherwise
 *                         `adb install -r` refuses the update
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? '1');
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error(`ANDROID_VERSION_CODE must be a positive integer, got "${versionCode}"`);
  }

  const serverUrl = (process.env.EXPO_PUBLIC_SERVER_URL ?? '').replace(/\/+$/, '');

  return withReleaseSigning({
    ...config,
    name: config.name ?? 'sem',
    slug: config.slug ?? 'sem-app',
    version: process.env.APP_VERSION ?? config.version ?? '0.0.0',
    android: { ...config.android, versionCode },
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      // Without a server URL (web/dev builds) there is nothing to ask.
      enabled: serverUrl !== '',
      ...(serverUrl !== '' && { url: `${serverUrl}/api/updates/manifest` }),
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      codeSigningCertificate: './certs/certificate.pem',
      codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
    },
    extra: { ...config.extra, gitCommit: process.env.GIT_COMMIT || gitCommit() },
  });
};
