import { Tabs, useRouter, useSegments } from 'expo-router';
import { MessageCircle, Users, Heart, Settings } from 'lucide-react-native';
import { useChatBadge } from '@/contexts/ChatBadgeContext';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

function TabLayout() {
  const { unreadContactCount } = useChatBadge();
  const { user, loading, isRestoringSession } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  // ✅ FIX: Navigation guard - redirect to signin ONLY when truly unauthenticated
  // Do NOT redirect during session restore or when user is on non-tabs routes
  useEffect(() => {
    const publicRoutes = [
      '/reset-password',
      '/enter-otp',
      '/(auth)/signin',
      '/(auth)/signup',
      '/accept-invitation'
    ];

    // Construct current pathname from segments
    const currentPathname = '/' + segments.join('/');

    // Only redirect if:
    // 1. Not loading
    // 2. Not restoring session (prevents redirect during temporary session=null)
    // 3. User is not authenticated
    // 4. Current route is NOT a public route
    // 5. We're actually inside the tabs group (segments start with 'tabs')
    const isInTabsGroup = segments.length > 0 && segments[0] === '(tabs)';
    
    if (!loading && !isRestoringSession && !user && !publicRoutes.includes(currentPathname) && isInTabsGroup) {
      console.log('🚫 User not authenticated in tabs, redirecting to signin');
      router.replace('/(auth)/signin');
    }
  }, [user, loading, isRestoringSession, router, segments]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          paddingBottom: 8,
          paddingTop: 8,
          height: 80,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ size, color }) => (
            <View style={styles.iconContainer}>
              <MessageCircle size={size} color={color} />
              {unreadContactCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {unreadContactCount > 99 ? '99+' : unreadContactCount.toString()}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ size, color }) => (
            <Users size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="soulroom"
        options={{
          title: 'Soulroom',
          tabBarIcon: ({ size, color }) => (
            <Heart size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ size, color }) => (
            <Settings size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default TabLayout;