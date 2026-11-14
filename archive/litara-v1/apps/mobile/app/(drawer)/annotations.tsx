import { StyleSheet, Text, View } from 'react-native';

export default function AnnotationsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Annotations coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#666',
    fontSize: 15,
  },
});
