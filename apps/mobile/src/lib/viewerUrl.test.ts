import { describe, expect, it } from 'vitest';
import { buildViewerUrl, isAllowedNavigation, viewerBridgeScript, viewerOrigin } from './viewerUrl';

const path = '/api/haus/viewer/k/abc/index.html?v=1';

describe('buildViewerUrl', () => {
  it('appends the path to the server address', () => {
    expect(buildViewerUrl('https://sem.example.org', path)).toBe(
      'https://sem.example.org/api/haus/viewer/k/abc/index.html?v=1',
    );
  });

  it('ignores a trailing slash of the server address', () => {
    expect(buildViewerUrl('https://sem.example.org/', path)).toBe(
      buildViewerUrl('https://sem.example.org', path),
    );
  });

  it('yields the bare path for the same origin (web)', () => {
    expect(buildViewerUrl('', path)).toBe(path);
  });
});

describe('viewerOrigin', () => {
  it('uses the origin of the server address', () => {
    expect(viewerOrigin('https://sem.example.org:8443/x', 'http://own')).toBe(
      'https://sem.example.org:8443',
    );
  });

  it('uses the own origin for an empty server address', () => {
    expect(viewerOrigin('', 'http://own')).toBe('http://own');
  });
});

describe('isAllowedNavigation', () => {
  const origin = 'https://sem.example.org';

  it('allows the server origin only', () => {
    expect(isAllowedNavigation(`${origin}/api/haus/viewer/k/a/b`, origin)).toBe(true);
    expect(isAllowedNavigation('https://evil.example/', origin)).toBe(false);
    expect(isAllowedNavigation('http://sem.example.org/', origin)).toBe(false);
    expect(isAllowedNavigation('not a url', origin)).toBe(false);
  });
});

describe('viewerBridgeScript', () => {
  it('forwards message events to the WebView and returns true', () => {
    expect(viewerBridgeScript).toContain("addEventListener('message'");
    expect(viewerBridgeScript).toContain('ReactNativeWebView.postMessage');
    expect(viewerBridgeScript.trimEnd().endsWith('true;')).toBe(true);
  });
});
