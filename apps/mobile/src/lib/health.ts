import { Health } from '@sem/contracts';

export type HealthResult = { ok: true; health: Health } | { ok: false; error: string };

/**
 * Asks the server for `GET /health`. An empty `serverUrl` means the same
 * origin as the page (the web version is served by sem-server itself).
 */
export async function fetchHealth(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResult> {
  const url = `${serverUrl.replace(/\/+$/, '')}/health`;
  try {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const parsed = Health.safeParse(await response.json());
    if (!parsed.success) {
      return { ok: false, error: 'Ungültige Antwort vom Server' };
    }
    return { ok: true, health: parsed.data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
