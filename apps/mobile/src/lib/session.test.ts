import { describe, expect, it, vi } from 'vitest';
import {
  createSessionClient,
  LOGIN_ERROR_TEXTS,
  type FetchApi,
  type SessionClient,
  type TokenStore,
} from './session';

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (token: string) => {
      store.value = token;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const apiError = (error: string) => ({ error, message: 'Text' });
const loginOk = { user: { name: 'sven' }, expiresAt: '2030-01-01T00:00:00.000Z' };

function setup(delivery: 'cookie' | 'body', fetchApi: FetchApi, token: string | null = null) {
  const store = memoryStore(token);
  const client = createSessionClient({ fetchApi, store, delivery });
  return { store, client };
}

const credentials = { username: 'sven', password: 'geheim-123' };

describe('login', () => {
  it('stores the token on Android (tokenDelivery body)', async () => {
    const fetchApi = vi.fn<FetchApi>(async () => json(200, { ...loginOk, token: 'tok-1' }));
    const { store, client } = setup('body', fetchApi);

    expect(await client.login(credentials)).toEqual({ kind: 'success', user: { name: 'sven' } });

    expect(store.value).toBe('tok-1');
    const body = JSON.parse(String(fetchApi.mock.calls[0]?.[1]?.body));
    expect(body.tokenDelivery).toBe('body');
  });

  it('stores nothing on the web (tokenDelivery cookie)', async () => {
    const fetchApi = vi.fn<FetchApi>(async () => json(200, loginOk));
    const { store, client } = setup('cookie', fetchApi);

    expect(await client.login(credentials)).toEqual({ kind: 'success', user: { name: 'sven' } });

    expect(store.value).toBeNull();
    const body = JSON.parse(String(fetchApi.mock.calls[0]?.[1]?.body));
    expect(body.tokenDelivery).toBe('cookie');
  });

  it('moves to the OTP step on otp_required and sends the code on the next attempt', async () => {
    const fetchApi = vi
      .fn<FetchApi>()
      .mockResolvedValueOnce(json(401, apiError('otp_required')))
      .mockResolvedValueOnce(json(200, loginOk));
    const { client } = setup('cookie', fetchApi);

    expect(await client.login(credentials)).toEqual({ kind: 'otp_required' });
    expect((await client.login({ ...credentials, otp: '123456' })).kind).toBe('success');

    expect(JSON.parse(String(fetchApi.mock.calls[0]?.[1]?.body))).not.toHaveProperty('otp');
    expect(JSON.parse(String(fetchApi.mock.calls[1]?.[1]?.body)).otp).toBe('123456');
  });

  it.each([
    ['invalid_credentials', 401, 'Benutzername oder Passwort ist falsch.'],
    ['otp_invalid', 401, 'Der Bestätigungscode ist falsch.'],
    ['account_blocked', 403, 'Dieses Konto kann sich derzeit nicht anmelden.'],
    ['rate_limited', 429, 'Zu viele Versuche. Bitte später erneut versuchen.'],
    ['nas_unavailable', 503, 'Die Anmeldung am NAS ist gerade nicht möglich.'],
  ])('maps %s to its German text', async (code, status, text) => {
    const { store, client } = setup('body', async () => json(status, apiError(code)));

    expect(await client.login(credentials)).toEqual({ kind: 'error', code, message: text });
    expect(store.value).toBeNull();
  });

  it('reports a network error as "Server nicht erreichbar."', async () => {
    const { client } = setup('body', async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(await client.login(credentials)).toEqual({
      kind: 'error',
      code: 'network',
      message: 'Server nicht erreichbar.',
    });
    expect(LOGIN_ERROR_TEXTS.network).toBe('Server nicht erreichbar.');
  });

  it('falls back to a generic text for unknown answers', async () => {
    const { client } = setup('body', async () => json(500, { oops: true }));

    expect(await client.login(credentials)).toMatchObject({ kind: 'error', code: 'other' });
  });

  it('keeps the password out of the token store, the result and every error text', async () => {
    const outcomes: unknown[] = [];
    for (const [delivery, response] of [
      ['body', () => json(200, { ...loginOk, token: 'tok-1' })],
      ['cookie', () => json(200, loginOk)],
      ['body', () => json(401, apiError('invalid_credentials'))],
    ] as const) {
      const { store, client } = setup(delivery, async () => response());
      outcomes.push(await client.login({ ...credentials, otp: '654321' }), store.value);
      outcomes.push(Object.keys(client), Object.values(LOGIN_ERROR_TEXTS));
    }

    const serialized = JSON.stringify(outcomes);
    expect(serialized).not.toContain(credentials.password);
    expect(serialized).not.toContain('654321');
  });

  it('never logs the password', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );
    const { client } = setup('body', async () => json(401, apiError('invalid_credentials')));

    await client.login(credentials);

    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(credentials.password);
      spy.mockRestore();
    }
  });
});

describe('restore (app start)', () => {
  it('Android without a token: signed out, no request', async () => {
    const fetchApi = vi.fn<FetchApi>();
    const { client } = setup('body', fetchApi);

    expect(await client.restore()).toEqual({ kind: 'signedOut' });
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it('Android with a valid token: signed in, bearer header sent', async () => {
    const fetchApi = vi.fn<FetchApi>(async () => json(200, loginOk));
    const { client } = setup('body', fetchApi, 'tok-1');

    expect(await client.restore()).toEqual({ kind: 'signedIn', user: { name: 'sven' } });

    const [path, init] = fetchApi.mock.calls[0] ?? [];
    expect(path).toBe('/api/auth/session');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok-1');
  });

  it('web: asks the server with same-origin credentials and no header', async () => {
    const fetchApi = vi.fn<FetchApi>(async () => json(200, loginOk));
    const { client } = setup('cookie', fetchApi);

    expect((await client.restore()).kind).toBe('signedIn');

    const init = fetchApi.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('401 clears the token', async () => {
    const { store, client } = setup(
      'body',
      async () => json(401, apiError('unauthenticated')),
      'tok-1',
    );

    expect(await client.restore()).toEqual({ kind: 'signedOut' });
    expect(store.value).toBeNull();
  });

  it('a network error keeps the token', async () => {
    const { store, client } = setup(
      'body',
      async () => {
        throw new TypeError('Failed to fetch');
      },
      'tok-1',
    );

    expect(await client.restore()).toEqual({ kind: 'unreachable' });
    expect(store.value).toBe('tok-1');
  });

  it('a server error keeps the token', async () => {
    const { store, client } = setup('body', async () => json(502, {}), 'tok-1');

    expect(await client.restore()).toEqual({ kind: 'unreachable' });
    expect(store.value).toBe('tok-1');
  });
});

describe('logout', () => {
  it('posts to /api/auth/logout and clears the token', async () => {
    const fetchApi = vi.fn<FetchApi>(async () => new Response(null, { status: 204 }));
    const { store, client } = setup('body', fetchApi, 'tok-1');

    await client.logout();

    const [path, init] = fetchApi.mock.calls[0] ?? [];
    expect(path).toBe('/api/auth/logout');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok-1');
    expect(store.value).toBeNull();
  });

  it('clears the token even when the server does not answer', async () => {
    const { store, client } = setup(
      'body',
      async () => {
        throw new TypeError('Failed to fetch');
      },
      'tok-1',
    );

    await client.logout();

    expect(store.value).toBeNull();
  });
});

describe('authFetch', () => {
  async function unauthenticatedSetup(error: string): Promise<{
    store: ReturnType<typeof memoryStore>;
    client: SessionClient;
    listener: ReturnType<typeof vi.fn>;
  }> {
    const { store, client } = setup('body', async () => json(401, apiError(error)), 'tok-1');
    const listener = vi.fn();
    client.onUnauthenticated(listener);
    return { store, client, listener };
  }

  it('401 unauthenticated clears the token, notifies, and still returns the response', async () => {
    const { store, client, listener } = await unauthenticatedSetup('unauthenticated');

    const response = await client.authFetch('/api/anything');

    expect(response.status).toBe(401);
    expect(store.value).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('other 401 codes do not sign out', async () => {
    const { store, client, listener } = await unauthenticatedSetup('invalid_credentials');

    await client.authFetch('/api/anything');

    expect(store.value).toBe('tok-1');
    expect(listener).not.toHaveBeenCalled();
  });

  it('an unsubscribed listener is not called', async () => {
    const { client } = setup('body', async () => json(401, apiError('unauthenticated')));
    const listener = vi.fn();
    client.onUnauthenticated(listener)();

    await client.authFetch('/api/anything');

    expect(listener).not.toHaveBeenCalled();
  });
});
