import { z } from 'zod';

/*
 * postMessage protocol of the house viewer from the `home` repo
 * (modell/viewer/readings.js, counterpart home-assistant/haus-modell-card.js).
 * This is a contract between two repos: the German wire keys (typ, entitaeten,
 * werte, wert, einheit, alter) belong to the viewer and must not be renamed here.
 */

export const VIEWER_ENTITIES_TYPE = 'haus-modell/entitaeten';
export const VIEWER_READINGS_TYPE = 'haus-modell/messwerte';

/** Home Assistant entity id, e.g. `sensor.wohnzimmer_temperatur`. */
export const EntityId = z
  .string()
  .max(120)
  .regex(/^[a-z0-9_]+\.[a-z0-9_]+$/);

export type EntityId = z.infer<typeof EntityId>;

/** Viewer → host: the entities the viewer needs readings for. */
export const ViewerEntitiesMessage = z.strictObject({
  typ: z.literal(VIEWER_ENTITIES_TYPE),
  entitaeten: z.array(EntityId).min(1),
});

export type ViewerEntitiesMessage = z.infer<typeof ViewerEntitiesMessage>;

/** One reading as the viewer expects it. */
export const ViewerReading = z.strictObject({
  /** Home Assistant state, always a string. */
  wert: z.string(),
  /** Unit of measurement, empty if none. */
  einheit: z.string(),
  /** Age of the measurement in whole seconds, `null` if unknown. */
  alter: z.number().int().nonnegative().nullable(),
});

export type ViewerReading = z.infer<typeof ViewerReading>;

/** Host → viewer: current readings keyed by entity id. */
export const ViewerReadingsMessage = z.strictObject({
  typ: z.literal(VIEWER_READINGS_TYPE),
  werte: z.record(EntityId, ViewerReading),
});

export type ViewerReadingsMessage = z.infer<typeof ViewerReadingsMessage>;
