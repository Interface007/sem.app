import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './apiFetch';

const health = { status: 'ok', version: '0.1.0', commit: 'abc1234' };
const a = 'https://a.example';
const b = 'https://b.example';

/** `online` lists the origins that answer; everything else throws. */
function network(online: () => string[], status = 200): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (!online().includes(url.origin)) throw new TypeError('Network request failed');
    const body = url.pathname === '/health' ? health : { data: 1 };
    return new Response(JSON.stringify(body), {
      status: url.pathname === '/health' ? 200 : status,
    });
  }) as unknown as typeof fetch;
}

const calls = (fetchImpl: typeof fetch, path: string) =>
  vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith(path));

describe('apiFetch', () => {
  it('resolves once and then uses the remembered address', async () => {
    const fetchImpl = network(() => [a, b]);
    const client = createApiClient({ urls: [a, b], fetchImpl });

    await client.apiFetch('/things');
    await client.apiFetch('/things');

    expect(client.currentUrl()).toBe(a);
    expect(calls(fetchImpl, '/health')).toHaveLength(2);
    expect(calls(fetchImpl, '/things').map(([url]) => url)).toEqual([`${a}/things`, `${a}/things`]);
  });

  it('re-resolves and retries exactly once after a network error', async () => {
    let online = [a];
    const fetchImpl = network(() => online);
    const client = createApiClient({ urls: [a, b], fetchImpl });
    await client.apiFetch('/things');

    online = [b];
    const response = await client.apiFetch('/things');

    expect(response.status).toBe(200);
    expect(client.currentUrl()).toBe(b);
    expect(calls(fetchImpl, '/things').map(([url]) => url)).toEqual([
      `${a}/things`,
      `${a}/things`,
      `${b}/things`,
    ]);
  });

  it('throws the original error when nothing is reachable after re-resolving', async () => {
    let online = [a];
    const fetchImpl = network(() => online);
    const client = createApiClient({ urls: [a], fetchImpl });
    await client.apiFetch('/things');

    online = [];
    await expect(client.apiFetch('/things')).rejects.toThrow('Network request failed');
    expect(calls(fetchImpl, '/things')).toHaveLength(2);
  });

  it.each([401, 500])('neither switches nor retries on HTTP %i', async (status) => {
    const fetchImpl = network(() => [a, b], status);
    const client = createApiClient({ urls: [a, b], fetchImpl });
    await client.apiFetch('/health-check-warmup');
    const healthCalls = calls(fetchImpl, '/health').length;

    const response = await client.apiFetch('/things');

    expect(response.status).toBe(status);
    expect(calls(fetchImpl, '/things')).toHaveLength(1);
    expect(calls(fetchImpl, '/health')).toHaveLength(healthCalls);
    expect(client.currentUrl()).toBe(a);
  });

  it('uses relative URLs for the same origin', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const client = createApiClient({ urls: [], fetchImpl });

    await client.apiFetch('/things');

    expect(fetchImpl).toHaveBeenCalledWith('/things', undefined);
    expect(client.currentUrl()).toBe('');
  });

  it('fails clearly when no server is reachable at all', async () => {
    const client = createApiClient({ urls: [a], fetchImpl: network(() => []) });
    await expect(client.apiFetch('/things')).rejects.toThrow('Kein Server erreichbar');
  });
});
