import { describe, expect, it, vi } from 'vitest';
import { fetchViewerInfo } from './haus';
import { createSessionClient } from './session';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('fetchViewerInfo', () => {
  it('returns the path when the viewer is available', async () => {
    const path = '/api/haus/viewer/k/abc/index.html?v=1';
    const paths: string[] = [];
    const result = await fetchViewerInfo((p) => {
      paths.push(p);
      return json({ available: true, path });
    });
    expect(result).toEqual({ status: 'available', path });
    expect(paths).toEqual(['/api/haus/viewer']);
  });

  it('sends the Android session token and loads the viewer when authenticated', async () => {
    const path = '/api/haus/viewer/k/abc/index.html?v=1';
    const seen: { path: string; authorization: string | null }[] = [];
    const client = createSessionClient({
      fetchApi: async (p, init) => {
        seen.push({ path: p, authorization: new Headers(init?.headers).get('authorization') });
        return new Response(JSON.stringify({ available: true, path }));
      },
      store: { get: async () => 'tok-123', set: async () => {}, clear: async () => {} },
      delivery: 'body',
    });
    expect(await fetchViewerInfo(client.authFetch)).toEqual({ status: 'available', path });
    expect(seen).toEqual([{ path: '/api/haus/viewer', authorization: 'Bearer tok-123' }]);
  });

  it('signs the app out when the session has expired', async () => {
    const onExpired = vi.fn();
    const client = createSessionClient({
      fetchApi: async () =>
        new Response(JSON.stringify({ error: 'unauthenticated', message: 'Text' }), {
          status: 401,
        }),
      store: { get: async () => 'old', set: async () => {}, clear: async () => {} },
      delivery: 'body',
    });
    client.onUnauthenticated(onExpired);
    await fetchViewerInfo(client.authFetch);
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it('passes on the reason when unavailable', async () => {
    expect(
      await fetchViewerInfo(() => json({ available: false, reason: 'not_configured' })),
    ).toEqual({ status: 'not_configured' });
    expect(await fetchViewerInfo(() => json({ available: false, reason: 'unreachable' }))).toEqual({
      status: 'unreachable',
    });
  });

  it('treats network errors, HTTP errors and invalid answers as unreachable', async () => {
    const unreachable = { status: 'unreachable' };
    expect(await fetchViewerInfo(() => Promise.reject(new Error('offline')))).toEqual(unreachable);
    expect(await fetchViewerInfo(() => json({ error: 'x' }, 502))).toEqual(unreachable);
    expect(
      await fetchViewerInfo(() => json({ available: true, path: 'https://x.example/' })),
    ).toEqual(unreachable);
    expect(await fetchViewerInfo(() => Promise.resolve(new Response('<html>')))).toEqual(
      unreachable,
    );
  });
});
