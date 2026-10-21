import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import {
  checkAndApplyUpdate,
  describeRunningUpdate,
  describeUpdateCheck,
} from '../lib/updateStatus';

export default function EinstellungenScreen() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function check() {
    setBusy(true);
    setMessage('');
    setMessage(describeUpdateCheck(await checkAndApplyUpdate(Updates)));
    setBusy(false);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Einstellungen</Text>
      <Text testID="update-id">
        Update:{' '}
        {describeRunningUpdate({
          isEnabled: Updates.isEnabled,
          isEmbeddedLaunch: Updates.isEmbeddedLaunch,
          updateId: Updates.updateId,
        })}
      </Text>
      <Button title="Nach Updates suchen" onPress={check} disabled={busy || !Updates.isEnabled} />
      {message !== '' && <Text testID="update-message">{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
});
