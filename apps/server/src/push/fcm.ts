import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/** Outcome of one message; `invalid_token` means the token should be forgotten. */
export type PushOutcome = 'sent' | 'invalid_token' | 'failed';

export interface PushSender {
  /** Sends a data-only message with high priority. Never throws. */
  send(token: string, data: Record<string, string>, ttlSeconds: number): Promise<PushOutcome>;
}

/** Used when `FCM_SERVICE_ACCOUNT_FILE` is not set. */
export const noPushSender: PushSender = {
  send: () => Promise.resolve('failed'),
};

const ServiceAccount = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  token_uri: z.url().default('https://oauth2.googleapis.com/token'),
});
type ServiceAccount = z.infer<typeof ServiceAccount>;

const TokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Renew the access token this long before it expires. */
const RENEW_MARGIN_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

export interface FcmOptions {
  /** Path of the service account JSON from the Firebase console; a secret. */
  serviceAccountFile: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Only the reason, never tokens or keys. */
  warn?: (message: string) => void;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** Error codes of the FCM v1 API that mean the token will never work again. */
function isInvalidToken(status: number, body: unknown): boolean {
  if (status === 404) return true;
  const details = (body as { error?: { details?: { errorCode?: string }[] } } | null)?.error
    ?.details;
  return (
    status === 400 &&
    Array.isArray(details) &&
    details.some((d) => d.errorCode === 'UNREGISTERED' || d.errorCode === 'INVALID_ARGUMENT')
  );
}

/**
 * FCM HTTP v1 with a service account (OAuth 2 JWT bearer grant, RS256 via
 * `node:crypto`), so no Google SDK is needed.
 */
export class FcmPushSender implements PushSender {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private account: ServiceAccount | undefined;
  private accessToken: { value: string; expiresAt: number } | undefined;

  constructor(private readonly options: FcmOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.warn = options.warn ?? (() => undefined);
  }

  private async loadAccount(): Promise<ServiceAccount> {
    this.account ??= ServiceAccount.parse(
      JSON.parse(await readFile(this.options.serviceAccountFile, 'utf8')),
    );
    return this.account;
  }

  private async getAccessToken(account: ServiceAccount): Promise<string> {
    const now = this.now();
    if (this.accessToken && this.accessToken.expiresAt - RENEW_MARGIN_MS > now) {
      return this.accessToken.value;
    }
    const iat = Math.floor(now / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: SCOPE,
        aud: account.token_uri,
        iat,
        exp: iat + 3600,
      }),
    )}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
    const response = await this.fetch(account.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${base64url(signature)}`,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`token endpoint answered ${response.status}`);
    const token = TokenResponse.parse(await response.json());
    this.accessToken = { value: token.access_token, expiresAt: now + token.expires_in * 1000 };
    return token.access_token;
  }

  async send(
    token: string,
    data: Record<string, string>,
    ttlSeconds: number,
  ): Promise<PushOutcome> {
    try {
      const account = await this.loadAccount();
      const accessToken = await this.getAccessToken(account);
      const response = await this.fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: { token, data, android: { priority: 'HIGH', ttl: `${ttlSeconds}s` } },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (response.ok) return 'sent';
      if (response.status === 401) this.accessToken = undefined;
      const body: unknown = await response.json().catch(() => null);
      if (isInvalidToken(response.status, body)) return 'invalid_token';
      this.warn(`FCM answered ${response.status}`);
      return 'failed';
    } catch (error) {
      this.warn(`FCM unavailable: ${error instanceof Error ? error.name : 'unknown error'}`);
      return 'failed';
    }
  }
}
