import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DrawerContentScrollView,
  DrawerItemList,
} from '@react-navigation/drawer';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import { useAuthContext } from '@/src/context/AuthContext';

function DrawerContent(props: DrawerContentComponentProps) {
  const { clearToken } = useAuthContext();

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={styles.drawerContainer}
    >
      <DrawerItemList {...props} />
      <View style={styles.divider} />
      <Pressable style={styles.signOutBtn} onPress={() => clearToken()}>
        <Ionicons name="log-out-outline" size={22} color="#ff6b6b" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </DrawerContentScrollView>
  );
}

export default function DrawerLayout() {
  const { token, serverUrl, loading } = useAuthContext();

  if (loading) return null;
  if (!serverUrl) return <Redirect href="/server-setup" />;
  if (!token) return <Redirect href="/login" />;

  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        drawerStyle: { backgroundColor: '#0d0d0d' },
        drawerActiveTintColor: '#4a9eff',
        drawerInactiveTintColor: '#888',
        drawerLabelStyle: { fontSize: 15 },
      }}
    >
      {/* Main tabs — hidden from drawer item list, manages its own header */}
      <Drawer.Screen
        name="(tabs)"
        options={{
          headerShown: false,
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="annotations"
        options={{
          title: 'Annotations',
          drawerLabel: 'Annotations',
          drawerIcon: ({ color, size }) => (
            <Ionicons name="bookmark-outline" size={size} color={color} />
          ),
        }}
      />
      {/* index exists only as a redirect fallback */}
      <Drawer.Screen
        name="index"
        options={{ drawerItemStyle: { display: 'none' }, headerShown: false }}
      />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  drawerContainer: {
    flex: 1,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: '#1c1c1e',
    marginHorizontal: 16,
    marginTop: 8,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  signOutText: {
    color: '#ff6b6b',
    fontSize: 15,
  },
});
