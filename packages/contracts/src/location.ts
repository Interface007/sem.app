import { z } from 'zod';

/** Random identifier of an app installation. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export type DeviceId = z.infer<typeof DeviceId>;

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);
/** Meters; `null` if the device does not know it. */
const Accuracy = z.number().min(0).nullable();
const DeviceName = z.string().min(1).max(60);
/** FCM registration token of the app installation. */
export const PushToken = z.string().min(1).max(512);

/** Sent by a phone; the user is always taken from the session. */
export const LocationReport = z.strictObject({
  deviceId: DeviceId,
  deviceName: DeviceName,
  latitude: Latitude,
  longitude: Longitude,
  accuracy: Accuracy,
  /** Time of the measurement on the device. */
  recordedAt: z.iso.datetime(),
  /**
   * FCM token for boost messages; `null` if the device has none. Sent by apps
   * that understand `LocationReportResult`; older apps omit the field.
   */
  pushToken: PushToken.nullable().optional(),
});
export type LocationReport = z.infer<typeof LocationReport>;

export const FamilyLocation = z.strictObject({
  user: z.string().min(1),
  deviceId: DeviceId,
  deviceName: DeviceName,
  latitude: Latitude,
  longitude: Longitude,
  accuracy: Accuracy,
  recordedAt: z.iso.datetime(),
  /** Server clock at the time the report arrived. */
  receivedAt: z.iso.datetime(),
});
export type FamilyLocation = z.infer<typeof FamilyLocation>;

/** Sorted by user, then device name. */
export const LocationList = z.strictObject({ locations: z.array(FamilyLocation) });
export type LocationList = z.infer<typeof LocationList>;

/** How long a boost lasts once requested. */
export const BOOST_DURATION_MS = 10 * 60 * 1000;
/** Send interval of a boosted device. */
export const BOOST_INTERVAL_MS = 10_000;

/**
 * Answer to a `LocationReport` that contains `pushToken` (HTTP 200); reports
 * without the field get an empty 204 as before.
 */
export const LocationReportResult = z.strictObject({
  /** End of the active boost of the reporting device, `null` if none. */
  boostUntil: z.iso.datetime().nullable(),
});
export type LocationReportResult = z.infer<typeof LocationReportResult>;

/** A device that currently sends every `BOOST_INTERVAL_MS`. */
export const LocationBoost = z.strictObject({
  deviceId: DeviceId,
  boostUntil: z.iso.datetime(),
});
export type LocationBoost = z.infer<typeof LocationBoost>;

/** `GET /api/locations/boosts`: all active boosts. */
export const LocationBoostList = z.strictObject({ boosts: z.array(LocationBoost) });
export type LocationBoostList = z.infer<typeof LocationBoostList>;

/** `PUT /api/locations/:deviceId/boost`. */
export const LocationBoostResult = z.strictObject({
  boostUntil: z.iso.datetime(),
  /** True if FCM accepted a message to the device; otherwise it learns of the boost with its next report. */
  pushed: z.boolean(),
});
export type LocationBoostResult = z.infer<typeof LocationBoostResult>;

/** FCM data payload sent to a boosted device (FCM data values are strings). */
export const BoostPushData = z.object({
  type: z.literal('location-boost'),
  boostUntil: z.iso.datetime(),
});
export type BoostPushData = z.infer<typeof BoostPushData>;
