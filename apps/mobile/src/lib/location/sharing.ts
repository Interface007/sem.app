import {
  BOOST_LOCATION_INTERVAL_MS,
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
  /** FCM token of this installation; rejects if there is none (e.g. no Firebase config). */
  getPushToken(): Promise<string>;
  now(): number;
}

export type EnableResult = { ok: true } | { ok: false; denied: DeniedPermission };

export interface LocationSharing {
  /** Asks for the permissions in order; starts the updates only if all are granted. */
  enable(): Promise<EnableResult>;
  /** Stops the updates, deletes the position on the server (errors ignored), remembers "off". */
  disable(): Promise<void>;
  /** Stores the interval; if sharing is on, restarts the updates with it (stop → start) without switching off. */
  setInterval(interval: LocationIntervalMs): Promise<void>;
  /**
   * Remembers the boost end and, if sharing is on and the effective interval changed,
   * re-registers the running updates with it. Works from the background (patched
   * expo-location); throws if the system refuses.
   */
  applyBoost(boostUntil: number | null): Promise<void>;
  /** App start: restarts the updates if sharing is on, the user is signed in and the task is not running. */
  resume(signedIn: boolean): Promise<void>;
  /** Before sign-out, while the token still exists: like `disable`, but only if sharing is on. */
  stopForLogout(): Promise<void>;
}

/** The boost wins while it lasts, otherwise the selected interval applies. */
export function effectiveInterval(
  selected: LocationIntervalMs,
  boostUntil: number | null,
  now: number,
): LocationIntervalMs {
  return boostUntil !== null && boostUntil > now ? BOOST_LOCATION_INTERVAL_MS : selected;
}

/** "14:05" in local time. */
export function formatClock(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function notificationBody(interval: LocationIntervalMs, boostUntil: number | null): string {
  const base = `Der Standort wird ${LOCATION_INTERVAL_LABELS[interval]} an den Familien-Server gesendet.`;
  return boostUntil === null ? base : `Live-Verfolgung bis ${formatClock(boostUntil)}. ${base}`;
}

function updatesOptions(
  interval: LocationIntervalMs,
  boostUntil: number | null = null,
): UpdatesOptions {
  return {
    timeInterval: interval,
    distanceInterval: 0,
    deferredUpdatesInterval: interval,
    foregroundService: {
      ...FOREGROUND_NOTIFICATION,
      notificationBody: notificationBody(interval, boostUntil),
      killServiceOnDestroy: false,
    },
  };
}

/** Error name only: messages could contain location data. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

export function createLocationSharing({
  api,
  settings,
  authFetch,
  getPushToken,
  now,
}: SharingDeps): LocationSharing {
  /** Starts (or re-registers) the updates with the interval that applies right now. */
  async function startEffective(): Promise<void> {
    const boostUntil = await settings.getBoostUntil();
    const interval = effectiveInterval(await settings.getInterval(), boostUntil, now());
    const boosted = boostUntil !== null && boostUntil > now();
    await api.startUpdates(updatesOptions(interval, boosted ? boostUntil : null));
    await settings.setActiveInterval(interval);
  }

  async function applyBoost(boostUntil: number | null): Promise<void> {
    await settings.setBoostUntil(boostUntil);
    if (!(await settings.isEnabled())) return;
    const selected = await settings.getInterval();
    const target = effectiveInterval(selected, boostUntil, now());
    // Unknown for updates started before boosts existed: those run with the selected interval.
    if (((await settings.getActiveInterval()) ?? selected) === target) return;
    await startEffective();
  }

  /** Never throws: without a token the device simply cannot be boosted by push. */
  async function refreshPushToken(): Promise<void> {
    try {
      await settings.setPushToken(await getPushToken());
    } catch (error) {
      console.warn('push token unavailable', errorName(error));
      try {
        await settings.setPushToken(null);
      } catch {
        // Storage unavailable: the next start tries again.
      }
    }
  }

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
      await refreshPushToken();
      await startEffective();
      await settings.setEnabled(true);
      await settings.setStoppedByError(false);
      return { ok: true };
    },
    disable,
    async setInterval(interval) {
      await settings.setInterval(interval);
      if (!(await settings.isEnabled())) return;
      await api.stopUpdates();
      await startEffective();
    },
    applyBoost,
    async resume(signedIn) {
      // Never throws: a failure here must not take the app down at start.
      try {
        if (!signedIn || !(await settings.isEnabled())) return;
        await refreshPushToken();
        if (await api.hasStarted()) {
          // A boost may have ended while no report got through.
          await applyBoost(await settings.getBoostUntil());
          return;
        }
        if (!(await api.hasPermissions())) {
          await switchOffAfterFailure();
          return;
        }
        await startEffective();
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
