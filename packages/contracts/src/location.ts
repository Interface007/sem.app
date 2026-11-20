import { z } from 'zod';

/** Random identifier of an app installation. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export type DeviceId = z.infer<typeof DeviceId>;

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);
/** Meters; `null` if the device does not know it. */
const Accuracy = z.number().min(0).nullable();
const DeviceName = z.string().min(1).max(60);

/** Sent by a phone; the user is always taken from the session. */
export const LocationReport = z.strictObject({
  deviceId: DeviceId,
  deviceName: DeviceName,
  latitude: Latitude,
  longitude: Longitude,
  accuracy: Accuracy,
  /** Time of the measurement on the device. */
  recordedAt: z.iso.datetime(),
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
