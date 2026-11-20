import { LocationReport } from '@sem/contracts';
import type { SharingSettings } from './settings';

export interface MeasuredLocation {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  /** Epoch milliseconds of the measurement. */
  timestamp: number;
}

export interface TaskDeps {
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  getToken(): Promise<string | null>;
  settings: SharingSettings;
  now(): number;
  stopUpdates(): Promise<void>;
  deviceName: string;
}

/**
 * Work of the background task: sends the newest position of a delivered batch.
 * Never throws; a failed report is dropped (the server only keeps the latest).
 */
export async function handleLocationBatch(
  locations: readonly MeasuredLocation[],
  deps: TaskDeps,
): Promise<void> {
  const newest = locations.reduce<MeasuredLocation | undefined>(
    (best, item) => (best === undefined || item.timestamp > best.timestamp ? item : best),
    undefined,
  );
  if (newest === undefined) return;

  try {
    const token = await deps.getToken();
    if (token === null) return;

    const { accuracy } = newest.coords;
    const report = LocationReport.safeParse({
      deviceId: await deps.settings.getDeviceId(),
      deviceName: deps.deviceName,
      latitude: newest.coords.latitude,
      longitude: newest.coords.longitude,
      accuracy: accuracy !== null && accuracy >= 0 ? accuracy : null,
      recordedAt: new Date(newest.timestamp).toISOString(),
    });
    if (!report.success) return;

    const response = await deps.apiFetch('/api/locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(report.data),
    });
    if (response.status === 204) {
      await deps.settings.setLastSentAt(deps.now());
    } else if (response.status === 401) {
      // The session is gone; the user has to sign in again.
      await deps.stopUpdates();
      await deps.settings.setEnabled(false);
    }
  } catch {
    // No network or storage problem: drop this report, keep running.
  }
}
