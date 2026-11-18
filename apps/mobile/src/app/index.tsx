import { StyleSheet, View } from 'react-native';
import { HealthStatus } from '../components/HealthStatus';

export default function StartScreen() {
  return (
    <View style={styles.container}>
      <HealthStatus />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
