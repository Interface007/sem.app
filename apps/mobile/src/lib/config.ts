import { parseServerUrls } from './serverUrls';

/**
 * Server base URLs, set at build time via `EXPO_PUBLIC_SERVER_URL` as a
 * comma-separated list (order = priority, e.g. WLAN address first, Tailscale
 * second). Empty means same origin, which is right for the web version served
 * by the server itself. The Android build needs absolute `https` URLs.
 */
export const serverUrls: string[] = parseServerUrls(process.env.EXPO_PUBLIC_SERVER_URL ?? '');
