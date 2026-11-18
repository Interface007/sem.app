import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveServerUrl } from './serverResolver';

const health = { status: 'ok', version: '0.1.0', commit: 'abc1234' };
const a = 'https://a.example';
const b = 'https://b.example';

type Behavior = { delayMs?: number; body?: unknown; hang?: boolean; fail?: boolean };

/** Fake fetch keyed by origin; honors the abort signal like the real one. */
function fakeFetch(behaviors: Record<string, Behavior>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const behavior = behaviors[new URL(String(input)).origin] ?? { fail: true };
    if (behavior.fail) throw new TypeError('Network request failed');
    await new Promise<void>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      if (!behavior.hang) setTimeout(resolve, behavior.delayMs ?? 0);
    });
    return new Response(JSON.stringify(behavior.body ?? health));
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('resolveServerUrl', () => {
  it('prefers the first address even if the second answers faster', async () => {
    const fetchImpl = fakeFetch({ [a]: { delayMs: 2000 }, [b]: { delayMs: 10 } });
    const result = resolveServerUrl([a, b], { fetchImpl });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toEqual({ ok: true, url: a });
  });

  it('picks the second address when only it answers', async () => {
    const result = resolveServerUrl([a, b], { fetchImpl: fakeFetch({ [b]: {} }) });
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toEqual({ ok: true, url: b });
  });

  it('treats an invalid Health body as unreachable', async () => {
    const fetchImpl = fakeFetch({ [a]: { body: { status: 'ok' } }, [b]: {} });
    const result = resolveServerUrl([a, b], { fetchImpl });
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toEqual({ ok: true, url: b });
  });

  it('fails within the timeout when nothing answers', async () => {
    const fetchImpl = fakeFetch({ [a]: { hang: true }, [b]: { hang: true } });
    const result = resolveServerUrl([a, b], { fetchImpl, timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toEqual({ ok: false, error: 'Kein Server erreichbar' });
  });

  it('asks all addresses at once', async () => {
    const fetchImpl = fakeFetch({ [a]: { hang: true }, [b]: { hang: true } });
    void resolveServerUrl([a, b], { fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
  });

  it('means same origin for an empty list', async () => {
    await expect(resolveServerUrl([])).resolves.toEqual({ ok: true, url: '' });
  });
});
