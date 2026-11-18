import { Health } from '@sem/contracts';
import { apiFetch } from './apiFetch';

export type HealthResult = { ok: true; health: Health } | { ok: false; error: string };

/** Asks the server for `GET /health` through the central `apiFetch`. */
export async function fetchHealth(
  fetchApi: (path: string, init?: RequestInit) => Promise<Response> = apiFetch,
): Promise<HealthResult> {
  try {
    const response = await fetchApi('/health', { headers: { accept: 'application/json' } });
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
