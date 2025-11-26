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
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Bell, MessageCircle, Users, Bot, Heart, Mail, Smartphone, Volume2 } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import NotificationBanner from '@/components/ui/NotificationBanner';

interface NotificationSettings {
  // Message Notifications
  message_notifications: boolean;
  message_sound: boolean;
  message_vibration: boolean;
  
  // Contact Notifications
  contact_invites: boolean;
  contact_accepted: boolean;
  contact_sound: boolean;
  
  // AI Assistant Notifications
  ai_responses: boolean;
  ai_suggestions: boolean;
  ai_sound: boolean;
  
  // Soulroom Notifications
  soulroom_reminders: boolean;
  daily_reflection: boolean;
  
  // Email Notifications
  email_summaries: boolean;
  email_important: boolean;
  
  // General Settings
  do_not_disturb: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export default function NotificationsSettingsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<NotificationSettings>({
    message_notifications: true,
    message_sound: true,
    message_vibration: true,
    contact_invites: true,
    contact_accepted: true,
    contact_sound: true,
    ai_responses: true,
    ai_suggestions: false,
    ai_sound: false,
    soulroom_reminders: true,
    daily_reflection: false,
    email_summaries: false,
    email_important: true,
    do_not_disturb: false,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingNotification, setTestingNotification] = useState(false);
  const [notification, setNotification] = useState({
    visible: false,
    type: 'info' as 'success' | 'error' | 'info' | 'warning',
    title: '',
    message: '',
  });

  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const scaleAnim = React.useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (user) loadNotificationSettings();
  }, [user]);

  const showNotification = (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message?: string
  ) => {
    setNotification({ visible: true, type, title, message: message || '' });
  };

  const loadNotificationSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_preferences')
        .eq('id', user?.id)
        .single();

      if (error) throw error;

      if (data?.user_preferences?.notifications) {
        setSettings(prev => ({
          ...prev,
          ...data.user_preferences.notifications,
        }));
      }
    } catch (error) {
      console.error('Error loading notification settings:', error);
      showNotification('error', 'Load Failed', 'Could not load your notification preferences.');
    } finally {
      setLoading(false);
    }
  };

  const saveNotificationSettings = async (newSettings: Partial<NotificationSettings>) => {
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
        notifications: updatedSettings,
      };

      const { error } = await supabase
        .from('profiles')
        .update({ user_preferences: updatedPreferences })
        .eq('id', user?.id);

      if (error) throw error;

      setSettings(updatedSettings);
      showNotification('success', 'Settings Saved', 'Your notification preferences have been updated.');
    } catch (error) {
      console.error('Error saving notification settings:', error);
      showNotification('error', 'Save Failed', 'Could not save your notification preferences.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (key: keyof NotificationSettings, value: boolean) => {
    const newSettings = { [key]: value };
    setSettings(prev => ({ ...prev, ...newSettings }));
    saveNotificationSettings(newSettings);
    
    // Show immediate feedback for certain toggles
    if (key === 'do_not_disturb' && value) {
      showNotification('info', 'Do Not Disturb Enabled', 'All notifications are now silenced.');
    } else if (key === 'do_not_disturb' && !value) {
      showNotification('success', 'Do Not Disturb Disabled', 'Notifications are now active based on your settings.');
    }
  };

  const testNotification = async () => {
    setTestingNotification(true);
    try {
      // Import the notification service
      const { notificationService } = await import('@/contexts/NotificationService');
      
      // Create a test notification in the database and trigger local notification
      const testNotificationData = {
        user_id: user?.id,
        type: 'contact_invite' as const,
        title: 'Test Notification 🔔',
        message: 'This is a test notification to verify your settings are working correctly.',
        data: { test: true, timestamp: new Date().toISOString() },
      };

      const { error } = await supabase
        .from('notifications')
        .insert(testNotificationData);

      if (error) throw error;

      // Also trigger a local notification to test the notification service
      await notificationService.showNotification(
        testNotificationData.title,
        testNotificationData.message,
        testNotificationData.type,
        testNotificationData.data
      );

      showNotification('success', 'Test Sent', 'A test notification has been created and sent. Check your notifications tab and device notifications.');
    } catch (error) {
      console.error('Error creating test notification:', error);
      showNotification('error', 'Test Failed', 'Could not create test notification.');
    } finally {
      setTestingNotification(false);
    }
  };

  const updateQuietHours = async (startTime: string, endTime: string) => {
    const newSettings = {
      quiet_hours_start: startTime,
      quiet_hours_end: endTime,
    };
    await saveNotificationSettings(newSettings);
  };

  const showQuietHoursEditor = () => {
    Alert.alert(
      'Quiet Hours',
      'This feature allows you to set specific hours when notifications will be silenced.',
      [
        { text: 'OK' }
      ]
    );
  };

  const renderToggleSection = (
    title: string,
    description: string,
    icon: React.ReactNode,
    items: Array<{
      key: keyof NotificationSettings;
      label: string;
      description: string;
      enabled: boolean;
    }>
  ) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>{icon}</View>
        <View style={styles.sectionInfo}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionDescription}>{description}</Text>
        </View>
      </View>
      
      <View style={styles.toggleContainer}>
        {items.map((item, index) => (
          <View key={item.key} style={[styles.toggleItem, index === items.length - 1 && styles.lastToggleItem]}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>{item.label}</Text>
              <Text style={styles.toggleDescription}>{item.description}</Text>
            </View>
            <Switch
              value={settings[item.key] as boolean}
              onValueChange={(value) => handleToggle(item.key, value)}
              trackColor={{ false: Colors.neutral[300], true: Colors.primary[200] }}
              thumbColor={settings[item.key] ? Colors.primary[500] : Colors.neutral[400]}
              disabled={saving || !item.enabled}
            />
          </View>
        ))}
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" />
          <Text style={styles.loadingText}>Loading notification settings...</Text>
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
        <Animated.View 
          style={[
            styles.content, 
            { 
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            }
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { paddingTop: Math.max(insets.top + Spacing.sm, Spacing.lg) }]}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <ArrowLeft size={24} color={Colors.text.secondary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Notifications</Text>
            <View style={styles.placeholder} />
          </View>

          <ScrollView 
            style={styles.scrollView} 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Do Not Disturb */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, styles.dndIcon]}>
                  <Volume2 size={16} color={Colors.warning[600]} />
                </View>
                <View style={styles.sectionInfo}>
                  <Text style={styles.sectionTitle}>Do Not Disturb</Text>
                  <Text style={styles.sectionDescription}>
                    Temporarily disable all notifications
                  </Text>
                </View>
                <Switch
                  value={settings.do_not_disturb}
                  onValueChange={(value) => handleToggle('do_not_disturb', value)}
                  trackColor={{ false: Colors.neutral[300], true: Colors.warning[200] }}
                  thumbColor={settings.do_not_disturb ? Colors.warning[500] : Colors.neutral[400]}
                  disabled={saving}
                />
              </View>
            </View>

            {/* Messages */}
            {renderToggleSection(
              'Messages',
              'Notifications for chat messages and conversations',
              <MessageCircle size={16} color={Colors.primary[500]} />,
              [
                {
                  key: 'message_notifications',
                  label: 'Message Notifications',
                  description: 'Get notified when you receive new messages',
                  enabled: !settings.do_not_disturb,
                },
                {
                  key: 'message_sound',
                  label: 'Message Sound',
                  description: 'Play sound for new messages',
                  enabled: !settings.do_not_disturb && settings.message_notifications,
                },
                {
                  key: 'message_vibration',
                  label: 'Message Vibration',
                  description: 'Vibrate device for new messages',
                  enabled: !settings.do_not_disturb && settings.message_notifications,
                },
              ]
            )}

            {/* Contacts */}
            {renderToggleSection(
              'Contacts',
              'Notifications for contact invites and connections',
              <Users size={16} color={Colors.success[500]} />,
              [
                {
                  key: 'contact_invites',
                  label: 'Contact Invites',
                  description: 'Get notified when someone sends you a contact invite',
                  enabled: !settings.do_not_disturb,
                },
                {
                  key: 'contact_accepted',
                  label: 'Contact Accepted',
                  description: 'Get notified when someone accepts your invite',
                  enabled: !settings.do_not_disturb,
                },
                {
                  key: 'contact_sound',
                  label: 'Contact Sound',
                  description: 'Play sound for contact notifications',
                  enabled: !settings.do_not_disturb && (settings.contact_invites || settings.contact_accepted),
                },
              ]
            )}

            {/* AI Assistant */}
            {renderToggleSection(
              'AI Assistant',
              'Notifications from your AI conversation partner',
              <Bot size={16} color={Colors.secondary[500]} />,
              [
                {
                  key: 'ai_responses',
                  label: 'AI Responses',
                  description: 'Get notified when AI has new insights or responses',
                  enabled: !settings.do_not_disturb,
                },
                {
                  key: 'ai_suggestions',
                  label: 'AI Suggestions',
                  description: 'Receive proactive suggestions from AI assistant',
                  enabled: !settings.do_not_disturb,
                },
                {
                  key: 'ai_sound',
                  label: 'AI Sound',
                  description: 'Play sound for AI notifications',
                  enabled: !settings.do_not_disturb && (settings.ai_responses || settings.ai_suggestions),
                },
              ]
            )}

            {/* Soulroom */}
            {renderToggleSection(
              'Soulroom',
              'Notifications for personal reflection and wellness',
              <Heart size={16} color={Colors.error[400]} />,
              [
                {
                  key: 'soulroom_reminders',
                  label: 'Reflection Reminders',
                  description: 'Gentle reminders to check in with yourself',
                  enabled: !settings.do_not_disturb,
                },
                {
                  key: 'daily_reflection',
                  label: 'Daily Reflection',
                  description: 'Daily prompts for mindful reflection',
                  enabled: !settings.do_not_disturb,
                },
              ]
            )}

            {/* Email Notifications */}
            {renderToggleSection(
              'Email Notifications',
              'Important updates sent to your email',
              <Mail size={16} color={Colors.warning[500]} />,
              [
                {
                  key: 'email_important',
                  label: 'Important Updates',
                  description: 'Security alerts and critical app updates',
                  enabled: true,
                },
                {
                  key: 'email_summaries',
                  label: 'Weekly Summaries',
                  description: 'Weekly digest of your conversations and insights',
                  enabled: true,
                },
              ]
            )}

            {/* Quiet Hours */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <Smartphone size={16} color={Colors.neutral[600]} />
                </View>
                <View style={styles.sectionInfo}>
                  <Text style={styles.sectionTitle}>Quiet Hours</Text>
                  <Text style={styles.sectionDescription}>
                    Automatically silence notifications during specific hours
                  </Text>
                </View>
                <Switch
                  value={settings.quiet_hours_enabled}
                  onValueChange={(value) => handleToggle('quiet_hours_enabled', value)}
                  trackColor={{ false: Colors.neutral[300], true: Colors.primary[200] }}
                  thumbColor={settings.quiet_hours_enabled ? Colors.primary[500] : Colors.neutral[400]}
                  disabled={saving || settings.do_not_disturb}
                />
              </View>
              
              {settings.quiet_hours_enabled && !settings.do_not_disturb && (
                <View style={styles.quietHoursContainer}>
                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>From:</Text>
                    <Text style={styles.timeValue}>{settings.quiet_hours_start}</Text>
                  </View>
                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>Until:</Text>
                    <Text style={styles.timeValue}>{settings.quiet_hours_end}</Text>
                  </View>
                  <Text style={styles.quietHoursNote}>
                    Only emergency notifications will be shown during quiet hours
                  </Text>
                </View>
              )}
            </View>

            {/* Information Note */}
            <View style={styles.infoCard}>
              <Bell size={16} color={Colors.primary[500]} />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>About Notifications</Text>
                <Text style={styles.infoText}>
                  Sorted respects your privacy and only sends relevant notifications. 
                  You can customize these settings anytime to match your preferences.
                </Text>
                <TouchableOpacity
                  style={[styles.testButton, testingNotification && styles.testButtonDisabled]}
                  onPress={testNotification}
                  disabled={testingNotification}
                >
                  <Text style={styles.testButtonText}>
                    {testingNotification ? 'Sending Test...' : 'Send Test Notification'}
                  </Text>
                </TouchableOpacity>
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
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  dndIcon: {
    backgroundColor: Colors.warning[50],
  },
  sectionInfo: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  sectionDescription: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  toggleContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: Spacing.sm,
  },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  lastToggleItem: {
    borderBottomWidth: 0,
  },
  toggleInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  toggleLabel: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: Typography.fontSize.xs * 1.3,
  },
  quietHoursContainer: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  timeLabel: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  timeValue: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
    fontWeight: Typography.fontWeight.semibold,
  },
  quietHoursNote: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    fontStyle: 'italic',
    marginTop: Spacing.xs,
    textAlign: 'center',
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
    marginBottom: Spacing.sm,
  },
  testButton: {
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[600],
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    alignSelf: 'flex-start',
    ...Shadows.small,
  },
  testButtonDisabled: {
    opacity: 0.6,
  },
  testButtonText: {
    color: '#FFFFFF',
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
});