import { describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './health';

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('fetchHealth', () => {
  it('returns the parsed health of the server', async () => {
    const health = { status: 'ok', version: '0.1.0', commit: 'abc1234' };
    const fetchImpl = respond(200, health);

    await expect(fetchHealth('http://nas:8080', fetchImpl)).resolves.toEqual({ ok: true, health });
    expect(fetchImpl).toHaveBeenCalledWith('http://nas:8080/health', expect.anything());
  });

  it('uses a relative URL for the same origin and strips trailing slashes', async () => {
    const fetchImpl = respond(200, { status: 'ok', version: '1', commit: 'c' });

    await fetchHealth('', fetchImpl);
    await fetchHealth('http://nas:8080//', fetchImpl);

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/health', expect.anything());
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://nas:8080/health', expect.anything());
  });

  it('reports HTTP errors', async () => {
    await expect(fetchHealth('', respond(503, {}))).resolves.toEqual({
      ok: false,
      error: 'HTTP 503',
    });
  });

  it('rejects answers that violate the contract', async () => {
    await expect(fetchHealth('', respond(200, { status: 'ok' }))).resolves.toEqual({
      ok: false,
      error: 'Ungültige Antwort vom Server',
    });
  });

  it('reports network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchHealth('', fetchImpl)).resolves.toEqual({
      ok: false,
      error: 'Failed to fetch',
    });
  });
});
