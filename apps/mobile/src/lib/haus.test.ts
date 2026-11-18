import { describe, expect, it } from 'vitest';
import { fetchViewerInfo } from './haus';

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
