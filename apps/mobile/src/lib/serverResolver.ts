import { Health } from '@sem/contracts';

export type ResolveResult = { ok: true; url: string } | { ok: false; error: string };

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  /** Per-address timeout in milliseconds. */
  timeoutMs?: number | undefined;
}

export const healthTimeoutMs = 3000;

async function isHealthy(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${url}/health`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    return Health.safeParse(await response.json()).success;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks `GET /health` on all addresses at once and picks the first address of
 * the list that answers with a valid `Health`, even if a later one is faster.
 * An empty list means same origin: there is nothing to choose.
 */
export async function resolveServerUrl(
  urls: readonly string[],
  { fetchImpl = (...args) => fetch(...args), timeoutMs = healthTimeoutMs }: ResolveOptions = {},
): Promise<ResolveResult> {
  if (urls.length === 0) return { ok: true, url: '' };
  const checks = urls.map((url) => isHealthy(url, fetchImpl, timeoutMs));
  // All checks run concurrently; awaiting in list order yields the priority.
  for (const [index, check] of checks.entries()) {
    if (await check) return { ok: true, url: urls[index] as string };
  }
  return { ok: false, error: 'Kein Server erreichbar' };
}
