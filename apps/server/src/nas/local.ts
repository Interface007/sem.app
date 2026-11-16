import { randomUUID } from 'node:crypto';
import type { NasCredentials, NasGateway, NasLoginResult, NasSession } from './gateway.js';

export interface LocalNasUser {
  account: string;
  password: string;
  /** Fixed second factor; if set, logins must supply it. */
  otpCode?: string;
}

/** In-memory stand-in for tests and development; mirrors the DSM behaviour. */
export class LocalNasGateway implements NasGateway {
  constructor(private readonly users: readonly LocalNasUser[]) {}

  login(credentials: NasCredentials): Promise<NasLoginResult> {
    const wanted = credentials.account.toLowerCase();
    const user = this.users.find((u) => u.account.toLowerCase() === wanted);
    if (user === undefined || user.password !== credentials.password) {
      return Promise.resolve({ ok: false, reason: 'invalid_credentials' });
    }
    if (user.otpCode !== undefined) {
      if (credentials.otpCode === undefined || credentials.otpCode === '') {
        return Promise.resolve({ ok: false, reason: 'otp_required' });
      }
      if (credentials.otpCode !== user.otpCode) {
        return Promise.resolve({ ok: false, reason: 'otp_invalid' });
      }
    }
    return Promise.resolve({ ok: true, session: { account: user.account, sid: randomUUID() } });
  }

  logout(_session: NasSession): Promise<void> {
    return Promise.resolve();
  }
}
