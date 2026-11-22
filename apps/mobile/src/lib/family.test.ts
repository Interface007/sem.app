import type { FamilyLocation } from '@sem/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  addMapError,
  boundingBox,
  activeBoost,
  DEFAULT_MAP_STYLE_URL,
  describeMapError,
  endBoost,
  fetchBoosts,
  MAX_MAP_ERRORS,
  fetchLocations,
  formatAccuracy,
  formatAge,
  isStale,
  mapStyleUrl,
  sortLocations,
  startBoost,
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
    const invalid = await fetchLocations(respond(200, { locations: [{}] }));
    expect(invalid.ok).toBe(false);
    expect(!invalid.ok && invalid.error).toMatch(/^invalid: locations\.0\.\w+: /);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(fetchLocations(failing)).resolves.toEqual({ ok: false, error: 'offline' });
  });
});

describe('describeMapError', () => {
  it('names the source of a MapLibre error event', () => {
    const event = { error: new TypeError('Failed to fetch'), sourceId: 'openmaptiles' };
    expect(describeMapError(event)).toBe('[openmaptiles] TypeError: Failed to fetch');
  });

  it('reads an event without a source', () => {
    expect(describeMapError({ error: new Error('boom') })).toBe('Error: boom');
  });

  it('accepts plain errors, strings and other values', () => {
    expect(describeMapError(new RangeError('too far'))).toBe('RangeError: too far');
    expect(describeMapError('worker died')).toBe('worker died');
    expect(describeMapError(42)).toBe('42');
  });
});

describe('addMapError', () => {
  it('adds a new message at the end', () => {
    expect(addMapError(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('does not repeat a message and does not change the input', () => {
    const list = ['a', 'b'];
    const result = addMapError(list, 'a');
    expect(result).toEqual(['a', 'b']);
    expect(result).not.toBe(list);
  });

  it(`keeps only the newest ${MAX_MAP_ERRORS}`, () => {
    let list: string[] = [];
    for (const message of ['1', '2', '3', '4', '5']) list = addMapError(list, message);
    expect(list).toEqual(['3', '4', '5']);
  });
});

describe('boost API', () => {
  const until = '2030-01-01T12:10:00.000Z';
  const respond = (status: number, body?: unknown) =>
    vi.fn(
      async (_path: string, _init?: RequestInit) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status }),
    );

  it('maps the active boosts by device id', async () => {
    const fetcher = respond(200, { boosts: [{ deviceId: 'device-1234', boostUntil: until }] });
    const boosts = await fetchBoosts(fetcher);
    expect(fetcher).toHaveBeenCalledWith('/api/locations/boosts');
    expect(boosts.get('device-1234')).toBe(Date.parse(until));
  });

  it('treats any boost list failure as no boosts', async () => {
    expect((await fetchBoosts(respond(404, {}))).size).toBe(0);
    expect((await fetchBoosts(respond(200, { boosts: [{}] }))).size).toBe(0);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect((await fetchBoosts(failing)).size).toBe(0);
  });

  it('starts a boost with PUT and reports whether the device was pushed', async () => {
    const fetcher = respond(200, { boostUntil: until, pushed: false });
    expect(await startBoost(fetcher, 'device-1234')).toEqual({
      ok: true,
      boostUntil: Date.parse(until),
      pushed: false,
    });
    expect(fetcher).toHaveBeenCalledWith('/api/locations/device-1234/boost', { method: 'PUT' });
    expect(await startBoost(respond(404, {}), 'device-1234')).toEqual({
      ok: false,
      error: 'HTTP 404',
    });
  });

  it('ends a boost with DELETE', async () => {
    const fetcher = respond(204);
    expect(await endBoost(fetcher, 'device-1234')).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('/api/locations/device-1234/boost', { method: 'DELETE' });
    expect(await endBoost(respond(500), 'device-1234')).toBe(false);
  });

  it('counts a boost as active only before its end', () => {
    const boosts = new Map([['d', now + 1000]]);
    expect(activeBoost(boosts, 'd', now)).toBe(now + 1000);
    expect(activeBoost(boosts, 'd', now + 1000)).toBeUndefined();
    expect(activeBoost(boosts, 'other', now)).toBeUndefined();
  });
});
