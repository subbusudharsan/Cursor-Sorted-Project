import { Tabs, useRouter } from 'expo-router';
import { MessageCircle, Users, Heart, Settings } from 'lucide-react-native';
import { useChatBadge } from '@/contexts/ChatBadgeContext';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

function TabLayout() {
  const { unreadContactCount } = useChatBadge();
  const { user, loading } = useAuth();
  const router = useRouter();

  // ✅ FIX: Navigation guard - redirect to landing if not authenticated
  // This prevents users from accessing tabs after signing out
  useEffect(() => {
    if (!loading && !user) {
      // User is not authenticated, redirect to landing page immediately
      console.log('🚫 User not authenticated, redirecting to landing page');
      // Use replace to prevent back navigation
      router.replace('/');
    }
  }, [user, loading, router]);

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