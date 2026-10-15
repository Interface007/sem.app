/**
 * Base URL of sem-server, set at build time via `EXPO_PUBLIC_SERVER_URL`.
 * Empty means same origin, which is right for the web version served by the
 * server itself. The Android build needs an absolute URL.
 */
export const serverUrl: string = process.env.EXPO_PUBLIC_SERVER_URL ?? '';
