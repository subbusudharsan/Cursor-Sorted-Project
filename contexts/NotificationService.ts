import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// 👇 Prevent Expo Go crash by lazy-requiring only when actually needed
let Notifications: any;
function getNotifications() {
  if (Platform.OS === 'web') return null;
  if (!Notifications) {
    try {
      Notifications = require('expo-notifications');
      if (Notifications?.setNotificationHandler) {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });
      }
    } catch (err) {
      console.log('⚠️ Expo Notifications not available, skipping setup.', err);
      return null;
    }
  }
  return Notifications;
}


if (Notifications?.setNotificationHandler) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}


export class NotificationService {
  private static instance: NotificationService;
  private notificationSettings: any = null;

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async initialize(userId: string) {
  if (Platform.OS === 'web') return;

  try {
    // ✅ 1. Detect Expo Go and skip push token setup
    const Constants = require('expo-constants').default;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId;

    if (!projectId) {
      console.log("⚠️ Skipping push notification setup (Expo Go detected, no projectId).");
      return true; // Exit silently — no crash
    }

    // ✅ 2. Request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Notification permissions not granted');
      return false;
    }

    // ✅ 3. Get push token (only in dev build / EAS build)
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;

    // ✅ 4. Save token to Supabase profile
    await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', userId);

    // ✅ 5. Load user preferences
    await this.loadNotificationSettings(userId);

    return true;
  } catch (error) {
    console.error('Error initializing notifications:', error);
    return false;
  }
}

  async loadNotificationSettings(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_preferences')
        .eq('id', userId)
        .single();

      if (error) throw error;
      this.notificationSettings = data?.user_preferences?.notifications || {};
    } catch (error) {
      console.error('Error loading notification settings:', error);
      this.notificationSettings = {};
    }
  }

  private shouldShowNotification(type: string): boolean {
    if (!this.notificationSettings) return true;
    
    // Check do not disturb
    if (this.notificationSettings.do_not_disturb) return false;
    
    // Check quiet hours
    if (this.notificationSettings.quiet_hours_enabled) {
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const startTime = this.parseTimeString(this.notificationSettings.quiet_hours_start || '22:00');
      const endTime = this.parseTimeString(this.notificationSettings.quiet_hours_end || '08:00');
      
      if (startTime > endTime) {
        // Quiet hours span midnight
        if (currentTime >= startTime || currentTime <= endTime) return false;
      } else {
        // Quiet hours within same day
        if (currentTime >= startTime && currentTime <= endTime) return false;
      }
    }
    
    // Check specific notification type settings
    switch (type) {
      case 'contact_invite':
        return this.notificationSettings.contact_invites !== false;
      case 'contact_accepted':
        return this.notificationSettings.contact_accepted !== false;
      case 'message':
        return this.notificationSettings.message_notifications !== false;
      case 'ai_response':
        return this.notificationSettings.ai_responses !== false;
      case 'soulroom_reminder':
        return this.notificationSettings.soulroom_reminders !== false;
      default:
        return true;
    }
  }

  private parseTimeString(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  async showNotification(title: string, body: string, type: string, data?: any) {
    if (Platform.OS === 'web') {
      // For web, we can use browser notifications
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title, { 
            body, 
            icon: '/favicon.png',
            badge: '/favicon.png',
            tag: type,
            requireInteraction: false,
          });
        } else if (Notification.permission !== 'denied') {
          // Request permission
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            new Notification(title, { 
              body, 
              icon: '/favicon.png',
              badge: '/favicon.png',
              tag: type,
            });
          }
        }
      }
      return;
    }

    if (!this.shouldShowNotification(type)) {
      console.log('Notification blocked by user settings:', type);
      return;
    }

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { type, ...data },
          sound: this.shouldPlaySound(type) ? 'default' : false,
          badge: 1,
        },
        trigger: null, // Show immediately
      });
    } catch (error) {
      console.error('Error showing notification:', error);
    }
  }

  private shouldPlaySound(type: string): boolean {
    if (!this.notificationSettings) return true;
    
    switch (type) {
      case 'contact_invite':
      case 'contact_accepted':
        return this.notificationSettings.contact_sound !== false;
      case 'message':
        return this.notificationSettings.message_sound !== false;
      case 'ai_response':
        return this.notificationSettings.ai_sound !== false;
      default:
        return true;
    }
  }

  async scheduleDailyReflectionReminder(userId?: string) {
    if (!this.shouldShowNotification('soulroom_reminder')) return;

    try {
      // Cancel existing daily reminders
      await this.cancelDailyReminders();

      // Schedule daily reminder at 8 PM
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Daily Reflection 🌙',
          body: 'Take a moment to reflect on your day in your Soulroom',
          data: { type: 'daily_reflection' },
        },
        trigger: {
          hour: 20,
          minute: 0,
          repeats: true,
        },
      });

      console.log('✅ Daily reflection reminder scheduled for 8 PM');
    } catch (error) {
      console.error('Error scheduling daily reminder:', error);
    }
  }

  async cancelAllNotifications() {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error canceling notifications:', error);
    }
  }

  async updateNotificationSettings(settings: any) {
    this.notificationSettings = settings;

    // Update scheduled notifications based on new settings
    if (settings.daily_reflection) {
      await this.scheduleDailyReflectionReminder();
    } else {
      await this.cancelDailyReminders();
    }
  }

  async cancelDailyReminders() {
    try {
      const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
      const dailyReminderIds = scheduledNotifications
        .filter((notification: any) => notification.content.data?.type === 'daily_reflection')
        .map((notification: any) => notification.identifier);

      await Promise.all(
        dailyReminderIds.map((id: string) => Notifications.cancelScheduledNotificationAsync(id))
      );
    } catch (error) {
      console.error('Error canceling daily reminders:', error);
    }
  }
}

export const notificationService = NotificationService.getInstance();