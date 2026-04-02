import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function SeriesScreen() {
  return (
    <View style={styles.container}>
      <Ionicons name="albums-outline" size={48} color="#333" />
      <Text style={styles.title}>Series</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  title: { color: '#555', fontSize: 18, fontWeight: '600', marginTop: 12 },
  subtitle: { color: '#333', fontSize: 14 },
});
