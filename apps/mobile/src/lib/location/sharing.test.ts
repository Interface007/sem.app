import { DeviceId } from '@sem/contracts';
import { describe, expect, it, vi } from 'vitest';
import { LOCATION_INTERVAL_MS } from './constants';
import { logoutStoppingSharing } from './logout';
import { createSharingSettings, randomUuid } from './settings';
import { createLocationSharing, type LocationApi } from './sharing';

function setup(
  grants: Partial<Record<'foreground' | 'notifications' | 'background', boolean>> = {},
) {
  const calls: string[] = [];
  const data = new Map<string, string>();
  let counter = 0;
  const settings = createSharingSettings(
    {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => void data.set(key, value),
    },
    () => `00000000-0000-4000-8000-00000000000${++counter}`,
  );
  const api: LocationApi = {
    requestForeground: async () => (calls.push('foreground'), grants.foreground ?? true),
    requestNotifications: async () => (calls.push('notifications'), grants.notifications ?? true),
    requestBackground: async () => (calls.push('background'), grants.background ?? true),
    startUpdates: vi.fn(async () => void calls.push('start')),
    stopUpdates: vi.fn(async () => void calls.push('stop')),
    hasStarted: vi.fn(async () => false),
    hasPermissions: vi.fn(async () => true),
  };
  const authFetch = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    return new Response(null, { status: 204 });
  });
  return {
    sharing: createLocationSharing({ api, settings, authFetch }),
    api,
    settings,
    authFetch,
    calls,
  };
}

describe('enable', () => {
  it('asks in order and starts updates with interval and foreground service', async () => {
    const { sharing, api, settings, calls } = setup();
    expect(await sharing.enable()).toEqual({ ok: true });
    expect(calls).toEqual(['foreground', 'notifications', 'background', 'start']);
    expect(api.startUpdates).toHaveBeenCalledWith({
      timeInterval: LOCATION_INTERVAL_MS,
      distanceInterval: 0,
      deferredUpdatesInterval: LOCATION_INTERVAL_MS,
      foregroundService: {
        notificationTitle: 'sem teilt deinen Standort',
        notificationBody: 'Der Standort wird regelmäßig an den Familien-Server gesendet.',
        killServiceOnDestroy: false,
      },
    });
    expect(LOCATION_INTERVAL_MS).toBe(10_000);
    expect(await settings.isEnabled()).toBe(true);
  });

  it.each(['foreground', 'notifications', 'background'] as const)(
    'does not start and stays off when %s is denied',
    async (denied) => {
      const { sharing, api, settings } = setup({ [denied]: false });
      expect(await sharing.enable()).toEqual({ ok: false, denied });
      expect(api.startUpdates).not.toHaveBeenCalled();
      expect(await settings.isEnabled()).toBe(false);
    },
  );
});

describe('disable', () => {
  it('stops the updates and deletes the position of the own device', async () => {
    const { sharing, settings, authFetch } = setup();
    await sharing.enable();
    const deviceId = await settings.getDeviceId();
    await sharing.disable();

    expect(authFetch).toHaveBeenCalledWith(`/api/locations/${deviceId}`, { method: 'DELETE' });
    expect(await settings.isEnabled()).toBe(false);
  });

  it('ignores a failing DELETE', async () => {
    const { sharing, settings, authFetch } = setup();
    authFetch.mockRejectedValue(new TypeError('offline'));
    await sharing.enable();
    await expect(sharing.disable()).resolves.toBeUndefined();
    expect(await settings.isEnabled()).toBe(false);
  });
});

describe('resume', () => {
  it('restarts when on, signed in and not running', async () => {
    const { sharing, api, settings } = setup();
    await settings.setEnabled(true);
    await sharing.resume(true);
    expect(api.startUpdates).toHaveBeenCalledTimes(1);
  });

  it('does nothing when off, signed out or already running', async () => {
    const { sharing, api, settings } = setup();
    await sharing.resume(true);
    await settings.setEnabled(true);
    await sharing.resume(false);
    vi.mocked(api.hasStarted).mockResolvedValue(true);
    await sharing.resume(true);
    expect(api.startUpdates).not.toHaveBeenCalled();
  });

  it('does not start and switches off when a permission was revoked', async () => {
    const { sharing, api, settings } = setup();
    await settings.setEnabled(true);
    vi.mocked(api.hasPermissions).mockResolvedValue(false);
    await sharing.resume(true);
    expect(api.startUpdates).not.toHaveBeenCalled();
    expect(await settings.isEnabled()).toBe(false);
    expect(await settings.wasStoppedByError()).toBe(true);
  });

  it('switches off when the restart fails, and enabling clears the notice', async () => {
    const { sharing, api, settings } = setup();
    await settings.setEnabled(true);
    vi.mocked(api.startUpdates).mockRejectedValueOnce(new Error('FGS not allowed'));
    await sharing.resume(true);
    expect(await settings.isEnabled()).toBe(false);
    expect(await settings.wasStoppedByError()).toBe(true);

    await sharing.enable();
    expect(await settings.wasStoppedByError()).toBe(false);
  });

  it.each(['isEnabled', 'hasStarted', 'startUpdates'] as const)(
    'never throws when %s throws',
    async (failing) => {
      const { sharing, api, settings } = setup();
      await settings.setEnabled(true);
      if (failing === 'isEnabled') {
        vi.spyOn(settings, 'isEnabled').mockRejectedValue(new Error('locked'));
      } else {
        vi.mocked(api[failing]).mockRejectedValue(new Error('boom'));
      }
      await expect(sharing.resume(true)).resolves.toBeUndefined();
    },
  );

  it('never throws when even the storage fails', async () => {
    const { sharing, api, settings } = setup();
    await settings.setEnabled(true);
    vi.mocked(api.startUpdates).mockRejectedValue(new Error('boom'));
    vi.spyOn(settings, 'setEnabled').mockRejectedValue(new Error('locked'));
    await expect(sharing.resume(true)).resolves.toBeUndefined();
  });
});

describe('device id', () => {
  it('is created once, survives off/on and matches the schema', async () => {
    const { sharing, settings } = setup();
    await sharing.enable();
    const first = await settings.getDeviceId();
    await sharing.disable();
    await sharing.enable();
    expect(await settings.getDeviceId()).toBe(first);
    expect(DeviceId.safeParse(first).success).toBe(true);
  });

  it('is valid for the real UUID generator', () => {
    expect(DeviceId.safeParse(randomUuid()).success).toBe(true);
  });
});

describe('logout', () => {
  it('stops, deletes the position, then clears the token', async () => {
    const { sharing, calls } = setup();
    await sharing.enable();
    calls.length = 0;
    const logout = vi.fn(async () => void calls.push('clear token'));

    await logoutStoppingSharing(sharing, logout);

    expect(calls).toEqual([
      'stop',
      expect.stringMatching(/^DELETE \/api\/locations\//),
      'clear token',
    ]);
  });

  it('only signs out when sharing is off', async () => {
    const { sharing, calls } = setup();
    const logout = vi.fn(async () => void calls.push('clear token'));
    await logoutStoppingSharing(sharing, logout);
    expect(calls).toEqual(['clear token']);
  });
});
