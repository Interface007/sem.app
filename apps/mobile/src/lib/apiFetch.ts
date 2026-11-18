import { serverUrls } from './config';
import { resolveServerUrl, type ResolveResult } from './serverResolver';

export interface ApiClientOptions {
  urls: readonly string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ApiClient {
  /** Fetches `path` from the remembered server; see `createApiClient`. */
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
  /** Resolves again (e.g. when the app returns to the foreground). */
  refresh(): Promise<ResolveResult>;
  /** The remembered address (`''` = same origin), `undefined` before resolving. */
  currentUrl(): string | undefined;
}

/**
 * Central access to the server. Remembers the resolved address in memory. A
 * request that fails without any HTTP response (network error, timeout)
 * triggers one new resolution and one retry; any HTTP status, including
 * 4xx/5xx, is returned as is and never switches the address.
 */
export function createApiClient({
  urls,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs,
}: ApiClientOptions): ApiClient {
  let current: string | undefined;
  let pending: Promise<ResolveResult> | undefined;

  function refresh(): Promise<ResolveResult> {
    // Concurrent callers share one resolution.
    pending ??= resolveServerUrl(urls, { fetchImpl, timeoutMs })
      .then((result) => {
        if (result.ok) current = result.url;
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }

  async function baseUrl(): Promise<string> {
    if (current !== undefined) return current;
    const result = await refresh();
    if (!result.ok) throw new Error(result.error);
    return result.url;
  }

  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const base = await baseUrl();
    try {
      return await fetchImpl(`${base}${path}`, init);
    } catch (error) {
      const result = await refresh();
      if (!result.ok) throw error;
      return fetchImpl(`${result.url}${path}`, init);
    }
  }

  return { apiFetch, refresh, currentUrl: () => current };
}

const client = createApiClient({ urls: serverUrls });

export const apiFetch = client.apiFetch;
export const refreshServer = client.refresh;
export const currentServerUrl = client.currentUrl;
