import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { LocationSharingSection } from '../components/LocationSharingSection';
import { useAuth } from '../lib/AuthProvider';
import {
  checkAndApplyUpdate,
  describeRunningUpdate,
  describeUpdateCheck,
} from '../lib/updateStatus';

export default function EinstellungenScreen() {
  const { state, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function check() {
    setBusy(true);
    setMessage('');
    setMessage(describeUpdateCheck(await checkAndApplyUpdate(Updates)));
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Einstellungen</Text>
      {state.status === 'signedIn' && (
        <Text testID="session-user">Angemeldet als {state.user.name}</Text>
      )}
      <Button testID="logout" title="Abmelden" onPress={() => void logout()} />
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
      {Platform.OS === 'android' && <LocationSharingSection />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
});
