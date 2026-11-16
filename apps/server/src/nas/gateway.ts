export interface NasCredentials {
  account: string;
  password: string;
  otpCode?: string;
}

export interface NasSession {
  account: string;
  sid: string;
}

export type NasLoginFailure =
  'invalid_credentials' | 'otp_required' | 'otp_invalid' | 'account_blocked' | 'unavailable';

export type NasLoginResult =
  { ok: true; session: NasSession } | { ok: false; reason: NasLoginFailure };

export interface NasGateway {
  login(credentials: NasCredentials): Promise<NasLoginResult>;
  /** Best effort; does not throw if the NAS is unreachable. */
  logout(session: NasSession): Promise<void>;
}
