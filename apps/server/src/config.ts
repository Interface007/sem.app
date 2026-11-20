import { z } from 'zod';

interface LocalUserEntry {
  account: string;
  password: string;
}

/** `name:passwort,name2:passwort2`; the password may contain colons. */
function parseLocalUsers(raw: string, ctx: z.RefinementCtx): LocalUserEntry[] {
  const users: LocalUserEntry[] = [];
  for (const entry of raw.split(',')) {
    const separator = entry.indexOf(':');
    const account = entry.slice(0, separator).trim();
    const password = entry.slice(separator + 1);
    if (separator < 1 || account === '' || password === '') {
      // Never echo the entry: it contains a password.
      ctx.addIssue({
        code: 'custom',
        message: 'LOCAL_USERS must look like name:password,name2:password2',
      });
      return z.NEVER;
    }
    users.push({ account, password });
  }
  return users;
}

const EnvSchema = z
  .object({
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Folder with the web export of the app; static serving is off if unset. */
    WEB_ROOT: z.string().min(1).optional(),
    /** Output folder of `expo export`; no updates are served if unset. */
    UPDATES_DIR: z.string().min(1).optional(),
    /** PEM file with the private key that signs update manifests. */
    UPDATES_PRIVATE_KEY_PATH: z.string().min(1).optional(),
    /** Public base URL used in asset URLs; derived from the request if unset. */
    UPDATES_BASE_URL: z.url().optional(),
    /** Folder of the house viewer, e.g. http://192.168.1.20:8123/local/haus/; off if unset. */
    HAUS_VIEWER_BASE_URL: z
      .url({ protocol: /^https?$/ })
      .transform((value) => (value.endsWith('/') ? value : `${value}/`))
      .optional(),
    /** Entry file of the house viewer, relative to the folder. */
    HAUS_VIEWER_ENTRY: z.string().min(1).default('viewer.html'),
    APP_VERSION: z.string().min(1).default('0.0.0-dev'),
    GIT_COMMIT: z.string().min(1).default('unknown'),
    /** NAS access; no gateway (login always unavailable) if unset. */
    NAS_GATEWAY: z.enum(['dsm', 'local']).optional(),
    /** Base URL of the DSM, e.g. http://172.17.0.1:5000 (required for `dsm`). */
    DSM_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Users for the `local` gateway, `name:passwort,name2:passwort2`. */
    LOCAL_USERS: z.string().min(1).transform(parseLocalUsers).optional(),
    /** Folder for `sem.db`; sessions are kept in memory only if unset. */
    DATA_DIR: z.string().min(1).optional(),
    /** Days without use until an app session expires. */
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    /** Hours until a location is no longer served and is deleted. */
    LOCATION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(8760).default(24),
    /** Minimum seconds between writes of the locations to the database. */
    LOCATION_FLUSH_SECONDS: z.coerce.number().int().min(1).max(86400).default(60),
    /** Honour `X-Forwarded-*` (set behind the DSM reverse proxy). */
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.NAS_GATEWAY === 'dsm' && env.DSM_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['DSM_URL'],
        message: 'DSM_URL is required when NAS_GATEWAY=dsm',
      });
    }
    if (env.NAS_GATEWAY === 'local' && env.LOCAL_USERS === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOCAL_USERS'],
        message: 'LOCAL_USERS is required when NAS_GATEWAY=local',
      });
    }
  });

export type NasConfig =
  { kind: 'none' } | { kind: 'dsm'; url: string } | { kind: 'local'; users: LocalUserEntry[] };

export interface Config {
  host: string;
  port: number;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  webRoot: string | undefined;
  updatesDir: string | undefined;
  updatesPrivateKeyPath: string | undefined;
  updatesBaseUrl: string | undefined;
  hausViewerBaseUrl: string | undefined;
  hausViewerEntry: string;
  version: string;
  commit: string;
  nas: NasConfig;
  dataDir: string | undefined;
  sessionTtlDays: number;
  locationMaxAgeHours: number;
  locationFlushSeconds: number;
  trustProxy: boolean;
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
  let nas: NasConfig = { kind: 'none' };
  if (e.NAS_GATEWAY === 'dsm' && e.DSM_URL !== undefined) nas = { kind: 'dsm', url: e.DSM_URL };
  if (e.NAS_GATEWAY === 'local' && e.LOCAL_USERS !== undefined)
    nas = { kind: 'local', users: e.LOCAL_USERS };
  return {
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    webRoot: e.WEB_ROOT,
    updatesDir: e.UPDATES_DIR,
    updatesPrivateKeyPath: e.UPDATES_PRIVATE_KEY_PATH,
    updatesBaseUrl: e.UPDATES_BASE_URL,
    hausViewerBaseUrl: e.HAUS_VIEWER_BASE_URL,
    hausViewerEntry: e.HAUS_VIEWER_ENTRY,
    version: e.APP_VERSION,
    commit: e.GIT_COMMIT,
    nas,
    dataDir: e.DATA_DIR,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    locationMaxAgeHours: e.LOCATION_MAX_AGE_HOURS,
    locationFlushSeconds: e.LOCATION_FLUSH_SECONDS,
    trustProxy: e.TRUST_PROXY,
  };
}
