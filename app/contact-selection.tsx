import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { ArrowLeft, MessageCircle, User, Plus, Bot } from 'lucide-react-native';

interface ContactChat {
  id: string;
  title: string | null;
  last_message: string | null;
  last_message_at: string | null;
  is_resolved: boolean;
  created_at: string;
}

interface Contact {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  category?: string; // 🌟 NEW
}

function ContactSelectionScreen() {
  const { user } = useAuth();
  const { contactId, readyToTalk } = useLocalSearchParams<{ contactId: string; readyToTalk?: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [contactChats, setContactChats] = useState<ContactChat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && contactId) {
      fetchContactAndChats();
    }
  }, [user, contactId]);

  const fetchContactAndChats = async () => {
    try {
      setLoading(true);

      // Fetch contact information 🌟 UPDATED to include category
      const { data: contactData, error: contactError } = await supabase
        .from('contacts')
        .select(`
          category,
          contact_profile:profiles!contacts_contact_id_fkey (
            id,
            email,
            full_name,
            avatar_url
          )
        `)
        .eq('user_id', user?.id)
        .eq('contact_id', contactId)
        .maybeSingle();

      if (contactError) throw contactError;

      if (contactData) {
        const profile = Array.isArray(contactData.contact_profile) ? contactData.contact_profile[0] : contactData.contact_profile;
        setContact({
          id: profile?.id || '',
          email: profile?.email || '',
          full_name: profile?.full_name || null,
          avatar_url: profile?.avatar_url || null,
          category: contactData.category || 'General',
        });
      }

      // Fetch all chat sessions with this contact
      const { data: chatsData, error: chatsError } = await supabase
        .from('chats')
        .select('id, title, last_message, last_message_at, is_resolved, created_at')
        .or(`and(user_id.eq.${user?.id},contact_id.eq.${contactId}),and(user_id.eq.${contactId},contact_id.eq.${user?.id})`)
        .eq('chat_type', 'contact_chat')
        .order('last_message_at', { ascending: false });

      if (chatsError) throw chatsError;

      // Filter out chats with no messages
      const validChats = (chatsData || []).filter(chat => 
        chat.last_message_at && 
        chat.last_message && 
        chat.last_message.trim() !== ''
      );

      setContactChats(validChats);
    } catch (error) {
      console.error('Error fetching contact and chats:', error);
      Alert.alert('Error', 'Failed to load contact information');
    } finally {
      setLoading(false);
    }
  };

  // ⬇️ rest of your file is untouched…


  const startNewChat = async () => {
    try {
      // Check if there's already an unresolved chat
      const unresolvedChat = contactChats.find(chat => !chat.is_resolved);
      if (unresolvedChat) {
        // Continue the existing unresolved chat
        router.push(`/contact-chat?chatId=${unresolvedChat.id}&contactId=${contactId}&isOngoing=true`);
        return;
      }

      // Check if we're coming from an AI chat (look for readyToTalk parameter or stored context)
      let contextData = {};
      let aiSourceChatId = null;
      
      // If coming from "ready to talk" flow, get the most recent AI chat for context
      if (readyToTalk === 'true') {
        try {
          const { data: aiChats, error: aiError } = await supabase
            .from('chats')
            .select('id, last_message_at')
            .eq('user_id', user?.id)
            .eq('chat_type', 'ai_assistant')
            .order('last_message_at', { ascending: false })
            .limit(1);

          if (!aiError && aiChats && aiChats.length > 0) {
            aiSourceChatId = aiChats[0].id;
            contextData = {
              source_type: 'ai_chat',
              created_from_ai: true,
              ready_to_talk: true,
              timestamp: new Date().toISOString()
            };
          }
        } catch (contextError) {
          console.log('Could not fetch AI context, proceeding without it:', contextError);
        }
      }

      // Create a new chat
      const { data: newChat, error: newChatError } = await supabase
        .from('chats')
        .insert({
          user_id: user?.id,
          contact_id: contactId,
          chat_type: 'contact_chat',
          title: `Chat with ${contact?.full_name || contact?.email}`,
          participants: [user?.id, contactId],
          is_resolved: false,
          context_data: contextData,
          ai_source_chat_id: aiSourceChatId,
        })
        .select('id')
        .single();

      if (newChatError) throw newChatError;

      router.push(`/contact-chat?chatId=${newChat.id}&contactId=${contactId}&isOngoing=true`);
    } catch (error) {
      console.error('Error starting new chat:', error);
      Alert.alert('Error', 'Failed to start new chat');
    }
  };

  const continueChat = (chat: ContactChat) => {
    router.push(`/contact-chat?chatId=${chat.id}&contactId=${contactId}&isOngoing=true`);
  };

  const formatTime = (timestamp: string) => {
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading conversations...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => {
            try {
              if (contactId) {
                router.push(`/ai-chat?contactId=${contactId}&mode=continue&returnStage=ready`);
              } else {
                router.push('/ai-assistant');
              }
            } catch {
              router.push('/ai-assistant');
            }
          }}>
            <ArrowLeft size={24} color={Colors.text.secondary} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <User size={24} color="#10b981" />
            <Text style={styles.headerTitle}>
              {contact?.full_name || 'Contact'}
            </Text>
            {contact?.category && (
              <Text style={styles.headerCategory}>{contact.category}</Text>
            )}
          </View>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.centeredContainer}>
          <ScrollView style={styles.scrollContent} contentContainerStyle={styles.contentContainer}>
            {readyToTalk === 'true' && (
              <View style={styles.readyToTalkBanner}>
                <Text style={styles.readyToTalkText}>
                  🎯 Ready to discuss your issue with {contact?.full_name || 'this contact'}
                </Text>
                <Text style={styles.readyToTalkSubtext}>
                  Your AI conversation context will help guide this discussion
                </Text>
              </View>
            )}
            
            <TouchableOpacity
              style={styles.newChatButton}
              onPress={() => router.push(`/ai-chat?contactId=${contactId}&mode=new`)}
            >
              <Text style={styles.aiAssistantEmoji}>🤖</Text>
              <Text style={styles.newChatButtonText}>Discuss with AI</Text>
            </TouchableOpacity>

            {contactChats.length === 0 ? (
              <View style={styles.emptyState}>
                <MessageCircle size={48} color="#9ca3af" />
                <Text style={styles.emptyTitle}>No conversations yet</Text>
                <Text style={styles.emptyDescription}>
                  Start your first conversation with {contact?.full_name || 'this contact'}
                </Text>
              </View>
            ) : (
              <View style={styles.chatsSection}>
                <Text style={styles.sectionTitle}>Previous Conversations</Text>
                {contactChats.map((chat) => (
                  <TouchableOpacity
                    key={chat.id}
                    style={styles.chatCard}
                    onPress={() => continueChat(chat)}
                  >
                    <View style={styles.chatInfo}>
                      <View style={styles.chatIcon}>
                        <MessageCircle size={20} color="#6366f1" />
                      </View>
                      <View style={styles.chatDetails}>
                        <Text style={styles.chatTitle}>
                          {chat.title || 'Conversation'}
                        </Text>
                        <Text style={styles.lastMessage} numberOfLines={1}>
                          {chat.last_message || 'No messages yet'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.chatMeta}>
                      <Text style={styles.chatTime}>
                        {formatTime(chat.last_message_at || chat.created_at)}
                      </Text>
                      {!chat.is_resolved && (
                        <View style={styles.activeBadge}>
                          <Text style={styles.activeBadgeText}>Active</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
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
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surfaceElevated,
    ...Shadows.small,
  },
  headerCategory: {
  fontSize: 13,
  color: '#6b7280',
  marginTop: 2,
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
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  placeholder: {
    width: 40,
  },
  scrollContent: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: Spacing.lg,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary[500],
    borderWidth: 3,
    borderColor: Colors.secondary[600],
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.xl,
    justifyContent: 'center',
    gap: Spacing.sm,
    ...Shadows.medium,
  },
  newChatButtonText: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: '#FFFFFF',
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  aiAssistantEmoji: {
    fontSize: 20,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  emptyTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptyDescription: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  chatsSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: '#0288D1',
    marginBottom: Spacing.lg,
  },
  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.small,
  },
  chatInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  chatIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  chatDetails: {
    flex: 1,
  },
  chatTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  lastMessage: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
  },
  chatMeta: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  chatTime: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
  },
  activeBadge: {
    backgroundColor: Colors.success[500],
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    ...Shadows.small,
  },
  activeBadgeText: {
    color: Colors.text.inverse,
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
  },
  readyToTalkBanner: {
    backgroundColor: Colors.primary[50],
    borderWidth: 1,
    borderColor: Colors.primary[200],
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  readyToTalkText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[700],
    marginBottom: Spacing.xs,
  },
  readyToTalkSubtext: {
    fontSize: Typography.fontSize.xs,
    color: Colors.primary[600],
  },
});

export default ContactSelectionScreen;