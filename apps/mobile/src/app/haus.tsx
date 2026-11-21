import type { ViewerEntitiesMessage } from '@sem/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { HausViewer } from '../components/HausViewer';
import { currentServerUrl } from '../lib/apiFetch';
import { resolveViewerState, type ViewerState } from '../lib/haus';
import { session } from '../lib/sessionClient';
import { appOrigin, buildViewerUrl, viewerOrigin } from '../lib/viewerUrl';

type State = { status: 'loading' } | ViewerState;

export default function HausScreen() {
  const [state, setState] = useState<State>({ status: 'loading' });
  // Held for the upcoming readings; nothing is sent to the viewer yet.
  const [, setEntities] = useState<ViewerEntitiesMessage['entitaeten']>([]);

  // The loading state unmounts the WebView, so every load creates it anew.
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    setState({ status: 'loading' });
    const server = currentServerUrl() ?? '';
    const next = await resolveViewerState(session.authFetch, (path) => ({
      uri: buildViewerUrl(server, path),
      origin: viewerOrigin(server, appOrigin(globalThis)),
    }));
    if (isCurrent()) setState(next);
  }, []);

  // On every focus, so reopening the tile asks the server again.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      void load(() => current);
      return () => {
        current = false;
      };
    }, [load]),
  );

  const onEntities = useCallback((message: ViewerEntitiesMessage) => {
    setEntities(message.entitaeten);
  }, []);
  const onError = useCallback(() => setState({ status: 'unreachable' }), []);

  switch (state.status) {
    case 'loading':
      return (
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Haus-Modell wird geladen" />
        </View>
      );
    case 'not_configured':
      return (
        <View style={styles.center}>
          <Text testID="haus-not-configured">
            Das Haus-Modell ist auf dem Server nicht eingerichtet.
          </Text>
        </View>
      );
    case 'unreachable':
      return (
        <View style={styles.center}>
          <Text testID="haus-unreachable">Das Haus-Modell ist gerade nicht erreichbar.</Text>
          <Button title="Erneut versuchen" onPress={() => void load()} />
        </View>
      );
    case 'available':
      return (
        <View style={styles.viewer}>
          <HausViewer
            uri={state.uri}
            origin={state.origin}
            onEntities={onEntities}
            onError={onError}
          />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  viewer: { flex: 1 },
});
