import { FOREGROUND_NOTIFICATION, LOCATION_INTERVAL_MS } from './constants';
import type { SharingSettings } from './settings';

export type DeniedPermission = 'foreground' | 'notifications' | 'background';

export interface UpdatesOptions {
  timeInterval: number;
  distanceInterval: number;
  deferredUpdatesInterval: number;
  foregroundService: {
    notificationTitle: string;
    notificationBody: string;
    killServiceOnDestroy: boolean;
  };
}

/** The slice of expo-location / permissions the flow needs. Each request resolves to "granted". */
export interface LocationApi {
  requestForeground(): Promise<boolean>;
  requestNotifications(): Promise<boolean>;
  requestBackground(): Promise<boolean>;
  startUpdates(options: UpdatesOptions): Promise<void>;
  stopUpdates(): Promise<void>;
  hasStarted(): Promise<boolean>;
}

export interface SharingDeps {
  api: LocationApi;
  settings: SharingSettings;
  authFetch(path: string, init?: RequestInit): Promise<Response>;
}

export type EnableResult = { ok: true } | { ok: false; denied: DeniedPermission };

export interface LocationSharing {
  /** Asks for the permissions in order; starts the updates only if all are granted. */
  enable(): Promise<EnableResult>;
  /** Stops the updates, deletes the position on the server (errors ignored), remembers "off". */
  disable(): Promise<void>;
  /** App start: restarts the updates if sharing is on, the user is signed in and the task is not running. */
  resume(signedIn: boolean): Promise<void>;
  /** Before sign-out, while the token still exists: like `disable`, but only if sharing is on. */
  stopForLogout(): Promise<void>;
}

const UPDATES_OPTIONS: UpdatesOptions = {
  timeInterval: LOCATION_INTERVAL_MS,
  distanceInterval: 0,
  deferredUpdatesInterval: LOCATION_INTERVAL_MS,
  foregroundService: { ...FOREGROUND_NOTIFICATION, killServiceOnDestroy: false },
};

export function createLocationSharing({ api, settings, authFetch }: SharingDeps): LocationSharing {
  async function disable(): Promise<void> {
    try {
      await api.stopUpdates();
    } catch {
      // Not running: nothing to stop.
    }
    await settings.setEnabled(false);
    try {
      const deviceId = await settings.getDeviceId();
      await authFetch(`/api/locations/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    } catch {
      // Offline: the position stays on the server until the next successful report.
    }
  }

  return {
    async enable() {
      if (!(await api.requestForeground())) return { ok: false, denied: 'foreground' };
      if (!(await api.requestNotifications())) return { ok: false, denied: 'notifications' };
      if (!(await api.requestBackground())) return { ok: false, denied: 'background' };
      await settings.getDeviceId();
      await api.startUpdates(UPDATES_OPTIONS);
      await settings.setEnabled(true);
      return { ok: true };
    },
    disable,
    async resume(signedIn) {
      if (!signedIn || !(await settings.isEnabled())) return;
      if (await api.hasStarted()) return;
      try {
        await api.startUpdates(UPDATES_OPTIONS);
      } catch {
        // Permissions revoked in the system settings: nothing to do until the user acts.
      }
    },
    async stopForLogout() {
      if (await settings.isEnabled()) await disable();
    },
  };
}
