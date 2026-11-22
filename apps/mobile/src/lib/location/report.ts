import { LocationReport, LocationReportResult, PushToken } from '@sem/contracts';
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
  /** `LocationSharing.applyBoost`: switches between boost and selected interval. */
  applyBoost(boostUntil: number | null): Promise<void>;
  deviceName: string;
}

/** Boost end from a 200 answer; `undefined` for a 204 or an answer that breaks the contract. */
async function boostFromAnswer(response: Response): Promise<number | null | undefined> {
  if (response.status !== 200) return undefined;
  const parsed = LocationReportResult.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) return undefined;
  return parsed.data.boostUntil === null ? null : Date.parse(parsed.data.boostUntil);
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
      // A token the contract rejects must not cost the whole report.
      pushToken: PushToken.safeParse(await deps.settings.getPushToken()).data ?? null,
    });
    if (!report.success) return;

    const response = await deps.apiFetch('/api/locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(report.data),
    });
    if (response.status === 401) {
      // The session is gone; the user has to sign in again.
      await deps.stopUpdates();
      await deps.settings.setEnabled(false);
      return;
    }
    if (response.status === 200 || response.status === 204) {
      await deps.settings.setLastSentAt(deps.now());
    }
    const boost = await boostFromAnswer(response);
    if (boost !== undefined) {
      await switchInterval(deps, boost);
      return;
    }
  } catch {
    // No network or storage problem: drop this report, keep running.
  }
  // Without an answer from the server the stored boost end decides, so a boost
  // also ends offline.
  try {
    await switchInterval(deps, await deps.settings.getBoostUntil());
  } catch {
    // Storage unavailable: the next batch tries again.
  }
}

async function switchInterval(deps: TaskDeps, boostUntil: number | null): Promise<void> {
  try {
    await deps.applyBoost(boostUntil);
  } catch (error) {
    console.warn('switching the interval failed', error instanceof Error ? error.name : 'unknown');
  }
}
