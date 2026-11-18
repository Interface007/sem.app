import { z } from 'zod';

export const LoginRequest = z.strictObject({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  otp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  /** `cookie` for the browser (HttpOnly cookie), `body` for the Android app. */
  tokenDelivery: z.enum(['cookie', 'body']),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** The DSM account; `name` is lower case. */
export const User = z.strictObject({ name: z.string().min(1) });
export type User = z.infer<typeof User>;

export const LoginResponse = z.strictObject({
  user: User,
  expiresAt: z.iso.datetime(),
  /** Only present for `tokenDelivery: 'body'`. */
  token: z.string().min(1).optional(),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const SessionResponse = z.strictObject({
  user: User,
  expiresAt: z.iso.datetime(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

export const ApiErrorCode = z.enum([
  'invalid_request',
  'invalid_credentials',
  'otp_required',
  'otp_invalid',
  'account_blocked',
  'nas_unavailable',
  'haus_unavailable',
  'rate_limited',
  'unauthenticated',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Uniform error format of all `/api` routes; `message` is a short German text. */
export const ApiError = z.strictObject({
  error: ApiErrorCode,
  message: z.string().min(1),
});
export type ApiError = z.infer<typeof ApiError>;
