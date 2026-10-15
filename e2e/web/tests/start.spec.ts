import { expect, test } from '@playwright/test';

test('start page shows the server status from /health', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Server-Status')).toBeVisible();
  await expect(page.getByTestId('health-status')).toHaveText('ok');
});

test('navigation offers all four areas', async ({ page }) => {
  await page.goto('/');

  for (const name of ['Start', 'Haus', 'Scan', 'Einstellungen']) {
    await expect(page.getByRole('tab', { name })).toBeVisible();
  }
});

test('client-side routes load directly', async ({ page }) => {
  await page.goto('/scan');

  await expect(page.getByText('Dieser Bereich folgt in einer späteren Phase.')).toBeVisible();
});
