import { z } from 'zod';

/** Answer of `GET /api/haus/viewer`. */
export const HausViewerInfo = z.discriminatedUnion('available', [
  z.strictObject({
    available: z.literal(true),
    /** Relative to the server address; carries the per-session key and `?v=<version>`. */
    path: z.string().regex(/^\/api\/haus\/viewer\/k\/[^/?#]+\/\S+$/),
  }),
  z.strictObject({
    available: z.literal(false),
    reason: z.enum(['not_configured', 'unreachable']),
  }),
]);
export type HausViewerInfo = z.infer<typeof HausViewerInfo>;
