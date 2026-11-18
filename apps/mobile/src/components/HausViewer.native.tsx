import { WebView } from 'react-native-webview';
import { parseViewerMessage } from '../lib/viewerMessage';
import { isAllowedNavigation, viewerBridgeScript } from '../lib/viewerUrl';
import type { HausViewerProps } from './HausViewer.types';

/** Embeds the house viewer in a WebView that stays on the server origin. */
export function HausViewer({ uri, origin, onEntities, onError }: HausViewerProps) {
  return (
    <WebView
      testID="haus-viewer"
      style={{ flex: 1 }}
      source={{ uri }}
      originWhitelist={[`${origin}/*`]}
      mixedContentMode="never"
      onShouldStartLoadWithRequest={(request) => isAllowedNavigation(request.url, origin)}
      injectedJavaScriptBeforeContentLoaded={viewerBridgeScript}
      onMessage={(event) => {
        const message = parseViewerMessage(event.nativeEvent.data);
        if (message) onEntities(message);
      }}
      onError={onError}
      onHttpError={onError}
    />
  );
}
