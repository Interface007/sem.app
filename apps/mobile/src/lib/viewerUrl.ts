/**
 * Address of the viewer: server address (`''` = same origin) plus the path
 * from `GET /api/haus/viewer`.
 */
export function buildViewerUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, '')}${path}`;
}

/** Origin of the viewer; `ownOrigin` stands in for the empty (same-origin) server address. */
export function viewerOrigin(serverUrl: string, ownOrigin: string): string {
  return serverUrl === '' ? ownOrigin : new URL(serverUrl).origin;
}

/**
 * Origin the app itself runs on, `''` when it has none. Pass `globalThis`:
 * on the web that carries `location`, while React Native defines `window`
 * without a `location`, so reading `window.location.origin` would throw there.
 */
export function appOrigin(scope: { location?: { origin?: string } }): string {
  return scope.location?.origin ?? '';
}

/** Whether the WebView may navigate to `url`: only to the server origin. */
export function isAllowedNavigation(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Runs in the WebView before the page loads: forwards the page's `message`
 * events as JSON to the app. Does not touch the viewer itself.
 */
export const viewerBridgeScript = `(function () {
  window.addEventListener('message', function (event) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(event.data));
    } catch (e) {}
  });
})();
true;`;
