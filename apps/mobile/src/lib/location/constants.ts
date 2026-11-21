/** The selectable send intervals in milliseconds — the only allowed values. */
export const LOCATION_INTERVALS_MS = [10_000, 600_000, 3_600_000] as const;
export type LocationIntervalMs = (typeof LOCATION_INTERVALS_MS)[number];

/** Used when nothing valid is stored: the behaviour of installations before the interval was selectable. */
export const DEFAULT_LOCATION_INTERVAL_MS: LocationIntervalMs = 10_000;

export const LOCATION_INTERVAL_LABELS: Record<LocationIntervalMs, string> = {
  10_000: 'alle 10 Sekunden',
  600_000: 'alle 10 Minuten',
  3_600_000: 'jede Stunde',
};

export const LOCATION_TASK_NAME = 'sem-location-updates';

export const FOREGROUND_NOTIFICATION = {
  notificationTitle: 'sem teilt deinen Standort',
  notificationBody: 'Der Standort wird regelmäßig an den Familien-Server gesendet.',
} as const;
