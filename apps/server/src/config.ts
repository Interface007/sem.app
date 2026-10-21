import { z } from 'zod';

const EnvSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Folder with the web export of the app; static serving is off if unset. */
  WEB_ROOT: z.string().min(1).optional(),
  /** Output folder of `expo export`; no updates are served if unset. */
  UPDATES_DIR: z.string().min(1).optional(),
  /** PEM file with the private key that signs update manifests. */
  UPDATES_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  /** Public base URL used in asset URLs; derived from the request if unset. */
  UPDATES_BASE_URL: z.url().optional(),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  GIT_COMMIT: z.string().min(1).default('unknown'),
});

export interface Config {
  host: string;
  port: number;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  webRoot: string | undefined;
  updatesDir: string | undefined;
  updatesPrivateKeyPath: string | undefined;
  updatesBaseUrl: string | undefined;
  version: string;
  commit: string;
}

/** Reads the configuration from environment variables; throws on invalid values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Empty strings count as unset, so `FOO=` in a compose file means "default".
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = EnvSchema.safeParse(defined);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  const e = result.data;
  return {
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    webRoot: e.WEB_ROOT,
    updatesDir: e.UPDATES_DIR,
    updatesPrivateKeyPath: e.UPDATES_PRIVATE_KEY_PATH,
    updatesBaseUrl: e.UPDATES_BASE_URL,
    version: e.APP_VERSION,
    commit: e.GIT_COMMIT,
  };
}
