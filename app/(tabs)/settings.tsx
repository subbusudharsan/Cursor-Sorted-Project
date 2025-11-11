import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  Modal,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import {
  LogOut,
  User,
  Bell,
  Shield,
  CircleHelp as HelpCircle,
  Camera,
  X,
  Upload,
  Trash2,
  Lock,
} from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Button from '@/components/ui/Button';
import NotificationBanner from '@/components/ui/NotificationBanner';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  first_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
}

function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [notification, setNotification] = useState({
    visible: false,
    type: 'info' as 'success' | 'error' | 'info' | 'warning',
    title: '',
    message: '',
  });

  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user) fetchProfile();
  }, [user, fetchProfile]);

  useEffect(() => {
    if (user) {
      fetchProfile();
      const cleanup = setupProfileSubscription();
      return cleanup;
    }
  }, [user, fetchProfile]);

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [fetchProfile])
  );

  const setupProfileSubscription = () => {
    if (!user?.id) return () => {};

    const profileSubscription = supabase
      .channel(`settings-profile-${user?.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user?.id}`,
        },
        (payload) => {
          console.log('👤 Settings - Profile update detected, refreshing');
          fetchProfile();
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(profileSubscription);
      } catch (error) {
        console.error('Error cleaning up settings profile subscription:', error);
      }
    };
  };

  const showNotification = (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message?: string
  ) => {
    setNotification({ visible: true, type, title, message: message || '' });
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
            router.replace('/');
          } catch (error) {
            Alert.alert('Error', 'Failed to sign out');
          }
        },
      },
    ]);
  };

  const handleClearAllData = () => {
    Alert.alert(
      'Clear All Data',
      'This will permanently delete all your chats, AI sessions, and soulroom entries. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await supabase.from('chats').delete().or(`user_id.eq.${user?.id},contact_id.eq.${user?.id}`);
              await supabase.from('soulroom_entries').delete().eq('user_id', user?.id);

              showNotification('success', 'Data Cleared', 'All your data has been cleared successfully');
            } catch (error) {
              console.error('Error clearing data:', error);
              showNotification('error', 'Clear Failed', 'Failed to clear data. Please try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  // ✅ Updated: each option now navigates to a screen
  const settingsOptions = [
    {
      icon: User,
      title: 'Profile',
      subtitle: 'Edit your personal information',
      description: 'Update your name, email, and profile picture.',
      onPress: () => router.push('/settings/profile'),
    },
    {
      icon: Bell,
      title: 'Notifications',
      subtitle: 'Manage notification preferences',
      description: 'Control how and when you get notified.',
      onPress: () => router.push('/settings/notifications'),
    },
    {
      icon: Shield,
      title: 'Privacy & Security',
      subtitle: 'Control your privacy settings',
      description: 'Manage data sharing and account security.',
      onPress: () => router.push('/settings/privacy'),
    },
    {
      icon: Lock,
      title: 'Change Password',
      subtitle: 'Keep your password strong',
      description: 'Update your password with the latest security policy.',
      onPress: () => router.push('/settings/change-password'),
    },
    {
      icon: Trash2,
      title: 'Clear All Data',
      subtitle: 'Delete all chats and sessions',
      description: 'This cannot be undone.',
      onPress: () => handleClearAllData(),
    },
    {
      icon: HelpCircle,
      title: 'Help & Support',
      subtitle: 'Get help and contact support',
      description: 'FAQs, tutorials, and contact info.',
      onPress: () => router.push('/settings/help'),
    },
  ];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" />
          <Text style={styles.loadingText}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <NotificationBanner
        {...notification}
        onDismiss={() => setNotification((prev) => ({ ...prev, visible: false }))}
      />
      <SafeAreaView style={styles.container}>
        <Animated.View style={[styles.content, { opacity: fadeAnim, paddingTop: insets.top }]}> 
          {/* Centered content container */}
          <View style={styles.centeredContainer}>
            {/* Title */}
            <View style={styles.titleSection}>
              <Text style={styles.title}>Settings</Text>
            </View>

            {/* Profile info */}
            <View style={styles.profileSection}>
              <TouchableOpacity
                style={styles.avatarContainer}
                onPress={() => setShowAvatarModal(true)}
                disabled={uploading}
                activeOpacity={0.8}
              >
                {profile?.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
                ) : (
                 <View style={styles.avatarCircle}>
  <User size={24} color="#FFEB3B" />
</View>

                )}
              </TouchableOpacity>
              <Text style={styles.userName}>
                {profile?.first_name || profile?.nickname || profile?.full_name?.split(' ')[0] || 'User'}
              </Text>
              <Text style={styles.userEmail}>{profile?.email || 'No email'}</Text>
            </View>

            {/* Settings option cards */}
            <View style={styles.settingsList}>
              {settingsOptions.map((option, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.settingItem}
                  onPress={option.onPress}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingIcon}>
                    <option.icon size={18} color={Colors.text.secondary} />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>{option.title}</Text>
                    <Text style={styles.settingSubtitle}>{option.subtitle}</Text>
                    <Text style={styles.settingDescription}>{option.description}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Sign Out button */}
            <View style={styles.signOutContainer}>
              <Button
                title="Sign Out"
                onPress={handleSignOut}
                variant="outline"
                style={styles.signOutButton}
                textStyle={styles.signOutButtonText}
                icon={<LogOut size={16} color={Colors.error[500]} />}
              />
            </View>
          </View>

        </Animated.View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1 },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    marginTop: Spacing.md,
  },

  titleSection: {
    marginBottom: Spacing.xs,
  },

  title: {
    fontSize: Typography.fontSize['2xl'],
    fontWeight: Typography.fontWeight.bold,
    color: '#0288D1',
    textAlign: 'left',
  },

  profileSection: {
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },

  userName: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: '#0288D1',
    marginTop: Spacing.sm,
    textAlign: 'center',
  },

  userEmail: {
    fontSize: Typography.fontSize.sm,
    color: '#0277BD',
    textAlign: 'center',
    marginTop: Spacing.xs,
  },

  avatarContainer: {
    marginBottom: Spacing.xs,
  },
  avatar: { width: 48, height: 48, borderRadius: BorderRadius.xxl },
  

  settingsList: { 
    marginBottom: Spacing.md,
  },

  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: '#FFEB3B',
    ...Shadows.small,
  },

  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.lg,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
    borderWidth: 1,
    borderColor: '#E0F7FA',
    ...Shadows.small,
  },

  settingContent: { flex: 1 },

  settingTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: '#0288D1',
  },

  settingSubtitle: { fontSize: Typography.fontSize.xs, color: '#0277BD' },
  settingDescription: { fontSize: Typography.fontSize.xs, color: '#546E7A' },

  signOutContainer: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },

  signOutButton: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },

  signOutButtonText: {
    color: '#D32F2F',
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
  },
  avatarCircle: {
  width: 48,
  height: 48,
  borderRadius: 24,
  borderWidth: 2,
  borderColor: '#FFEB3B',     // lemon yellowborder (#0D47A1 - dark navy blue border)
  backgroundColor: '#42A5F5', // sky blue fill
  justifyContent: 'center',
  alignItems: 'center',
  alignSelf: 'center',
  marginBottom: 8,
},

});

export default SettingsScreen;