import { useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { HealthStatus } from '../components/HealthStatus';
import { useAuth } from '../lib/AuthProvider';

export default function AnmeldungScreen() {
  const { login } = useAuth();
  // The password exists only here, in the state of the form.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpRequired, setOtpRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const input = {
      username: username.trim(),
      password,
      ...(otpRequired && otp !== '' ? { otp } : {}),
    };
    setBusy(true);
    setError('');
    const result = await login(input);
    setBusy(false);
    if (result.kind === 'otp_required') {
      // The code is sent together with the password, so it stays for this one step.
      setOtpRequired(true);
      setOtp('');
      return;
    }
    setPassword('');
    setOtp('');
    if (result.kind === 'error') setError(result.message);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Anmelden</Text>
      <Text>Mit dem DSM-Konto anmelden.</Text>
      <TextInput
        testID="login-username"
        style={styles.input}
        placeholder="Benutzername"
        accessibilityLabel="Benutzername"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        editable={!busy}
      />
      <TextInput
        testID="login-password"
        style={styles.input}
        placeholder="Passwort"
        accessibilityLabel="Passwort"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        editable={!busy}
        onSubmitEditing={() => void submit()}
      />
      {otpRequired && (
        <TextInput
          testID="login-otp"
          style={styles.input}
          placeholder="Bestätigungscode"
          accessibilityLabel="Bestätigungscode"
          value={otp}
          onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          autoCorrect={false}
          autoComplete="one-time-code"
          editable={!busy}
          onSubmitEditing={() => void submit()}
        />
      )}
      {error !== '' && (
        <Text testID="login-error" style={styles.error}>
          {error}
        </Text>
      )}
      <Button
        testID="login-submit"
        title="Anmelden"
        onPress={() => void submit()}
        disabled={busy || username.trim() === '' || password === ''}
      />
      <View style={styles.health}>
        <HealthStatus />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  input: {
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 4,
    padding: 8,
  },
  error: { color: '#b00020' },
  health: { marginTop: 24 },
});
