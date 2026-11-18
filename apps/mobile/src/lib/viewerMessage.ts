import { ViewerEntitiesMessage } from '@sem/contracts';

/**
 * Validates a message coming from the viewer. Accepts the parsed object (web)
 * or its JSON text (as forwarded by the WebView); everything else is dropped.
 */
export function parseViewerMessage(data: unknown): ViewerEntitiesMessage | undefined {
  let value = data;
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  const result = ViewerEntitiesMessage.safeParse(value);
  return result.success ? result.data : undefined;
}
