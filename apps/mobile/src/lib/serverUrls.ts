/** Plain-HTTP hosts that stay allowed for local development only. */
const devHosts = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

function isAllowed(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && devHosts.has(url.hostname);
}

/**
 * Parses the comma-separated `EXPO_PUBLIC_SERVER_URL`. Order is priority.
 * Trims, strips trailing slashes, drops duplicates and every entry that is
 * not `https` (plain HTTP only for localhost, 127.0.0.1 and 10.0.2.2).
 */
export function parseServerUrls(raw: string): string[] {
  const urls: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim().replace(/\/+$/, '');
    if (entry === '') continue;
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      continue;
    }
    if (isAllowed(parsed) && !urls.includes(entry)) urls.push(entry);
  }
  return urls;
}

/** Host name of a server URL for display; empty for the same origin. */
export function serverHost(url: string): string {
  if (url === '') return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
