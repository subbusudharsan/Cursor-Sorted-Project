import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { notificationService } from "./NotificationService";


interface Notification {
  id: string;
  user_id: string;
  type: 'contact_invite' | 'contact_accepted' | 'chat_request' | 'message';
  title: string;
  message: string;
  data?: any;
  read: boolean;
  created_at: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteAll: () => Promise<void>;
  deleteSelected: (ids: string[]) => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (user) {
      fetchNotifications();
      setupRealtimeSubscription();
    }
  }, [user]);

  const fetchNotifications = async () => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user?.id)
        .in('type', ['contact_invite', 'contact_accepted', 'chat_request'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const setupRealtimeSubscription = () => {
    const subscription = supabase
      .channel(`notifications-${user?.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user?.id}`,
        },
        (payload) => {
          const newNotification = payload.new as Notification;
  
          if (newNotification.type !== 'message') {
            setNotifications((prev) => [newNotification, ...prev]);
  
            // 🔔 Trigger local popup
            notificationService.showNotification(
              newNotification.title,
              newNotification.message,
              newNotification.type
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user?.id}`,
        },
        (payload) => {
          const updatedNotification = payload.new as Notification;
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === updatedNotification.id ? updatedNotification : n
            )
          );
        }
      )
      .subscribe();
  
    // ✅ Cleanup
    return () => subscription.unsubscribe();
  };
  

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase.from('notifications').update({ read: true }).eq('id', notificationId);
      if (error) throw error;
      setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, read: true } : n));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', user?.id).eq('read', false);
      if (error) throw error;
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteAll = async () => {
    try {
      const { error } = await supabase.from('notifications').delete().eq('user_id', user?.id);
      if (error) throw error;
      setNotifications([]);
    } catch (error) {
      console.error('Error deleting notifications:', error);
    }
  };

  const deleteSelected = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const { error } = await supabase.from('notifications').delete().in('id', ids);
      if (error) throw error;
      setNotifications(prev => prev.filter(n => !ids.includes(n.id)));
    } catch (error) {
      console.error('Error deleting selected notifications:', error);
    }
  };

  const refreshNotifications = async () => {
    setLoading(true);
    await fetchNotifications();
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, loading, markAsRead, markAllAsRead, deleteAll, deleteSelected, refreshNotifications }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) throw new Error('useNotifications must be used within a NotificationProvider');
  return context;
};