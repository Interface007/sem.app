import { ApiError, LoginResponse, SessionResponse, type User } from '@sem/contracts';

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export type FetchApi = (path: string, init?: RequestInit) => Promise<Response>;

/** Error categories of the login form: server error codes plus `network`. */
export type LoginErrorCode =
  | 'invalid_credentials'
  | 'otp_invalid'
  | 'account_blocked'
  | 'rate_limited'
  | 'nas_unavailable'
  | 'network'
  | 'other';

export const LOGIN_ERROR_TEXTS: Record<LoginErrorCode, string> = {
  invalid_credentials: 'Benutzername oder Passwort ist falsch.',
  otp_invalid: 'Der Bestätigungscode ist falsch.',
  account_blocked: 'Dieses Konto kann sich derzeit nicht anmelden.',
  rate_limited: 'Zu viele Versuche. Bitte später erneut versuchen.',
  nas_unavailable: 'Die Anmeldung am NAS ist gerade nicht möglich.',
  network: 'Server nicht erreichbar.',
  other: 'Die Anmeldung ist fehlgeschlagen.',
};

export type LoginResult =
  | { kind: 'success'; user: User }
  | { kind: 'otp_required' }
  | { kind: 'error'; code: LoginErrorCode; message: string };

export type RestoreResult =
  { kind: 'signedIn'; user: User } | { kind: 'signedOut' } | { kind: 'unreachable' };

export interface SessionOptions {
  fetchApi: FetchApi;
  store: TokenStore;
  delivery: 'cookie' | 'body';
}

export interface SessionClient {
  /** Never keeps the password or OTP code; they exist only as arguments. */
  login(input: { username: string; password: string; otp?: string }): Promise<LoginResult>;
  /** Checks the stored session (Android: only with a token). */
  restore(): Promise<RestoreResult>;
  /** Revokes the session on the server; always clears the local token. */
  logout(): Promise<void>;
  /** `apiFetch` with credentials; a 401 `unauthenticated` signs the app out. */
  authFetch: FetchApi;
  /** Called when any request is answered with 401 `unauthenticated`. */
  onUnauthenticated(listener: () => void): () => void;
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const parsed = ApiError.safeParse(await response.json());
    return parsed.success ? parsed.data.error : undefined;
  } catch {
    return undefined;
  }
}

function loginError(code: LoginErrorCode): LoginResult {
  return { kind: 'error', code, message: LOGIN_ERROR_TEXTS[code] };
}

export function createSessionClient({ fetchApi, store, delivery }: SessionOptions): SessionClient {
  const listeners = new Set<() => void>();

  async function withCredentials(init: RequestInit = {}): Promise<RequestInit> {
    const headers = new Headers(init.headers);
    const token = await store.get();
    if (token !== null) headers.set('authorization', `Bearer ${token}`);
    return { ...init, headers, credentials: 'same-origin' };
  }

  const authFetch: FetchApi = async (path, init) => {
    const response = await fetchApi(path, await withCredentials(init));
    if (response.status === 401 && (await readErrorCode(response.clone())) === 'unauthenticated') {
      await store.clear();
      for (const listener of listeners) listener();
    }
    return response;
  };

  async function login(input: {
    username: string;
    password: string;
    otp?: string;
  }): Promise<LoginResult> {
    let response: Response;
    try {
      response = await fetchApi('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          ...(input.otp ? { otp: input.otp } : {}),
          tokenDelivery: delivery,
        }),
      });
    } catch {
      return loginError('network');
    }

    if (response.ok) {
      const parsed = LoginResponse.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) return loginError('other');
      if (delivery === 'body') {
        if (parsed.data.token === undefined) return loginError('other');
        await store.set(parsed.data.token);
      }
      return { kind: 'success', user: parsed.data.user };
    }

    const code = await readErrorCode(response);
    switch (code) {
      case 'otp_required':
        return { kind: 'otp_required' };
      case 'invalid_credentials':
      case 'otp_invalid':
      case 'account_blocked':
      case 'rate_limited':
      case 'nas_unavailable':
        return loginError(code);
      default:
        return loginError('other');
    }
  }

  async function restore(): Promise<RestoreResult> {
    if (delivery === 'body' && (await store.get()) === null) return { kind: 'signedOut' };
    let response: Response;
    try {
      // Not `authFetch`: a 401 here is the normal "no session" answer, not an event.
      response = await fetchApi('/api/auth/session', await withCredentials());
    } catch {
      return { kind: 'unreachable' };
    }
    if (response.status === 401) {
      await store.clear();
      return { kind: 'signedOut' };
    }
    const parsed = response.ok
      ? SessionResponse.safeParse(await response.json().catch(() => undefined))
      : undefined;
    // Other answers (5xx, garbage) say nothing about the session: keep the token.
    return parsed?.success ? { kind: 'signedIn', user: parsed.data.user } : { kind: 'unreachable' };
  }

  async function logout(): Promise<void> {
    try {
      await fetchApi('/api/auth/logout', { ...(await withCredentials()), method: 'POST' });
    } catch {
      // The server may be unreachable; signing out locally must still work.
    }
    await store.clear();
  }

  return {
    login,
    restore,
    logout,
    authFetch,
    onUnauthenticated(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
