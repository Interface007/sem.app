import { z } from 'zod';

/** Response of `GET /health`. */
export const Health = z.strictObject({
  status: z.literal('ok'),
  version: z.string().min(1),
  commit: z.string().min(1),
});

export type Health = z.infer<typeof Health>;
