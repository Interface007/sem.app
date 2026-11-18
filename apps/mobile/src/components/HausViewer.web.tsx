import { useEffect, useRef } from 'react';
import { parseViewerMessage } from '../lib/viewerMessage';
import type { HausViewerProps } from './HausViewer.types';

/** Embeds the house viewer as iframe and listens for its `postMessage`s. */
export function HausViewer({ uri, origin, onEntities }: HausViewerProps) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      const message = parseViewerMessage(event.data);
      if (message) onEntities(message);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [origin, onEntities]);

  return (
    <iframe
      ref={frame}
      title="Haus-Modell"
      src={uri}
      data-testid="haus-viewer"
      style={{ flex: 1, width: '100%', height: '100%', border: 0 }}
    />
  );
}
