import type { FamilyLocation } from '@sem/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  boundingBox,
  DEFAULT_MAP_STYLE_URL,
  fetchLocations,
  formatAccuracy,
  formatAge,
  isStale,
  mapStyleUrl,
  sortLocations,
} from './family';

const now = Date.parse('2030-01-01T12:00:00.000Z');
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

describe('formatAge', () => {
  it.each([
    [0, 'gerade eben'],
    [9, 'gerade eben'],
    [10, 'vor 10 s'],
    [40, 'vor 40 s'],
    [59, 'vor 59 s'],
    [60, 'vor 1 min'],
    [5 * 60, 'vor 5 min'],
    [59 * 60, 'vor 59 min'],
    [60 * 60, 'vor 1 h'],
    [3 * 3600 + 59 * 60, 'vor 3 h'],
    [24 * 3600, 'vor 1 d'],
  ])('%i s old reads "%s"', (seconds, text) => {
    expect(formatAge(ago(seconds), now)).toBe(text);
  });

  it('treats a timestamp in the future as just now', () => {
    expect(formatAge(ago(-30), now)).toBe('gerade eben');
  });
});

describe('isStale', () => {
  it('is false below two minutes and true from two minutes on', () => {
    expect(isStale(ago(0), now)).toBe(false);
    expect(isStale(ago(119), now)).toBe(false);
    expect(isStale(ago(120), now)).toBe(true);
    expect(isStale(ago(600), now)).toBe(true);
  });
});

describe('formatAccuracy', () => {
  it('rounds meters and hides an unknown accuracy', () => {
    expect(formatAccuracy(12.4)).toBe('± 12 m');
    expect(formatAccuracy(0)).toBe('± 0 m');
    expect(formatAccuracy(null)).toBeUndefined();
  });
});

describe('boundingBox', () => {
  it('is undefined for an empty list', () => {
    expect(boundingBox([])).toBeUndefined();
  });

  it('collapses to the point for one point', () => {
    expect(boundingBox([{ latitude: 52.5, longitude: 13.4 }])).toEqual({
      west: 13.4,
      south: 52.5,
      east: 13.4,
      north: 52.5,
    });
  });

  it('spans two points', () => {
    expect(
      boundingBox([
        { latitude: 50, longitude: 10 },
        { latitude: 48, longitude: 12 },
      ]),
    ).toEqual({ west: 10, south: 48, east: 12, north: 50 });
  });

  it('spans many points, also across the prime meridian', () => {
    expect(
      boundingBox([
        { latitude: 51, longitude: -0.1 },
        { latitude: 48.8, longitude: 2.3 },
        { latitude: 53.5, longitude: 0 },
        { latitude: 40.4, longitude: -3.7 },
      ]),
    ).toEqual({ west: -3.7, south: 40.4, east: 2.3, north: 53.5 });
  });
});

function location(user: string, deviceName: string, deviceId = 'device-0001'): FamilyLocation {
  return {
    user,
    deviceName,
    deviceId,
    latitude: 52,
    longitude: 13,
    accuracy: null,
    recordedAt: ago(5),
    receivedAt: ago(4),
  };
}

describe('sortLocations', () => {
  it('sorts by user, then device name, without changing the input', () => {
    const input = [
      location('sven', 'Tablet'),
      location('anna', 'Pixel'),
      location('sven', 'Handy'),
    ];
    expect(sortLocations(input).map((l) => `${l.user}/${l.deviceName}`)).toEqual([
      'anna/Pixel',
      'sven/Handy',
      'sven/Tablet',
    ]);
    expect(input[0]?.deviceName).toBe('Tablet');
  });

  it('is empty for an empty list', () => {
    expect(sortLocations([])).toEqual([]);
  });
});

describe('mapStyleUrl', () => {
  it('uses the default unless an override is set', () => {
    expect(mapStyleUrl(undefined)).toBe(DEFAULT_MAP_STYLE_URL);
    expect(mapStyleUrl('  ')).toBe(DEFAULT_MAP_STYLE_URL);
    expect(mapStyleUrl('https://tiles.example/style.json')).toBe(
      'https://tiles.example/style.json',
    );
  });
});

describe('fetchLocations', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('returns the sorted, validated locations', async () => {
    const fetcher = respond(200, { locations: [location('sven', 'A'), location('anna', 'B')] });
    const result = await fetchLocations(fetcher);
    expect(fetcher).toHaveBeenCalledWith('/api/locations');
    expect(result.ok && result.locations.map((l) => l.user)).toEqual(['anna', 'sven']);
  });

  it('reports HTTP errors, invalid answers and network errors', async () => {
    await expect(fetchLocations(respond(500, {}))).resolves.toEqual({
      ok: false,
      error: 'HTTP 500',
    });
    await expect(fetchLocations(respond(200, { locations: [{}] }))).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(fetchLocations(failing)).resolves.toEqual({ ok: false, error: 'offline' });
  });
});
