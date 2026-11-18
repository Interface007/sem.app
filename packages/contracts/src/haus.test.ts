import { describe, expect, it } from 'vitest';
import { HausViewerInfo } from './index.js';

describe('HausViewerInfo', () => {
  it.each([
    { available: true, path: '/api/haus/viewer/k/abc_DEF-123/viewer.html?v=1a2b' },
    { available: false, reason: 'not_configured' },
    { available: false, reason: 'unreachable' },
  ])('accepts %j', (value) => {
    expect(HausViewerInfo.parse(value)).toEqual(value);
  });

  it.each([
    ['available without path', { available: true }],
    ['path outside the viewer route', { available: true, path: '/api/other/viewer.html' }],
    ['path without key', { available: true, path: '/api/haus/viewer/k//viewer.html' }],
    ['unavailable without reason', { available: false }],
    ['unknown reason', { available: false, reason: 'broken' }],
    ['path together with unavailable', { available: false, reason: 'unreachable', path: '/x' }],
    ['unknown key', { available: true, path: '/api/haus/viewer/k/a/b.html', extra: 1 }],
  ])('rejects %s', (_name, value) => {
    expect(HausViewerInfo.safeParse(value).success).toBe(false);
  });
});
