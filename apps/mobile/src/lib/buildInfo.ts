export interface BuildInfo {
  version: string;
  commit: string;
}

/** Text shown in the footer, e.g. `Version 0.1.0 (abc1234)`. */
export function formatBuildInfo({ version, commit }: BuildInfo): string {
  return `Version ${version} (${commit})`;
}

/**
 * Reads version and commit that `app.config.ts` embedded at build time
 * (`APP_VERSION`, `GIT_COMMIT`). Missing values show up as `unknown`.
 */
export function readBuildInfo(
  expoConfig: { version?: string; extra?: Record<string, unknown> } | null,
): BuildInfo {
  const commit = expoConfig?.extra?.gitCommit;
  return {
    version: expoConfig?.version || 'unknown',
    commit: typeof commit === 'string' && commit !== '' ? commit : 'unknown',
  };
}
