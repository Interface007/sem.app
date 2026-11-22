import {
  LocationBoostList,
  LocationBoostResult,
  LocationList,
  type FamilyLocation,
} from '@sem/contracts';

/** Positions older than this are drawn faded. */
export const STALE_AFTER_MS = 2 * 60 * 1000;

/** Interval between two refreshes while the screen is visible. */
export const POLL_INTERVAL_MS = 10_000;

/** Default style (no key, no registration); see `EXPO_PUBLIC_MAP_STYLE_URL`. */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export function mapStyleUrl(override: string | undefined): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : DEFAULT_MAP_STYLE_URL;
}

function ageMs(recordedAt: string, now: number): number {
  return Math.max(0, now - Date.parse(recordedAt));
}

/** "gerade eben", "vor 40 s", "vor 5 min", "vor 3 h", "vor 2 d". */
export function formatAge(recordedAt: string, now: number): string {
  const seconds = Math.floor(ageMs(recordedAt, now) / 1000);
  if (seconds < 10) return 'gerade eben';
  if (seconds < 60) return `vor ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  return `vor ${Math.floor(hours / 24)} d`;
}

/** True from an age of two minutes on. */
export function isStale(recordedAt: string, now: number): boolean {
  return ageMs(recordedAt, now) >= STALE_AFTER_MS;
}

/** "± 12 m", or `undefined` if the accuracy is not known. */
export function formatAccuracy(accuracy: number | null): string | undefined {
  return accuracy === null ? undefined : `± ${Math.round(accuracy)} m`;
}

export interface Point {
  latitude: number;
  longitude: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Smallest rectangle around all points; `undefined` for an empty list. */
export function boundingBox(points: readonly Point[]): Bounds | undefined {
  const [first, ...rest] = points;
  if (first === undefined) return undefined;
  const bounds: Bounds = {
    west: first.longitude,
    south: first.latitude,
    east: first.longitude,
    north: first.latitude,
  };
  for (const { latitude, longitude } of rest) {
    bounds.west = Math.min(bounds.west, longitude);
    bounds.east = Math.max(bounds.east, longitude);
    bounds.south = Math.min(bounds.south, latitude);
    bounds.north = Math.max(bounds.north, latitude);
  }
  return bounds;
}

/** How many distinct map errors the screen keeps. */
export const MAX_MAP_ERRORS = 3;

/**
 * One line for a MapLibre `error` event or a value thrown in the map
 * (`{ error, sourceId }`, an `Error`, or anything else).
 */
export function describeMapError(value: unknown): string {
  let source: string | undefined;
  let error = value;
  if (typeof value === 'object' && value !== null && 'error' in value) {
    error = value.error;
    if ('sourceId' in value && typeof value.sourceId === 'string') source = value.sourceId;
  }
  let text: string;
  if (error instanceof Error) text = `${error.name}: ${error.message}`;
  else if (typeof error === 'string') text = error;
  else text = String(error);
  return source === undefined ? text : `[${source}] ${text}`;
}

/** Adds `message` unless already listed; keeps the newest `MAX_MAP_ERRORS`. */
export function addMapError(list: readonly string[], message: string): string[] {
  if (list.includes(message)) return [...list];
  return [...list, message].slice(-MAX_MAP_ERRORS);
}

const collator = new Intl.Collator('de');

/** By user, then device name, then device id; does not change the input. */
export function sortLocations(locations: readonly FamilyLocation[]): FamilyLocation[] {
  return [...locations].sort(
    (a, b) =>
      collator.compare(a.user, b.user) ||
      collator.compare(a.deviceName, b.deviceName) ||
      collator.compare(a.deviceId, b.deviceId),
  );
}

export type LocationsResult =
  { ok: true; locations: FamilyLocation[] } | { ok: false; error: string };

/**
 * `GET /api/locations`. Network errors, HTTP errors and answers that violate
 * the contract all count as an error.
 */
export async function fetchLocations(
  fetcher: (path: string) => Promise<Response>,
): Promise<LocationsResult> {
  try {
    const response = await fetcher('/api/locations');
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const parsed = LocationList.safeParse(await response.json());
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return { ok: false, error: `invalid: ${issues}` };
    }
    return { ok: true, locations: sortLocations(parsed.data.locations) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Device id → end of its boost (epoch ms). */
export type BoostMap = ReadonlyMap<string, number>;

/**
 * `GET /api/locations/boosts`. Any failure gives an empty map: the map stays
 * usable, only the boost state is missing.
 */
export async function fetchBoosts(fetcher: (path: string) => Promise<Response>): Promise<BoostMap> {
  try {
    const response = await fetcher('/api/locations/boosts');
    if (!response.ok) return new Map();
    const parsed = LocationBoostList.safeParse(await response.json());
    if (!parsed.success) return new Map();
    return new Map(parsed.data.boosts.map((b) => [b.deviceId, Date.parse(b.boostUntil)]));
  } catch {
    return new Map();
  }
}

export type BoostStartResult =
  { ok: true; boostUntil: number; pushed: boolean } | { ok: false; error: string };

/** `PUT /api/locations/:deviceId/boost`. */
export async function startBoost(
  fetcher: (path: string, init?: RequestInit) => Promise<Response>,
  deviceId: string,
): Promise<BoostStartResult> {
  try {
    const response = await fetcher(`/api/locations/${encodeURIComponent(deviceId)}/boost`, {
      method: 'PUT',
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const parsed = LocationBoostResult.safeParse(await response.json());
    if (!parsed.success) return { ok: false, error: 'invalid answer' };
    return { ok: true, boostUntil: Date.parse(parsed.data.boostUntil), pushed: parsed.data.pushed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** `DELETE /api/locations/:deviceId/boost`; true on success. */
export async function endBoost(
  fetcher: (path: string, init?: RequestInit) => Promise<Response>,
  deviceId: string,
): Promise<boolean> {
  try {
    const response = await fetcher(`/api/locations/${encodeURIComponent(deviceId)}/boost`, {
      method: 'DELETE',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Remaining boost of a device at `now`, `undefined` if none. */
export function activeBoost(boosts: BoostMap, deviceId: string, now: number): number | undefined {
  const until = boosts.get(deviceId);
  return until !== undefined && until > now ? until : undefined;
}
