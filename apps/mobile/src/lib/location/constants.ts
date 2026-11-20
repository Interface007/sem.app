/** How often a position is sent. Together with `LOCATION_ACCURACY` (adapter.ts) the only tuning knob. */
export const LOCATION_INTERVAL_MS = 10_000;

export const LOCATION_TASK_NAME = 'sem-location-updates';

export const FOREGROUND_NOTIFICATION = {
  notificationTitle: 'sem teilt deinen Standort',
  notificationBody: 'Der Standort wird regelmäßig an den Familien-Server gesendet.',
} as const;
