import { LocationReport } from '@sem/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleLocationBatch, type MeasuredLocation, type TaskDeps } from './report';
import { createSharingSettings } from './settings';

function measured(
  timestamp: number,
  latitude = 48.1,
  accuracy: number | null = 8,
): MeasuredLocation {
  return { coords: { latitude, longitude: 11.5, accuracy }, timestamp };
}

function setup(respond: () => Promise<Response> = async () => new Response(null, { status: 204 })) {
  const data = new Map<string, string>();
  const settings = createSharingSettings(
    {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => void data.set(key, value),
    },
    () => '11111111-2222-4333-8444-555555555555',
  );
  const apiFetch = vi.fn<TaskDeps['apiFetch']>(respond);
  const stopUpdates = vi.fn(async () => undefined);
  const applyBoost = vi.fn<TaskDeps['applyBoost']>(async () => undefined);
  const deps: TaskDeps = {
    apiFetch,
    getToken: async () => 'tok',
    settings,
    now: () => 1_700_000_000_000,
    stopUpdates,
    applyBoost,
    deviceName: 'Pixel 9',
  };
  return { deps, apiFetch, stopUpdates, applyBoost, settings };
}

function sentBody(apiFetch: ReturnType<typeof setup>['apiFetch']) {
  return JSON.parse(String(apiFetch.mock.calls[0]?.[1]?.body));
}

describe('handleLocationBatch', () => {
  it('sends the newest of several positions as a valid report', async () => {
    const { deps, apiFetch } = setup();
    await handleLocationBatch(
      [
        measured(1_700_000_001_000, 1),
        measured(1_700_000_003_000, 3),
        measured(1_700_000_002_000, 2),
      ],
      deps,
    );

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = apiFetch.mock.calls[0] ?? [];
    expect(path).toBe('/api/locations');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
    const report = LocationReport.parse(sentBody(apiFetch));
    expect(report).toMatchObject({
      deviceId: '11111111-2222-4333-8444-555555555555',
      deviceName: 'Pixel 9',
      latitude: 3,
      accuracy: 8,
      recordedAt: new Date(1_700_000_003_000).toISOString(),
    });
  });

  it('sends a missing accuracy as null', async () => {
    const { deps, apiFetch } = setup();
    await handleLocationBatch([measured(1_700_000_001_000, 48, null)], deps);
    expect(LocationReport.parse(sentBody(apiFetch)).accuracy).toBeNull();
  });

  it('records the time of a 204 as "last sent"', async () => {
    const { deps, settings } = setup();
    await handleLocationBatch([measured(1)], deps);
    expect(await settings.getLastSentAt()).toBe(1_700_000_000_000);
  });

  it('stops the updates and switches sharing off on 401', async () => {
    const { deps, stopUpdates, settings } = setup(async () => new Response('{}', { status: 401 }));
    await settings.setEnabled(true);
    await handleLocationBatch([measured(1)], deps);
    expect(stopUpdates).toHaveBeenCalledTimes(1);
    expect(await settings.isEnabled()).toBe(false);
    expect(await settings.getLastSentAt()).toBeNull();
  });

  it('drops the report on a network error without stopping or throwing', async () => {
    const { deps, stopUpdates, settings } = setup(async () => {
      throw new TypeError('Network request failed');
    });
    await settings.setEnabled(true);
    await expect(handleLocationBatch([measured(1)], deps)).resolves.toBeUndefined();
    expect(stopUpdates).not.toHaveBeenCalled();
    expect(await settings.isEnabled()).toBe(true);
  });

  it('drops the report on other status codes without stopping', async () => {
    const { deps, stopUpdates, settings } = setup(async () => new Response('', { status: 503 }));
    await handleLocationBatch([measured(1)], deps);
    expect(stopUpdates).not.toHaveBeenCalled();
    expect(await settings.getLastSentAt()).toBeNull();
  });

  it('sends nothing without a token', async () => {
    const { deps, apiFetch } = setup();
    await handleLocationBatch([measured(1)], { ...deps, getToken: async () => null });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('sends nothing for an empty batch', async () => {
    const { deps, apiFetch } = setup();
    await handleLocationBatch([], deps);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  describe('boost', () => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    it('sends the stored push token, or null without one', async () => {
      const first = setup();
      await handleLocationBatch([measured(1)], first.deps);
      expect(sentBody(first.apiFetch).pushToken).toBeNull();

      const second = setup();
      await second.settings.setPushToken('fcm-token');
      await handleLocationBatch([measured(1)], second.deps);
      expect(LocationReport.parse(sentBody(second.apiFetch)).pushToken).toBe('fcm-token');
    });

    it('sends null instead of a token the contract rejects', async () => {
      const { deps, apiFetch, settings } = setup();
      await settings.setPushToken('x'.repeat(600));
      await handleLocationBatch([measured(1)], deps);
      expect(sentBody(apiFetch).pushToken).toBeNull();
    });

    it('applies the boost end from a 200 answer and records "last sent"', async () => {
      const until = '2026-01-01T12:10:00.000Z';
      const { deps, applyBoost, settings } = setup(async () => json({ boostUntil: until }));
      await handleLocationBatch([measured(1)], deps);
      expect(applyBoost).toHaveBeenCalledWith(Date.parse(until));
      expect(await settings.getLastSentAt()).toBe(1_700_000_000_000);
    });

    it('ends the boost when the answer says null', async () => {
      const { deps, applyBoost } = setup(async () => json({ boostUntil: null }));
      await handleLocationBatch([measured(1)], deps);
      expect(applyBoost).toHaveBeenCalledWith(null);
    });

    it.each([
      ['a 204 from an older server', async () => new Response(null, { status: 204 })],
      ['an answer that breaks the contract', async () => json({ boost: 1 })],
      [
        'a network error',
        async () => {
          throw new TypeError('Network request failed');
        },
      ],
    ])('falls back to the stored boost end on %s', async (_name, respond) => {
      const { deps, applyBoost, settings } = setup(respond);
      await settings.setBoostUntil(1_700_000_600_000);
      await handleLocationBatch([measured(1)], deps);
      expect(applyBoost).toHaveBeenCalledWith(1_700_000_600_000);
    });

    it('does not switch after a 401', async () => {
      const { deps, applyBoost } = setup(async () => new Response('{}', { status: 401 }));
      await handleLocationBatch([measured(1)], deps);
      expect(applyBoost).not.toHaveBeenCalled();
    });

    it('never throws when switching fails', async () => {
      const { deps, applyBoost } = setup(async () => json({ boostUntil: null }));
      applyBoost.mockRejectedValue(new Error('ForegroundServiceStartNotAllowedException'));
      await expect(handleLocationBatch([measured(1)], deps)).resolves.toBeUndefined();
    });
  });
});
