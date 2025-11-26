import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  TextInput,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { supabase } from '@/lib/supabase';
import { Bot, Bell, MessageCircle, Users, Heart, Plus, User, History, Clock, Search } from 'lucide-react-native';
import NotificationsList from '@/components/NotificationsList';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { useChatBadge } from '@/contexts/ChatBadgeContext';

interface ContactChat {
  contact_id: string;
  contact_name: string;
  contact_email: string;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id?: string | null;
  session_count: number;
  ongoing_count: number;
  total_ongoing_count?: number;
  contact_profile?: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  };
  participants?: string[];
  context_data?: any;
  issueLabel?: string;
  issueSummary?: string;
  chatTitle?: string;
  lastMsg?: string;
  isUserB?: boolean;
  is_resolved?: boolean;
}

function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { unreadCount } = useNotifications();
  const { setUnreadContactCount } = useChatBadge();
  const [contactChats, setContactChats] = useState<ContactChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [userProfile, setUserProfile] = useState<{ 
    full_name: string | null; 
    first_name: string | null;
    nickname: string | null;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const profileRetryCount = React.useRef(0);
  const MAX_PROFILE_RETRIES = 3;

  const welcomeName = userProfile?.nickname
    || userProfile?.first_name
    || (userProfile?.full_name ? userProfile.full_name.split(' ')[0] : '');

  const welcomeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
    // Gentle looping animation for the welcome banner background/scale
    Animated.loop(
      Animated.sequence([
        Animated.timing(welcomeAnim, { toValue: 1, duration: 2200, useNativeDriver: false }),
        Animated.timing(welcomeAnim, { toValue: 0, duration: 2200, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const fetchUserProfile = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, first_name, nickname')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        // Handle PGRST116 (no rows) gracefully - profile might be creating
        if (error.code === 'PGRST116') {
          if (profileRetryCount.current < MAX_PROFILE_RETRIES) {
            profileRetryCount.current++;
            console.log(`ℹ️ Profile not found yet, retrying (${profileRetryCount.current}/${MAX_PROFILE_RETRIES})...`);
            // Retry after a short delay in case profile is being created
            setTimeout(() => {
              fetchUserProfile();
            }, 1000);
            return;
          } else {
            console.log('ℹ️ Profile not found after retries, user might be new');
            setUserProfile(null);
            return;
          }
        }
        throw error;
      }
      
      if (data) {
        profileRetryCount.current = 0; // Reset retry count on success
        setUserProfile(data);
      } else {
        // Profile doesn't exist yet - retry after delay
        if (profileRetryCount.current < MAX_PROFILE_RETRIES) {
          profileRetryCount.current++;
          console.log(`ℹ️ Profile not found, retrying (${profileRetryCount.current}/${MAX_PROFILE_RETRIES})...`);
          setTimeout(() => {
            fetchUserProfile();
          }, 1000);
        } else {
          console.log('ℹ️ Profile not found after retries, user might be new');
          setUserProfile(null);
        }
      }
    } catch (error: any) {
      // Only log non-PGRST116 errors
      if (error?.code !== 'PGRST116') {
        console.error('Error fetching user profile:', error);
      }
    }
  }, [user?.id]);

  const fetchAllChats = useCallback(async () => {
    console.log('📥 Fetching all chats for user:', user?.id);
    try {
      // Get all contact chats where user is involved
      const { data: contactChatsData, error: contactChatsError } = await supabase
  .from('chats')
  .select(`
    id,
    user_id,
    contact_id,
    last_message,
    last_message_at,
    is_resolved,
    context_data,
    contact_profile:profiles!chats_contact_id_fkey(
      id,
      email,
      full_name,
      avatar_url
    ),
    owner_profile:profiles!chats_user_id_fkey(
      id,
      email,
      full_name,
      avatar_url
    )
  `)
  .or(`user_id.eq.${user?.id},contact_id.eq.${user?.id},participants.cs.{${user?.id}}`)
  .eq('chat_type', 'contact_chat')
  .order('last_message_at', { ascending: false });

if (contactChatsError) throw contactChatsError;

// 🧩 Fetch latest messages fallback (only if last_message missing)
const chatIds = (contactChatsData || [])
  .map((chat: any) => chat.id)
  .filter((id: string | null | undefined): id is string => Boolean(id));

const latestMsgMap = new Map<string, { content: string; created_at: string; sender_id: string | null }>();
const lastReceivedMsgMap = new Map<string, { content: string; created_at: string }>();
const messagePresenceMap = new Map<string, { hasAny: boolean; hasUserMessage: boolean }>();

if (chatIds.length > 0) {
  const { data: messageRows, error: messageError } = await supabase
    .from('messages')
    .select('chat_id, sender_id, content, created_at')
    .in('chat_id', chatIds)
    .order('created_at', { ascending: false });

  if (messageError) {
    console.warn('⚠️ Failed to fetch message presence metadata:', messageError);
  } else if (messageRows) {
    messageRows.forEach((row: any) => {
      if (!row?.chat_id) return;

      if (!messagePresenceMap.has(row.chat_id)) {
        messagePresenceMap.set(row.chat_id, { hasAny: false, hasUserMessage: false });
      }

      const presence = messagePresenceMap.get(row.chat_id)!;
      presence.hasAny = true;
      if (row.sender_id === user?.id) {
        presence.hasUserMessage = true;
      }

      if (!latestMsgMap.has(row.chat_id)) {
        latestMsgMap.set(row.chat_id, {
          content: row.content ?? 'New conversation started',
          created_at: row.created_at ?? new Date().toISOString(),
          sender_id: row.sender_id ?? null,
        });
      }
      // Capture the most recent message RECEIVED from the other user
      if (row.sender_id !== user?.id && !lastReceivedMsgMap.has(row.chat_id)) {
        lastReceivedMsgMap.set(row.chat_id, {
          content: row.content ?? '',
          created_at: row.created_at ?? new Date().toISOString(),
        });
      }
    });
  }
}

const validContactChats = (contactChatsData || []).filter((chat: any) => {
  const presence = messagePresenceMap.get(chat.id) || { hasAny: false, hasUserMessage: false };
  const isDirectContact = chat.user_id === user?.id
    || chat.contact_id === user?.id
    || (Array.isArray(chat.participants) && chat.participants.includes(user?.id));
  const hasValidConversation = presence.hasAny || chat.last_message_at || chat.last_message;
  const isResolved = chat.is_resolved || chat.context_data?.is_resolved;

  return isDirectContact && (hasValidConversation || isResolved);
});

// 👇 keep your same grouping logic and issueLabel additions as before

// Group contact chats by contact and precompute ongoing counts
const contactChatMap = new Map<string, ContactChat>();
const myOngoingByContact = new Map<string, number>();
const totalOngoingByContact = new Map<string, number>();

validContactChats.forEach((chat: any) => {
  // Determine the contact ID and profile
  let contactId: string = '';
  let contactProfile: any;
  const isMyTalk = chat.user_id === user?.id;
  const latestMsg = latestMsgMap.get(chat.id);

  if (chat.user_id === user?.id) {
    contactId = chat.contact_id;
    contactProfile = Array.isArray(chat.contact_profile) ? chat.contact_profile[0] : chat.contact_profile;
  } else if (chat.contact_id === user?.id) {
    contactId = chat.user_id;
    contactProfile = Array.isArray(chat.owner_profile) ? chat.owner_profile[0] : chat.owner_profile;
  } else if (chat.participants && chat.participants.includes(user?.id)) {
    const otherParticipantId = chat.participants.find((id: string) => id !== user?.id);
    contactId = otherParticipantId || '';
    const contactProf = Array.isArray(chat.contact_profile) ? chat.contact_profile[0] : chat.contact_profile;
    const ownerProf = Array.isArray(chat.owner_profile) ? chat.owner_profile[0] : chat.owner_profile;
    contactProfile =
      contactProf?.id === otherParticipantId
        ? contactProf
        : ownerProf;
  }

  if (!contactId || !contactProfile) return;
  const chatData: ContactChat = {
    contact_id: contactId,
    contact_name: contactProfile?.full_name || contactProfile?.email || 'Unknown',
    contact_email: contactProfile?.email || '',
    last_message: chat.last_message || 'New conversation started',
    last_message_at: chat.last_message_at,
    last_sender_id: latestMsg?.sender_id ?? null,
    session_count: 1,
    ongoing_count: 0, // will set after loop from maps
    total_ongoing_count: 0, // will set after loop from maps
    contact_profile: contactProfile,
    context_data: chat.context_data || {},
    participants: chat.participants,
    is_resolved: chat.is_resolved,
    // Derived fields for received preview
    last_received: lastReceivedMsgMap.get(chat.id)?.content || '',
    last_received_at: lastReceivedMsgMap.get(chat.id)?.created_at || null,
  };

  const existingContact = contactChatMap.get(contactId);
  if (!existingContact) {
    contactChatMap.set(contactId, chatData);
  } else {
    if (
      chat.last_message_at &&
      (!existingContact.last_message_at ||
        new Date(chat.last_message_at) >
          new Date(existingContact.last_message_at))
    ) {
      existingContact.last_message = chat.last_message || 'New conversation started';
      existingContact.last_message_at = chat.last_message_at;
      existingContact.last_sender_id = latestMsg?.sender_id ?? existingContact.last_sender_id ?? null;
    }
    existingContact.session_count += 1;
  }

  // Count ongoing per contact (maps prevent double-count drift when aggregating later)
  // My Talks = chats where user_id === current user (user started the chat)
  // Total = all unresolved chats with this contact (regardless of who started)
  const presence = messagePresenceMap.get(chat.id) || { hasAny: false, hasUserMessage: false };
  if (!chat.is_resolved && presence.hasAny) {
    totalOngoingByContact.set(contactId, (totalOngoingByContact.get(contactId) || 0) + 1);
    if (isMyTalk && presence.hasUserMessage) {
      myOngoingByContact.set(contactId, (myOngoingByContact.get(contactId) || 0) + 1);
    }
    console.log(`📊 Chat counting: chat_id=${chat.id}, user_id=${chat.user_id}, contact_id=${chat.contact_id}, isMyTalk=${isMyTalk}, contactId=${contactId}, myOngoing=${myOngoingByContact.get(contactId)}, totalOngoing=${totalOngoingByContact.get(contactId)}`);
  }
});

// Apply the precomputed counts
const finalChats = Array.from(contactChatMap.values()).map((chat) => {
  const myOngoing = myOngoingByContact.get(chat.contact_id) || 0;
  const totalOngoing = totalOngoingByContact.get(chat.contact_id) || 0;
  const isUserA = chat.contact_profile?.id !== user?.id;
  const isUserB = !isUserA;

  if (isUserA) {
    const issueSummary = chat?.context_data?.summary_a || chat?.context_data?.summary || '';
    return {
      ...chat,
      ongoing_count: myOngoing,
      total_ongoing_count: totalOngoing,
      issueLabel: issueSummary,
      issueSummary,
      chatTitle: chat.context_data?.chat_title || issueSummary,
      lastMsg: chat?.last_message || '',
      isUserB: false,
    };
  }

  const hintIssue = chat?.context_data?.hint_to_contact?.issue || chat?.context_data?.hint_to_contact?.full_text || '';
  const receivedSummary = chat?.context_data?.summary_b || chat?.context_data?.summary || '';
  return {
    ...chat,
    ongoing_count: myOngoing,
    total_ongoing_count: totalOngoing,
    issueLabel: hintIssue || receivedSummary,
    issueSummary: hintIssue || receivedSummary,
    chatTitle: chat.context_data?.chat_title || hintIssue || receivedSummary,
    lastMsg: chat?.last_message || '',
    isUserB: true,
  };
});

// Sort by last_message_at in descending order (newest first)
finalChats.sort((a, b) => {
  const dateA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
  const dateB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
  return dateB - dateA;
});

const unreadContactsCount = finalChats.reduce((count, chat) => {
  if (!chat.last_sender_id) return count;
  return count + (String(chat.last_sender_id) !== String(user?.id || '') ? 1 : 0);
}, 0);

setUnreadContactCount(unreadContactsCount);

setContactChats(finalChats);


    } catch (error) {
      console.error('💥 Error in fetchAllChats:', error);
      setUnreadContactCount(0);
    } finally {
      setLoading(false);
    }
  }, [user?.id, setUnreadContactCount]);

  useEffect(() => {
    if (!user) {
      return;
    }

    fetchUserProfile();
    fetchAllChats();

    const unsubscribeChats = setupRealtimeSubscription();
    const unsubscribeProfile = setupProfileSubscription();

    return () => {
      if (typeof unsubscribeChats === 'function') {
        unsubscribeChats();
      }
      if (typeof unsubscribeProfile === 'function') {
        unsubscribeProfile();
      }
    };
  }, [user, fetchUserProfile, fetchAllChats]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) {
        return;
      }
      fetchUserProfile();
      fetchAllChats();
    }, [user?.id, fetchUserProfile, fetchAllChats])
  );

  const setupRealtimeSubscription = () => {
    if (!user?.id) return () => {};

    const subscription = supabase
      .channel(`user-chats-${user?.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chats',
        },
        (payload: any) => {
          const chatData = payload.new || payload.old;
          if (chatData && (
            chatData.user_id === user?.id ||
            chatData.contact_id === user?.id ||
            (chatData.participants && chatData.participants.includes(user?.id))
          )) {
            fetchAllChats();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          fetchAllChats();
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(subscription);
      } catch (error) {
        console.error('Error cleaning up chats subscription:', error);
      }
    };
  };

  const setupProfileSubscription = () => {
    if (!user?.id) return () => {};

    const profileSubscription = supabase
      .channel(`user-profile-${user?.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user?.id}`,
        },
        (payload) => {
          fetchUserProfile();
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(profileSubscription);
      } catch (error) {
        console.error('Error cleaning up profile subscription:', error);
      }
    };
  };

  const formatTime = (timestamp: string | null) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      return 'Just now';
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  // Recent timestamp (< 7 days) show time, else show MM/DD/YYYY
  const formatRecentOrDate = (timestamp: string | null) => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const now = new Date();
    const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 7) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  };

  const handleContactPress = (contactChat: ContactChat) => {
    if (multiSelectMode) {
      setSelectedContactIds(prev => prev.includes(contactChat.contact_id)
        ? prev.filter(id => id !== contactChat.contact_id)
        : [...prev, contactChat.contact_id]);
      return;
    }
    router.push(`/contact-chat-details?contactId=${contactChat.contact_id}`);
  };

  const handleAIAssistantPress = () => {
    router.push('/ai-assistant');
  };

  const handleNotificationsPress = () => {
    setShowNotifications(true);
  };

  // Filter contacts based on search query
  const filteredContacts = contactChats.filter(contact =>
    contact.contact_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.contact_email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" />
          <Text style={styles.loadingText}>Loading your conversations...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>

        {/* Centered content container */}
        <View style={styles.centeredContainer}>
          {/* Title and Notifications */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>Chats</Text>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={handleNotificationsPress}
            >
              <Bell size={20} color={Colors.secondary[500]} />
              {unreadCount > 0 && (
                <View style={styles.notificationBadge}>
                  <Text style={styles.badgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount.toString()}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Welcome Section */}
          {(() => {
            const scale = welcomeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.02],
            });
            const haloOpacity = welcomeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.06, 0.12],
            });
            const textValue = `Welcome back${welcomeName ? `, ${welcomeName}` : ''}!`;
            return (
              <Animated.View style={[styles.welcomeCard, { transform: [{ scale }] }]}>
                {/* Soft backlight behind the text (no border, no button feel) */}
                <Animated.View style={[styles.welcomeHalo, { opacity: haloOpacity }]} />
                <Text style={styles.welcomeText}>{textValue}</Text>
              </Animated.View>
            );
          })()}

          {/* AI Assistant Button */}
          <TouchableOpacity style={styles.aiAssistantButton} onPress={handleAIAssistantPress}>
            <View style={styles.aiAssistantIcon}>
              <Text style={styles.aiAssistantEmoji}>🤖</Text>
            </View>
            <Text style={styles.aiAssistantButtonText}>Discuss with AI Assistant</Text>
          </TouchableOpacity>

          {/* Search Box */}
          <View style={styles.searchContainer}>
            <View style={styles.searchIcon}>
              <Search size={18} color={Colors.text.tertiary} />
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Search conversations..."
              placeholderTextColor={Colors.text.tertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {/* Chats List */}
          <View style={styles.chatsList}>
            {filteredContacts.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <MessageCircle size={32} color={Colors.primary[400]} />
                </View>
                <Text style={styles.emptyTitle}>
                  {searchQuery ? 'No contacts found' : 'No conversations yet'}
                </Text>
                <Text style={styles.emptyDescription}>
                  {searchQuery 
                    ? 'Try adjusting your search terms'
                    : 'Start conversations with your contacts to see them here'
                  }
                </Text>
              </View>
            ) : (
              <ScrollView 
                style={styles.chatsScrollView} 
                contentContainerStyle={styles.chatsContent}
                showsVerticalScrollIndicator={false}
              >
              {filteredContacts.map((contactChat) => {
                const isContactTalk = !!contactChat.isUserB;
                // Prefer session start if available for the Started label
                const startedAt =
                  contactChat?.context_data?.session_started_at ||
                  contactChat?.context_data?.started_at ||
                  contactChat?.context_data?.created_at ||
                  contactChat.last_message_at ||
                  '';

                // Subtitle rule for home: ALWAYS show last RECEIVED message (from the other user) if available,
                // otherwise fall back to the latest message
                const latestMessage = (contactChat.lastMsg || contactChat.last_message || '').trim();
                const lastReceived = (contactChat as any).last_received ? String((contactChat as any).last_received).trim() : '';
                const displaySubtitle = lastReceived || latestMessage || 'No messages yet';

                return (
                  <TouchableOpacity
                    key={contactChat.contact_id}
                    style={[
                      styles.chatCard,
                      isContactTalk ? styles.contactTalkCard : styles.myTalkCard,
                    ]}
                    onPress={() => handleContactPress(contactChat)}
                    onLongPress={() => {
                      if (!multiSelectMode) {
                        setMultiSelectMode(true);
                        setSelectedContactIds([contactChat.contact_id]);
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={styles.chatContent}>
                      {multiSelectMode && (
                        <View style={styles.radioWrap}>
                          <View style={[styles.radioOuter, selectedContactIds.includes(contactChat.contact_id) && styles.radioOuterSelected]}>
                            {selectedContactIds.includes(contactChat.contact_id) && <View style={styles.radioInner} />}
                          </View>
                        </View>
                      )}

                      <View style={styles.chatAvatar}>
                        <User size={20} color={Colors.success[500]} />
                      </View>

                      <View style={styles.chatBody}>
                        <View style={styles.chatHeaderRow}>
                          <Text style={styles.chatName} numberOfLines={1}>
                            {contactChat.contact_name}
                          </Text>
                          <Text style={styles.chatTime}>{formatRecentOrDate(contactChat.last_received_at || contactChat.last_message_at || '')}</Text>
                        </View>

                        <View style={styles.subtitleRow}>
                          <Text style={styles.chatSubtitle} numberOfLines={1}>{displaySubtitle}</Text>
                          {(contactChat.context_data?.is_resolved || contactChat.is_resolved) && (
                            <View style={styles.resolvedPill}>
                              <Text style={styles.resolvedPillEmoji}>✅</Text>
                              <Text style={styles.resolvedPillText}>Closed peacefully</Text>
                            </View>
                          )}
                        </View>
                        {/* message preview row removed to keep rows thin */}

                        {(contactChat.ongoing_count > 0 || (contactChat.total_ongoing_count || 0) > 0) && (
                          <View style={styles.metaRow}>
                            {contactChat.ongoing_count > 0 && (
                              <View style={styles.metaBadge}>
                                <Text style={styles.metaBadgeText}>{contactChat.ongoing_count} ongoing</Text>
                              </View>
                            )}
                            {(contactChat.total_ongoing_count || 0) > 0 && (
                              <View style={[styles.metaBadge, styles.metaBadgeAlt]}>
                                <Text style={[styles.metaBadgeText, styles.metaBadgeTextAlt]}>{contactChat.total_ongoing_count} total</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
              </ScrollView>
            )}
          </View>
        </View>
      </Animated.View>

      {multiSelectMode && (
        <View style={styles.actionBar}>
          <Text style={styles.selectedCount}>{selectedContactIds.length} selected</Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => { setMultiSelectMode(false); setSelectedContactIds([]); }}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.deleteBtn, selectedContactIds.length === 0 && styles.deleteBtnDisabled]}
              disabled={selectedContactIds.length === 0}
              onPress={async () => {
                try {
                  if (!user?.id) return;
                  for (const cid of selectedContactIds) {
                    await supabase
                      .from('chats')
                      .delete()
                      .eq('user_id', user.id)
                      .eq('contact_id', cid)
                      .eq('chat_type', 'contact_chat');
                  }
                  setMultiSelectMode(false);
                  setSelectedContactIds([]);
                  await fetchAllChats();
                } catch (e) {
                  console.error('Delete chats failed', e);
                }
              }}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal
        visible={showNotifications}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <NotificationsList onClose={() => setShowNotifications(false)} />
      </Modal>
    </SafeAreaView>
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
  centeredContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: 40,
    paddingBottom: Spacing.md,
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
  titleSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },

  title: {
    fontSize: Typography.fontSize['2xl'] + 4,
    fontWeight: Typography.fontWeight.bold,
    color: '#FFACC4', // coral
    letterSpacing: 0.5,
  
    textShadowColor: 'rgba(110, 200, 245, 0.8)', // sky blue
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  
  welcomeSection: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  welcomeCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderRadius: BorderRadius.lg,
    // fully remove any button feel (no border/background/gloss)
    marginBottom: Spacing.xl,
  },
  welcomeHalo: {
    position: 'absolute',
    left: '5%',
    right: '5%',
    height: 28,
    borderRadius: 20,
    backgroundColor: 'rgba(2, 136, 209, 0.22)', // subtle cyan backlight
  },
  welcomeText: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    textAlign: 'center',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    ...Shadows.small,
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.error[500],
    borderRadius: BorderRadius.full,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: Colors.background,
  },
  badgeText: {
    color: Colors.text.inverse,
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
  },
  aiAssistantButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary[500],
    borderWidth: 3,
    borderColor: Colors.secondary[600],
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.xl,
    ...Shadows.medium,
  },
  aiAssistantIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  aiAssistantEmoji: {
    fontSize: 20,
  },
  aiAssistantButtonText: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: '#FFFFFF',
    flex: 1,
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    // even thinner search
    paddingVertical: 2,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    ...Shadows.small,
  },
  searchIcon: {
    marginRight: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
  },
  chatsList: {
    flex: 1,
    // Allow full page scrolling
    // Removing height cap to avoid half-scrolled view
  },
  chatsScrollView: {
    flex: 1,
  },
  chatsContent: {
    paddingBottom: Spacing.lg,
  },
  emptyState: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.xxl,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },

  
  emptyTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  chatCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    ...Shadows.medium,
  },
  myTalkCard: {
    backgroundColor: Colors.primary[50],
    borderColor: Colors.primary[200],
  },
  contactTalkCard: {
    backgroundColor: Colors.secondary[50],
    borderColor: Colors.secondary[100],
  },
  chatContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  radioWrap: { justifyContent: 'center', alignItems: 'center', marginRight: Spacing.sm },
  radioOuter: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: Colors.primary[500], justifyContent: 'center', alignItems: 'center' },
  radioOuterSelected: { borderColor: Colors.primary[700] },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary[600] },
  chatAvatar: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.success[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  chatBody: {
    flex: 1,
    gap: Spacing.xs,
  },
  chatHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatName: {
    fontSize: Typography.fontSize.md,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    flex: 1,
    marginRight: Spacing.sm,
    marginBottom: 1,
  },
  chatTime: {
    fontSize: Typography.fontSize.xs,
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.medium,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  chatSubtitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.regular,
    color: Colors.text.secondary,
    flex: 1,
    flexShrink: 1,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  newBadge: {
    backgroundColor: Colors.success[100],
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.success[200],
  },
  newBadgeText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.success[700],
    fontWeight: Typography.fontWeight.medium,
  },
  lastMsgText: {
    color: Colors.text.tertiary,
    fontSize: Typography.fontSize.sm,
    marginTop: 2,
  },
  lastMsgTextEmphasis: {
    color: Colors.text.primary,
    fontWeight: Typography.fontWeight.medium,
  },

issueRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
},
hintBadge: {
  backgroundColor: Colors.primary[100],
  borderRadius: BorderRadius.sm,
  paddingHorizontal: 6,
  paddingVertical: 2,
  marginLeft: 4,
},
hintBadgeText: {
  fontSize: Typography.fontSize.xs,
  color: Colors.primary[700],
  fontWeight: Typography.fontWeight.medium,
},
  closedPeacefullyText: {
  fontSize: Typography.fontSize.xs,
  color: Colors.success[600],
  fontWeight: Typography.fontWeight.semibold,
  marginTop: 4,
},
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.md, backgroundColor: Colors.surfaceElevated, borderTopWidth: 1, borderTopColor: Colors.borderLight, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionButtons: { flexDirection: 'row', gap: Spacing.md },
  selectedCount: { fontSize: Typography.fontSize.sm, color: Colors.text.primary, fontWeight: Typography.fontWeight.semibold },
  cancelBtn: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.lg },
  cancelText: { color: Colors.text.secondary, fontSize: Typography.fontSize.sm },
  deleteBtn: { backgroundColor: Colors.error[600], paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.lg },
  deleteBtnDisabled: { opacity: 0.5 },
  deleteText: { color: Colors.text.inverse, fontSize: Typography.fontSize.sm, fontWeight: Typography.fontWeight.semibold },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  metaBadge: {
    backgroundColor: Colors.primary[100],
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
  },
  metaBadgeText: {
    color: Colors.primary[700],
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
  },
  metaBadgeAlt: {
    backgroundColor: Colors.secondary[100],
  },
  metaBadgeTextAlt: {
    color: Colors.secondary[700],
  },
  resolvedPill: {
    backgroundColor: Colors.success[100],
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  resolvedPillEmoji: {
    fontSize: Typography.fontSize.xs,
    lineHeight: Typography.fontSize.xs,
    marginRight: 2,
  },
  resolvedPillText: {
    color: Colors.success[700],
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
    lineHeight: Typography.fontSize.xs,
  },

});

export default ChatsScreen;