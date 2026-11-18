import { expect, test } from '@playwright/test';
import { mockSession } from './auth-mock.js';

test('start page shows the server status from /health', async ({ page }) => {
  await mockSession(page);
  await page.goto('/');

  await expect(page.getByText('Server-Status')).toBeVisible();
  await expect(page.getByTestId('health-status')).toHaveText('ok');
});

test('navigation offers three tabs and no tab for the house', async ({ page }) => {
  await mockSession(page);
  await page.goto('/');

  for (const name of ['Start', 'Scan', 'Einstellungen']) {
    await expect(page.getByRole('tab', { name })).toBeVisible();
  }
  await expect(page.getByRole('tab', { name: 'Haus' })).toHaveCount(0);
});

test('client-side routes load directly', async ({ page }) => {
  await mockSession(page);
  await page.goto('/scan');

  await expect(page.getByText('Dieser Bereich folgt in einer späteren Phase.')).toBeVisible();
});
