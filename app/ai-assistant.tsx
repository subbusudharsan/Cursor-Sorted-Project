import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LongPressGestureHandler, State } from "react-native-gesture-handler";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Bot, MessageCircle, Plus, Sparkles, Check, Trash2, X } from "lucide-react-native";
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';

const MAX_CONVERSATIONS = 10;

interface AIConversation {
  id: string;
  session_name: string;
  last_message: string;
  created_at: string;
  context_contact_id: string;
  contact_name: string;
}

function AIAssistantScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { contactId } = useLocalSearchParams<{ contactId?: string }>();
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [contactName, setContactName] = useState('');

// 🧠 Multi-select state like old version
const [multiSelectMode, setMultiSelectMode] = useState(false);
const [selectedConversations, setSelectedConversations] = useState<string[]>([]);
const [bulkDeleting, setBulkDeleting] = useState(false);

const fetchConversations = useCallback(async () => {
    if (!user?.id) {
      console.log('⚠️ No user ID, skipping fetch');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log('📥 Fetching AI conversations for user:', user?.id);

      const { data: chatsData, error } = await supabase
  .from('chats')
  .select('id, user_id, session_name, last_message, created_at, context_contact_id, chat_type, context_data')
  .eq('user_id', user.id)
  .eq('chat_type', 'ai_assistant')
  .order('created_at', { ascending: false })
  .range(0, MAX_CONVERSATIONS - 1)
  .throwOnError();




      if (error) {
        console.error('❌ Fetch error:', error);
        throw error;
      }

      console.log('✅ Found', chatsData?.length || 0, 'AI conversations');

      if (!chatsData || chatsData.length === 0) {
        setConversations([]);
        return;
      }

      const contactIds = Array.from(
        new Set(
          (chatsData || [])
            .map((chat) => chat.context_contact_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      let contactMap = new Map<string, { full_name: string | null; email: string | null }>();
      if (contactIds.length > 0) {
        const { data: contacts, error: contactsError } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', contactIds);

        if (contactsError) {
          console.warn('⚠️ Failed to fetch contact profiles:', contactsError);
        } else if (contacts) {
          contacts.forEach((profile) => {
            contactMap.set(profile.id, {
              full_name: profile.full_name,
              email: profile.email,
            });
          });
        }
      }

      const formattedConversations = (chatsData || []).filter((chat) => {
        if (!chat.context_data) return true;
        if (chat.context_data.initial_pending === false) return false;
        if (chat.context_data.session_promoted === true) return false;
        return true;
      }).map((chat) => {
        const profile = chat.context_contact_id
          ? contactMap.get(chat.context_contact_id)
          : undefined;

        const contactNameStr = profile
          ? profile.full_name || profile.email || 'Unknown Contact'
          : 'Unknown Contact';

        return {
          id: chat.id,
          session_name: chat.session_name || 'Untitled Session',
          last_message: chat.last_message || 'No messages yet',
          created_at: chat.created_at,
          context_contact_id: chat.context_contact_id,
          contact_name: contactNameStr,
        };
      });

      setConversations(formattedConversations);

      console.log('✅ Updated conversations state with', formattedConversations.length, 'items');
    } catch (error) {
      console.error('❌ Error fetching conversations:', error);
      Alert.alert('Error', 'Failed to load conversations');
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [user]);


  useEffect(() => {
  if (user && contactId) {
    fetchContactName();
  }
}, [user, contactId]);

  useEffect(() => {
    if (!user?.id) return;

    console.log('📡 Setting up realtime subscription for AI assistant chats');

    const subscription = supabase
      .channel(`ai-assistant-chats-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chats',
        },
        (payload: any) => {
          console.log('🔔 Chat deleted via realtime:', payload.old?.id);
          if (payload.old && payload.old.chat_type === 'ai_assistant' && payload.old.user_id === user.id) {
            setConversations(prev => {
              const filtered = prev.filter(c => c.id !== payload.old.id);
              console.log(`🧹 Removed chat ${payload.old.id}, ${prev.length} -> ${filtered.length} conversations`);
              return filtered;
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chats',
          filter: `user_id=eq.${user.id}`,
        },
        (payload: any) => {
          if (payload.new && payload.new.chat_type === 'ai_assistant') {
            console.log('🔔 New AI chat created via realtime:', payload.new.id);
            fetchConversations();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chats',
          filter: `user_id=eq.${user.id}`,
        },
        (payload: any) => {
          if (payload.new && payload.new.chat_type === 'ai_assistant') {
            console.log('🔔 AI chat updated via realtime:', payload.new.id);
            fetchConversations();
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime subscription status:', status);
      });

    return () => {
      console.log('🔌 Cleaning up realtime subscription');
      supabase.removeChannel(subscription);
    };
  }, [user]);


    useFocusEffect(
    useCallback(() => {
      console.log("🔄 Screen focused — refreshing chat list");
      fetchConversations();
    }, [fetchConversations])
  );


  const fetchContactName = async () => {
    if (!contactId) return;
    
    try {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', contactId)
        .single();
      
      setContactName(data?.full_name || data?.email || 'Contact');
      console.log('✅ Contact name fetched:', data?.full_name || data?.email);
    } catch (error) {
      console.error('❌ Error fetching contact name:', error);
    }
  };

    
  const handleCreateConversation = async () => {
    console.log('🚀 Create conversation clicked. ContactId:', contactId, 'Conversations:', conversations.length);

    if (conversations.length >= MAX_CONVERSATIONS) {
      Alert.alert(
        'Limit Reached',
        `You can only have ${MAX_CONVERSATIONS} active AI conversations. Please complete or delete an existing conversation first.`
      );
      return;
    }

    // If no contactId, navigate to Contacts tab to select a contact
    if (!contactId) {
      console.log('⚠️ No contactId, navigating to Contacts tab for selection');
      router.push('/(tabs)/contacts?mode=ai_chat');
      return;
    }

      // Check per-contact conversation limit (max 3 "My Talks" contact chats OR 3 total ongoing)
      try {
        const { count: myTalksCount, error: myTalksError } = await supabase
          .from('chats')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user?.id)
          .eq('contact_id', contactId)
          .eq('chat_type', 'contact_chat')
          .eq('is_resolved', false);

        // Also check total ongoing (My Talks + Contact's Talks)
        // Count chats where contact started the chat (user_id = contactId AND contact_id = user.id)
        const { count: contactTalksCount, error: contactTalksError } = await supabase
          .from('chats')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', contactId)
          .eq('contact_id', user?.id)
          .eq('chat_type', 'contact_chat')
          .eq('is_resolved', false);
        
        const totalOngoingCount = (myTalksCount ?? 0) + (contactTalksCount ?? 0);
        
        if (contactTalksError) {
          console.error('❌ Error checking contact talks count:', contactTalksError);
        }

      if (myTalksError) {
        console.error('❌ Error checking My Talks count:', myTalksError);
        throw myTalksError;
      }

      if ((myTalksCount ?? 0) >= 3 || (totalOngoingCount ?? 0) >= 3) {
        Alert.alert(
          'Limit Reached',
          `You already have 3 active talks with ${contactName}. Please finish one before starting another.`,
          [{ text: 'OK', style: 'default' }]
        );
        return;
      }
      
      console.log(`📊 AI Assistant Limit Check: My Talks=${myTalksCount}, Total Ongoing=${totalOngoingCount}`);
    } catch (error) {
      console.error('❌ Error in conversation limit check:', error);
      Alert.alert('Error', 'Failed to check conversation limit. Please try again.');
      return;
    }

    // Prevent duplicate AI assistant chats: reuse existing if present
    try {
      const { data: existingAIChat, error: existingErr } = await supabase
        .from('chats')
        .select('id')
        .eq('user_id', user?.id)
        .eq('context_contact_id', contactId)
        .eq('chat_type', 'ai_assistant')
        .eq('is_resolved', false)
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (existingErr) {
        console.warn('⚠️ Existing AI chat lookup error:', existingErr);
      }

      if (existingAIChat?.id) {
        console.log('🔁 Reusing existing AI chat:', existingAIChat.id);
        router.push({
          pathname: '/ai-chat',
          params: { chatId: existingAIChat.id, contactId, mode: 'continue' }
        });
        return;
      }
    } catch (e) {
      console.warn('⚠️ Duplicate check failed, proceeding to create new:', e);
    }

    console.log('✅ Navigating to AI chat with contactId (new):', contactId);
    router.push({ pathname: '/ai-chat', params: { contactId, mode: 'new' } });
  };

  const handleContinueConversation = async (conversationId: string) => {
    console.log('📱 Continue conversation:', conversationId);

    try {
      const conversation = conversations.find(c => c.id === conversationId);

      if (!conversation) {
        console.error('❌ Conversation not found in local state');
        Alert.alert('Error', 'Unable to find conversation details');
        return;
      }

      const contactIdToUse = conversation.context_contact_id;

      if (!contactIdToUse) {
        console.error('❌ No context_contact_id found for conversation:', conversationId);
        Alert.alert('Error', 'Contact information is missing for this conversation');
        return;
      }

      // Try to locate the corresponding contact chat to resume in real chat view
      let contactChatId: string | undefined;
      try {
        const { data: relatedChat, error: relatedError } = await supabase
          .from('chats')
          .select('id')
          .eq('chat_type', 'contact_chat')
          .eq('ai_source_chat_id', conversationId)
          .order('created_at', { ascending: false })
          .maybeSingle();

        if (relatedError) {
          console.warn('⚠️ Unable to locate related contact chat:', relatedError);
        }

        if (relatedChat?.id) {
          contactChatId = relatedChat.id;
        }
      } catch (lookupError) {
        console.warn('⚠️ Error looking up related contact chat:', lookupError);
      }

      if (contactChatId) {
        console.log('✅ Opening contact chat', contactChatId);
        router.push(`/contact-chat?chatId=${contactChatId}&contactId=${contactIdToUse}&isOngoing=true`);
      } else {
        console.log('ℹ️ Related contact chat not found, returning to AI preparation view');
        router.push({
          pathname: '/ai-chat',
          params: {
            chatId: conversationId,
            contactId: contactIdToUse,
            mode: 'continue'
          }
        });
      }
    } catch (error) {
      console.error('❌ Error continuing conversation:', error);
      Alert.alert('Error', 'Failed to open conversation. Please try again.');
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return Math.floor(diffHours) + 'h ago';
    if (diffHours < 48) return 'Yesterday';
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary[500]} />
          <Text style={styles.loadingText}>Loading AI Assistant...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const progressPercent = (conversations.length / MAX_CONVERSATIONS) * 100;
  const isLimitReached = conversations.length >= MAX_CONVERSATIONS;
  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.push('/(tabs)/chats')}
        >
          <ArrowLeft size={24} color={Colors.text.secondary} />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>AI Assistant</Text>
          {contactId && contactName ? (
            <Text style={styles.headerSubtitle}>for {contactName}</Text>
          ) : null}
        </View>
        
        <View style={styles.placeholder} />
      </View>

      <ScrollView
  style={styles.content}
  contentContainerStyle={[
    styles.contentContainer,
    multiSelectMode && { paddingBottom: 100 },
  ]}
>

        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <Bot size={32} color={Colors.primary[500]} />
          </View>
          <Text style={styles.heroTitle}>AI Conversation Assistant</Text>
          <Text style={styles.heroDescription}>
            I'll help you prepare for meaningful conversations
          </Text>
        </View>

        {!isLimitReached && (
          <TouchableOpacity
            style={styles.createButton}
            onPress={handleCreateConversation}
          >
            <Plus size={20} color="#fff" />
            <Text style={styles.createButtonText}>
              {contactId ? 'Create New Conversation' : 'Select Contact & Chat'}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.limitSection}>
          <View style={styles.limitCard}>
            <Text style={styles.limitTitle}>Conversation Limit</Text>
            <View style={styles.limitProgress}>
              <Text style={styles.limitNumber}>
                {conversations.length} / {MAX_CONVERSATIONS}
              </Text>
              <Text style={styles.limitLabel}>active conversations</Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progressPercent}%`,
                    backgroundColor: isLimitReached ? Colors.error[500] : Colors.success[500],
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {conversations.length > 0 ? (
          <View style={styles.conversationsSection}>
            <Text style={styles.sectionTitle}>Your Active Conversations</Text>
            {conversations.map((conversation) => (
  <LongPressGestureHandler
    key={conversation.id}
    onHandlerStateChange={({ nativeEvent }) => {
      if (nativeEvent.state === State.ACTIVE) {
        if (!multiSelectMode) {
          setMultiSelectMode(true);
          setSelectedConversations([conversation.id]);
        } else {
          setSelectedConversations((prev) =>
            prev.includes(conversation.id)
              ? prev.filter((id) => id !== conversation.id)
              : [...prev, conversation.id]
          );
        }
      }
    }}
    minDurationMs={500}
  >
    <TouchableOpacity
      style={[
        styles.conversationCard,
        multiSelectMode &&
          selectedConversations.includes(conversation.id) &&
          styles.selectedCard,
      ]}
      onPress={() =>
        multiSelectMode
          ? setSelectedConversations((prev) =>
              prev.includes(conversation.id)
                ? prev.filter((id) => id !== conversation.id)
                : [...prev, conversation.id]
            )
          : handleContinueConversation(conversation.id)
      }
    >
      {multiSelectMode && (
        <View style={styles.checkbox}>
          {selectedConversations.includes(conversation.id) && (
            <Check size={16} color={Colors.primary[500]} />
          )}
        </View>
      )}
      <MessageCircle size={20} color={Colors.primary[500]} />
      <View style={{ marginLeft: 10 }}>
        <Text style={styles.conversationTitle}>{conversation.session_name}</Text>
        <Text style={styles.conversationContact}>
          with {conversation.contact_name}
        </Text>
        <Text style={styles.conversationTime}>
          {formatTime(conversation.created_at)}
        </Text>
      </View>
    </TouchableOpacity>
  </LongPressGestureHandler>
))}

          </View>
        ) : (
          <View style={styles.emptyState}>
            <Sparkles size={40} color={Colors.text.tertiary} />
            <Text style={styles.emptyTitle}>No active conversations</Text>
            <Text style={styles.emptyDescription}>
              {contactId
                ? 'Start your first AI-assisted conversation to begin'
                : 'Select a contact to start an AI-assisted conversation'
              }
            </Text>
          </View>
        )}
      </ScrollView>

      {multiSelectMode && (
  <View style={styles.actionBar}>
    <View style={styles.actionBarContent}>
      <Text style={styles.selectedCount}>
        {selectedConversations.length} selected
      </Text>
      <View style={styles.actionBarButtons}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => {
            setMultiSelectMode(false);
            setSelectedConversations([]);
          }}
        >
          <X size={18} color={Colors.text.secondary} />
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>

       <TouchableOpacity
  style={[
    styles.deleteButton,
    (bulkDeleting || selectedConversations.length === 0) &&
      styles.deleteButtonDisabled,
  ]}
  onPress={() => {
    if (selectedConversations.length === 0) {
      Alert.alert("No Selection", "Select conversations to delete.");
      return;
    }

    Alert.alert(
      "Delete Conversations",
      `Are you sure you want to delete ${selectedConversations.length} conversation(s)? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBulkDeleting(true);

            try {
              console.log("🗑 Starting deletion process...");
              console.log("📋 IDs to delete:", selectedConversations);

              if (!user?.id) {
                console.error("❌ No authenticated user found!");
                Alert.alert("Error", "You must be logged in to delete conversations.");
                return;
              }

              const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
              if (sessionError || !sessionData?.session) {
                console.error("❌ No valid session:", sessionError);
                Alert.alert("Error", "Your session has expired. Please log in again.");
                return;
              }

              const idsToDelete = [...selectedConversations];

              const { data: existingChats, error: verifyError } = await supabase
                .from("chats")
                .select("id, user_id, chat_type")
                .in("id", idsToDelete)
                .eq('user_id', user.id)
                .eq('chat_type', 'ai_assistant');

              if (verifyError) {
                console.error("❌ Error verifying chats:", verifyError);
                Alert.alert("Error", "Failed to verify conversations. Please try again.");
                return;
              }

              if (!existingChats || existingChats.length === 0) {
                console.error("❌ No matching chats found for deletion");
                Alert.alert("Error", "The selected conversations could not be found.");
                await fetchConversations();
                return;
              }

              console.log(`🔍 Verified ${existingChats.length} AI assistant chat(s) for deletion`);

              // Delete any related contact chats that originated from these sessions
              const { data: relatedContactChats, error: relatedError } = await supabase
                .from('chats')
                .select('id')
                .eq('chat_type', 'contact_chat')
                .in('ai_source_chat_id', idsToDelete);

              if (relatedError) {
                console.error('⚠️ Failed to lookup related contact chats:', relatedError);
              }

              if (relatedContactChats && relatedContactChats.length > 0) {
                console.log(`🧹 Removing ${relatedContactChats.length} related contact chat(s)`);
                const contactIds = relatedContactChats.map((c) => c.id);
                const { error: contactDeleteError } = await supabase
                  .from('chats')
                  .delete()
                  .in('id', contactIds);

                if (contactDeleteError) {
                  console.error('⚠️ Failed to delete related contact chats:', contactDeleteError);
                }
              }

              console.log("🗑️ Executing DELETE query...");
              const { error, count } = await supabase
                .from("chats")
                .delete({ count: 'exact' })
                .eq("user_id", user.id)
                .eq("chat_type", "ai_assistant")
                .in("id", selectedConversations);

              if (error) {
                console.error("❌ Delete failed:", error);
                Alert.alert("Error", error.message || "Failed to delete chats");
                return;
              }

              if (count === 0) {
                console.warn("⚠️ No rows deleted - chats may have been already deleted or you lack permission");
                Alert.alert("Error", "No chats were deleted. They may have been removed already or you lack permission.");
                await fetchConversations();
                return;
              }

              console.log(`✅ Successfully deleted ${count} chat(s)`);

              // Update UI instantly
              setConversations(prev => prev.filter(c => !selectedConversations.includes(c.id)));

              await fetchConversations();

              Alert.alert("Success", `${count} chat(s) deleted successfully!`);

              setBulkDeleting(false);
              setSelectedConversations([]);
              setMultiSelectMode(false);
            } catch (err: any) {
              console.error("❌ Delete operation failed:", err);

              Alert.alert(
                "Error",
                "Failed to delete conversations. Please check your connection and try again."
              );

              await fetchConversations();
            } finally {
              setBulkDeleting(false);
              setSelectedConversations([]);
              setMultiSelectMode(false);
            }
          }
        }
      ]
    );
  }}
  disabled={bulkDeleting || selectedConversations.length === 0}
>
  <Trash2 size={18} color="#fff" />
  <Text style={styles.deleteButtonText}>
    {bulkDeleting ? "Deleting..." : "Delete"}
  </Text>
</TouchableOpacity>

      </View>
    </View>
  </View>
)}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  loadingText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    marginTop: Spacing.sm,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: Spacing.xl,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    ...Shadows.small,
  },
  heroTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: 4,
    textAlign: 'center',
  },
  heroDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    paddingHorizontal: Spacing.md,
  },
  limitSection: {
    marginBottom: Spacing.lg,
  },
  limitCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  limitTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  limitProgress: {
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  limitNumber: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.primary[500],
  },
  limitLabel: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  progressBar: {
    height: 8,
    backgroundColor: Colors.neutral[200],
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: BorderRadius.full,
  },
  conversationsSection: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  conversationCard: {
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
  conversationIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: 1,
  },
  conversationContact: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    marginBottom: 1,
  },
  conversationTime: {
    fontSize: 10,
    color: Colors.text.tertiary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  emptyTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  emptyDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
  },
  footer: {
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surfaceElevated,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary[500],
    borderWidth: 3,
    borderColor: Colors.secondary[600],
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
    ...Shadows.medium,
  },
  createButtonDisabled: {
    backgroundColor: Colors.neutral[400],
    borderColor: Colors.neutral[500],
    opacity: 0.6,
  },
  createButtonText: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: '#FFFFFF',
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },

  selectedCard: {
  borderColor: Colors.primary[400],
  backgroundColor: Colors.primary[50],
},
  actionBar: {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: "#fff",
  borderTopWidth: 1,
  borderTopColor: Colors.borderLight,
  paddingHorizontal: 16,
  paddingVertical: 12,
  elevation: 8,
  zIndex: 999,
},
actionBarContent: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
},
selectedCount: { fontSize: 16, fontWeight: "600", color: Colors.text.primary },
actionBarButtons: { flexDirection: "row", gap: 12 },
cancelButton: {
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: 16,
  paddingVertical: 8,
  backgroundColor: "#f9fafb",
  borderRadius: 8,
  gap: 4,
},
cancelButtonText: { fontSize: 14, color: Colors.text.secondary, fontWeight: "500" },
deleteButton: {
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: 16,
  paddingVertical: 8,
  backgroundColor: Colors.error[600],
  borderRadius: 8,
  gap: 4,
},
deleteButtonDisabled: { opacity: 0.6 },
deleteButtonText: { fontSize: 14, color: "#fff", fontWeight: "600" },
checkbox: {
  width: 22,
  height: 22,
  borderRadius: 11,
  borderWidth: 2,
  borderColor: Colors.primary[500],
  justifyContent: "center",
  alignItems: "center",
  marginRight: 12,
},


});

export default AIAssistantScreen;