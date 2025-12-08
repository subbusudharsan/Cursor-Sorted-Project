import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LongPressGestureHandler, State } from 'react-native-gesture-handler';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, MessageCircle, User, Plus, Clock, History, Trash2, X, Check, ChevronDown, Bot } from 'lucide-react-native';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import NotificationBanner from '@/components/ui/NotificationBanner';


const truncate = (text: string, max: number) =>
  text.length > max ? text.slice(0, max) + "..." : text;

const formatTime = (timestamp: string | null) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);

  // Format as HH:MM (24h) or you can change to 12h format
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDateLabel = (timestamp: string | null) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
};


interface ContactChat {
  id: string;
  user_id: string;
  contact_id: string | null;
  title: string | null;
  last_message: string | null;
  last_message_at: string | null;
  is_resolved: boolean;
  created_at: string;
  participants?: string[];
  owner_id?: string;
  owner_type?: 'you' | 'contact';
  issueLabel?: string;
  isUserB?: boolean;
  lastMsg?: string;
  context_data?: {
    summary?: string;
    summary_a?: string;
    thoughts?: string;
    thoughts_a?: string;
    [key: string]: any;
  };
}

interface Contact {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

interface ConfirmationDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  destructive?: boolean;
}

function ConfirmationDialog({
  visible,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  loading = false,
  destructive = false,
}: ConfirmationDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.confirmationDialog}>
          <Text style={styles.confirmationTitle}>{title}</Text>
          <Text style={styles.confirmationMessage}>{message}</Text>
          
          <View style={styles.confirmationActions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onCancel}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>{cancelText}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.confirmButton,
                destructive && styles.destructiveButton,
                loading && styles.disabledButton,
              ]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <LoadingSpinner size="small" color={Colors.text.inverse} />
              ) : (
                <Text style={[
                  styles.confirmButtonText,
                  destructive && styles.destructiveButtonText,
                ]}>
                  {confirmText}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ContactChatDetailsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { contactId, autoSwitchToHistory } = useLocalSearchParams<{ contactId: string; autoSwitchToHistory?: string }>();
  const [activeTab, setActiveTab] = useState<'ongoing' | 'history'>(autoSwitchToHistory === 'true' ? 'history' : 'ongoing');
  const [showYouHistory, setShowYouHistory] = useState(false);
  const [showContactHistory, setShowContactHistory] = useState(false);
  const [showYouOngoingHistory, setShowYouOngoingHistory] = useState(false);
  const [showContactOngoingHistory, setShowContactOngoingHistory] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [ongoingByCurrentUser, setOngoingByCurrentUser] = useState<ContactChat[]>([]);
  const [ongoingByContact, setOngoingByContact] = useState<ContactChat[]>([]);
  const [historyByCurrentUser, setHistoryByCurrentUser] = useState<ContactChat[]>([]);
  const [historyByContact, setHistoryByContact] = useState<ContactChat[]>([]);
  const [loading, setLoading] = useState(false); // ✅ PERFORMANCE: Show UI immediately, load data in background
  const [error, setError] = useState<string | null>(null);
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const [confirmationConfig, setConfirmationConfig] = useState<{
    title: string;
    message: string;
    confirmText: string;
    action: () => Promise<void>;
    destructive: boolean;
  } | null>(null);
  const [operationLoading, setOperationLoading] = useState(false);
  const [selectedChats, setSelectedChats] = useState<string[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [userPreferences, setUserPreferences] = useState<{
    hiddenHistoryChatIds?: string[];
    hiddenContactIds?: string[];
  }>({});
  const [userOngoingChats, setUserOngoingChats] = useState<ContactChat[]>([]);
  const [contactOngoingChats, setContactOngoingChats] = useState<ContactChat[]>([]);
  const [historyChats, setHistoryChats] = useState<ContactChat[]>([]);
  const [notification, setNotification] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message?: string;
  }>({
    visible: false,
    type: 'info',
    title: '',
  });

  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => {
    setNotification({ visible: true, type, title, message });
  };

  useEffect(() => {
    if (user && contactId) {
      fetchUserPreferences();
      fetchContactAndChats();
    }
  }, [user, contactId]);

  const fetchUserPreferences = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_preferences')
        .eq('id', user?.id)
        .single();

      if (error) throw error;
      setUserPreferences(data?.user_preferences || {});
    } catch (error) {
      console.error('Error fetching user preferences:', error);
    }
  };

  const updateUserPreferences = async (newPreferences: any) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ user_preferences: newPreferences })
        .eq('id', user?.id);

      if (error) throw error;
      setUserPreferences(newPreferences);
    } catch (error) {
      console.error('Error updating user preferences:', error);
      throw error;
    }
  };

  const fetchContactAndChats = async () => {
    console.log('🔄 FETCH: Starting fetchContactAndChats for contactId:', contactId);
    try {
      // ✅ PERFORMANCE: Don't block UI - load data in background
      setError(null);

      const { data: contactData, error: contactError } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url')
        .eq('id', contactId)
        .single();

      if (contactError) {
        console.error('❌ FETCH: Contact fetch error:', contactError);
        throw new Error(`Failed to load contact: ${contactError.message}`);
      }
      
      console.log('✅ FETCH: Contact data loaded:', contactData?.full_name || contactData?.email);
      setContact(contactData);

      const { data: chatsData, error: chatsError } = await supabase
        .from('chats')
        .select('id, user_id, contact_id, title, last_message, last_message_at, is_resolved, created_at, context_data')
        .or(`and(user_id.eq.${user?.id},contact_id.eq.${contactId}),and(user_id.eq.${contactId},contact_id.eq.${user?.id})`)
        .eq('chat_type', 'contact_chat')
        .order('last_message_at', { ascending: false });

      if (chatsError) {
        console.error('❌ FETCH: Chats fetch error:', chatsError);
        throw new Error(`Failed to load conversations: ${chatsError.message}`);
      }

      console.log('✅ FETCH: Chats data loaded, count:', chatsData?.length || 0);

      const validChats = (chatsData || []).filter(chat =>
        chat.last_message_at &&
        chat.last_message &&
        chat.last_message.trim() !== ''
      );

      // Process and categorize chats
      const processedChats = (validChats || []).map(chat => ({
        ...chat,
        owner_id: chat.user_id, // Track who initiated the chat
        owner_type: chat.user_id === user?.id ? 'you' : 'contact' as 'you' | 'contact'
      }));

      // Separate ongoing and history chats
      const ongoing = processedChats.filter(chat => !chat.is_resolved);
      const history = processedChats.filter(chat => chat.is_resolved);
      
      // Separate ongoing chats by owner
      const userOngoing = ongoing.filter(chat => chat.owner_id === user?.id);
      const contactOngoing = ongoing.filter(chat => chat.owner_id === contactId);

      setUserOngoingChats(userOngoing);
      setContactOngoingChats(contactOngoing);
      setHistoryChats(history);

      const ongoingByUser = validChats
        .filter(chat => !chat.is_resolved && chat.user_id === user?.id)
        .slice(0, 3);

      const ongoingByOther = validChats
        .filter(chat => !chat.is_resolved && chat.user_id !== user?.id)
        .slice(0, 3);

      const historyByUser = validChats.filter(chat =>
        chat.is_resolved &&
        chat.user_id === user?.id &&
        !(userPreferences.hiddenHistoryChatIds || []).includes(chat.id)
      );

      const historyByOther = validChats.filter(chat =>
        chat.is_resolved &&
        chat.user_id !== user?.id &&
        !(userPreferences.hiddenHistoryChatIds || []).includes(chat.id)
      );

      console.log('📊 FETCH: Data categorized - Ongoing(You):', ongoingByUser.length, 'Ongoing(Contact):', ongoingByOther.length);
      
      setOngoingByCurrentUser(ongoingByUser);
      setOngoingByContact(ongoingByOther);
      setHistoryByCurrentUser(historyByUser);
      setHistoryByContact(historyByOther);
    } catch (error) {
      console.error('Error fetching contact and chats:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load contact information';
      setError(errorMessage);
      showNotification('error', 'Loading Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const startNewChat = async () => {
    console.log('🚀 NEW CHAT: Starting new chat with contactId:', contactId);
    try {
      setOperationLoading(true);

      // Redirect to AI Assistant first - core app flow
      console.log('🤖 NEW CHAT: Redirecting to AI chat flow with contactId:', contactId);
      router.push({
        pathname: '/ai-assistant',
        params: { contactId, mode: 'new' }
      });
    } catch (error) {
      console.error('Error navigating to AI assistant:', error);
      showNotification('error', 'Navigation Failed', 'Failed to open AI assistant');
    } finally {
      setOperationLoading(false);
    }
  };

  const continueChat = (chat: ContactChat) => {
    console.log('📱 CONTINUE: Navigating to chat:', chat.id, 'isResolved:', chat.is_resolved);
    const isOngoing = !chat.is_resolved;
    router.push({
  pathname: '/contact-chat',
  params: {
    chatId: chat.id,
    contactId,
    isOngoing: isOngoing.toString(),
    contextSummary: chat.context_data?.summary_a || '',
    contextThoughts: chat.context_data?.thoughts_a || ''
  },
});

  };

  const handleLongPress = (chatId: string) => {
  console.log('🔍 CHAT DETAILS - LONG PRESS: Detected on chatId:', chatId);

  if (!multiSelectMode) {
    console.log('🔍 CHAT DETAILS - LONG PRESS: ENTERING MULTI-SELECT MODE');
    setMultiSelectMode(true);
    setSelectedChats([chatId]);
    console.log('🔍 CHAT DETAILS - LONG PRESS: Multi-select mode entered with chat:', chatId);
  } else {
    console.log('🔍 CHAT DETAILS - LONG PRESS: TOGGLING CHAT SELECTION');
    setSelectedChats(prev =>
      prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]
    );
    console.log('🔍 CHAT DETAILS - LONG PRESS: Updated selectedChats after toggle');
  }
};


  const handleChatSelect = (chatId: string) => {
    console.log('🔍 CHAT DETAILS - CHAT SELECT: Tapping chat in multi-select mode:', chatId);
    if (multiSelectMode) {
      console.log('🔍 CHAT DETAILS - CHAT SELECT: Toggling selection for:', chatId);
      setSelectedChats(prev =>
        prev.includes(chatId)
          ? prev.filter(id => id !== chatId)
          : [...prev, chatId]
      );
      console.log('🔍 CHAT DETAILS - CHAT SELECT: Updated selectedChats:', selectedChats);
    }
  };

  const cancelMultiSelect = () => {
    setMultiSelectMode(false);
    setSelectedChats([]);
  };

  const showConfirmation = (config: {
    title: string;
    message: string;
    confirmText: string;
    action: () => Promise<void>;
    destructive?: boolean;
  }) => {
    setConfirmationConfig({
      ...config,
      destructive: config.destructive ?? false,
    });
    setShowConfirmationDialog(true);
  };

  const handleConfirmation = async () => {
    if (!confirmationConfig) return;
    
    try {
      setOperationLoading(true);
      await confirmationConfig.action();
    } catch (error) {
      console.error('💥 CONFIRMATION: Action failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Operation failed';
      showNotification('error', 'Operation Failed', errorMessage);
    } finally {
      setOperationLoading(false);
      setShowConfirmationDialog(false);
      setConfirmationConfig(null);
    }
  };

  const handleCancelConfirmation = () => {
    setShowConfirmationDialog(false);
    setConfirmationConfig(null);
  };

  const deleteSingleChat = async (chat: ContactChat) => {
    console.log('🗑️ SINGLE DELETE: Starting deletion for chat:', chat.id, 'owned by user:', chat.user_id === user?.id);
    
    if (chat.user_id !== user?.id) {
      showNotification('error', 'Permission Denied', 'You can only delete sessions you created');
      return;
    }

    showConfirmation({
      title: 'Delete Session',
      message: 'Are you sure you want to delete this session? This action cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
      action: async () => {
        // Optimistic update - remove from UI immediately
        const optimisticUpdate = () => {
          setOngoingByCurrentUser(prev => prev.filter(c => c.id !== chat.id));
          setHistoryByCurrentUser(prev => prev.filter(c => c.id !== chat.id));
          setOngoingByContact(prev => prev.filter(c => c.id !== chat.id));
          setHistoryByContact(prev => prev.filter(c => c.id !== chat.id));
        };

        optimisticUpdate();

        try {
          const { error, count } = await supabase
            .from('chats')
            .delete({ count: 'exact' })
            .eq('id', chat.id)
            .eq('user_id', user?.id);

          if (error) {
            console.error('❌ SINGLE DELETE: Database error:', error);
            // Rollback optimistic update
            await fetchContactAndChats();
            throw new Error(`Database error: ${error.message}`);
          }

          if (count === 0) {
            console.warn('⚠️ SINGLE DELETE: No rows affected, rolling back');
            // Rollback optimistic update
            await fetchContactAndChats();
            throw new Error('Session not found or you lack permission to delete it');
          }

          console.log('✅ SINGLE DELETE: Successfully deleted chat, count:', count);
          showNotification('success', 'Session Deleted', 'The session has been permanently removed');
          await fetchContactAndChats(); 
        } catch (dbError) {
          console.error('💥 SINGLE DELETE: Failed:', dbError);
          throw dbError;
        }
      },
    });
  };

  const confirmBulkDelete = () => {
    console.log('🔍 BULK DELETE: Function triggered with selectedChats:', selectedChats);
    
    if (selectedChats.length === 0) {
      console.log('⚠️ BULK DELETE: No chats selected');
      showNotification('warning', 'No Selection', 'Please select sessions to delete first');
      return;
    }

    const allChats = [...ongoingByCurrentUser, ...ongoingByContact, ...historyByCurrentUser, ...historyByContact];
    const selectedChatObjects = selectedChats
      .map(chatId => allChats.find(chat => chat.id === chatId))
      .filter((chat): chat is ContactChat => chat !== undefined);

    console.log('📋 BULK DELETE: Selected chat objects:', selectedChatObjects.map(c => ({
      id: c.id,
      user_id: c.user_id,
      is_resolved: c.is_resolved,
      owned_by_user: c.user_id === user?.id
    })));

    if (selectedChatObjects.length === 0) {
      console.error('❌ BULK DELETE: No valid chat objects found');
      showNotification('error', 'Selection Error', 'Selected sessions are no longer available');
      return;
    }

    const ongoingChats = selectedChatObjects.filter(chat => !chat.is_resolved);
    const historyChats = selectedChatObjects.filter(chat => chat.is_resolved);

    console.log('📊 BULK DELETE: Categorized - Ongoing:', ongoingChats.length, 'History:', historyChats.length);

    if (ongoingChats.length > 0 && historyChats.length > 0) {
      showNotification('warning', 'Mixed Selection', 'Please select only ongoing OR history sessions');
      return;
    }

    const isOngoing = ongoingChats.length > 0;
    const chatsToProcess = isOngoing ? ongoingChats : historyChats;

    if (isOngoing) {
      const unauthorizedChats = chatsToProcess.filter(chat => chat.user_id !== user?.id);
      console.log('🔒 BULK DELETE: Unauthorized chats:', unauthorizedChats.length);
      
      if (unauthorizedChats.length > 0) {
        showNotification('error', 'Permission Denied', 'You cannot delete sessions created by the contact');
        return;
      }
    }

    const actionText = isOngoing ? 'Delete' : 'Hide';
    const actionDescription = isOngoing ? 'permanently deleted' : 'hidden from your view';
    
    showConfirmation({
      title: `${actionText} Sessions`,
      message: `Are you sure you want to ${actionText.toLowerCase()} ${selectedChats.length} session(s)? ${isOngoing ? 'This action cannot be undone.' : 'You can restore them later from settings.'}`,
      confirmText: actionText,
      destructive: isOngoing,
      action: () => performBulkAction(isOngoing, chatsToProcess),
    });
  };

  const performBulkAction = async (isOngoing: boolean, chatsToProcess: ContactChat[]) => {
    console.log('🔄 BULK ACTION: Starting', isOngoing ? 'deletion' : 'hiding', 'for', chatsToProcess.length, 'chats');
    
    if (!user?.id) {
      throw new Error('User authentication required');
    }

    if (chatsToProcess.length === 0) {
      throw new Error('No sessions available for processing');
    }

    // Optimistic update - remove from UI immediately
    const chatIdsToProcess = chatsToProcess.map(c => c.id);
    const optimisticUpdate = () => {
      setOngoingByCurrentUser(prev => prev.filter(c => !chatIdsToProcess.includes(c.id)));
      setHistoryByCurrentUser(prev => prev.filter(c => !chatIdsToProcess.includes(c.id)));
      setOngoingByContact(prev => prev.filter(c => !chatIdsToProcess.includes(c.id)));
      setHistoryByContact(prev => prev.filter(c => !chatIdsToProcess.includes(c.id)));
    };

    optimisticUpdate();

    try {
      if (isOngoing) {
        // Hard delete for ongoing sessions
        const chatsToDelete = chatsToProcess.filter(chat => chat.user_id === user.id).map(c => c.id);
        
        console.log('🗑️ BULK ACTION: Deleting chat IDs:', chatsToDelete);
        
        if (chatsToDelete.length === 0) {
          throw new Error('No sessions available for deletion');
        }

        const { error, count } = await supabase
          .from('chats')
          .delete({ count: 'exact' })
          .eq('user_id', user.id)
          .in('id', chatsToDelete);

        if (error) {
          console.error('❌ BULK ACTION: Database error:', error);
          throw new Error(`Database error: ${error.message}`);
        }

        if (count === 0) {
          console.warn('⚠️ BULK ACTION: No rows affected');
          throw new Error('No sessions were deleted. They may have been removed already or you lack permission');
        }

        console.log('✅ BULK ACTION: Successfully deleted', count, 'sessions');
        showNotification('success', 'Sessions Deleted', `${count} session(s) permanently removed`);
        await fetchContactAndChats();
      } else {
        // Soft delete for history sessions
        const currentHidden = userPreferences.hiddenHistoryChatIds || [];
        const newHidden = [...new Set([...currentHidden, ...chatIdsToProcess])];
        const newPreferences = { ...userPreferences, hiddenHistoryChatIds: newHidden };
        
        await updateUserPreferences(newPreferences);
        console.log('✅ BULK ACTION: Successfully hid', chatIdsToProcess.length, 'sessions');
        showNotification('success', 'Sessions Hidden', `${chatIdsToProcess.length} session(s) hidden from view`);
      }
    } catch (dbError) {
      console.error('💥 BULK ACTION: Failed, rolling back optimistic update');
      // Rollback optimistic update by refetching
      await fetchContactAndChats();
      throw dbError;
    } finally {
      // Reset selection state
      setSelectedChats([]);
      setMultiSelectMode(false);
    }
  };

  const renderChatCard = (chat: ContactChat, showOwnerTag: boolean = false) => {
    const isSelected = selectedChats.includes(chat.id);
    const isMyTalk = chat.user_id === user?.id;
    // NOTE: Owner label no longer displayed inline per spec; leaving var for future reference if needed
    const ownerLabel = isMyTalk ? 'My talk' : `${contact?.full_name || 'Contact'}'s talk`;
    // My Talks → one-line A-summary (with …); Contact Talks → latest message/notification (one line)
    const baseSummary = isMyTalk
      ? (chat.context_data?.summary_a || chat.context_data?.summary || '')
      : (chat.last_message || '');
    const summaryOneLine = (baseSummary || 'No messages yet').replace(/\s+/g, ' ').trim();
    // Shrink User A summary further to keep rows thin; allow a bit more room for contact messages
    const maxSummaryLength = isMyTalk ? 90 : 140;
    const summaryText = summaryOneLine.length > maxSummaryLength
      ? `${summaryOneLine.slice(0, maxSummaryLength)}…`
      : summaryOneLine;
    const lastTouched = chat.last_message_at || chat.created_at;
    const statusLabel = chat.is_resolved ? 'Resolved' : 'Active';
    const categoryLabel = chat.context_data?.contact_category; // kept for backward compatibility (not shown)
    
    return (
      <TouchableOpacity
        key={chat.id}
        style={[
          styles.chatCard,
          isSelected && styles.selectedChatCard
        ]}
        onLongPress={() => handleLongPress(chat.id)}
        onPress={() => multiSelectMode ? handleChatSelect(chat.id) : continueChat(chat)}
      >
        <View style={styles.chatContent}>
          <View style={styles.chatHeaderRow}>
            <View style={styles.chatHeaderLeft}>
              {/* Keep full title (allow wrap up to 2 lines) */}
              <Text style={styles.chatTitle} numberOfLines={2}>
                {chat.title || 'Untitled Chat'}
              </Text>
            </View>
            {/* Show recent time at header; add small ownership label near timestamp */}
            <View style={styles.chatHeaderRight}>
              <Text style={styles.chatTime}>{formatTime(lastTouched)}</Text>
              {showOwnerTag && (
                <View style={styles.ownerHeaderTag}>
                  <Text style={styles.ownerHeaderTagText}>
                    {isMyTalk ? 'My talk' : `${contact?.full_name || 'Contact'}'s talk`}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* One-line thin summary per spec */}
          <Text style={styles.chatSummary} numberOfLines={1}>
            {summaryText}
          </Text>

          <View style={styles.chatMetaRow}>
            <View style={styles.metaPill}>
              <Clock size={12} color={Colors.text.secondary} />
              <Text style={styles.metaPillText}>Started {formatDateLabel(chat.created_at)}</Text>
            </View>
            {/* Ended date for resolved chats (History) after Started */}
            {chat.is_resolved && (chat.context_data?.closure_achieved_at || chat.last_message_at) && (
              <View style={styles.metaPill}>
                <History size={12} color={Colors.text.secondary} />
                <Text style={styles.metaPillText}>
                  Ended {formatDateLabel(chat.context_data?.closure_achieved_at || chat.last_message_at)}
                </Text>
              </View>
            )}
            {/* Removed Updated + Category chips to keep row thin */}
            <View
              style={[styles.statusPill, chat.is_resolved ? styles.resolvedPill : styles.activePill]}
            >
              <Text
                style={[styles.statusPillText, chat.is_resolved ? styles.resolvedPillText : styles.activePillText]}
              >
                {statusLabel}
              </Text>
            </View>
            {!multiSelectMode && chat.user_id === user?.id && (
              <TouchableOpacity
                style={styles.metaIconButton}
                onPress={() => deleteSingleChat(chat)}
              >
                <Trash2 size={14} color={Colors.error[500]} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {multiSelectMode && (
          <View style={styles.checkbox}>
            {isSelected && <Check size={16} color={Colors.primary[500]} />}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const getAllChats = (): ContactChat[] => {
    if (activeTab === 'ongoing') {
      return [...userOngoingChats, ...contactOngoingChats];
    }
    return historyChats;
  };

  const renderTabContent = () => {
    if (activeTab === 'ongoing') {
      return (
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.sectionContainer, styles.myTalkHighlight]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>My Talks</Text>
              {userOngoingChats.length > 3 && (
                <Text style={styles.sectionSubLabel}>showing latest 3</Text>
              )}
            </View>
            {userOngoingChats.length === 0 ? (
              <View style={styles.emptySectionState}>
                <Text style={styles.emptySectionText}>No ongoing sessions started by you</Text>
              </View>
            ) : (
              <View style={styles.chatsContainer}>
                {userOngoingChats.slice(0, 3).map((chat) => renderChatCard(chat, true))}
                {userOngoingChats.length > 3 && (
                  <Text style={styles.moreChatsText}>
                    +{userOngoingChats.length - 3} more conversations
                  </Text>
                )}
              </View>
            )}
          </View>

          <View style={[styles.sectionContainer, styles.contactTalkHighlight]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{contact?.full_name || 'Contact'}'s Talks</Text>
              {contactOngoingChats.length > 3 && (
                <Text style={styles.sectionSubLabel}>showing latest 3</Text>
              )}
            </View>
            {contactOngoingChats.length === 0 ? (
              <View style={styles.emptySectionState}>
                <Text style={styles.emptySectionText}>
                  No ongoing sessions started by {contact?.full_name || 'contact'}
                </Text>
              </View>
            ) : (
              <View style={styles.chatsContainer}>
                {contactOngoingChats.slice(0, 3).map((chat) => renderChatCard(chat, true))}
                {contactOngoingChats.length > 3 && (
                  <Text style={styles.moreChatsText}>
                    +{contactOngoingChats.length - 3} more conversations
                  </Text>
                )}
              </View>
            )}
          </View>

          {userOngoingChats.length === 0 && contactOngoingChats.length === 0 && (
            <View style={styles.emptyState}>
              <MessageCircle size={48} color="#9ca3af" />
              <Text style={styles.emptyTitle}>No ongoing conversations</Text>
              <Text style={styles.emptyDescription}>
                Start a new conversation to see it here
              </Text>
            </View>
          )}
        </ScrollView>
      );
    }

    return (
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
      >
        {historyChats.length === 0 ? (
          <View style={styles.emptyState}>
            <History size={48} color={Colors.text.tertiary} />
            <Text style={styles.emptyTitle}>No conversation history</Text>
            <Text style={styles.emptyDescription}>
              Completed conversations will appear here
            </Text>
          </View>
        ) : (
          <View style={styles.chatsContainer}>
            {historyChats.map((chat) => renderChatCard(chat, true))}
          </View>
        )}
      </ScrollView>
    );
  };

  const renderChatSection = (
    chats: ContactChat[],
    title: string,
    emptyMessage: string,
    showNewChatButton: boolean = false,
    showHistoryTab: boolean = false,
    historyChats: ContactChat[] = [],
    isHistoryExpanded: boolean = false,
    onToggleHistory?: () => void
  ) => {
    if (chats.length === 0 && !showNewChatButton) {
      return (
        <View style={styles.emptySection}>
          <Text style={styles.emptySectionText}>{emptyMessage}</Text>
        </View>
      );
    }

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {showNewChatButton && (
            <TouchableOpacity
              style={[styles.newChatButton, operationLoading && styles.disabledButton]}
              onPress={startNewChat}
              disabled={operationLoading}
            >
              {operationLoading ? (
                <LoadingSpinner size="small" color={Colors.primary[500]} />
              ) : (
                <Bot size={16} color={Colors.primary[500]} />
              )}
              <Text style={styles.newChatButtonText}>Discuss with AI Assistant</Text>
            </TouchableOpacity>
          )}
        </View>
        
        {chats.map((chat) => (
          <LongPressGestureHandler
            key={chat.id}
            onHandlerStateChange={({ nativeEvent }) => {
              if (nativeEvent.state === State.ACTIVE) {
                handleLongPress(chat.id);
              }
            }}
            minDurationMs={500}
          >
            <TouchableOpacity
              style={[
                styles.chatItem,
                multiSelectMode && selectedChats.includes(chat.id) && styles.selectedChatItem
              ]}
              onPress={() => 
                multiSelectMode 
                  ? handleChatSelect(chat.id)
                  : continueChat(chat)
              }
              activeOpacity={0.7}
            >
              {multiSelectMode && (
                <View style={styles.checkbox}>
                  {selectedChats.includes(chat.id) && (
                    <Check size={16} color={Colors.primary[500]} />
                  )}
                </View>
              )}
              
              <View style={styles.chatContent}>
                <View style={styles.chatHeader}>
                  <Text style={styles.chatTitle} numberOfLines={1}>
                    {chat.title || 'Untitled Chat'}
                  </Text>
                  <Text style={styles.chatPartner}>
                    with {contact?.full_name || contact?.email || 'Contact'}
                  </Text>
                  <Text style={styles.chatTime}>
                    {formatTime(chat.last_message_at || chat.created_at)}
                  </Text>
                </View>
                
                <Text style={styles.chatPreview} numberOfLines={2}>
                  {truncate(chat.last_message || 'No messages yet', 100)}
                </Text>
                
                <View style={styles.chatMeta}>
                  <View style={styles.chatStatus}>
                    {!chat.is_resolved && (
                      <View style={styles.activeBadge}>
                        <Text style={styles.activeBadgeText}>Active</Text>
                      </View>
                    )}
                  </View>
                  
                  {!multiSelectMode && chat.user_id === user?.id && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => deleteSingleChat(chat)}
                    >
                      <Trash2 size={14} color={Colors.error[500]} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          </LongPressGestureHandler>
        ))}
        
        {/* History subsection */}
        {showHistoryTab && historyChats.length > 0 && (
          <View style={styles.historySubsection}>
            <TouchableOpacity 
              style={styles.historySubHeader} 
              onPress={onToggleHistory}
            >
              <Text style={styles.historySubTitle}>
                History ({historyChats.length})
              </Text>
              <ChevronDown 
                size={16} 
                color={Colors.text.tertiary}
                style={[styles.chevronSmall, isHistoryExpanded && styles.chevronExpanded]}
              />
            </TouchableOpacity>
            
            {isHistoryExpanded && (
              <View style={styles.historySubContent}>
                {historyChats.slice(0, 3).map((chat) => (
                  <LongPressGestureHandler
                    key={chat.id}
                    onHandlerStateChange={({ nativeEvent }) => {
                      if (nativeEvent.state === State.ACTIVE) {
                        handleLongPress(chat.id);
                      }
                    }}
                    minDurationMs={500}
                  >
                    <TouchableOpacity
                      style={[
                        styles.historySubItem,
                        multiSelectMode && selectedChats.includes(chat.id) && styles.selectedChatItem
                      ]}
                      onPress={() => 
                        multiSelectMode 
                          ? handleChatSelect(chat.id)
                          : continueChat(chat)
                      }
                      activeOpacity={0.7}
                    >
                      {multiSelectMode && (
                        <View style={styles.checkbox}>
                          {selectedChats.includes(chat.id) && (
                            <Check size={16} color={Colors.primary[500]} />
                          )}
                        </View>
                      )}
                      
                      <View style={styles.chatContent}>
                        <View style={styles.chatHeader}>
                          <Text style={styles.historySubItemTitle} numberOfLines={1}>
                            {chat.title || 'Untitled Chat'}
                          </Text>
                          <Text style={styles.chatTime}>
                            {formatTime(chat.last_message_at || chat.created_at)}
                          </Text>
                        </View>
                        
                        <Text style={styles.historySubItemPreview} numberOfLines={1}>
                          {truncate(chat.last_message || 'No messages yet', 60)}
                        </Text>
                        
                        <View style={styles.chatMeta}>
                          <View style={styles.chatStatus}>
                            {!chat.is_resolved && (
                              <View style={styles.activeBadge}>
                                <Text style={styles.activeBadgeText}>Active</Text>
                              </View>
                            )}
                          </View>
                          
                          {!multiSelectMode && chat.user_id === user?.id && (
                            <TouchableOpacity
                              style={styles.deleteButton}
                              onPress={() => deleteSingleChat(chat)}
                            >
                              <Trash2 size={14} color={Colors.error[500]} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  </LongPressGestureHandler>
                ))}
                
                {historyChats.length > 3 && (
                  <Text style={styles.moreItemsText}>
                    +{historyChats.length - 3} more conversations
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderHistorySection = (chats: ContactChat[], title: string, isExpanded: boolean, onToggle: () => void) => {
    if (chats.length === 0) return null;

    return (
      <View style={styles.section}>
        <TouchableOpacity style={styles.historyHeader} onPress={onToggle}>
          <Text style={styles.sectionTitle}>{title} ({chats.length})</Text>
          <ChevronDown 
            size={20} 
            color={Colors.text.secondary}
            style={[styles.chevron, isExpanded && styles.chevronExpanded]}
          />
        </TouchableOpacity>
        
        {isExpanded && (
          <View style={styles.historyContent}>
            {chats.slice(0, 5).map((chat) => (
              <TouchableOpacity
                key={chat.id}
                style={styles.historyItem}
                onPress={() => continueChat(chat)}
                activeOpacity={0.7}
              >
                <View style={styles.historyItemContent}>
                  <Text style={styles.historyItemTitle} numberOfLines={1}>
                    {chat.title || 'Untitled Chat'}
                  </Text>
                  <Text style={styles.historyItemTime}>
                    {formatTime(chat.last_message_at || chat.created_at)}
                  </Text>
                </View>
                <Text style={styles.historyItemPreview} numberOfLines={1}>
                  {truncate(chat.last_message || 'No messages yet', 80)}
                </Text>
              </TouchableOpacity>
            ))}
            
            {chats.length > 5 && (
              <Text style={styles.moreItemsText}>
                +{chats.length - 5} more conversations
              </Text>
            )}
          </View>
        )}
      </View>
    );
  };

  // ✅ PERFORMANCE: Removed blocking loading screen - UI shows immediately while data loads in background

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Unable to Load</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setError(null);
              fetchContactAndChats();
            }}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
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
      
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color={Colors.text.secondary} />
          </TouchableOpacity>
          
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>
              {contact?.full_name || contact?.email || 'Contact'}
            </Text>
            <Text style={styles.headerSubtitle}>Conversations</Text>
          </View>
          
          <View style={styles.placeholder} />
        </View>

        {/* Discuss with AI Button - Common for both tabs */}
      <TouchableOpacity style={styles.aiAssistantButton} onPress={startNewChat}>
  <Text style={styles.aiAssistantButtonText}>🤖 Discuss with AI Assistant</Text>
</TouchableOpacity>


        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'ongoing' && styles.activeTab]}
            onPress={() => setActiveTab('ongoing')}
          >
            <Text style={[styles.tabText, activeTab === 'ongoing' && styles.activeTabText]}>
              Ongoing Sessions
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.tab, activeTab === 'history' && styles.activeTab]}
            onPress={() => setActiveTab('history')}
          >
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>
              History
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        {renderTabContent()}

        {/* Multi-select action bar */}
        {multiSelectMode && (
          <Animated.View style={styles.actionBar}>
            <View style={styles.actionBarContent}>
              <Text style={styles.selectedCount}>
                {selectedChats.length} selected
              </Text>
              <View style={styles.actionBarButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={cancelMultiSelect}
                >
                  <X size={18} color={Colors.text.secondary} />
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.deleteActionButton,
                    selectedChats.length === 0 && styles.disabledButton
                  ]}
                  onPress={confirmBulkDelete}
                  disabled={selectedChats.length === 0}
                >
                  <Trash2 size={18} color={Colors.text.inverse} />
                  <Text style={styles.deleteActionButtonText}>
                    Delete ({selectedChats.length})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        )}

        <ConfirmationDialog
          visible={showConfirmationDialog}
          title={confirmationConfig?.title || ''}
          message={confirmationConfig?.message || ''}
          confirmText={confirmationConfig?.confirmText || 'Confirm'}
          cancelText="Cancel"
          onConfirm={handleConfirmation}
          onCancel={handleCancelConfirmation}
          loading={operationLoading}
          destructive={confirmationConfig?.destructive || false}
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  errorTitle: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.error[600],
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.base,
  },
  retryButton: {
    backgroundColor: Colors.primary[500],
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    ...Shadows.small,
  },
  retryButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
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
    width: 40,
    height: 40,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
  },
  headerSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  placeholder: {
    width: 40,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.lg,
    padding: 4,
    ...Shadows.small,
  },
  scrollArea: {
    flex: 1,
  },
  scrollBody: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  sectionContainer: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    ...Shadows.small,
  },
  myTalkHighlight: {
    // Switch: My Talks now use the secondary light style (was purple)
    backgroundColor: Colors.secondary[50],
    borderWidth: 1,
    borderColor: Colors.secondary[200],
  },
  contactTalkHighlight: {
    // Switch: Contact Talks now use purple highlight
    backgroundColor: '#F3E8FF', // light purple
    borderWidth: 1,
    borderColor: '#E0C3FF',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionSubLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
  },
  emptySectionState: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  emptySectionText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
  moreChatsText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    backgroundColor: Colors.background,
  },

  tabText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.secondary[700],
    textAlign: 'center',
  },

  activeTab: {
    backgroundColor: Colors.secondary[100],
    borderColor: Colors.secondary[200],
    borderWidth: 1,
  },

  activeTabText: {
    color: Colors.primary[500], // ✅ Brighter yellow (#FFEB3B) for better visibility on blue background
    fontWeight: Typography.fontWeight.bold,
  },

  tabContent: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: 12, 
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary[50],
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xl,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.medium,
  },
  newChatButtonText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[500],
  },
  emptySection: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  chatItem: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.medium,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  selectedChatItem: {
    backgroundColor: Colors.primary[50],
    borderColor: Colors.primary[200],
    borderWidth: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.primary[300],
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
    marginTop: 2,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.xs,
  },
  chatTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  chatPartner: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  chatTime: {
    fontSize: 11,
    color: Colors.text.tertiary,
    fontWeight: Typography.fontWeight.normal,
  },
  lastMessage: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    lineHeight: 14,
    marginTop: 1,
  },
  chatPreview: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    marginBottom: Spacing.sm,
  },
  chatMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatMetaRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  chatStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeBadge: {
    backgroundColor: Colors.success[500],
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.sm,
    ...Shadows.small,
  },
  activeBadgeText: {
    color: Colors.text.inverse,
    fontSize: 10,
    fontWeight: Typography.fontWeight.semibold,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.error[500],
    borderWidth: 2,
    borderColor: Colors.error[600],
    borderRadius: 8,
    gap: 4,
    ...Shadows.small,
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
    textShadowColor: Colors.error[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  chevron: {
    transform: [{ rotate: '0deg' }],
  },
  chevronExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  historyContent: {
    gap: Spacing.sm,
  },
  historyItem: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  historyItemContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  historyItemTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.primary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  historyItemTime: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
  },
  historyItemPreview: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
  },
  moreItemsText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.tertiary,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: Spacing.md,
  },
  historySubsection: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  historySubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  historySubTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.secondary,
  },
  chevronSmall: {
    transform: [{ rotate: '0deg' }],
  },
  historySubContent: {
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
  },
  historySubItem: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  historySubItemTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.primary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  historySubItemPreview: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
  },
  historyBottomSection: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  historyBottomTitle: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  historyBottomSubtitle: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  historyGroup: {
    marginBottom: Spacing.lg,
  },
  historyGroupTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  historyBottomItem: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  historyBottomItemContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  historyBottomItemTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.primary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  historyBottomItemTime: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
  },
  historyBottomItemPreview: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
  },
  actionBar: {
    backgroundColor: Colors.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    ...Shadows.large,
  },
  actionBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectedCount: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  actionBarButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  cancelButtonText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  deleteActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.error[500],
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  deleteActionButtonText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.inverse,
    fontWeight: Typography.fontWeight.semibold,
  },
  disabledButton: {
    opacity: 0.6,
  },
  // Confirmation Dialog Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
  },
  confirmationDialog: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 400,
    ...Shadows.large,
  },
  confirmationTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  confirmationMessage: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.base,
    marginBottom: Spacing.xl,
    textAlign: 'center',
  },
  confirmationActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: Colors.primary[500],
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  destructiveButton: {
    backgroundColor: Colors.error[500],
  },
  confirmButtonText: {
    color: Colors.text.inverse,
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
  },
  destructiveButtonText: {
    color: Colors.text.inverse,
  },
  aiAssistantButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary[500],
    borderWidth: 1,
    borderColor: Colors.primary[400],
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    ...Shadows.small,
  },

  aiAssistantEmoji: {
    fontSize: 20,
    marginRight: Spacing.md,
  },
  aiAssistantButtonText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: '#FFFFFF',
  },
  chatsList: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xxxl,
  },
  emptyTitle: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.base,
  },
  chatCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  selectedChatCard: {
    backgroundColor: Colors.primary[50],
    borderColor: Colors.primary[200],
    borderWidth: 2,
  },
  chatContent: {
    flexDirection: 'column',
    gap: Spacing.xs,
  },
  chatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  chatHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  chatHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  ownerHeaderTag: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: Spacing.xs,
  },
  ownerHeaderTagText: {
    fontSize: 10,
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.semibold,
  },
  ownerTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.sm,
    marginLeft: Spacing.xs,
  },
  ownerTagYou: {
    backgroundColor: Colors.secondary[100],
  },
  ownerTagContact: {
    backgroundColor: Colors.success[100],
  },
  ownerTagText: {
    fontSize: 10,
    fontWeight: Typography.fontWeight.semibold,
  },
  ownerTagYouText: {
    color: Colors.secondary[700],
  },
  ownerTagContactText: {
    color: Colors.success[700],
  },
  youTag: {
    backgroundColor: Colors.secondary[100],
  },
  contactTag: {
    backgroundColor: Colors.success[100],
  },
  chatsContainer: {
    gap: Spacing.md,
  },
  chatIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  chatSummary: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    marginBottom: Spacing.xs,
  },
  chatMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  metaPillText: {
    fontSize: 11,
    color: Colors.text.secondary,
  },
  statusPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  activePill: {
    backgroundColor: Colors.success[100],
  },
  resolvedPill: {
    // Keep resolved pill green (matches success palette)
    backgroundColor: Colors.success[100],
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: Typography.fontWeight.semibold,
  },
  activePillText: {
    color: Colors.success[700],
  },
  resolvedPillText: {
    // Green text for resolved as well
    color: Colors.success[700],
  },
  metaIconButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.error[100],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  chatSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    marginTop: Spacing.xs,
  },
  chatDetails: {
    flexDirection: 'column',
    gap: Spacing.xs,
  },
});

export default ContactChatDetailsScreen;