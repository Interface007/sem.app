import type { ViewerEntitiesMessage } from '@sem/contracts';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { HausViewer } from '../components/HausViewer';
import { currentServerUrl } from '../lib/apiFetch';
import { fetchViewerInfo } from '../lib/haus';
import { session } from '../lib/sessionClient';
import { buildViewerUrl, viewerOrigin } from '../lib/viewerUrl';

type State =
  | { status: 'loading' }
  | { status: 'available'; uri: string; origin: string }
  | { status: 'not_configured' }
  | { status: 'unreachable' };

export default function HausScreen() {
  const [state, setState] = useState<State>({ status: 'loading' });
  // Held for the upcoming readings; nothing is sent to the viewer yet.
  const [, setEntities] = useState<ViewerEntitiesMessage['entitaeten']>([]);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const info = await fetchViewerInfo(session.authFetch);
    if (info.status !== 'available') {
      setState({ status: info.status });
      return;
    }
    const server = currentServerUrl() ?? '';
    const ownOrigin = typeof window === 'undefined' ? '' : window.location.origin;
    setState({
      status: 'available',
      uri: buildViewerUrl(server, info.path),
      origin: viewerOrigin(server, ownOrigin),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
