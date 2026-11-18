import type { Page, Route } from '@playwright/test';

/*
 * The CI container has no NAS gateway, so `/api/auth/*` is mocked here;
 * `/health` stays real.
 */

const expiresAt = '2030-01-01T00:00:00.000Z';

export function apiError(error: string) {
  return { error, message: 'Text' };
}

export function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Mocks an existing session (`name`) as if the cookie were set. */
export async function mockSession(page: Page, name = 'sven'): Promise<void> {
  let signedIn = true;
  await page.route('**/api/auth/session', (route) =>
    signedIn
      ? fulfillJson(route, 200, { user: { name }, expiresAt })
      : fulfillJson(route, 401, apiError('unauthenticated')),
  );
  await page.route('**/api/auth/logout', (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
}

export interface LoginMock {
  /** Parsed bodies of all requests to `/api/auth/login`. */
  requests: Record<string, unknown>[];
}

/**
 * Mocks a server without session. `login` decides per request; on 200 the
 * mocked session becomes valid.
 */
export async function mockLogin(
  page: Page,
  login: (body: Record<string, unknown>) => { status: number; body: unknown },
  name = 'sven',
): Promise<LoginMock> {
  const mock: LoginMock = { requests: [] };
  let signedIn = false;
  await page.route('**/api/auth/session', (route) =>
    signedIn
      ? fulfillJson(route, 200, { user: { name }, expiresAt })
      : fulfillJson(route, 401, apiError('unauthenticated')),
  );
  await page.route('**/api/auth/login', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    mock.requests.push(body);
    const answer = login(body);
    if (answer.status === 200) signedIn = true;
    return fulfillJson(route, answer.status, answer.body);
  });
  await page.route('**/api/auth/logout', (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
  return mock;
}

export const loginOk = (name = 'sven') => ({ status: 200, body: { user: { name }, expiresAt } });
