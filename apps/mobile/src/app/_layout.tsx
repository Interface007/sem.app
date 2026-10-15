import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { BuildFooter } from '../components/BuildFooter';

export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ tabBarIconStyle: { display: 'none' } }}>
        <Tabs.Screen name="index" options={{ title: 'Start' }} />
        <Tabs.Screen name="haus" options={{ title: 'Haus' }} />
        <Tabs.Screen name="scan" options={{ title: 'Scan' }} />
        <Tabs.Screen name="einstellungen" options={{ title: 'Einstellungen' }} />
      </Tabs>
      <BuildFooter />
    </View>
  );
}
