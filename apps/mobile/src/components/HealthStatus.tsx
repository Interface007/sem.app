import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { currentServerUrl, refreshServer } from '../lib/apiFetch';
import { fetchHealth, type HealthResult } from '../lib/health';
import { serverHost } from '../lib/serverUrls';

/** Server status from `GET /health`; works without a session. */
export function HealthStatus() {
  const [result, setResult] = useState<HealthResult | undefined>();
  const [host, setHost] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      await refreshServer();
      const value = await fetchHealth();
      if (!active) return;
      setHost(serverHost(currentServerUrl() ?? ''));
      setResult(value);
    };
    void load();
    // Switching between WLAN and mobile typically happens in the background.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Server-Status</Text>
      {result === undefined ? (
        <ActivityIndicator accessibilityLabel="Status wird geladen" />
      ) : result.ok ? (
        <>
          <Text testID="health-status" style={styles.ok}>
            {result.health.status}
          </Text>
          <Text>
            Version {result.health.version} ({result.health.commit})
          </Text>
          {host !== '' && (
            <Text testID="server-host" style={styles.host}>
              {host}
            </Text>
          )}
        </>
      ) : (
        <Text testID="health-error" style={styles.error}>
          Nicht erreichbar: {result.error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  ok: { fontSize: 32, fontWeight: '700', color: '#1b7f3b' },
  host: { color: '#555' },
  error: { color: '#b00020' },
});
