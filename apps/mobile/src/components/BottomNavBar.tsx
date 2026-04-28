import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface NavItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'home-outline', href: '/(drawer)/(tabs)/' },
  {
    label: 'All Books',
    icon: 'library-outline',
    href: '/(drawer)/(tabs)/books',
  },
  { label: 'Search', icon: 'search', href: '/(drawer)/(tabs)/search' },
  {
    label: 'Libraries',
    icon: 'folder-open-outline',
    href: '/(drawer)/(tabs)/libraries',
  },
  {
    label: 'Shelves',
    icon: 'bookmark-outline',
    href: '/(drawer)/(tabs)/shelves',
  },
];

export function BottomNavBar() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}
    >
      {NAV_ITEMS.map((item) => (
        <Pressable
          key={item.label}
          style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          onPress={() => router.push(item.href)}
          hitSlop={4}
        >
          <Ionicons name={item.icon} size={22} color="#555" />
          <Text style={styles.label}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1c1c1e',
    paddingTop: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  itemPressed: { opacity: 0.6 },
  label: {
    color: '#555',
    fontSize: 11,
  },
});
