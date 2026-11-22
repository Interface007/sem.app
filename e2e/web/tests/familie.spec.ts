import { expect, test, type Page } from '@playwright/test';
import { fulfillJson, mockSession } from './auth-mock.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

function location(user: string, latitude: number, longitude: number, ageSeconds = 5) {
  const recordedAt = new Date(Date.now() - ageSeconds * 1000).toISOString();
  return {
    user,
    deviceId: `device-${user}`,
    deviceName: `Handy ${user}`,
    latitude,
    longitude,
    accuracy: 12,
    recordedAt,
    receivedAt: recordedAt,
  };
}

interface LocationsMock {
  requests: number;
  boosts: { deviceId: string; boostUntil: string }[];
  /** Answer of the next requests; a number is an HTTP error status. */
  answer: () => unknown;
}

/** Mocks session, locations and the map style: no foreign service is contacted. */
async function mockFamily(page: Page, answer: LocationsMock['answer']): Promise<LocationsMock> {
  const mock: LocationsMock = { requests: 0, boosts: [], answer };
  await mockSession(page);
  // Any other external request fails loudly instead of leaving the machine.
  await page.route(/^https:\/\/(?!tiles\.openfreemap\.org\/styles\/liberty)/, (route) =>
    route.abort(),
  );
  await page.route(STYLE_URL, (route) =>
    fulfillJson(route, 200, { version: 8, sources: {}, layers: [] }),
  );
  await page.route('**/api/locations', (route) => {
    mock.requests += 1;
    const body = mock.answer();
    return typeof body === 'number'
      ? route.fulfill({ status: body })
      : fulfillJson(route, 200, body);
  });
  await page.route('**/api/locations/boosts', (route) =>
    fulfillJson(route, 200, { boosts: mock.boosts }),
  );
  await page.route('**/api/locations/*/boost', (route) => {
    const deviceId = new URL(route.request().url()).pathname.split('/')[3] ?? '';
    if (route.request().method() === 'DELETE') {
      mock.boosts = mock.boosts.filter((b) => b.deviceId !== deviceId);
      return route.fulfill({ status: 204 });
    }
    const boostUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    mock.boosts = [...mock.boosts, { deviceId, boostUntil }];
    return fulfillJson(route, 200, { boostUntil, pushed: true });
  });
  return mock;
}

test('the start page shows "Haus" and "Familie"; "Familie" opens /familie', async ({ page }) => {
  await mockFamily(page, () => ({ locations: [] }));
  await page.goto('/');

  await expect(page.getByTestId('tile-haus')).toBeVisible();
  await page.getByTestId('tile-familie').click();

  await expect(page).toHaveURL(/\/familie$/);
  await expect(page.getByTestId('family-map')).toBeVisible();
});

test('two positions show two list entries and two markers', async ({ page }) => {
  await mockFamily(page, () => ({
    locations: [location('anna', 52.52, 13.4), location('sven', 48.14, 11.58)],
  }));
  await page.goto('/familie');

  const list = page.getByTestId('family-list');
  await expect(list).toContainText('anna');
  await expect(list).toContainText('sven');
  await expect(list).toContainText('± 12 m');
  await expect(page.getByTestId('family-marker')).toHaveCount(2);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();
});

test('a position of 10 minutes ago is marked as stale', async ({ page }) => {
  await mockFamily(page, () => ({
    locations: [location('anna', 52.52, 13.4, 600), location('sven', 48.14, 11.58)],
  }));
  await page.goto('/familie');

  await expect(page.getByTestId('family-list')).toContainText('vor 10 min');
  await expect(page.locator('[data-testid="family-marker"][data-user="anna"]')).toHaveAttribute(
    'data-stale',
    'true',
  );
  await expect(page.locator('[data-testid="family-marker"][data-user="sven"]')).toHaveAttribute(
    'data-stale',
    'false',
  );
});

test('a changed position shows up after the next refresh without reload', async ({ page }) => {
  await page.clock.install();
  let moved = false;
  const mock = await mockFamily(page, () => ({
    locations: [moved ? location('anna', 48.14, 11.58) : location('anna', 52.52, 13.4)],
  }));
  await page.goto('/familie');

  const marker = page.getByTestId('family-marker');
  await expect(marker).toHaveCount(1);
  const before = await marker.boundingBox();
  const requests = mock.requests;

  moved = true;
  await page.clock.runFor(10_500);

  await expect.poll(() => mock.requests).toBeGreaterThan(requests);
  // Same view, new coordinates: the marker moved on screen.
  await expect.poll(async () => (await marker.boundingBox())?.y).not.toBe(before?.y);
});

test('an empty list shows the empty text', async ({ page }) => {
  await mockFamily(page, () => ({ locations: [] }));
  await page.goto('/familie');

  await expect(page.getByTestId('family-empty')).toHaveText('Noch teilt niemand seinen Standort.');
});

test('an error shows the error text and can be retried', async ({ page }) => {
  let status: number | undefined = 500;
  await mockFamily(page, () => status ?? { locations: [location('anna', 52.52, 13.4)] });
  await page.goto('/familie');

  await expect(page.getByTestId('family-error')).toContainText(
    'Standorte konnten nicht geladen werden.',
  );
  await expect(page.getByTestId('family-error-reason')).toHaveText('HTTP 500');

  status = undefined;
  await page.getByText('Erneut versuchen').click();

  await expect(page.getByTestId('family-list')).toContainText('anna');
});

test('leaving the screen stops the requests', async ({ page }) => {
  await page.clock.install();
  const mock = await mockFamily(page, () => ({ locations: [location('anna', 52.52, 13.4)] }));
  await page.goto('/familie');
  await expect(page.getByTestId('family-list')).toBeVisible();

  await page.getByRole('tab', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/$/);
  const requests = mock.requests;

  await page.clock.runFor(35_000);
  expect(mock.requests).toBe(requests);
});

test('a device can be followed live for 10 minutes and the boost ended again', async ({ page }) => {
  await mockFamily(page, () => ({ locations: [location('anna', 52.52, 13.4)] }));
  await page.goto('/familie');

  const toggle = page.getByTestId('family-boost-toggle-device-anna');
  await expect(toggle).toContainText('10 min live verfolgen');
  await toggle.click();
  await expect(page.getByTestId('family-boost-device-anna')).toContainText('Live bis');
  await expect(page.getByTestId('family-list')).toContainText('Das Gerät wurde benachrichtigt.');

  await toggle.click();
  await expect(page.getByTestId('family-boost-device-anna')).toHaveCount(0);
  await expect(page.getByTestId('family-list')).toContainText('Live-Verfolgung beendet.');
});
