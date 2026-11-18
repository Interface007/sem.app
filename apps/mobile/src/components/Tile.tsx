import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface TileProps {
  title: string;
  subtitle?: string;
  testID?: string;
  onPress: () => void;
}

export function Tile({ title, subtitle, testID, onPress }: TileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Text style={styles.title}>{title}</Text>
      {subtitle !== undefined && <Text style={styles.subtitle}>{subtitle}</Text>}
    </Pressable>
  );
}

/** Two-column grid for `Tile`s. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, width: '100%' },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 96,
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#e8f0fe',
  },
  pressed: { opacity: 0.7 },
  title: { fontSize: 18, fontWeight: '600' },
  subtitle: { marginTop: 4, color: '#555' },
});
