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
import KeyboardSafeView from '@/components/KeyboardSafeView';
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
      'This will permanently delete all your chats, AI sessions, soulroom entries, reflections, insights, nudges, emotions, orchestration, and notifications. Your contacts will be preserved. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              
              if (!user?.id) {
                showNotification('error', 'Error', 'User not found');
                return;
              }

              console.log('🗑️ Starting comprehensive data deletion for user:', user.id);

              // 1. Delete all chats (AI assistant + contact chats) where user is involved
              // This covers: My Talks, Contact Talks, AI chat conversations, ongoing chats
              // Include participants array check to catch all chats
              // Use correct Supabase syntax with quotes around user.id for participants.cs
              const { error: chatsError } = await supabase
                .from('chats')
                .delete()
                .or(`user_id.eq.${user.id},contact_id.eq.${user.id},participants.cs.{"${user.id}"}`);
              
              if (chatsError) {
                console.error('❌ Error deleting chats:', chatsError);
                throw new Error(`Failed to delete chats: ${chatsError.message}`);
              }
              console.log('✅ Deleted all chats (AI assistant + contact chats)');

              // 2. Delete message options (ongoing chat options)
              // Delete by recipient_id first, then by sender_id if needed
              const { error: messageOptionsError1 } = await supabase
                .from('message_options')
                .delete()
                .eq('recipient_id', user.id);
              
              // Also delete message options where user is the sender (if sender_id exists)
              const { error: messageOptionsError2 } = await supabase
                .from('message_options')
                .delete()
                .eq('sender_id', user.id);
              
              if (messageOptionsError1 || messageOptionsError2) {
                console.warn('⚠️ Error deleting message options:', messageOptionsError1 || messageOptionsError2);
              } else {
                console.log('✅ Deleted message options');
              }

              // 3. Delete soulroom entries (try both table names for compatibility)
              const { error: soulEntriesError } = await supabase
                .from('soul_entries')
                .delete()
                .eq('user_id', user.id);
              
              if (soulEntriesError) {
                // Try alternative table name (soulroom_entries might be a view or alias)
                const { error: soulroomEntriesError } = await supabase
                  .from('soulroom_entries')
                  .delete()
                  .eq('user_id', user.id);
                
                if (soulroomEntriesError) {
                  console.warn('⚠️ Could not delete soulroom entries:', soulroomEntriesError);
                } else {
                  console.log('✅ Deleted soulroom entries');
                }
              } else {
                console.log('✅ Deleted soul entries');
              }

              // 4. Delete soul AI insights
              const { error: insightsError } = await supabase
                .from('soul_ai_insights')
                .delete()
                .eq('user_id', user.id);
              
              if (insightsError) {
                console.warn('⚠️ Error deleting soul AI insights:', insightsError);
              } else {
                console.log('✅ Deleted soul AI insights');
              }

              // 5. Delete wellness daily checkins
              const { error: wellnessError } = await supabase
                .from('wellness_daily_checkins')
                .delete()
                .eq('user_id', user.id);
              
              if (wellnessError) {
                console.warn('⚠️ Error deleting wellness checkins:', wellnessError);
              } else {
                console.log('✅ Deleted wellness checkins');
              }

              // 6. Delete emotion timeline
              const { error: emotionTimelineError } = await supabase
                .from('emotion_timeline')
                .delete()
                .eq('user_id', user.id);
              
              if (emotionTimelineError) {
                console.warn('⚠️ Error deleting emotion timeline:', emotionTimelineError);
              } else {
                console.log('✅ Deleted emotion timeline');
              }

              // 7. Delete soul coach nudges
              const { error: nudgesError } = await supabase
                .from('soul_coach_nudges')
                .delete()
                .eq('user_id', user.id);
              
              if (nudgesError) {
                console.warn('⚠️ Error deleting coach nudges:', nudgesError);
              } else {
                console.log('✅ Deleted coach nudges');
              }

              // 8. Delete emotion intent history
              const { error: emotionIntentError } = await supabase
                .from('emotion_intent_history')
                .delete()
                .eq('user_id', user.id);
              
              if (emotionIntentError) {
                console.warn('⚠️ Error deleting emotion intent history:', emotionIntentError);
              } else {
                console.log('✅ Deleted emotion intent history');
              }

              // 9. Delete conversation orchestration
              const { error: orchestrationError } = await supabase
                .from('conversation_orchestration')
                .delete()
                .eq('user_id', user.id);
              
              if (orchestrationError) {
                console.warn('⚠️ Error deleting conversation orchestration:', orchestrationError);
              } else {
                console.log('✅ Deleted conversation orchestration');
              }

              // 10. Delete agent decisions
              const { error: agentDecisionsError } = await supabase
                .from('agent_decisions')
                .delete()
                .eq('user_id', user.id);
              
              if (agentDecisionsError) {
                console.warn('⚠️ Error deleting agent decisions:', agentDecisionsError);
              } else {
                console.log('✅ Deleted agent decisions');
              }

              // 11. Delete notifications
              const { error: notificationsError } = await supabase
                .from('notifications')
                .delete()
                .eq('user_id', user.id);
              
              if (notificationsError) {
                console.warn('⚠️ Error deleting notifications:', notificationsError);
              } else {
                console.log('✅ Deleted notifications');
              }

              console.log('✅ All data cleared successfully');
              showNotification('success', 'Data Cleared', 'All your data has been cleared successfully. Your contacts have been preserved.');
              
              // Navigate to chats tab to refresh the UI and show zero chats
              setTimeout(() => {
                router.replace('/(tabs)/chats');
              }, 500);
            } catch (error: any) {
              console.error('❌ Error clearing data:', error);
              showNotification('error', 'Clear Failed', error?.message || 'Failed to clear data. Please try again.');
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
      description: 'Update your password securely',
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
      <KeyboardSafeView
        style={styles.container}
        contentStyle={styles.content}
        offset={(insets.top || 0) + 8}
        edges={['top', 'left', 'right']}
      >
        <Animated.View style={[styles.content, { opacity: fadeAnim, paddingTop: insets.top }]}> 
          {/* Centered content container */}
          <View style={styles.centeredContainer}>
  <View style={{ width: '92%' }}>

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
          </View>
        </Animated.View>
      </KeyboardSafeView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1 },
  centeredContainer: {
    flex: 1,
    justifyContent: 'flex-start', // start from top instead of center
    alignItems: 'center',      // keeps all content nicely aligned
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs, // reduced top padding
    paddingBottom: Spacing.xs, // reduced bottom padding
  },
  
  
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -20 }], 
  },
  loadingText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    marginTop: Spacing.md,
    
  },

  titleSection: {
    marginBottom: Spacing.sm, // increased spacing
  },

  title: {
    fontSize: Typography.fontSize.xl, // reduced from 2xl
    fontWeight: Typography.fontWeight.bold,
    color: '#0288D1',
    textAlign: 'left',
  },

  profileSection: {
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: Spacing.md, // increased spacing between profile and settings
  },

  userName: {
    fontSize: Typography.fontSize.base, // reduced from lg
    fontWeight: Typography.fontWeight.semibold,
    color: '#0288D1',
    marginTop: Spacing.xs, // reduced from sm
    textAlign: 'center',
  },

  userEmail: {
    fontSize: Typography.fontSize.xs, // reduced from sm
    color: '#0277BD',
    textAlign: 'center',
    marginTop: 2, // reduced from Spacing.xs
  },

  avatarContainer: {
    marginBottom: 0, // removed margin
  },
  avatar: { width: 48, height: 48, borderRadius: BorderRadius.xxl },
  

  settingsList: {
    marginBottom: Spacing.md, // increased spacing before sign out
  },
  

  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.xs, // reduced from sm
    marginBottom: Spacing.xs, // reduced from sm
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
    fontSize: Typography.fontSize.xs, // reduced from sm
    fontWeight: Typography.fontWeight.semibold,
    color: '#0288D1',
  },

  settingSubtitle: { fontSize: Typography.fontSize.xs, color: '#0277BD', lineHeight: Typography.fontSize.xs * 1.2 },
  settingDescription: { fontSize: Typography.fontSize.xs, color: '#546E7A', lineHeight: Typography.fontSize.xs * 1.2 },

  signOutContainer: {
    marginTop: Spacing.sm, // added spacing from settings list
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.md, // increased bottom padding for visibility
    alignItems: 'center',
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
  marginBottom: 4, // reduced from 8
},

});

export default SettingsScreen;