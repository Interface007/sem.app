/*
 * Exports the Android update that sem-server serves (docs/updates.md):
 *   pnpm exec tsx scripts/export-update.ts <output-dir>
 * Runs in apps/mobile with the same environment as the APK build
 * (EXPO_PUBLIC_SERVER_URL), otherwise the runtime version does not match.
 * Writes the output of `expo export --platform android` plus expoConfig.json,
 * which carries the resolved runtime version (fingerprint).
 * Without a server URL the app asks for no updates: the directory stays
 * empty and the server answers "no update" (204).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getConfig } from 'expo/config';
import { clientConfig, parseRuntimeVersion, updatesEnabled } from './updateExport';

const outputArg = process.argv[2];
if (!outputArg) {
  console.error('Usage: tsx scripts/export-update.ts <output-dir>');
  process.exit(2);
}
const projectRoot = process.cwd();
const outputDir = path.resolve(outputArg);
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const { exp } = getConfig(projectRoot, { isPublicConfig: true, skipSDKVersionRequirement: true });
if (!updatesEnabled(exp)) {
  console.warn('EXPO_PUBLIC_SERVER_URL is not set: no update exported.');
  process.exit(0);
}

const runtimeVersion = parseRuntimeVersion(
  execFileSync(
    process.execPath,
    [require.resolve('expo-updates/bin/cli'), 'runtimeversion:resolve', '--platform', 'android'],
    { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ),
);

execFileSync(
  process.execPath,
  [require.resolve('expo/bin/cli'), 'export', '--platform', 'android', '--output-dir', outputDir],
  { cwd: projectRoot, stdio: 'inherit' },
);

writeFileSync(
  path.join(outputDir, 'expoConfig.json'),
  JSON.stringify(clientConfig(exp, runtimeVersion)),
);
console.log(`Update exported for runtime version ${runtimeVersion}`);
