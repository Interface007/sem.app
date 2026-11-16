import { z } from 'zod';
import type {
  NasCredentials,
  NasGateway,
  NasLoginFailure,
  NasLoginResult,
  NasSession,
} from './gateway.js';

const REQUEST_TIMEOUT_MS = 10_000;

const DsmResponseSchema = z.union([
  z.object({ success: z.literal(true), data: z.object({ sid: z.string().min(1) }).optional() }),
  z.object({ success: z.literal(false), error: z.object({ code: z.number() }) }),
]);

/** Mapping from the DSM Login Web API Guide. */
function reasonForCode(code: number): NasLoginFailure {
  switch (code) {
    case 400:
      return 'invalid_credentials';
    case 403:
      return 'otp_required';
    case 404:
      return 'otp_invalid';
    case 401:
    case 402:
    case 406:
    case 407:
    case 408:
    case 409:
    case 410:
      return 'account_blocked';
    default:
      return 'unavailable';
  }
}

/** Talks to the DSM `SYNO.API.Auth`; credentials only ever go into the POST body. */
export class DsmNasGateway implements NasGateway {
  private readonly endpoint: string;

  constructor(
    dsmUrl: string,
    private readonly timeoutMs: number = REQUEST_TIMEOUT_MS,
  ) {
    this.endpoint = `${dsmUrl.replace(/\/+$/, '')}/webapi/entry.cgi`;
  }

  async login(credentials: NasCredentials): Promise<NasLoginResult> {
    const body = new URLSearchParams({
      api: 'SYNO.API.Auth',
      version: '6',
      method: 'login',
      account: credentials.account,
      passwd: credentials.password,
      session: 'FileStation',
      format: 'sid',
    });
    if (credentials.otpCode !== undefined && credentials.otpCode !== '') {
      body.set('otp_code', credentials.otpCode);
    }
    const parsed = await this.post(body);
    if (parsed === undefined) return { ok: false, reason: 'unavailable' };
    if (!parsed.success) return { ok: false, reason: reasonForCode(parsed.error.code) };
    const sid = parsed.data?.sid;
    if (sid === undefined) return { ok: false, reason: 'unavailable' };
    return { ok: true, session: { account: credentials.account, sid } };
  }

  async logout(session: NasSession): Promise<void> {
    await this.post(
      new URLSearchParams({
        api: 'SYNO.API.Auth',
        version: '6',
        method: 'logout',
        session: 'FileStation',
        _sid: session.sid,
      }),
    );
  }

  /** Returns undefined for network errors, timeouts and unparsable answers. */
  private async post(
    body: URLSearchParams,
  ): Promise<z.infer<typeof DsmResponseSchema> | undefined> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const parsed = DsmResponseSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : undefined;
    } catch {
      // Deliberately swallowed: error details could carry request data.
      return undefined;
    }
  }
}
