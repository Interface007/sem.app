import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { serverUrl } from '../lib/config';
import { fetchHealth, type HealthResult } from '../lib/health';

export default function StartScreen() {
  const [result, setResult] = useState<HealthResult | undefined>();

  useEffect(() => {
    let active = true;
    void fetchHealth(serverUrl).then((value) => {
      if (active) setResult(value);
    });
    return () => {
      active = false;
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
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  ok: { fontSize: 32, fontWeight: '700', color: '#1b7f3b' },
  error: { color: '#b00020' },
});
