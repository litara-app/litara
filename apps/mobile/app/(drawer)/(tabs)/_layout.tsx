import { Tabs } from 'expo-router';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { MiniPlayerTabBar } from '@/src/components/MiniPlayerTabBar';

function HamburgerButton() {
  const navigation = useNavigation();
  return (
    <Pressable
      onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
      style={{ paddingLeft: 16 }}
      hitSlop={8}
    >
      <Ionicons name="menu" size={24} color="#fff" />
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <MiniPlayerTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        headerLeft: () => <HamburgerButton />,
        tabBarStyle: {
          backgroundColor: '#0a0a0a',
          borderTopColor: '#1c1c1e',
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: '#4a9eff',
        tabBarInactiveTintColor: '#555',
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="books"
        options={{
          title: 'All Books',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="library-outline" size={size} color={color} />
          ),
          // headerRight injected dynamically by books.tsx via navigation.setOptions
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="libraries"
        options={{
          title: 'Libraries',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="folder-open-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="shelves"
        options={{
          title: 'Shelves',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bookmark-outline" size={size} color={color} />
          ),
        }}
      />
      {/* Hidden tabs — accessible via the drawer menu */}
      <Tabs.Screen
        name="series"
        options={{ title: 'Series', tabBarItemStyle: { display: 'none' } }}
      />
      <Tabs.Screen
        name="authors"
        options={{ title: 'Authors', tabBarItemStyle: { display: 'none' } }}
      />
      <Tabs.Screen
        name="annotations"
        options={{ title: 'Annotations', tabBarItemStyle: { display: 'none' } }}
      />
      <Tabs.Screen
        name="smart-shelves"
        options={{
          title: 'Smart Shelves',
          tabBarItemStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="book-drop"
        options={{ title: 'Book Drop', tabBarItemStyle: { display: 'none' } }}
      />
      <Tabs.Screen
        name="book-review"
        options={{ title: 'Book Review', tabBarItemStyle: { display: 'none' } }}
      />
    </Tabs>
  );
}
