import { describe, expect, it, vi } from 'vitest';
import { fetchViewerInfo, resolveViewerState } from './haus';
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

describe('resolveViewerState', () => {
  const toState = (path: string) => ({ uri: `https://s${path}`, origin: 'https://s' });

  it('asks the server again on every call and returns the fresh URL', async () => {
    const paths = ['/api/haus/viewer/k/a/viewer.html?v=1', '/api/haus/viewer/k/a/viewer.html?v=2'];
    const asked: string[] = [];
    const fetcher = (p: string) => {
      asked.push(p);
      return json({ available: true, path: paths[asked.length - 1] });
    };
    const first = await resolveViewerState(fetcher, toState);
    const second = await resolveViewerState(fetcher, toState);
    expect(asked).toEqual(['/api/haus/viewer', '/api/haus/viewer']);
    expect(first).toEqual({
      status: 'available',
      uri: 'https://s/api/haus/viewer/k/a/viewer.html?v=1',
      origin: 'https://s',
    });
    expect(second).toMatchObject({ uri: 'https://s/api/haus/viewer/k/a/viewer.html?v=2' });
  });

  it('passes not_configured on and maps failures to unreachable', async () => {
    expect(
      await resolveViewerState(() => json({ available: false, reason: 'not_configured' }), toState),
    ).toEqual({ status: 'not_configured' });
    const broken = () => {
      throw new Error('bad url');
    };
    expect(await resolveViewerState(() => json({ available: true, path: '/p' }), broken)).toEqual({
      status: 'unreachable',
    });
  });
});
