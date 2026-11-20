import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
      // Matched against the origin alone, so no path or wildcard here.
      originWhitelist={[origin]}
      mixedContentMode="never"
      onShouldStartLoadWithRequest={(request) => isAllowedNavigation(request.url, origin)}
      injectedJavaScriptBeforeContentLoaded={viewerBridgeScript}
      onMessage={(event) => {
        const message = parseViewerMessage(event.nativeEvent.data);
        if (message) onEntities(message);
      }}
      onError={onError}
      onHttpError={onError}
      // The viewer takes a while; without this the page stays blank meanwhile.
      startInLoadingState
      renderLoading={() => (
        <View style={styles.loading}>
          <ActivityIndicator accessibilityLabel="Haus-Modell wird geladen" />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
