import { describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './health';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('fetchHealth', () => {
  it('returns the parsed health of the server', async () => {
    const health = { status: 'ok', version: '0.1.0', commit: 'abc1234' };
    const fetchApi = respond(200, health);

    await expect(fetchHealth(fetchApi)).resolves.toEqual({ ok: true, health });
    expect(fetchApi).toHaveBeenCalledWith('/health', expect.anything());
  });

  it('reports HTTP errors', async () => {
    await expect(fetchHealth(respond(503, {}))).resolves.toEqual({
      ok: false,
      error: 'HTTP 503',
    });
  });

  it('rejects answers that violate the contract', async () => {
    await expect(fetchHealth(respond(200, { status: 'ok' }))).resolves.toEqual({
      ok: false,
      error: 'Ungültige Antwort vom Server',
    });
  });

  it('reports network errors', async () => {
    const fetchApi = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchHealth(fetchApi)).resolves.toEqual({
      ok: false,
      error: 'Failed to fetch',
    });
  });
});
