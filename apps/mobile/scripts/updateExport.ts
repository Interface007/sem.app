import type { ExpoConfig } from 'expo/config';
import { z } from 'zod';

/** Output of `expo-updates runtimeversion:resolve` (JSON on stdout). */
const ResolvedRuntimeVersion = z.object({ runtimeVersion: z.string().min(1) });

/** Runtime version from the stdout of `expo-updates runtimeversion:resolve`. */
export function parseRuntimeVersion(stdout: string): string {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error(`runtimeversion:resolve printed no JSON: ${stdout.slice(0, 200)}`);
  }
  const parsed = ResolvedRuntimeVersion.safeParse(json);
  if (!parsed.success) {
    throw new Error('runtimeversion:resolve printed no runtime version');
  }
  return parsed.data.runtimeVersion;
}

/** Whether the config describes an app that asks a server for updates. */
export function updatesEnabled(config: ExpoConfig): boolean {
  return config.updates?.enabled === true && Boolean(config.updates.url);
}

/**
 * Contents of `expoConfig.json` for the server: the public config with the
 * runtime version as a string instead of the policy object.
 */
export function clientConfig(
  config: ExpoConfig,
  runtimeVersion: string,
): ExpoConfig & { runtimeVersion: string } {
  return { ...config, runtimeVersion };
}
