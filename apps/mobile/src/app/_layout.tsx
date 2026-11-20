import { Link, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Button, Platform, StyleSheet, Text, View } from 'react-native';
import { BuildFooter } from '../components/BuildFooter';
import { AuthProvider, useAuth } from '../lib/AuthProvider';
import { locationSharing } from '../lib/location/adapter';
// Registers the background task; it must exist even when Android starts the app without UI.
import '../lib/location/task';

function Navigation() {
  const { state, retry } = useAuth();
  const signedIn = state.status === 'signedIn';

  useEffect(() => {
    if (Platform.OS === 'android') void locationSharing.resume(signedIn);
  }, [signedIn]);

  if (state.status === 'checking') {
    return (
      <View style={styles.center}>
        <ActivityIndicator accessibilityLabel="Sitzung wird geprüft" />
      </View>
    );
  }
  if (state.status === 'unreachable') {
    return (
      <View style={styles.center}>
        <Text testID="server-unreachable">Server nicht erreichbar.</Text>
        <Button title="Erneut versuchen" onPress={retry} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{ tabBarIconStyle: { display: 'none' } }}
      // Signed out: only the login form, no tab bar at all.
      {...(signedIn ? {} : { tabBar: () => null })}
    >
      <Tabs.Protected guard={!signedIn}>
        <Tabs.Screen name="anmeldung" options={{ title: 'Anmeldung' }} />
      </Tabs.Protected>
      <Tabs.Protected guard={signedIn}>
        <Tabs.Screen name="index" options={{ title: 'Start' }} />
        <Tabs.Screen
          name="haus"
          options={{
            title: 'Haus',
            // Reached via the tile on the start page, not via the tab bar.
            href: null,
            headerLeft: () => (
              <Link href="/" accessibilityLabel="Zurück zur Startseite" style={styles.back}>
                ‹ Start
              </Link>
            ),
          }}
        />
        <Tabs.Screen
          name="familie"
          options={{
            title: 'Familie',
            // Reached via the tile on the start page, not via the tab bar.
            href: null,
            headerLeft: () => (
              <Link href="/" accessibilityLabel="Zurück zur Startseite" style={styles.back}>
                ‹ Start
              </Link>
            ),
          }}
        />
        <Tabs.Screen name="scan" options={{ title: 'Scan' }} />
        <Tabs.Screen name="einstellungen" options={{ title: 'Einstellungen' }} />
      </Tabs.Protected>
    </Tabs>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <View style={{ flex: 1 }}>
        <Navigation />
        <BuildFooter />
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  back: { paddingHorizontal: 16, fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
});
