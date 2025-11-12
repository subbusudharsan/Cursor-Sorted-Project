import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';

interface ChatBadgeContextType {
  unreadContactCount: number;
  setUnreadContactCount: (count: number) => void;
}

const ChatBadgeContext = createContext<ChatBadgeContextType | undefined>(undefined);

export function ChatBadgeProvider({ children }: { children: ReactNode }) {
  const [unreadContactCount, setUnreadContactCount] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) {
      setUnreadContactCount(0);
      return;
    }

    let isMounted = true;

    const computeUnreadContacts = async () => {
      try {
        const { data: chatRows, error: chatsError } = await supabase
          .from('chats')
          .select(
            'id, user_id, contact_id, participants, chat_type, is_resolved, last_message_at'
          )
          .or(`user_id.eq.${user.id},contact_id.eq.${user.id},participants.cs.{${user.id}}`)
          .eq('chat_type', 'contact_chat');

        if (chatsError) {
          throw chatsError;
        }

        const chatIds =
          chatRows
            ?.map((chat) => chat.id)
            .filter((id: string | null | undefined): id is string => Boolean(id)) ?? [];

        const latestMsgMap = new Map<
          string,
          { created_at: string; sender_id: string | null }
        >();

        if (chatIds.length > 0) {
          const { data: messageRows, error: messageError } = await supabase
            .from('messages')
            .select('chat_id, sender_id, created_at')
            .in('chat_id', chatIds)
            .order('created_at', { ascending: false });

          if (messageError) {
            throw messageError;
          }

          messageRows?.forEach((row) => {
            if (!row?.chat_id) return;
            if (!latestMsgMap.has(row.chat_id)) {
              latestMsgMap.set(row.chat_id, {
                created_at: row.created_at ?? new Date().toISOString(),
                sender_id: row.sender_id ?? null,
              });
            }
          });
        }

        const contactLatest = new Map<
          string,
          { lastMessageAt: number; lastSenderId: string | null }
        >();

        (chatRows || []).forEach((chat: any) => {
          if (chat.chat_type !== 'contact_chat') return;
          if (chat.is_resolved) return;

          let contactId = '';
          if (chat.user_id === user.id) {
            contactId = chat.contact_id;
          } else if (chat.contact_id === user.id) {
            contactId = chat.user_id;
          } else if (Array.isArray(chat.participants) && chat.participants.includes(user.id)) {
            contactId = chat.participants.find((id: string) => id !== user.id) || '';
          }

          if (!contactId) return;

          const latest = latestMsgMap.get(chat.id);
          const lastMessageAtTimestamp = latest?.created_at
            ? new Date(latest.created_at).getTime()
            : chat.last_message_at
            ? new Date(chat.last_message_at).getTime()
            : 0;

          if (!lastMessageAtTimestamp) return;

          const existing = contactLatest.get(contactId);
          if (!existing || lastMessageAtTimestamp > existing.lastMessageAt) {
            contactLatest.set(contactId, {
              lastMessageAt: lastMessageAtTimestamp,
              lastSenderId: latest?.sender_id ?? null,
            });
          }
        });

        const count = Array.from(contactLatest.values()).reduce((acc, entry) => {
          if (!entry.lastSenderId) return acc;
          return acc + (String(entry.lastSenderId) !== String(user.id) ? 1 : 0);
        }, 0);

        if (isMounted) {
          setUnreadContactCount(count);
        }
      } catch (error) {
        console.error('Failed to compute unread contacts:', error);
        if (isMounted) {
          setUnreadContactCount(0);
        }
      }
    };

    computeUnreadContacts();

    const messagesChannel = supabase
      .channel(`chat-badge-messages-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => computeUnreadContacts()
      )
      .subscribe();

    const chatsChannel = supabase
      .channel(`chat-badge-chats-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chats' },
        () => computeUnreadContacts()
      )
      .subscribe();

    return () => {
      isMounted = false;
      try {
        supabase.removeChannel(messagesChannel);
        supabase.removeChannel(chatsChannel);
      } catch (cleanupError) {
        console.error('Error cleaning up chat badge subscriptions:', cleanupError);
      }
    };
  }, [user?.id]);

  return (
    <ChatBadgeContext.Provider value={{ unreadContactCount, setUnreadContactCount }}>
      {children}
    </ChatBadgeContext.Provider>
  );
}

export function useChatBadge() {
  const context = useContext(ChatBadgeContext);
  if (!context) {
    throw new Error('useChatBadge must be used within a ChatBadgeProvider');
  }
  return context;
}

