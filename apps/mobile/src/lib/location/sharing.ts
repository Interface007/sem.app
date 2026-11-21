import {
  FOREGROUND_NOTIFICATION,
  LOCATION_INTERVAL_LABELS,
  type LocationIntervalMs,
} from './constants';
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
  /** True while foreground and background location are still granted in the system settings. */
  hasPermissions(): Promise<boolean>;
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
  /** Stores the interval; if sharing is on, restarts the updates with it (stop → start) without switching off. */
  setInterval(interval: LocationIntervalMs): Promise<void>;
  /** App start: restarts the updates if sharing is on, the user is signed in and the task is not running. */
  resume(signedIn: boolean): Promise<void>;
  /** Before sign-out, while the token still exists: like `disable`, but only if sharing is on. */
  stopForLogout(): Promise<void>;
}

function updatesOptions(interval: LocationIntervalMs): UpdatesOptions {
  return {
    timeInterval: interval,
    distanceInterval: 0,
    deferredUpdatesInterval: interval,
    foregroundService: {
      ...FOREGROUND_NOTIFICATION,
      notificationBody: `Der Standort wird ${LOCATION_INTERVAL_LABELS[interval]} an den Familien-Server gesendet.`,
      killServiceOnDestroy: false,
    },
  };
}

/** Error name only: messages could contain location data. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

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

  /** Remembers "off" so the next start does not run into the same failure again. */
  async function switchOffAfterFailure(): Promise<void> {
    await settings.setEnabled(false);
    await settings.setStoppedByError(true);
  }

  return {
    async enable() {
      if (!(await api.requestForeground())) return { ok: false, denied: 'foreground' };
      if (!(await api.requestNotifications())) return { ok: false, denied: 'notifications' };
      if (!(await api.requestBackground())) return { ok: false, denied: 'background' };
      await settings.getDeviceId();
      await api.startUpdates(updatesOptions(await settings.getInterval()));
      await settings.setEnabled(true);
      await settings.setStoppedByError(false);
      return { ok: true };
    },
    disable,
    async setInterval(interval) {
      await settings.setInterval(interval);
      if (!(await settings.isEnabled())) return;
      await api.stopUpdates();
      await api.startUpdates(updatesOptions(interval));
    },
    async resume(signedIn) {
      // Never throws: a failure here must not take the app down at start.
      try {
        if (!signedIn || !(await settings.isEnabled())) return;
        if (await api.hasStarted()) return;
        if (!(await api.hasPermissions())) {
          await switchOffAfterFailure();
          return;
        }
        await api.startUpdates(updatesOptions(await settings.getInterval()));
      } catch (error) {
        console.warn('location sharing: restart failed', errorName(error));
        try {
          await switchOffAfterFailure();
        } catch {
          // Storage unavailable: the next start tries again.
        }
      }
    },
    async stopForLogout() {
      if (await settings.isEnabled()) await disable();
    },
  };
}
