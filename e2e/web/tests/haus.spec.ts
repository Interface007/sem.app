import { expect, test, type Page } from '@playwright/test';
import { fulfillJson, mockSession } from './auth-mock.js';

const viewerPath = '/api/haus/viewer/k/testkey/index.html?v=1';

// Stands in for the real viewer: shows text and announces its entities.
const viewerPage = `<!doctype html><html><body><p id="inhalt">Test-Viewer</p>
<script>
  parent.postMessage({ typ: 'haus-modell/entitaeten', entitaeten: ['sensor.test_temperatur'] }, '*');
</script></body></html>`;

async function mockViewer(page: Page, answers: unknown[]): Promise<{ requests: number }> {
  const counter = { requests: 0 };
  await mockSession(page);
  await page.route('**/api/haus/viewer', (route) => {
    const answer = answers[Math.min(counter.requests, answers.length - 1)];
    counter.requests += 1;
    return fulfillJson(route, 200, answer);
  });
  await page.route('**/api/haus/viewer/k/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: viewerPage }),
  );
  return counter;
}

test('the start page shows the tile "Haus", which opens /haus', async ({ page }) => {
  await mockViewer(page, [{ available: true, path: viewerPath }]);
  await page.goto('/');

  const tile = page.getByTestId('tile-haus');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute('role', 'button');
  await tile.click();

  await expect(page).toHaveURL(/\/haus$/);
});

test('an available viewer is embedded as iframe', async ({ page }) => {
  await mockViewer(page, [{ available: true, path: viewerPath }]);
  await page.goto('/haus');

  const frame = page.locator('iframe[title="Haus-Modell"]');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', viewerPath);
  await expect(page.frameLocator('iframe[title="Haus-Modell"]').locator('#inhalt')).toHaveText(
    'Test-Viewer',
  );
});

test('a not configured viewer shows a hint', async ({ page }) => {
  await mockViewer(page, [{ available: false, reason: 'not_configured' }]);
  await page.goto('/haus');

  await expect(page.getByTestId('haus-not-configured')).toHaveText(
    'Das Haus-Modell ist auf dem Server nicht eingerichtet.',
  );
});

test('an unreachable viewer can be retried', async ({ page }) => {
  const counter = await mockViewer(page, [
    { available: false, reason: 'unreachable' },
    { available: true, path: viewerPath },
  ]);
  await page.goto('/haus');

  await expect(page.getByTestId('haus-unreachable')).toHaveText(
    'Das Haus-Modell ist gerade nicht erreichbar.',
  );
  expect(counter.requests).toBe(1);

  await page.getByText('Erneut versuchen').click();

  await expect(page.locator('iframe[title="Haus-Modell"]')).toBeVisible();
  expect(counter.requests).toBe(2);
});
