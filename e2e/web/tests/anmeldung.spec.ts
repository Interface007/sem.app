import { expect, test, type Page } from '@playwright/test';
import { apiError, loginOk, mockLogin } from './auth-mock.js';

const tabNames = ['Start', 'Scan', 'Einstellungen'];

async function fillAndSubmit(page: Page, password: string) {
  await page.getByTestId('login-username').fill('Sven');
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

test('without a session / shows the login form with the server status and no tabs', async ({
  page,
}) => {
  await mockLogin(page, () => loginOk());
  await page.goto('/');

  await expect(page.getByTestId('login-username')).toBeVisible();
  await expect(page.getByTestId('health-status')).toHaveText('ok');
  for (const name of tabNames) {
    await expect(page.getByRole('tab', { name })).toHaveCount(0);
  }
});

test('without a session /scan leads to the login form', async ({ page }) => {
  await mockLogin(page, () => loginOk());
  await page.goto('/scan');

  await expect(page.getByTestId('login-username')).toBeVisible();
  await expect(page.getByText('Dieser Bereich folgt in einer späteren Phase.')).toHaveCount(0);
});

test('successful login shows the tabs and the user in the settings', async ({ page }) => {
  const mock = await mockLogin(page, () => loginOk());
  await page.goto('/');

  await fillAndSubmit(page, 'richtig');

  for (const name of tabNames) {
    await expect(page.getByRole('tab', { name })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await expect(page.getByTestId('session-user')).toHaveText('Angemeldet als sven');
  expect(mock.requests).toHaveLength(1);
});

test('login request asks for the cookie delivery', async ({ page }) => {
  const mock = await mockLogin(page, () => loginOk());
  await page.goto('/');

  await fillAndSubmit(page, 'richtig');
  await expect(page.getByRole('tab', { name: 'Start' })).toBeVisible();

  expect(mock.requests[0]).toMatchObject({ username: 'Sven', tokenDelivery: 'cookie' });
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('richtig');
});

test('wrong password shows the error and empties the password field', async ({ page }) => {
  await mockLogin(page, () => ({ status: 401, body: apiError('invalid_credentials') }));
  await page.goto('/');

  await fillAndSubmit(page, 'falsch');

  await expect(page.getByTestId('login-error')).toHaveText(
    'Benutzername oder Passwort ist falsch.',
  );
  await expect(page.getByTestId('login-password')).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Start' })).toHaveCount(0);
});

test('OTP flow: otp_required first, then success with the code', async ({ page }) => {
  const mock = await mockLogin(page, (body) =>
    body.otp === '123456' ? loginOk() : { status: 401, body: apiError('otp_required') },
  );
  await page.goto('/');
  await expect(page.getByTestId('login-otp')).toHaveCount(0);

  await fillAndSubmit(page, 'richtig');
  await expect(page.getByTestId('login-otp')).toBeVisible();

  await page.getByTestId('login-otp').fill('123456');
  await page.getByTestId('login-submit').click();

  await expect(page.getByRole('tab', { name: 'Start' })).toBeVisible();
  expect(mock.requests).toHaveLength(2);
  expect(mock.requests[0]).not.toHaveProperty('otp');
  expect(mock.requests[1]).toMatchObject({ otp: '123456', password: 'richtig' });
});

test('logout leads back to the login form', async ({ page }) => {
  await mockLogin(page, () => loginOk());
  await page.goto('/');
  await fillAndSubmit(page, 'richtig');

  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await page.getByTestId('logout').click();

  await expect(page.getByTestId('login-username')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Start' })).toHaveCount(0);
});

test('the settings do not show the location sharing in the web version', async ({ page }) => {
  await mockLogin(page, () => loginOk());
  await page.goto('/');
  await fillAndSubmit(page, 'richtig');

  await page.getByRole('tab', { name: 'Einstellungen' }).click();
  await expect(page.getByTestId('session-user')).toBeVisible();
  await expect(page.getByText('Standort teilen')).toHaveCount(0);
  await expect(page.getByTestId('location-sharing')).toHaveCount(0);
});

test('an unreachable server offers a retry', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.abort('connectionrefused'));
  await page.goto('/');

  await expect(page.getByTestId('server-unreachable')).toBeVisible();
  await expect(page.getByText('Erneut versuchen')).toBeVisible();
});
