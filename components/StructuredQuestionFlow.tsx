import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { useNotifications } from '@/contexts/NotificationContext';
import { Users, UserCheck, X, MessageCircle } from 'lucide-react-native';
import { router } from 'expo-router';

export default function NotificationsList({ onClose }: { onClose: () => void }) {
  const { notifications, markAsRead, markAllAsRead, deleteAll } = useNotifications();

  const handleNotificationPress = async (notification: any) => {
    if (!notification.read) await markAsRead(notification.id);
    if (notification.type === 'contact_invite' || notification.type === 'contact_accepted') {
      router.push('/(tabs)/contacts');
    } else if (notification.type === 'chat_request' && notification.data?.chat_id) {
      // Navigate directly to the contact chat
      const chatId = notification.data.chat_id;
      const senderId = notification.data.sender_id;
      router.push(`/contact-chat?chatId=${chatId}&contactId=${senderId}&isOngoing=true`);
    }
    onClose();
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'contact_invite': return <Users size={20} color="#f59e0b" />;
      case 'contact_accepted': return <UserCheck size={20} color="#10b981" />;
      case 'chat_request': return <MessageCircle size={20} color="#6366f1" />;
      default: return <Users size={20} color="#6b7280" />;
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    return diffInHours < 1 ? 'Just now' : diffInHours < 24 ? `${Math.floor(diffInHours)}h ago` : date.toLocaleDateString();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.headerActions}>
          {notifications.some(n => !n.read) && (
            <TouchableOpacity style={styles.markAllButton} onPress={markAllAsRead}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          )}
          {notifications.length > 0 && (
            <TouchableOpacity style={styles.deleteAllButton} onPress={deleteAll}>
              <Text style={styles.deleteAllText}>Delete all</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.closeButton} onPress={onClose}><X size={24} color="#374151" /></TouchableOpacity>
        </View>
      </View>
      <ScrollView style={styles.notificationsList}>
        {notifications.length === 0 ? (
          <View style={styles.emptyState}>
            <Users size={48} color="#9ca3af" />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptyDescription}>You'll see notifications for invites and chat requests here</Text>
          </View>
        ) : (
          notifications.map((notification) => (
            <TouchableOpacity key={notification.id} style={[styles.notificationItem, !notification.read && styles.unreadNotification]} onPress={() => handleNotificationPress(notification)}>
              <View style={styles.notificationIcon}>{getNotificationIcon(notification.type)}</View>
              <View style={styles.notificationContent}>
                <Text style={styles.notificationTitle}>{notification.title}</Text>
                <Text style={styles.notificationMessage} numberOfLines={2}>{notification.message || 'New notification'}</Text>
                <Text style={styles.notificationTime}>{formatTime(notification.created_at)}</Text>
              </View>
              {!notification.read && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1f2937' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  markAllButton: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f3f4f6', borderRadius: 8 },
  markAllText: { fontSize: 14, color: '#6366f1', fontWeight: '600' },
  deleteAllButton: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fee2e2', borderRadius: 8 },
  deleteAllText: { fontSize: 14, color: '#ef4444', fontWeight: '600' },
  closeButton: { padding: 4 },
  notificationsList: { flex: 1 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingTop: 100 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 8 },
  emptyDescription: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  notificationItem: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  unreadNotification: { backgroundColor: '#f0f9ff' },
  notificationIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f9fafb', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  notificationContent: { flex: 1 },
  notificationTitle: { fontSize: 16, fontWeight: '600', color: '#1f2937', marginBottom: 4 },
  notificationMessage: { fontSize: 14, color: '#6b7280', lineHeight: 18, marginBottom: 4 },
  notificationTime: { fontSize: 12, color: '#9ca3af' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', marginTop: 8 },
});