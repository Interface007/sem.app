import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { HealthStatus } from '../components/HealthStatus';
import { Tile, TileGrid } from '../components/Tile';

export default function StartScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <TileGrid>
        <Tile
          title="Haus"
          subtitle="Haus-Modell"
          testID="tile-haus"
          onPress={() => router.push('/haus')}
        />
      </TileGrid>
      <HealthStatus />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'space-between', padding: 16 },
});
