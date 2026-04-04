import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DrawerContentScrollView, DrawerItem } from '@react-navigation/drawer';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useAuthContext } from '@/src/context/AuthContext';
import { getServerInfo } from '@/src/api/server';

function getInitials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function getAvatarColor(str: string): string {
  const palette = [
    '#4a9eff',
    '#7c5af3',
    '#e66465',
    '#f0a500',
    '#2ecc71',
    '#e91e8c',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0x7fffffff;
  }
  return palette[hash % palette.length];
}

function DrawerContent(props: DrawerContentComponentProps) {
  const { clearToken, user } = useAuthContext();
  const appVersion = Constants.expoConfig?.version ?? '—';

  const { data: serverInfo } = useQuery({
    queryKey: ['server-info'],
    queryFn: getServerInfo,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  const initials = user ? getInitials(user.name, user.email) : '?';
  const avatarColor = user ? getAvatarColor(user.email) : '#4a9eff';
  const displayName = user?.name ?? user?.email ?? 'User';

  return (
    <View style={styles.drawerRoot}>
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled
      >
        {/* User avatar */}
        <View style={styles.userSection}>
          <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>
              {displayName}
            </Text>
            {user?.name && (
              <Text style={styles.userEmail} numberOfLines={1}>
                {user.email}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.divider} />

        {/* Nav items */}
        <DrawerItem
          label="Series"
          labelStyle={styles.itemLabel}
          icon={({ color, size }) => (
            <Ionicons name="albums-outline" size={size} color={color} />
          )}
          onPress={() => router.push('/(drawer)/(tabs)/series')}
          activeTintColor="#4a9eff"
          inactiveTintColor="#888"
        />
        <DrawerItem
          label="Annotations"
          labelStyle={styles.itemLabel}
          icon={({ color, size }) => (
            <Ionicons name="bookmark-outline" size={size} color={color} />
          )}
          onPress={() => router.push('/(drawer)/(tabs)/annotations')}
          activeTintColor="#4a9eff"
          inactiveTintColor="#888"
        />
        <DrawerItem
          label="Smart Shelves"
          labelStyle={styles.itemLabel}
          icon={({ color, size }) => (
            <Ionicons name="sparkles-outline" size={size} color={color} />
          )}
          onPress={() => router.push('/(drawer)/(tabs)/smart-shelves')}
          activeTintColor="#4a9eff"
          inactiveTintColor="#888"
        />

        {/* Version info */}
        <View style={styles.versionSection}>
          <View style={styles.divider} />
          <Text style={styles.versionLabel}>
            Server{' '}
            <Text style={styles.versionValue}>
              {serverInfo ? `v${serverInfo.version}` : '—'}
            </Text>
          </Text>
          <Text style={styles.versionLabel}>
            App <Text style={styles.versionValue}>v{appVersion}</Text>
          </Text>
        </View>
      </DrawerContentScrollView>

      {/* Logout — pinned to bottom */}
      <View style={styles.footer}>
        <View style={styles.divider} />
        <Pressable style={styles.logoutBtn} onPress={() => clearToken()}>
          <Ionicons name="log-out-outline" size={22} color="#ff6b6b" />
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>
    </View>
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
      <Drawer.Screen
        name="(tabs)"
        options={{ headerShown: false, drawerItemStyle: { display: 'none' } }}
      />
      <Drawer.Screen
        name="annotations"
        options={{ drawerItemStyle: { display: 'none' }, headerShown: false }}
      />
      <Drawer.Screen
        name="index"
        options={{ drawerItemStyle: { display: 'none' }, headerShown: false }}
      />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  drawerRoot: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },

  // User section
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
    gap: 2,
  },
  userName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  userEmail: {
    color: '#666',
    fontSize: 12,
  },

  // Nav items
  itemLabel: {
    fontSize: 15,
  },

  // Version
  versionSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 4,
  },
  versionLabel: {
    color: '#555',
    fontSize: 12,
  },
  versionValue: {
    color: '#444',
    fontWeight: '600',
  },

  // Shared
  divider: {
    borderTopWidth: 1,
    borderTopColor: '#1c1c1e',
    marginHorizontal: 16,
    marginVertical: 8,
  },

  // Footer
  footer: {
    paddingBottom: 24,
    backgroundColor: '#0d0d0d',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  logoutText: {
    color: '#ff6b6b',
    fontSize: 15,
  },
});
