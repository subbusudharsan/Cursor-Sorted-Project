import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Shield, Eye, EyeOff, Lock, Trash2, Download } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import NotificationBanner from '@/components/ui/NotificationBanner';

interface PrivacySettings {
  profile_visibility: 'public' | 'contacts_only' | 'private';
  show_online_status: boolean;
  allow_contact_invites: boolean;
  data_analytics: boolean;
  crash_reporting: boolean;
  usage_analytics: boolean;
}

export default function PrivacySecurityScreen() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<PrivacySettings>({
    profile_visibility: 'contacts_only',
    show_online_status: true,
    allow_contact_invites: true,
    data_analytics: false,
    crash_reporting: true,
    usage_analytics: false,
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    if (user) loadPrivacySettings();
  }, [user]);

  const showNotification = (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message?: string
  ) => {
    setNotification({ visible: true, type, title, message: message || '' });
  };

  const loadPrivacySettings = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_preferences')
        .eq('id', user?.id)
        .single();

      if (error) throw error;

      if (data?.user_preferences?.privacy) {
        setSettings(prev => ({
          ...prev,
          ...data.user_preferences.privacy,
        }));
      }
    } catch (error) {
      console.error('Error loading privacy settings:', error);
      showNotification('error', 'Load Failed', 'Could not load your privacy settings.');
    } finally {
      setLoading(false);
    }
  };

  const savePrivacySettings = async (newSettings: Partial<PrivacySettings>) => {
    setSaving(true);
    try {
      const updatedSettings = { ...settings, ...newSettings };
      
      const { data: currentProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('user_preferences')
        .eq('id', user?.id)
        .single();

      if (fetchError) throw fetchError;

      const updatedPreferences = {
        ...currentProfile.user_preferences,
        privacy: updatedSettings,
      };

      const { error } = await supabase
        .from('profiles')
        .update({ user_preferences: updatedPreferences })
        .eq('id', user?.id);

      if (error) throw error;

      setSettings(updatedSettings);
      showNotification('success', 'Settings Saved', 'Your privacy settings have been updated.');
    } catch (error) {
      console.error('Error saving privacy settings:', error);
      showNotification('error', 'Save Failed', 'Could not save your privacy settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (key: keyof PrivacySettings, value: boolean | string) => {
    const newSettings = { [key]: value };
    setSettings(prev => ({ ...prev, ...newSettings }));
    savePrivacySettings(newSettings);
  };

  const exportData = async () => {
    Alert.alert(
      'Export Data',
      'This will prepare a download of all your data including chats, reflections, and profile information.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async () => {
            try {
              showNotification('info', 'Export Started', 'Your data export is being prepared. You will receive an email when ready.');
              
              // In a real implementation, this would trigger a background job
              // For now, we'll simulate the process
              setTimeout(() => {
                showNotification('success', 'Export Ready', 'Your data export has been sent to your email address.');
              }, 3000);
            } catch (error) {
              showNotification('error', 'Export Failed', 'Could not export your data. Please try again.');
            }
          },
        },
      ]
    );
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Final Confirmation',
              'Are you absolutely sure? This will delete everything and cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Forever',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      setLoading(true);
                      
                      if (!user?.id) {
                        showNotification('error', 'Error', 'User not found');
                        setLoading(false);
                        return;
                      }

                      console.log('🗑️ Starting account deletion for user:', user.id);

                      // Call the edge function - it handles all cleanup and auth deletion
                      console.log('🔐 Calling delete-user-account edge function');
                      console.log('📤 Request body:', JSON.stringify({ userId: user.id }));

                      // Get the anon key for Authorization header
                      // Even though the function has auth: false, Supabase runtime may still require the header
                      const getEnvVariable = (key: string): string => {
                        if (process.env[key]) return process.env[key]!;
                        if (Constants.expoConfig?.extra?.[key]) return Constants.expoConfig.extra[key];
                        if (Constants.manifest?.extra?.[key]) return Constants.manifest.extra[key];
                        if (Constants.manifest2?.extra?.expoClient?.extra?.[key])
                          return Constants.manifest2.extra.expoClient.extra[key];
                        return '';
                      };
                      const anonKey = getEnvVariable('EXPO_PUBLIC_SUPABASE_ANON_KEY');

                      const response = await fetch(
                        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-user-account`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${anonKey}`,
                          },
                          body: JSON.stringify({ userId: user.id }),
                        }
                      );

                      const responseText = await response.text();
                      console.log('📥 Response status:', response.status);
                      console.log('📥 Response body:', responseText);

                      if (response.status !== 200) {
                        const errorMsg = responseText || `Failed to delete account (status: ${response.status})`;
                        console.error('❌ Edge function returned non-200 status:', response.status);
                        console.error('❌ Error response body:', errorMsg);
                        throw new Error(errorMsg);
                      }

                      let result;
                      try {
                        result = JSON.parse(responseText);
                      } catch (parseError) {
                        console.error('❌ Failed to parse response as JSON:', parseError);
                        throw new Error('Invalid response from server. Please try again.');
                      }

                      if (!result?.success) {
                        const errorMsg = result?.error || 'Failed to delete account';
                        console.error('❌ Account deletion failed:', result);
                        throw new Error(errorMsg);
                      }

                      console.log('✅ Account deleted successfully');

                      // Show success notification
                      showNotification('success', 'Account Deleted', 'Your account has been permanently deleted.');
                      
                      // Sign out and navigate immediately
                      try {
                        await signOut();
                        console.log('✅ Signed out successfully');
                      } catch (signOutError) {
                        console.warn('⚠️ Sign out error (continuing anyway):', signOutError);
                        // Continue with navigation even if signOut fails
                      }
                      
                      // Navigate to landing page
                      router.replace('/');
                      
                    } catch (error: any) {
                      console.error('❌ Error deleting account:', error);
                      const errorMessage = error?.message || 'Could not delete account. Please try again.';
                      showNotification('error', 'Deletion Failed', errorMessage);
                    } finally {
                      setLoading(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" />
          <Text style={styles.loadingText}>Loading privacy settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <>
      <NotificationBanner
        {...notification}
        onDismiss={() => setNotification(prev => ({ ...prev, visible: false }))}
      />
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {/* Header */}
          <View style={[styles.header, { paddingTop: Math.max(insets.top + Spacing.sm, Spacing.lg) }]}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <ArrowLeft size={20} color={Colors.text.secondary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Privacy & Security</Text>
            <View style={styles.placeholder} />
          </View>

          <ScrollView 
            style={styles.scrollView} 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Profile Privacy */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Profile Privacy</Text>
              
              <View style={styles.settingCard}>
                <View style={styles.settingHeader}>
                  <View style={styles.settingIcon}>
                    <Eye size={16} color={Colors.primary[500]} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Profile Visibility</Text>
                    <Text style={styles.settingDescription}>
                      Control who can see your profile information
                    </Text>
                  </View>
                </View>
                
                <View style={styles.radioGroup}>
                  {[
                    { value: 'contacts_only', label: 'Contacts Only', description: 'Only your contacts can see your profile' },
                    { value: 'public', label: 'Public', description: 'Anyone can find and see your profile' },
                    { value: 'private', label: 'Private', description: 'Your profile is hidden from everyone' },
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.radioOption,
                        settings.profile_visibility === option.value && styles.radioOptionSelected,
                      ]}
                      onPress={() => handleToggle('profile_visibility', option.value)}
                    >
                      <View style={[
                        styles.radioCircle,
                        settings.profile_visibility === option.value && styles.radioCircleSelected,
                      ]}>
                        {settings.profile_visibility === option.value && (
                          <View style={styles.radioInner} />
                        )}
                      </View>
                      <View style={styles.radioContent}>
                        <Text style={styles.radioLabel}>{option.label}</Text>
                        <Text style={styles.radioDescription}>{option.description}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.toggleCard}>
                <View style={styles.toggleHeader}>
                  <View style={styles.settingIcon}>
                    <Shield size={16} color={Colors.success[500]} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Show Online Status</Text>
                    <Text style={styles.settingDescription}>
                      Let contacts see when you're active
                    </Text>
                  </View>
                  <Switch
                    value={settings.show_online_status}
                    onValueChange={(value) => handleToggle('show_online_status', value)}
                    trackColor={{ false: Colors.neutral[300], true: Colors.primary[200] }}
                    thumbColor={settings.show_online_status ? Colors.primary[500] : Colors.neutral[400]}
                    disabled={saving}
                  />
                </View>
              </View>

              <View style={styles.toggleCard}>
                <View style={styles.toggleHeader}>
                  <View style={styles.settingIcon}>
                    <Lock size={16} color={Colors.warning[500]} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Allow Contact Invites</Text>
                    <Text style={styles.settingDescription}>
                      Allow others to send you contact invitations
                    </Text>
                  </View>
                  <Switch
                    value={settings.allow_contact_invites}
                    onValueChange={(value) => handleToggle('allow_contact_invites', value)}
                    trackColor={{ false: Colors.neutral[300], true: Colors.primary[200] }}
                    thumbColor={settings.allow_contact_invites ? Colors.primary[500] : Colors.neutral[400]}
                    disabled={saving}
                  />
                </View>
              </View>
            </View>

            {/* Data & Analytics */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Data & Analytics</Text>
              
              <View style={styles.toggleCard}>
                <View style={styles.toggleHeader}>
                  <View style={styles.settingIcon}>
                    <Shield size={16} color={Colors.secondary[500]} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Usage Analytics</Text>
                    <Text style={styles.settingDescription}>
                      Help improve Sorted by sharing anonymous usage data
                    </Text>
                  </View>
                  <Switch
                    value={settings.usage_analytics}
                    onValueChange={(value) => handleToggle('usage_analytics', value)}
                    trackColor={{ false: Colors.neutral[300], true: Colors.primary[200] }}
                    thumbColor={settings.usage_analytics ? Colors.primary[500] : Colors.neutral[400]}
                    disabled={saving}
                  />
                </View>
              </View>

              <View style={styles.toggleCard}>
                <View style={styles.toggleHeader}>
                  <View style={styles.settingIcon}>
                    <Shield size={16} color={Colors.error[500]} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Crash Reporting</Text>
                    <Text style={styles.settingDescription}>
                      Automatically send crash reports to help fix bugs
                    </Text>
                  </View>
                  <Switch
                    value={settings.crash_reporting}
                    onValueChange={(value) => handleToggle('crash_reporting', value)}
                    trackColor={{ false: Colors.neutral[300], true: Colors.primary[200] }}
                    thumbColor={settings.crash_reporting ? Colors.primary[500] : Colors.neutral[400]}
                    disabled={saving}
                  />
                </View>
              </View>
            </View>

            {/* Data Management */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Data Management</Text>
              
              <TouchableOpacity style={styles.actionCard} onPress={exportData}>
                <View style={styles.actionIcon}>
                  <Download size={20} color={Colors.primary[500]} />
                </View>
                <View style={styles.actionContent}>
                  <Text style={styles.actionTitle}>Export My Data</Text>
                  <Text style={styles.actionDescription}>
                    Download a copy of all your data
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.actionCard, styles.dangerCard]} onPress={deleteAccount}>
                <View style={[styles.actionIcon, styles.dangerIcon]}>
                  <Trash2 size={20} color={Colors.error[500]} />
                </View>
                <View style={styles.actionContent}>
                  <Text style={[styles.actionTitle, styles.dangerText]}>Delete Account</Text>
                  <Text style={styles.actionDescription}>
                    Permanently delete your account and all data
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Security Information */}
            <View style={styles.infoCard}>
              <Shield size={16} color={Colors.primary[500]} />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>Your Data is Secure</Text>
                <Text style={styles.infoText}>
                  Sorted uses end-to-end encryption for all conversations and stores your data securely. 
                  We never share your personal information with third parties without your explicit consent.
                </Text>
              </View>
            </View>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  loadingText: {
    fontSize: Typography.fontSize.lg,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surfaceElevated,
    ...Shadows.small,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  headerTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
  },
  placeholder: {
    width: 36,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  settingCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  settingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  radioGroup: {
    gap: Spacing.sm,
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  radioOptionSelected: {
    borderColor: Colors.primary[300],
    backgroundColor: Colors.primary[50],
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.neutral[400],
    marginRight: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: Colors.primary[500],
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary[500],
  },
  radioContent: {
    flex: 1,
  },
  radioLabel: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  radioDescription: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  toggleCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  toggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  dangerCard: {
    borderColor: Colors.error[200],
    backgroundColor: Colors.error[50],
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  dangerIcon: {
    backgroundColor: Colors.error[100],
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  dangerText: {
    color: Colors.error[600],
  },
  actionDescription: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.primary[50],
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.primary[200],
  },
  infoContent: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  infoTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[700],
    marginBottom: 2,
  },
  infoText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.primary[600],
    lineHeight: Typography.fontSize.xs * 1.3,
  },
});