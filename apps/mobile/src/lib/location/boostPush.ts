import { BoostPushData } from '@sem/contracts';

/**
 * Boost end from the payload of the expo-notifications background task, or
 * `undefined` if the message is no (valid) boost. FCM data arrives either as
 * fields of `data` or as the JSON string `data.dataString`.
 */
export function boostFromPushPayload(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) return undefined;
  const data: unknown = payload.data;
  if (typeof data !== 'object' || data === null) return undefined;

  const candidates: unknown[] = [data];
  if ('dataString' in data && typeof data.dataString === 'string') {
    try {
      candidates.unshift(JSON.parse(data.dataString));
    } catch {
      // Not JSON: only the plain fields count.
    }
  }
  for (const candidate of candidates) {
    const parsed = BoostPushData.safeParse(candidate);
    if (parsed.success) return Date.parse(parsed.data.boostUntil);
  }
  return undefined;
}
