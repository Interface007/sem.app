import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';
import { formatBuildInfo, readBuildInfo } from '../lib/buildInfo';

export function BuildFooter() {
  return (
    <View style={styles.footer}>
      <Text testID="build-info" style={styles.text}>
        {formatBuildInfo(readBuildInfo(Constants.expoConfig))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: 'center', paddingVertical: 4, backgroundColor: '#f2f2f2' },
  text: { fontSize: 12, color: '#555' },
});
