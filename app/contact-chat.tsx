import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  TextInput,
  Animated,
  Modal,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, User, X, History, Home, ListFilter as Filter, AtSign, Hash } from "lucide-react-native";
import { Colors, Shadows, BorderRadius, Spacing, Typography } from '@/constants/Colors';
import { getLastTypingTag, replaceTypingTag, parseTaggedEntities, getCommonHashTags, type TaggedEntity } from '@/lib/tagParser';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import NotificationBanner from '@/components/ui/NotificationBanner';
import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";

import type { RealtimeChannel } from "@supabase/supabase-js";

// ADD THIS LINE HERE
import { useNavigation } from '@react-navigation/native';


interface Message {
  id: string;
  content: string;
  sender_type: "user" | "contact";
  sender_id: string;
  created_at: string;
}

interface Contact {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  category?: string; // 🌟 NEW
}

// 🛡️ CLIENT-SIDE SAFETY NET: Clean any leaked names from options
const cleanOptionsForDisplay = (options: string[], contactName: string | null): string[] => {
  if (!contactName) return options;

  return options.map(opt => {
    if (!opt || typeof opt !== 'string') return opt;

    const escapedName = contactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace name with "you/your" in all forms
    let cleaned = opt;
    cleaned = cleaned.replace(new RegExp(`\\b${escapedName}'s\\b`, 'gi'), 'your');
    cleaned = cleaned.replace(new RegExp(`\\b${escapedName}\\b`, 'gi'), 'you');

    return cleaned;
  });
};

type ContactChatParams = {
  chatId?: string;
  contactId?: string;
  summary?: string;
  thoughts?: string;
  aiContext?: string;
};

function ContactChatScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    chatId,
    contactId,
    summary: summaryParam,
    thoughts: thoughtsParam,
    aiContext: aiContextParam,
  } = useLocalSearchParams<ContactChatParams>();
  const navigation = useNavigation();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [contact, setContact] = useState<Contact | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  const [showSuggestedOptions, setShowSuggestedOptions] = useState(false);
  const [suggestedOptions, setSuggestedOptions] = useState<string[]>([]);
  const [waitingForOptions, setWaitingForOptions] = useState(false);

  // 🧠 cached chat context
  const [chatSummary, setChatSummary] = useState<string>("");
  const [chatThoughts, setChatThoughts] = useState<string>("");

  // 🌟 NEW — extra context from AI (if provided)
  const [aiPerspective, setAiPerspective] = useState<string>("");
  const [aiClosure, setAiClosure] = useState<string>("");

  // 💬 Hint banner for User B
  const [hintToContact, setHintToContact] = useState<{issue: string, timeline: string, full_text: string} | null>(null);
  const [showHintBanner, setShowHintBanner] = useState(false);

  // 🎯 AI confidence tracking
  const [aiConfidence, setAiConfidence] = useState<string>("high");
  const [conversationPhase, setConversationPhase] = useState<string>("opening");

  // 🧠 Cached chat context (avoid redundant fetches)
  const [chatContext, setChatContext] = useState<any>(null);

  // 🔄 Conversation tracking (for context aggregator compatibility)
  const [conversationStage, setConversationStage] = useState<string>("warmup");
  const [turnCount, setTurnCount] = useState<number>(0);

  // Add local state for the tip box
  const [showTipBox, setShowTipBox] = useState(false);
  const [tipText, setTipText] = useState("");

  // Tagging state for hint submission
  const [hintTaggedEntities, setHintTaggedEntities] = useState<TaggedEntity[]>([]);
  const [hintShowTagDropdown, setHintShowTagDropdown] = useState<'@' | '#' | null>(null);
  const [hintContactSuggestions, setHintContactSuggestions] = useState<Contact[]>([]);
  const [hintHashSuggestions, setHintHashSuggestions] = useState<string[]>([]);
  const [hintCursorPos, setHintCursorPos] = useState<number>(0);
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

  //Hint Submission
  const [hintSubmitted, setHintSubmitted] = useState(false);
  const tipBoxSlideAnim = React.useRef(new Animated.Value(0)).current;
  const optionsSlideAnim = React.useRef(new Animated.Value(300)).current;

  // ✅ NEW: History view with filters
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'mine' | 'theirs'>('all');

  // 🔄 Recovery mechanism state
  const [optionsGenerationFailed, setOptionsGenerationFailed] = useState(false);
  const [manualInputMode, setManualInputMode] = useState(false);

  // 🔄 Option refresh tracking
  const [lastOptionRefreshTime, setLastOptionRefreshTime] = useState<number>(0);
  const OPTION_REFRESH_COOLDOWN = 30000; // 30 seconds
 
const optionsRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const optionsChannelRef = useRef<RealtimeChannel | null>(null);

  // ---- add near the other state declarations ----
const hasSentMessage = useRef(false);          // ← NEW

// 🌈 NEW — closure resolution indicator + animation
const [isResolved, setIsResolved] = useState(false);
const closureAnim = useRef(new Animated.Value(0)).current;

  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => {
    setNotification({ visible: true, type, title, message });
  };


  const scrollViewRef = useRef<ScrollView>(null);
  const manualInputRef = useRef<string>('');

  // ---- helpers ----
  const trimHistory = (arr: { sender_id: string; content: string }[], keep = 8) =>
    arr.slice(Math.max(0, arr.length - keep));

  const buildHistory = (extra?: { sender_id: string; content: string }) => {
    const base = messages.map((m) => ({ sender_id: m.sender_id, content: m.content }));
    return trimHistory(extra ? [...base, extra] : base, 8);
  };

  const fetchChatContext = async (cid: string) => {
    try {
      const { data, error } = await supabase
        .from("chats")
        .select("context_data, user_id, contact_id, ai_confidence_level, conversation_phase, is_resolved, ai_source_chat_id, session_name, user_a_smiley_sent, user_b_smiley_sent")
        .eq("id", cid)
        .maybeSingle();

      if (!error && data?.context_data) {
        setChatContext(data);
        // Set User A's context
        setChatSummary(String(data.context_data.summary_a || data.context_data.summary || ""));
        setChatThoughts(String(data.context_data.thoughts_a || data.context_data.thoughts || ""));

        // 💬 Show hint banner if current user is User B
        if (user?.id === data.contact_id && data.context_data.hint_to_contact) {
          setHintToContact(data.context_data.hint_to_contact);
          setShowHintBanner(true);
        }

        // 🌟 Only show tip box if User B hasn't provided hint yet
        if (user?.id === data.contact_id && !data.context_data.hint_from_b) {
          setShowTipBox(true);
        }

        // 🎯 Update AI confidence and phase
        setAiConfidence(data.ai_confidence_level || "high");
        setConversationPhase(data.conversation_phase || "opening");

      // 🌈 If chat already resolved, show closure banner with fade-in/out
if (data?.is_resolved) {
  setIsResolved(true);

  Animated.timing(closureAnim, {
    toValue: 1,
    duration: 600,
    useNativeDriver: true,
  }).start();

  setTimeout(() => {
    Animated.timing(closureAnim, {
      toValue: 0,
      duration: 800,
      useNativeDriver: true,
    }).start(() => setIsResolved(false));
  }, 5000);
}


      }
    } catch (e) {
      console.log("ℹ️ fetchChatContext failed (non-blocking)", e);
    }
  };

  // ---- effects ----
  useEffect(() => {
    if (user && contactId) {
      fetchContactInfo().catch(err => {
        console.error('❌ Failed to fetch contact info:', err);
        showNotification('error', 'Loading Failed', 'Could not load contact information');
      });
    }
  }, [user, contactId]);

  useEffect(() => {
    let unsubscribeOptions: (() => void) | undefined;

    if (user && chatId) {
      const id = chatId as string;
      console.log('🚀 CONTACT CHAT INITIALIZATION:', { chatId: id, userId: user.id });

      try {
        setCurrentChatId(id);
        fetchChatContext(id).catch(err => console.error('⚠️ fetchChatContext error:', err));
        fetchMessages().catch(err => {
          console.error('❌ Failed to fetch messages:', err);
          showNotification('error', 'Loading Failed', 'Could not load messages');
          setInitialLoading(false);
        });
        fetchInitialOptions(id, user.id);
        unsubscribeOptions = subscribeToOptions(id, user.id);
        ensureInitialOptions(id);
        subscribeToMessages(id, user.id);
        subscribeToClosureState(id);
      } catch (err) {
        console.error('❌ Contact chat initialization error:', err);
        showNotification('error', 'Initialization Failed', 'Could not start conversation');
        setInitialLoading(false);
      }
    }

    // ✅ FIX: Cleanup timeout on unmount
    return () => {
      if (optionsRefreshTimeoutRef.current) {
        clearTimeout(optionsRefreshTimeoutRef.current);
        optionsRefreshTimeoutRef.current = null;
      }
      if (typeof unsubscribeOptions === 'function') {
        unsubscribeOptions();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, chatId]);


// ✨ Replace any old router.addListener or useEffect for closure animation
useFocusEffect(
  useCallback(() => {
    if (isResolved) {
      // Immediately reset the animation value
      closureAnim.setValue(1);

      // Fade out smoothly
      Animated.timing(closureAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }).start(() => setIsResolved(false));
    }
  }, [isResolved])
);

// 🔄 Tab focus refresh logic - regenerate options when user returns
useFocusEffect(
  useCallback(() => {
    const refreshOptionsOnFocus = async () => {
      if (!currentChatId || !user) return;

      const now = Date.now();
      const timeSinceLastRefresh = now - lastOptionRefreshTime;

      // Check if it's the user's turn and cooldown has passed
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const isMyTurn = lastMessage.sender_id !== user.id;

        if (isMyTurn && timeSinceLastRefresh > OPTION_REFRESH_COOLDOWN) {
          console.log('🔄 Tab focused - refreshing options');
          setShowSuggestedOptions(false);
          setLastOptionRefreshTime(now);

          // Wait a moment then fetch fresh options
          setTimeout(() => {
            fetchInitialOptions(currentChatId, user.id);
          }, 500);
        }
      }
    };

    refreshOptionsOnFocus();

    return () => {
      if (showSuggestedOptions) {
        console.log('👋 Tab unfocused - clearing options display');
      }
    };
  }, [currentChatId, user, messages, lastOptionRefreshTime, showSuggestedOptions])
);


  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          style={{ paddingLeft: 16 }}
          onPress={() => {
            if (hasSentMessage.current) {
              router.replace('/(tabs)/chats');
            } else {
              router.push({
                pathname: '/ai-chat',
                params: {
                  contactId: contactId as string,
                  chatId: chatId as string,
                  summary: summaryParam ?? '',
                  thoughts: thoughtsParam ?? '',
                  aiContext: aiContextParam ?? '',
                  stage: '4',
                  mode: 'continue',
                  returnStage: 'ready',
                  fromContactChat: '1',
                  sent: '0',
                  skipReturnBanner: '1',
                },
              });
            }
          }}
        >
          <ArrowLeft size={24} color={Colors.text.secondary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, contactId, chatId, summaryParam, thoughtsParam, aiContextParam, hasSentMessage]);



useEffect(() => {
  Animated.timing(tipBoxSlideAnim, {
    toValue: 1,
    duration: 400,
    useNativeDriver: true,
  }).start();
}, []);

useEffect(() => {
  if (showSuggestedOptions) {
    Animated.timing(optionsSlideAnim, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  } else {
    Animated.timing(optionsSlideAnim, {
      toValue: 300,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }
}, [showSuggestedOptions]);

  
useEffect(() => {
  if (hintSubmitted) {
    const timer = setTimeout(() => {
      setHintSubmitted(false);  // hide the green box after 5s
    }, 10000);  // 5000 ms = 5 seconds

    return () => clearTimeout(timer); // cleanup if component re-renders
  }
}, [hintSubmitted]);

  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // ---- data fetch ----
  const fetchContactInfo = async () => {
    try {
      const { data, error } = await supabase
        .from("contacts")
        .select(`
          category,
          contact_profile:profiles!contacts_contact_id_fkey (
            id,
            email,
            full_name,
            avatar_url
          )
        `)
        .eq("user_id", user?.id)
        .eq("contact_id", contactId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const profile = Array.isArray(data.contact_profile) ? data.contact_profile[0] : data.contact_profile;
        setContact({
          id: profile?.id || '',
          email: profile?.email || '',
          full_name: profile?.full_name || null,
          avatar_url: profile?.avatar_url || null,
          category: data.category || "General",
        });
      }
    } catch {
      Alert.alert("Error", "Failed to load contact info");
    }
  };

  const fetchMessages = async () => {
    if (!chatId) return;
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      setMessages(
        (data || []).map((msg) => ({
          id: msg.id,
          content: msg.content,
          sender_type: msg.sender_id === user?.id ? "user" : "contact",
          sender_id: msg.sender_id,
          created_at: msg.created_at,
        }))
      );
    } catch {
      Alert.alert("Error", "Failed to load messages");
    } finally {
      setInitialLoading(false);
    }
  };

  // ---- options bootstrap ----
  const fetchInitialOptions = async (
    chatId: string,
    userId: string,
    retryCount = 0,
    options: { skipTurnCheck?: boolean } = {}
  ) => {
    const { skipTurnCheck = false } = options;
    const maxRetries = 5;
    console.log("🔍 FETCHING INITIAL OPTIONS", { chatId, userId, retryCount });

    if (!skipTurnCheck) {
      // ✅ First check if it's actually user's turn before fetching options
      const { data: messagesData } = await supabase
        .from("messages")
        .select("sender_id")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (messagesData && messagesData.length > 0) {
        const lastSenderId = messagesData[0].sender_id;
        if (lastSenderId === userId) {
          console.log("⛔ Not user's turn - they sent the last message");
          setShowSuggestedOptions(false);
          setWaitingForOptions(false);
          return;
        }
      }
    }

    const { data, error } = await supabase
      .from("message_options")
      .select("options, context_data, recipient_id")
      .eq("chat_id", chatId)
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("❌ Failed to fetch initial options:", error);
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(1.5, retryCount), 5000);
        console.log(`🔄 Retrying in ${delay}ms...`);
        setTimeout(() => fetchInitialOptions(chatId, userId, retryCount + 1, options), delay);
      } else {
        console.error("❌ Max retries reached for fetching initial options");
        setWaitingForOptions(false);
        setOptionsGenerationFailed(true);
        showNotification('error', 'Options Failed', 'Response options could not load. Try regenerating or use manual input.');
      }
    } else if (data && data.length > 0 && data[0].options && Array.isArray(data[0].options) && data[0].options.length >= 1) {
      console.log(`✅ INITIAL OPTIONS FOUND (${data[0].options.length} total)`, data[0].options);
      console.log("   Recipient ID from DB:", data[0].recipient_id);
      console.log("   Current User ID:", userId);

      // 🛡️ Apply client-side safety cleaning to remove any leaked names
      const cleanedOptions = cleanOptionsForDisplay(data[0].options || [], contact?.full_name || null);
      console.log("   After client-side cleaning:", cleanedOptions);

      setSuggestedOptions(cleanedOptions);
      setShowSuggestedOptions(true);
      setWaitingForOptions(false);

      // 🌟 Capture extra fields if present
      if (data[0].context_data) {
        setAiPerspective(data[0].context_data.newPerspective || "");
        setAiClosure(data[0].context_data.closure || "");

        // 🎭 Update stage tracking (if present in context_data)
        if (data[0].context_data.conversationStage) {
          setConversationStage(data[0].context_data.conversationStage);
        }
        if (data[0].context_data.turnCount !== undefined) {
          setTurnCount(data[0].context_data.turnCount);
        }
      }
    } else {
      console.log("ℹ️ NO INITIAL OPTIONS FOUND YET");
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(1.5, retryCount), 5000);
        console.log(`🔄 Retrying in ${delay}ms...`);
        setTimeout(() => fetchInitialOptions(chatId, userId, retryCount + 1, options), delay);
      } else {
        console.error("❌ Max retries reached, options not available");
        setWaitingForOptions(false);
        showNotification('warning', 'Options Delayed', 'Response options are taking longer than expected. They will appear when ready.');
      }
    }
  };

  const ensureInitialOptions = async (chatId: string) => {
    if (!user) return;
    console.log("🔍 ENSURING INITIAL OPTIONS EXIST", { chatId, userId: user.id });

    try {
      const { data, error } = await supabase
        .from("message_options")
        .select("id, options")
        .eq("chat_id", chatId)
        .eq("recipient_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;

      if (!data || data.length === 0 || data[0].options.length < 3) {
        console.log("ℹ️ No initial options found in DB — waiting for generation.");
        setWaitingForOptions(true);

        // Set a timeout to stop waiting after 20 seconds
        setTimeout(() => {
          setWaitingForOptions(false);
          if (!showSuggestedOptions) {
            console.warn("⚠️ Options generation timeout after 20 seconds");
            showNotification('info', 'Options Delayed', 'You can send a message manually or wait for AI-generated options.');
          }
        }, 20000);
      } else {
        console.log("✅ Options already exist, no need to wait");
        setWaitingForOptions(false);
      }
    } catch (err) {
      console.error("❌ ensureInitialOptions error:", err);
      setWaitingForOptions(false);
    }
  };

  // ---- realtime: options ----
  const subscribeToOptions = (chatId: string, currentUserId: string) => {
    console.log("🔔 SETTING UP OPTIONS SUBSCRIPTION", { chatId, currentUserId });

    if (optionsChannelRef.current) {
      console.log("🔁 Replacing existing options channel for options");
      supabase.removeChannel(optionsChannelRef.current);
      optionsChannelRef.current = null;
    }

    const fetchLatestOptions = async () => {
      try {
        await fetchInitialOptions(chatId, currentUserId, 0, { skipTurnCheck: true });
      } catch (err) {
        console.error("❌ Failed to fetch options after realtime event:", err);
      }
    };

    const handleOptionsUpdate = async (payload: any) => {
      console.log("📨 OPTIONS SUBSCRIPTION RECEIVED", payload);
      const newOptions = payload.new.options || [];

      if (payload.new.chat_id && payload.new.chat_id !== chatId) {
        console.log("ℹ️ Ignoring options for different chat", payload.new.chat_id);
        return;
      }

      // ✅ Only show options if they're for the current user
      if (payload.new.recipient_id !== currentUserId) {
        console.log("ℹ️ OPTIONS FOR OTHER USER", payload.new.recipient_id);
        return;
      }

      // ✅ FIX: Prevent flickering - debounce rapid updates
      console.log("✅ OPTIONS RECEIVED FOR CURRENT USER", newOptions.length, "options");
      console.log("   Recipient ID from payload:", payload.new.recipient_id);
      console.log("   Current User ID:", currentUserId);
      console.log("   Options:", newOptions);

      if (newOptions && Array.isArray(newOptions) && newOptions.length >= 1) {
        // ✅ FIX: Clear any pending poll timer
        if (optionsRefreshTimeoutRef.current) {
          clearTimeout(optionsRefreshTimeoutRef.current);
          optionsRefreshTimeoutRef.current = null;
        }
        
        console.log(`✅ Displaying ${newOptions.length} options for current user`);

        const cleanedOptions = cleanOptionsForDisplay(newOptions, contact?.full_name || null);
        console.log("   After client-side cleaning:", cleanedOptions);

        setSuggestedOptions([...cleanedOptions]);
        setShowSuggestedOptions(true);
        setWaitingForOptions(false);
        setOptionsGenerationFailed(false);
        setManualInputMode(false);
        setLastOptionRefreshTime(Date.now());

        if (payload.new.context_data) {
          setAiPerspective(payload.new.context_data.newPerspective || "");
          setAiClosure(payload.new.context_data.closure || "");
        }
      } else {
        console.warn("⚠️ Received incomplete options set:", newOptions.length);
        await fetchLatestOptions();
      }
    };

    const channel = supabase
      .channel(`options-${chatId}-${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_options",
          filter: `recipient_id=eq.${currentUserId}`,
        },
        handleOptionsUpdate
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_options",
          filter: `recipient_id=eq.${currentUserId}`,
        },
        handleOptionsUpdate
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_options",
          filter: `recipient_id=eq.${currentUserId}`,
        },
        (payload) => {
          if (payload.old?.recipient_id !== currentUserId) return;

          console.log("🧹 Options deleted for current user - hiding while regeneration runs");
          setShowSuggestedOptions(false);
          setSuggestedOptions([]);
          setWaitingForOptions(true);
        }
      )
      .subscribe((status) => {
        console.log("📡 Options subscription status:", status);
        if (status === 'SUBSCRIBED') {
          console.log("✅ Successfully subscribed to options updates (INSERT + UPDATE)");
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.error("❌ Options subscription issue - attempting to resubscribe", status);
          supabase.removeChannel(channel);
          if (optionsChannelRef.current === channel) {
            optionsChannelRef.current = null;
          }
          setTimeout(() => {
            subscribeToOptions(chatId, currentUserId);
          }, 500);
        }
      });

    optionsChannelRef.current = channel;

    return () => {
      console.log("🔌 Unsubscribing from options channel");
      if (optionsChannelRef.current) {
        supabase.removeChannel(optionsChannelRef.current);
        optionsChannelRef.current = null;
      } else {
        supabase.removeChannel(channel);
      }
    };
  };

  // ---- realtime: closure state ----
  const subscribeToClosureState = (chatId: string) => {
    console.log("🔔 SETTING UP CLOSURE STATE SUBSCRIPTION", { chatId });

    const channel = supabase
      .channel(`closure-${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chats",
          filter: `id=eq.${chatId}`,
        },
        async (payload) => {
          const updatedChat = payload.new;
          console.log("🎉 CLOSURE STATE CHANGED", updatedChat);

if (updatedChat.closure_state === 'closed' && updatedChat.is_resolved) {
  console.log("🎉 Both smileys detected → showing closure banner");
  setIsResolved(true);
  showNotification('success', 'Conversation Closed', '🌈 This conversation has peacefully concluded.');

  Animated.timing(closureAnim, {
    toValue: 1,
    duration: 600,
    useNativeDriver: true,
  }).start();

  setTimeout(() => {
    Animated.timing(closureAnim, {
      toValue: 0,
      duration: 800,
      useNativeDriver: true,
    }).start(() => setIsResolved(false));
  }, 5000);

  // ✅ FIX: Navigate to history tab instead of chats tab
  setTimeout(() => {
    router.push({
      pathname: '/contact-chat-details',
      params: { contactId: contactId || '', autoSwitchToHistory: 'true' }
    });
  }, 2500);
}



          // Check if conversation is now closed
          if (updatedChat.closure_state === 'closed' && updatedChat.is_resolved) {
            setIsResolved(true);
showNotification('success', 'Conversation Closed', '🌈 This conversation is complete now');

// 🌟 Fade-in animation
Animated.timing(closureAnim, {
  toValue: 1,
  duration: 600,
  useNativeDriver: true,
}).start();

// 🌟 Auto fade-out after 5 seconds
setTimeout(() => {
  Animated.timing(closureAnim, {
    toValue: 0,
    duration: 800,
    useNativeDriver: true,
  }).start(() => setIsResolved(false)); // hide after fade-out
}, 5000);

            console.log("✅ Conversation closed! Navigating to home...");

            // Small delay to let users see final message
            // ✅ FIX: Navigate to history tab instead of chats tab
            setTimeout(() => {
              router.push({
                pathname: '/contact-chat-details',
                params: { contactId: contactId || '', autoSwitchToHistory: 'true' }
              });
            }, 2000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  // ---- realtime: messages ----
  const subscribeToMessages = (chatId: string, currentUserId: string) => {
    console.log("\n" + "🔔".repeat(30));
    console.log("📡 SETTING UP MESSAGE SUBSCRIPTION");
    console.log("  Chat ID:", chatId);
    console.log("  Current User ID:", currentUserId);
    console.log("  Filter:", `chat_id=eq.${chatId}`);
    console.log("🔔".repeat(30) + "\n");

    const channel = supabase
      .channel(`messages-${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        async (payload) => {
          const newMsg = payload.new;

          console.log("\n" + "📨".repeat(30));
          console.log("📬 NEW MESSAGE RECEIVED VIA REALTIME");
          console.log("  Message ID:", newMsg.id);
          console.log("  Sender ID:", newMsg.sender_id);
          console.log("  Current User ID:", currentUserId);
          console.log("  Content:", newMsg.content?.substring(0, 50));
          console.log("  Is from current user?", newMsg.sender_id === currentUserId);
          console.log("  Will display as:", newMsg.sender_id === currentUserId ? "user" : "contact");
          console.log("📨".repeat(30) + "\n");

          setMessages((prev) => {
            const exists = prev.some((m) => m.id === newMsg.id);
            console.log("  Message already in list?", exists);

            if (exists) return prev;

            const newMessage: Message = {
              id: newMsg.id,
              content: newMsg.content,
              sender_type: (newMsg.sender_id === currentUserId ? "user" : "contact") as "user" | "contact",
              sender_id: newMsg.sender_id,
              created_at: newMsg.created_at,
            };

            console.log("  ✅ Adding message to list as:", newMessage.sender_type);
            return [...prev, newMessage];
          });

        if (String(newMsg.sender_id) !== String(currentUserId)) {
          console.log("🧹 Clearing existing suggestions while waiting for new options...");
          if (optionsRefreshTimeoutRef.current) {
            clearTimeout(optionsRefreshTimeoutRef.current);
          }
          setShowSuggestedOptions(false);
          setSuggestedOptions([]);
          setWaitingForOptions(true);

          optionsRefreshTimeoutRef.current = setTimeout(() => {
            console.log("🔄 Polling latest options after new incoming message");
            fetchInitialOptions(chatId, currentUserId).catch((err) =>
              console.error("❌ Failed to refresh options via polling:", err)
            );
          }, 800);
        }

          // CONTACT replied → generate options for current user
          console.log("  Checking if should generate options...");
          console.log("  newMsg.sender_id:", newMsg.sender_id);
          console.log("  contactId:", contactId);
          console.log("  contactId type:", typeof contactId);
          console.log("  Matches?", newMsg.sender_id === contactId);
          console.log("  Matches (string)?", String(newMsg.sender_id) === String(contactId));

          if (String(newMsg.sender_id) === String(contactId)) {
            console.log("\n" + "=".repeat(60));
            console.log("📤 CONTACT REPLIED - GENERATING OPTIONS FOR CURRENT USER");
            console.log("=".repeat(60));
            console.log("📬 Contact's message (currentMessage):", newMsg.content.substring(0, 80));
            setWaitingForOptions(true);

            const conversationHistory = buildHistory({
              sender_id: String(newMsg.sender_id),
              content: String(newMsg.content || ""),
            });

            const { data: chatCtx } = await supabase
              .from("chats")
              .select("context_data, user_id, contact_id")
              .eq("id", chatId)
              .single();

            // ✅ FIX: Determine if current user is User A or User B
            const isCurrentUserA = currentUserId === chatCtx?.user_id;

            console.log("💾 Context data being sent to validation:");
            console.log("   Role:", isCurrentUserA ? "User A" : "User B");
            console.log("   Summary:", (isCurrentUserA ? chatCtx?.context_data?.summary_a : chatCtx?.context_data?.summary_b)?.substring(0, 50) || "❌ MISSING");
            console.log("   Thoughts:", (isCurrentUserA ? chatCtx?.context_data?.thoughts_a : chatCtx?.context_data?.thoughts_b)?.substring(0, 50) || "❌ MISSING");
            console.log("   Hint from B:", chatCtx?.context_data?.hint_from_b?.substring(0, 50) || "⚠️ Not provided");
            console.log("   History length:", conversationHistory.length);

            // ✅ CRITICAL: Always include User A's original issue context in all generations
            const summaryA = chatCtx?.context_data?.summary_a || chatCtx?.context_data?.summary || "";
            const thoughtsA = chatCtx?.context_data?.thoughts_a || chatCtx?.context_data?.thoughts || "";
            const summaryB = chatCtx?.context_data?.summary_b || "";
            const thoughtsB = chatCtx?.context_data?.thoughts_b || "";

            // Send correct context based on who is receiving the options
            const summaryToSend = isCurrentUserA ? summaryA : summaryB;
            const thoughtsToSend = isCurrentUserA ? thoughtsA : thoughtsB;

            console.log("📤 Generating options with FULL context:");
            console.log("   Original Issue (User A):", summaryA.substring(0, 60));
            console.log("   Recipient context:", summaryToSend.substring(0, 60));

            // 🧠 STEP 1: Call orchestrate-conversation FIRST to get intelligent guidance
            console.log("🧠 ORCHESTRATION: Calling orchestrate-conversation for intelligent coordination...");
            let orchestrationGuidance = null;
            try {
              const { data: orchData, error: orchError } = await supabase.functions.invoke(
                "orchestrate-conversation",
                {
                  body: {
                    chatId,
                    recipientId: currentUserId,
                    currentUserId: currentUserId,
                    currentMessage: String(newMsg.content || ""),
                    summary: summaryToSend,
                    thoughts: thoughtsToSend,
                    summaryB: summaryB,
                    thoughtsB: thoughtsB,
                    hintFromB: chatCtx?.context_data?.hint_from_b || "",
                    conversationHistory,
                    contactCategory: contact?.category || "General",
                    isInitial: false,
                  },
                }
              );

              if (orchError) {
                console.error("⚠️ Orchestration failed (non-blocking):", orchError);
              } else {
                orchestrationGuidance = orchData;
                console.log("✅ Orchestration guidance received:", {
                  emotionIntent: orchData?.emotionIntent,
                  closureReadiness: orchData?.closureReadiness,
                });
              }
            } catch (err) {
              console.error("⚠️ Orchestration error (continuing anyway):", err);
            }

            // 🎯 STEP 2: Generate options WITH orchestration guidance
            const { error } = await supabase.functions.invoke(
              "generate-contextual-options",
              {
                body: {
                  chatId,
                  recipientId: currentUserId,
                  currentUserId: currentUserId,
                  currentMessage: String(newMsg.content || ""), // ✅ CRITICAL: Latest message from contact
                  summary: summaryToSend,
                  thoughts: thoughtsToSend,
                  // ✅ CRITICAL: Always pass User A's original issue context
                  originalIssue: {
                    summary: summaryA,
                    thoughts: thoughtsA,
                  },
                  hintFromB: chatCtx?.context_data?.hint_from_b || "",
                  hintToContact: chatCtx?.context_data?.hint_to_contact || null,
                  summaryB: summaryB,
                  thoughtsB: thoughtsB,
                  conversationHistory,
                  isInitial: false,
                  contactCategory: contact?.category || "General",
                  conversationPhase: conversationPhase,
                  resolutionDetected: false,
                  lastMessageTimestamp: newMsg.created_at, // ⏰ For timing-aware context
                  wordLimit: 15, // ✅ Pass word limit
                },
              }
            );

            if (error) {
              console.error("❌ Failed to generate options:", error);
              showNotification('error', 'Options Failed', 'Could not generate response options. You can type manually.');
            } else {
              console.log("✅ Options generation request sent with original issue context");
            }
          }
        }
      )
      .subscribe((status) => {
        console.log("📡 MESSAGE SUBSCRIPTION STATUS:", status);
        if (status === 'SUBSCRIBED') {
          console.log("✅ Successfully subscribed to messages for chat:", chatId);
        } else if (status === 'CHANNEL_ERROR') {
          console.error("❌ Message subscription error for chat:", chatId);
        } else if (status === 'TIMED_OUT') {
          console.error("⏱️ Message subscription timed out for chat:", chatId);
        }
      });

    return () => {
      console.log("🔌 UNSUBSCRIBING from messages for chat:", chatId);
      supabase.removeChannel(channel);
    };
  };

  // ---- send message ----
const sendMessage = async (messageContent: string) => {
  const content = messageContent.trim();
  if (!content || !currentChatId || loading) return;

    // ← ADD THIS LINE
    hasSentMessage.current = true;

  // Check if conversation is already resolved
  const { data: chatCheck } = await supabase
    .from("chats")
    .select("is_resolved, closure_state")
    .eq("id", currentChatId)
    .single();

  if (chatCheck?.is_resolved && chatCheck?.closure_state === 'closed') {
    console.log("🛑 Conversation is already closed - preventing new messages");
    showNotification('info', 'Conversation Closed', 'This conversation has been completed and closed.');
    return;
  }

  console.log("\n" + "🚀".repeat(30));
  console.log("📤 SENDING MESSAGE");
  console.log("  From User ID:", user?.id);
  console.log("  To Chat ID:", currentChatId);
  console.log("  Content:", content.substring(0, 50));
  console.log("🚀".repeat(30) + "\n");

  setLoading(true);
  setShowSuggestedOptions(false);

  try {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        chat_id: currentChatId,
        sender_type: "user",
        sender_id: user?.id,
        content,
        message_type: "text",
      })
      .select()
      .single();

    if (error) {
      console.error("❌ MESSAGE INSERT FAILED:", error);
      throw error;
    }

    console.log("✅ MESSAGE INSERTED INTO DATABASE");
    console.log("  Message ID:", data.id);
    console.log("  Sender ID:", data.sender_id);
    console.log("  Chat ID:", data.chat_id);

    // 😊 Mutual smiley detection for proper closure
    const CLOSURE_SMILEYS = ["👍", "🙂", "🤝", "❤️", "😊", "💖", "🌟", "✨", "🙏"];
    const isSmiley = CLOSURE_SMILEYS.some(smiley => content.trim() === smiley);

    if (isSmiley) {
      const { data: chatData } = await supabase
        .from("chats")
        .select("user_id, contact_id, context_data, user_a_smiley_sent, user_b_smiley_sent, closure_state")
        .eq("id", currentChatId)
        .single();

      if (chatData) {
        const isUserA = user?.id === chatData.user_id;
        const isUserB = user?.id === chatData.contact_id;

        // Update smiley sent status
        const updateData: any = {};
        if (isUserA) {
          updateData.user_a_smiley_sent = true;
        } else if (isUserB) {
          updateData.user_b_smiley_sent = true;
        }

        // Check if both have sent smileys
        const userASent = isUserA ? true : chatData.user_a_smiley_sent;
        const userBSent = isUserB ? true : chatData.user_b_smiley_sent;

        if (userASent && userBSent) {
  // ✅ Both users sent smileys → fully closed
  updateData.closure_state = 'closed';
  updateData.is_resolved = true;
  updateData.closure_achieved_at = new Date().toISOString();
  console.log("✅ Both users sent smileys - conversation closed!");

  // Notify both via Supabase trigger — don't show banner here yet
} else {
  // 🕊 One user sent smiley → only mark pending, no closure yet
  updateData.closure_state = isUserA
    ? 'pending_user_b_smiley'
    : 'pending_user_a_smiley';

  console.log(`⏳ Waiting for ${isUserA ? 'User B' : 'User A'} to send closure smiley`);
  showNotification('info', 'Closure Pending', 'Waiting for the other person to confirm completion');
}

        await supabase
          .from("chats")
          .update(updateData)
          .eq("id", currentChatId);

        if (userASent && userBSent) {
          try {
            const contextData = (chatData as any)?.context_data ?? {};
            const summaryA = contextData.summary_a || contextData.summary || '';
            const thoughtsA = contextData.thoughts_a || contextData.thoughts || '';
            const hintFromB = contextData.hint_from_b || contextData.hintToContact || null;

            const perspectiveLines: string[] = [];
            if (summaryA) {
              perspectiveLines.push(`My perspective: ${summaryA}`);
            }
            if (thoughtsA) {
              perspectiveLines.push(`My thoughts: ${thoughtsA}`);
            }
            if (hintFromB) {
              perspectiveLines.push(`Their perspective: ${hintFromB}`);
            }
            perspectiveLines.push(`Final note I sent: ${content}`);

            const tags = ['closure'];
            if (contactId) {
              tags.push(`contact:${contactId}`);
            }
            if (currentChatId) {
              tags.push(`chat:${currentChatId}`);
            }

            const closureMood = typeof contextData.closure_mood === 'string' && contextData.closure_mood.trim()
              ? contextData.closure_mood.trim().toLowerCase()
              : 'peaceful';

            await supabase
              .from('soulroom_entries')
              .insert({
                user_id: user?.id,
                title: `Post-conversation note`,
                content: perspectiveLines.join('\n\n'),
                mood: closureMood,
                tags,
                ai_summary: null,
                emotion_tag: 'relieved',
              });
          } catch (closureLogError) {
            console.warn('⚠️ Failed to log closure in Soulroom:', closureLogError);
          }
        }
      }
    }

    let chatData = chatContext;
    if (!chatData) {
      const { data: fetched } = await supabase
        .from("chats")
        .select("user_id, contact_id, context_data, ai_source_chat_id, session_name, ai_confidence_level, conversation_phase, is_resolved, user_a_smiley_sent, user_b_smiley_sent")
        .eq("id", currentChatId)
        .single();
      if (fetched) {
        chatData = fetched;
        setChatContext(fetched);
      }
    }

    if (!chatData) {
      throw new Error("Chat context unavailable");
    }

    const sessionId = chatData.session_name || (currentChatId as string);

    console.log("\n" + "=".repeat(60));
    console.log("📤 USER SENT MESSAGE - GENERATING OPTIONS FOR RECIPIENT");
    console.log("=".repeat(60));
    console.log("📬 User's message (currentMessage for recipient):", content.substring(0, 80));

    setMessages((prev) => {
      if (prev.some((m) => m.id === data.id)) return prev;
      return [
        ...prev,
        {
          id: data.id,
          content: data.content,
          sender_type: "user",
          sender_id: user?.id || "",
          created_at: data.created_at,
        },
      ];
    });

    const updatedContextData = chatData?.context_data
      ? { ...chatData.context_data, initial_pending: false, session_promoted: true }
      : { initial_pending: false, session_promoted: true };

    await supabase
      .from("chats")
      .update({
        last_message: content,
        last_message_at: new Date().toISOString(),
        context_data: updatedContextData,
      })
      .eq("id", currentChatId);

    const recipientId = contactId as string;

    const conversationHistory = buildHistory({
      sender_id: String(user?.id || ""),
      content,
    }) || []; // ✅ Ensure it's always an array

    // ✅ FIX: Determine if current user is User A or User B to send correct context
    const isCurrentUserA = user?.id === chatData.user_id;

    // ✅ FIX: Use fresh context from database, not stale component state
    // Send User A's context when generating options for User B
    // ✅ CRITICAL: Always include User A's original issue context in all generations
    const summaryA = chatData.context_data?.summary_a || chatData.context_data?.summary || "";
    const thoughtsA = chatData.context_data?.thoughts_a || chatData.context_data?.thoughts || "";
    const summaryB = chatData.context_data?.summary_b || "";
    const thoughtsB = chatData.context_data?.thoughts_b || "";

    // Determine recipient's context
    const isRecipientUserA = recipientId === chatData.user_id;
    const recipientSummary = isRecipientUserA ? summaryA : summaryB;
    const recipientThoughts = isRecipientUserA ? thoughtsA : thoughtsB;

    console.log("💾 Context data being sent to edge function:", {
      currentUserRole: isCurrentUserA ? "User A" : "User B",
      recipientRole: isRecipientUserA ? "User A" : "User B",
      originalIssueSummary: summaryA.substring(0, 60) || "❌ MISSING",
      recipientSummary: recipientSummary?.substring(0, 50) || "❌ MISSING",
      hint_from_b: chatData.context_data?.hint_from_b?.substring(0, 50) || "⚠️ Not provided",
      conversationHistoryLength: conversationHistory.length,
      contactCategory: contact?.category || "General",
    });

    // 🧠 STEP 1: Call orchestrate-conversation FIRST for intelligent guidance
    console.log("🧠 ORCHESTRATION: Calling orchestrate-conversation...");
    let orchestrationGuidance = null;
    try {
      const { data: orchData, error: orchError } = await supabase.functions.invoke(
        "orchestrate-conversation",
        {
          body: {
            chatId: currentChatId,
            recipientId,
            currentUserId: user?.id,
            currentMessage: content,
            summary: recipientSummary,
            thoughts: recipientThoughts,
            summaryB: summaryB,
            thoughtsB: thoughtsB,
            hintFromB: chatData.context_data?.hint_from_b || "",
            conversationHistory,
            contactCategory: contact?.category || "General",
            isInitial: false,
          },
        }
      );

      if (orchError) {
        console.error("⚠️ Orchestration failed (non-blocking):", orchError);
      } else {
        orchestrationGuidance = orchData;
        console.log("✅ Orchestration guidance received:", {
          emotionIntent: orchData?.emotionIntent,
          closureReadiness: orchData?.closureReadiness,
        });
      }
    } catch (err) {
      console.error("⚠️ Orchestration error (continuing anyway):", err);
    }

    // 🎯 STEP 2: Generate options WITH orchestration guidance
    const { error: funcError } = await supabase.functions.invoke(
      "generate-contextual-options",
      {
        body: {
          chatId: currentChatId,
          recipientId,
          currentUserId: user?.id,
          currentMessage: String(content || ""), // ✅ CRITICAL: User's latest message for recipient to respond to
          summary: recipientSummary || "",
          thoughts: recipientThoughts || "",
          originalIssueSummary: summaryA || "",
          recipientSummary: summaryB || "",
          hint_from_b: chatData.context_data?.hint_from_b || '',

          // ✅ CRITICAL: Always pass User A's original issue context
          originalIssue: {
            summary: summaryA,
            thoughts: thoughtsA,
          },
          hintFromB: chatData.context_data?.hint_from_b || "",
          hintToContact: chatData.context_data?.hint_to_contact || null,
          summaryB: summaryB || "",
          thoughtsB: thoughtsB || "",
          conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
          isInitial: false,
          contactCategory: contact?.category || "General",
          conversationPhase: conversationPhase,
          resolutionDetected: false,
          lastMessageTimestamp: data.created_at, // ⏰ For timing-aware context
          wordLimit: 15, // ✅ Pass word limit
        },
      }
    );

    if (funcError) {
      console.error("❌ Edge function error:", funcError);
      console.error("   Error details:", JSON.stringify(funcError, null, 2));
      console.error("   Chat ID:", currentChatId);
      console.error("   Recipient ID (User B):", recipientId);
      console.error("   Current User ID (User A):", user?.id);
      
      // ✅ Don't block the chat flow - allow manual typing
      showNotification('error', 'Options Failed', 'Could not generate response options. You can type manually.');
      // Don't throw - allow user to continue chatting manually
    } else {
      console.log("✅ Options generation completed for recipient:", recipientId);
      console.log("   Original issue context: INCLUDED");
      console.log("   Options will be validated and context-aware");
      console.log("   User B should see these options in their chat screen");
      console.log("=".repeat(60) + "\n");
    }
  } catch (err) {
    console.error("❌ Error sending message:", err);
    Alert.alert("Error", "Failed to send message");
  } finally {
    setLoading(false);
  }
};

const handleSuggestedOptionPress = (option: string) => {
  hasSentMessage.current = true;   // ← NEW
  setShowSuggestedOptions(false);
  sendMessage(option);
};

// 🔄 Regenerate options function
const regenerateOptions = async () => {
  if (!currentChatId || !user) return;

  setWaitingForOptions(true);
  setOptionsGenerationFailed(false);

  try {
    // Get the latest message from contact to respond to
    const latestContactMessage = messages
      .filter((m) => m.sender_id === contactId)
      .pop();

    if (!latestContactMessage) {
      showNotification('info', 'No Messages', 'Wait for a message from your contact first.');
      setWaitingForOptions(false);
      return;
    }

    let chatCtx = chatContext;
    if (!chatCtx) {
      const { data: fetched } = await supabase
        .from("chats")
        .select("context_data, user_id, contact_id, ai_confidence_level, conversation_phase, is_resolved, ai_source_chat_id, session_name, user_a_smiley_sent, user_b_smiley_sent")
        .eq("id", currentChatId)
        .single();
      if (fetched) {
        chatCtx = fetched;
        setChatContext(fetched);
      }
    }

    if (!chatCtx) {
      throw new Error("Chat context not found");
    }

    const conversationHistory = buildHistory();
    const isCurrentUserA = user.id === chatCtx.user_id;

    const summaryA = chatCtx.context_data?.summary_a || chatCtx.context_data?.summary || "";
    const thoughtsA = chatCtx.context_data?.thoughts_a || chatCtx.context_data?.thoughts || "";
    const summaryB = chatCtx.context_data?.summary_b || "";
    const thoughtsB = chatCtx.context_data?.thoughts_b || "";

    const summaryToSend = isCurrentUserA ? summaryA : summaryB;
    const thoughtsToSend = isCurrentUserA ? thoughtsA : thoughtsB;

    console.log("🔄 Manually regenerating options");

    const { error } = await supabase.functions.invoke(
      "generate-contextual-options",
      {
        body: {
          chatId: currentChatId,
          recipientId: user.id,
          currentUserId: user.id,
          currentMessage: latestContactMessage.content,
          summary: summaryToSend,
          thoughts: thoughtsToSend,
          originalIssue: {
            summary: summaryA,
            thoughts: thoughtsA,
          },
          hintFromB: chatCtx.context_data?.hint_from_b || "",
          hintToContact: chatCtx.context_data?.hint_to_contact || null,
          summaryB: summaryB,
          thoughtsB: thoughtsB,
          conversationHistory,
          isInitial: false,
          contactCategory: contact?.category || "General",
          conversationPhase: conversationPhase,
          resolutionDetected: false,
          lastMessageTimestamp: latestContactMessage.created_at, // ⏰ For timing-aware context
          wordLimit: 15, // ✅ Pass word limit
        },
      }
    );

    if (error) {
      throw error;
    }

    showNotification('success', 'Options Regenerated', 'New response options are being generated.');
  } catch (err) {
    console.error("❌ Failed to regenerate options:", err);
    setOptionsGenerationFailed(true);
    showNotification('error', 'Regeneration Failed', 'Could not generate new options. Try manual input mode.');
  } finally {
    setWaitingForOptions(false);
  }
};


  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" />
          <Text style={styles.loadingText}>Loading conversation...</Text>
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
      <SafeAreaView style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          
          <View style={[styles.headerInfo, { marginLeft: Spacing.sm }] }>
            {!showSuggestedOptions && (
              <View style={styles.contactAvatar}>
                <User size={20} color={Colors.success[500]} />
              </View>
            )}
            <View style={styles.contactInfo}>
              <Text style={styles.headerTitle}>
                {contact?.full_name || contact?.email || "Contact"}
              </Text>
              {contact?.category && (
                <Text style={styles.headerCategory}>{contact.category}</Text>
              )}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              style={styles.historyButton}
              onPress={() => router.push('/(tabs)/chats')}
            >
              <Home size={24} color={Colors.text.secondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.historyButton}
              onPress={() => setShowHistoryModal(true)}
            >
              <History size={24} color={Colors.text.secondary} />
            </TouchableOpacity>
          </View>
        </View>

  {/* 🌈 Peaceful Closure Banner (Animated) */}
{isResolved && (
  <Animated.View
    style={[
      styles.closureBanner,
      {
        opacity: closureAnim,
        transform: [
          {
            translateY: closureAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [-10, 0],
            }),
          },
        ],
      },
    ]}
  >
    <Text style={styles.closureBannerText}>
      🌈 This conversation has reached emotional peace.
    </Text>
  </Animated.View>
)}


        
        {/* 💬 Scrollable Hint Banner for User B */}
        {showHintBanner && hintToContact && (
          <View style={styles.hintBannerWrapper}>
            <ScrollView
  key="hint"
  style={styles.hintBannerScrollView}
  contentContainerStyle={styles.hintBannerScrollContent}
  showsVerticalScrollIndicator={true}
>
              <View style={styles.hintBannerContent}>
                <Text style={styles.hintBannerText}>
                  {hintToContact.full_text}
                </Text>
                <TouchableOpacity
                  style={styles.hintBannerCloseButton}
                  onPress={() => setShowHintBanner(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={18} color={Colors.text.tertiary} />
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}


        <KeyboardAvoidingView
          style={styles.chatContainer}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.messagesContainer}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((m) => (
              <View
                key={m.id}
                style={[
                  styles.messageContainer,
                  m.sender_type === "user"
                    ? styles.userMessageContainer
                    : styles.contactMessageContainer,
                ]}
              >
                <View
                  style={[
                    styles.messageBubble,
                    m.sender_type === "user"
                      ? styles.userMessageBubble
                      : styles.contactMessageBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.messageText,
                      m.sender_type === "user"
                        ? styles.userMessageText
                        : styles.contactMessageText,
                    ]}
                  >
                    {m.content}
                  </Text>
                  <Text
                    style={[
                      styles.messageTime,
                      m.sender_type === "user"
                        ? styles.userMessageTime
                        : styles.contactMessageTime,
                    ]}
                  >
                    {formatTime(m.created_at)}
                  </Text>
                </View>
              </View>
            ))}

            {/* 🌟 NEW: show extra AI context if available */}
            {aiPerspective ? (
              <View style={styles.aiNoteContainer}>
                <Text style={styles.aiNoteTitle}>🧠 Perspective</Text>
                <Text style={styles.aiNoteText}>{aiPerspective}</Text>
              </View>
            ) : null}

            {aiClosure ? (
              <View style={styles.aiNoteContainer}>
                <Text style={styles.aiNoteTitle}>✅ Toward Closure</Text>
                <Text style={styles.aiNoteText}>{aiClosure}</Text>
              </View>
            ) : null}
            
            {showTipBox && (
              <Animated.View 
                style={[
                  styles.tipBoxContainer,
                  {
                    transform: [{ translateY: tipBoxSlideAnim }],
                  },
                ]}
              >
                <Text style={styles.tipBoxTitle}>
                  💡 Share your side (stays private):
                </Text>

                {/* Tag Dropdown for Hint Input - @ for contacts */}
                {hintShowTagDropdown === '@' && hintContactSuggestions.length > 0 && (
                  <View style={styles.hintTagDropdown}>
                    <Text style={styles.hintDropdownHeader}>
                      <AtSign size={12} color={Colors.success[600]} /> People in this conversation
                    </Text>
                    {hintContactSuggestions.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.hintTagItem}
                        onPress={() => {
                          const typingTag = getLastTypingTag(tipText, hintCursorPos);
                          if (typingTag.type === '@') {
                            const newText = replaceTypingTag(
                              tipText,
                              typingTag.startPos,
                              '@',
                              c.full_name || c.email
                            );
                            setTipText(newText);
                            setHintContactSuggestions([]);
                            setHintShowTagDropdown(null);
                          }
                        }}
                      >
                        <View style={[styles.hintTagIndicator, { backgroundColor: Colors.success[100] }]}>
                          <AtSign size={12} color={Colors.success[600]} />
                        </View>
                        <Text style={styles.hintTagName}>{c.full_name || c.email}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Tag Dropdown for Hint Input - # for custom entities */}
                {hintShowTagDropdown === '#' && hintHashSuggestions.length > 0 && (
                  <View style={styles.hintTagDropdown}>
                    <Text style={styles.hintDropdownHeader}>
                      <Hash size={12} color={Colors.warning[600]} /> People/Groups (not in app)
                    </Text>
                    {hintHashSuggestions.map((tag, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.hintTagItem}
                        onPress={() => {
                          const typingTag = getLastTypingTag(tipText, hintCursorPos);
                          if (typingTag.type === '#') {
                            const newText = replaceTypingTag(
                              tipText,
                              typingTag.startPos,
                              '#',
                              tag
                            );
                            setTipText(newText);
                            setHintHashSuggestions([]);
                            setHintShowTagDropdown(null);
                          }
                        }}
                      >
                        <View style={[styles.hintTagIndicator, { backgroundColor: Colors.warning[100] }]}>
                          <Hash size={12} color={Colors.warning[600]} />
                        </View>
                        <Text style={styles.hintTagName}>#{tag}</Text>
                      </TouchableOpacity>
                    ))}
                    <Text style={styles.hintDropdownFooter}>
                      Type any name after # to create custom tag
                    </Text>
                  </View>
                )}

                <TextInput
                  value={tipText}
                  onChangeText={async (text) => {
                    if (text.length <= 200) {
                      setTipText(text);

                      // Handle tagging
                      const typingTag = getLastTypingTag(text, hintCursorPos);

                      if (typingTag.type === '@') {
                        setHintShowTagDropdown('@');
                        // Search contacts
                        try {
                          const { data, error } = await supabase
                            .from("contacts")
                            .select(
                              `contact_profile:profiles!contacts_contact_id_fkey (
                                id,
                                full_name,
                                email,
                                avatar_url
                              )`
                            )
                            .eq("user_id", user?.id)
                            .eq("status", "accepted")
                            .limit(5);

                          if (!error && data) {
                            const filtered = data
                              .map((c) => {
                                const profile = Array.isArray(c.contact_profile) ? c.contact_profile[0] : c.contact_profile;
                                return profile;
                              })
                              .filter(
                                (profile) =>
                                  profile &&
                                  (profile.full_name?.toLowerCase().includes(typingTag.search.toLowerCase()) ||
                                    profile.email?.toLowerCase().includes(typingTag.search.toLowerCase()))
                              ) as Contact[];
                            setHintContactSuggestions(filtered);
                          }
                        } catch (err) {
                          console.error("Error searching contacts for hint:", err);
                        }
                        setHintHashSuggestions([]);
                      } else if (typingTag.type === '#') {
                        setHintShowTagDropdown('#');
                        const commonTags = getCommonHashTags();
                        const filtered = typingTag.search
                          ? commonTags.filter(t => t.toLowerCase().includes(typingTag.search.toLowerCase()))
                          : commonTags;
                        setHintHashSuggestions(filtered);
                        setHintContactSuggestions([]);
                      } else {
                        setHintShowTagDropdown(null);
                        setHintContactSuggestions([]);
                        setHintHashSuggestions([]);
                      }

                      // Parse tagged entities
                      try {
                        const { data } = await supabase
                          .from("contacts")
                          .select(`contact_profile:profiles!contacts_contact_id_fkey (id, full_name, email)`)
                          .eq("user_id", user?.id)
                          .eq("status", "accepted");

                        const contacts = (data || []).map(c => {
                          const profile = Array.isArray(c.contact_profile) ? c.contact_profile[0] : c.contact_profile;
                          return {
                            id: profile?.id || '',
                            name: profile?.full_name || profile?.email || '',
                          };
                        });

                        const entities = parseTaggedEntities(text, contacts);
                        setHintTaggedEntities(entities);
                      } catch (err) {
                        console.error('Failed to parse hint tags:', err);
                      }
                    }
                  }}
                  placeholder="e.g. I've been stressed with work, or use @ for people, # for others"
                  placeholderTextColor={Colors.text.tertiary}
                  maxLength={200}
                  style={styles.tipBoxInput}
                  multiline
                  onSelectionChange={(event) => {
                    setHintCursorPos(event.nativeEvent.selection.start);
                  }}
                />
                <Text style={[
                  styles.tipBoxCharCount,
                  { color: tipText.length >= 200 ? Colors.error[500] : Colors.text.tertiary }
                ]}>
                  {tipText.length}/200 characters
                  {tipText.length >= 200 ? " (limit reached)" : ""}
                </Text>
                <View style={styles.tipBoxActions}>
                  <TouchableOpacity
                    style={styles.tipBoxSkipButton}
                    onPress={() => setShowTipBox(false)}
                  >
                    <Text style={styles.tipBoxSkipText}>Skip</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.tipBoxSubmitButton}
                    onPress={async () => {
                      try {
                        const { data: existing, error: fetchErr } = await supabase
                          .from("chats")
                          .select("context_data, user_id, contact_id")
                          .eq("id", currentChatId)
                          .single();

                        if (fetchErr) throw fetchErr;

                        const mergedContext = {
                          ...(existing?.context_data || {}),
                          hint_from_b: tipText,
                          hint_submitted_at: new Date().toISOString(),
                          hint_tagged_entities: hintTaggedEntities, // Store tagged entities from hint
                        };

                        await supabase
                          .from("chats")
                          .update({ context_data: mergedContext })
                          .eq("id", currentChatId);

                        console.log("✅ Hint saved:", tipText.substring(0, 50));
                        setShowTipBox(false);
                        setHintSubmitted(true);

                        // ✅ FIX: Always regenerate options immediately after hint submission
                        console.log("🔄 Hint submitted - regenerating options immediately with hint context");

                        setWaitingForOptions(true);
                        setShowSuggestedOptions(false);

                        // Get latest message from contact to respond to
                        const latestContactMessage = messages
                          .filter((m) => m.sender_id === contactId)
                          .pop();

                        if (latestContactMessage) {
                          const conversationHistory = buildHistory();

                          // Determine if current user is User A or User B
                          const isCurrentUserA = user?.id === existing?.user_id;

                          console.log("📤 Regenerating options with hint:", {
                            currentUserRole: isCurrentUserA ? "User A" : "User B",
                            hintLength: tipText.length,
                            latestMessagePreview: latestContactMessage.content.substring(0, 50),
                          });

                          // Regenerate options with hint included - CRITICAL: Include ALL context
                          const summaryA = existing?.context_data?.summary_a || existing?.context_data?.summary || "";
                          const thoughtsA = existing?.context_data?.thoughts_a || existing?.context_data?.thoughts || "";

                          if (!user) {
                            console.error('User not available for regenerating options');
                            return;
                          }

                          const { error: regenError } = await supabase.functions.invoke(
                            "generate-contextual-options",
                            {
                              body: {
                                chatId: currentChatId,
                                recipientId: user.id,
                                currentUserId: user.id,
                                currentMessage: latestContactMessage.content,
                                summary: isCurrentUserA
                                  ? summaryA
                                  : (existing?.context_data?.summary_b || ""),
                                thoughts: isCurrentUserA
                                  ? thoughtsA
                                  : (existing?.context_data?.thoughts_b || ""),
                                // ✅ CRITICAL: Always include User A's original issue
                                originalIssue: {
                                  summary: summaryA,
                                  thoughts: thoughtsA,
                                },
                                hintFromB: tipText.trim(), // ⭐ NEW HINT - User B's perspective
                                hintToContact: existing?.context_data?.hint_to_contact || null,
                                summaryB: existing?.context_data?.summary_b || "",
                                thoughtsB: existing?.context_data?.thoughts_b || "",
                                conversationHistory,
                                isInitial: false,
                                contactCategory: contact?.category || "General",
                                conversationPhase: conversationPhase,
                                resolutionDetected: false,
                                lastMessageTimestamp: latestContactMessage.created_at, // ⏰ For timing-aware context
                                wordLimit: 15, // ✅ Pass word limit
                              },
                            }
                          );

                          if (regenError) {
                            console.error("❌ Failed to regenerate options with hint:", regenError);
                            showNotification('warning', 'Context Saved', 'Your perspective is saved but options could not be updated');
                          } else {
                            console.log("✅ Options regenerated with hint context");
                            showNotification('success', 'Options Updated', 'Your response choices now reflect your perspective');
                          }
                        } else {
                          showNotification('success', 'Context Saved', 'Your perspective will guide future responses');
                        }
                      } catch (err) {
                        console.error("❌ Failed to save hint:", err);
                        showNotification('error', 'Save Failed', 'Could not save your perspective. Please try again.');
                      }
                    }}
                  >
                    <Text style={styles.tipBoxSubmitText}>Submit</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            )}

            {hintSubmitted && (
              <Animated.View style={styles.hintSubmittedBanner}>
                <Text style={styles.hintSubmittedText}>
                  ✅ Your perspective is noted. It stays private and won't be shown to the other side, but it may help clear misunderstandings.
                </Text>
              </Animated.View>
            )}

            {waitingForOptions && (
              <View style={styles.loadingOptionsContainer}>
                <LoadingSpinner size="small" />
                <Text style={styles.loadingOptionsText}>
                  Generating personalized response options...
                </Text>
                <Text style={styles.loadingOptionsSubtext}>
                  This usually takes 5-15 seconds
                </Text>
              </View>
            )}

            {/* 🔄 Recovery UI: Show when options failed to generate */}
            {optionsGenerationFailed && !waitingForOptions && !showSuggestedOptions && (
              <View style={styles.recoveryContainer}>
                <Text style={styles.recoveryTitle}>Options Not Available</Text>
                <Text style={styles.recoveryText}>
                  Response options couldn't be generated. You can:
                </Text>
                <View style={styles.recoveryButtonsContainer}>
                <TouchableOpacity
  style={styles.recoveryButton}
  onPress={regenerateOptions}
  disabled={waitingForOptions}  // ← NEW: stops clicking while loading
>
  {waitingForOptions ? (
    <ActivityIndicator color="#fff" size="small" />
  ) : (
    <Text style={styles.recoveryButtonText}>Try Again</Text>
  )}
</TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recoveryButton, styles.manualInputButton]}
                    onPress={() => {
                      setManualInputMode(true);
                      setOptionsGenerationFailed(false);
                    }}
                  >
                    <Text style={styles.recoveryButtonText}>✍️ Type Manually</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>

          {showSuggestedOptions && suggestedOptions.length > 0 && !manualInputMode && (
            <Animated.View
              style={[
                styles.suggestedOptionsContainer,
                {
                  transform: [{ translateY: optionsSlideAnim }],
                  paddingBottom: Math.max(Spacing.md, insets.bottom),
                },
              ]}
            >
              <View style={styles.suggestedOptionsHeader}>
                <Text style={styles.suggestedOptionsTitle}>
                  Choose response:
                </Text>
                <TouchableOpacity
                  style={styles.switchToManualButton}
                  onPress={() => setManualInputMode(true)}
                >
                  <Text style={styles.switchToManualText}>Type instead</Text>
                </TouchableOpacity>
              </View>

              {/* Navigation shortcuts removed; Home icon remains in header */}
              <View style={styles.optionsContainer}>
                {suggestedOptions.map((opt, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.suggestedOptionButton,
                      opt === "🙂" && styles.closureOptionButton
                    ]}
                    onPress={() => handleSuggestedOptionPress(opt)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.suggestedOptionText,
                      opt === "🙂" && styles.closureOptionText
                    ]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Animated.View>
          )}

          {/* ✍️ Manual Input Mode */}
          {manualInputMode && (
            <View style={styles.manualInputContainer}>
              <View style={styles.manualInputHeader}>
                <Text style={styles.manualInputTitle}>Type your response:</Text>
                {showSuggestedOptions && suggestedOptions.length > 0 && (
                  <TouchableOpacity
                    style={styles.switchToOptionsButton}
                    onPress={() => setManualInputMode(false)}
                  >
                    <Text style={styles.switchToOptionsText}>Use options</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.manualInputRow}>
                <TextInput
                  ref={(ref) => {
                    if (ref && manualInputMode) {
                      // Store ref for later use
                      (ref as any)._manualInputRef = true;
                    }
                  }}
                  style={styles.manualTextInput}
                  placeholder="Type your message..."
                  placeholderTextColor={Colors.text.tertiary}
                  multiline
                  maxLength={500}
                  onChangeText={(text) => {
                    // Store text in a ref for sending
                    (manualInputRef as any).current = text;
                  }}
                />
                <TouchableOpacity
                  style={styles.manualSendButton}
                  onPress={() => {
                    const text = (manualInputRef as any).current;
                    if (text?.trim()) {
                      hasSentMessage.current = true;   // ← NEW
                      sendMessage(text.trim());
                      (manualInputRef as any).current = '';
                      setManualInputMode(false);
                    }
                  }}
                >
                  <Text style={styles.manualSendButtonText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

        </KeyboardAvoidingView>

        {/* ✅ NEW: Unified History Modal with Filter Toggles */}
        <Modal
          visible={showHistoryModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowHistoryModal(false)}
        >
          <SafeAreaView style={styles.historyModalContainer}>
            <View style={styles.historyModalHeader}>
              <Text style={styles.historyModalTitle}>Conversation History</Text>
              <TouchableOpacity
                style={styles.historyModalCloseButton}
                onPress={() => setShowHistoryModal(false)}
              >
                <X size={24} color={Colors.text.secondary} />
              </TouchableOpacity>
            </View>

            {/* Filter Toggle Buttons */}
            <View style={styles.historyFilterContainer}>
              <TouchableOpacity
                style={[
                  styles.historyFilterButton,
                  historyFilter === 'all' && styles.historyFilterButtonActive
                ]}
                onPress={() => setHistoryFilter('all')}
              >
                <Text style={[
                  styles.historyFilterText,
                  historyFilter === 'all' && styles.historyFilterTextActive
                ]}>
                  All Messages
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.historyFilterButton,
                  historyFilter === 'mine' && styles.historyFilterButtonActive
                ]}
                onPress={() => setHistoryFilter('mine')}
              >
                <Text style={[
                  styles.historyFilterText,
                  historyFilter === 'mine' && styles.historyFilterTextActive
                ]}>
                  My Messages
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.historyFilterButton,
                  historyFilter === 'theirs' && styles.historyFilterButtonActive
                ]}
                onPress={() => setHistoryFilter('theirs')}
              >
                <Text style={[
                  styles.historyFilterText,
                  historyFilter === 'theirs' && styles.historyFilterTextActive
                ]}>
                  {contact?.full_name?.split(' ')[0] || 'Their'} Messages
                </Text>
              </TouchableOpacity>
            </View>

            {/* Unified Message History */}
            <ScrollView style={styles.historyMessagesList}>
              {messages
                .filter(m => {
                  if (historyFilter === 'all') return true;
                  if (historyFilter === 'mine') return m.sender_id === user?.id;
                  if (historyFilter === 'theirs') return m.sender_id !== user?.id;
                  return true;
                })
                .map((m) => (
                  <View
                    key={m.id}
                    style={[
                      styles.historyMessageContainer,
                      m.sender_id === user?.id
                        ? styles.historyMessageMine
                        : styles.historyMessageTheirs,
                    ]}
                  >
                    {/* Sender name label */}
                    <Text style={styles.historyMessageSender}>
                      {m.sender_id === user?.id
                        ? 'You'
                        : contact?.full_name?.split(' ')[0] || contact?.email?.split('@')[0] || 'Contact'}
                    </Text>

                    {/* Message bubble */}
                    <View
                      style={[
                        styles.historyMessageBubble,
                        m.sender_id === user?.id
                          ? styles.historyMessageBubbleMine
                          : styles.historyMessageBubbleTheirs,
                      ]}
                    >
                      <Text
                        style={[
                          styles.historyMessageText,
                          m.sender_id === user?.id
                            ? styles.historyMessageTextMine
                            : styles.historyMessageTextTheirs,
                        ]}
                      >
                        {m.content}
                      </Text>
                      <Text style={styles.historyMessageTime}>
                        {formatTime(m.created_at)}
                      </Text>
                    </View>
                  </View>
                ))}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: Colors.background 
  },
  loadingContainer: { 
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center",
    gap: Spacing.lg,
  },
  loadingText: { 
    fontSize: Typography.fontSize.lg, 
    color: Colors.text.secondary,
    fontWeight: Typography.fontWeight.medium,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  headerInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  contactAvatar: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.success[50],
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  contactInfo: {
    alignItems: 'center',
  },
  headerTitle: { 
    fontSize: Typography.fontSize.lg, 
    fontWeight: Typography.fontWeight.semibold, 
    color: Colors.text.primary 
  },
  headerCategory: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  // ✅ REMOVED: placeholder style (replaced by historyButton)
  chatContainer: { flex: 1 },
  messagesContainer: { flex: 1 },
  messagesContent: {
    padding: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: 240,
  },
  messageContainer: { marginBottom: Spacing.lg },
  userMessageContainer: { alignItems: "flex-end" },
  contactMessageContainer: { alignItems: "flex-start" },
  messageBubble: { 
    maxWidth: "85%", 
    paddingHorizontal: Spacing.lg, 
    paddingVertical: Spacing.md, 
    borderRadius: BorderRadius.xl,
    ...Shadows.small,
  },
  userMessageBubble: { 
    backgroundColor: Colors.secondary[500],
    borderBottomRightRadius: BorderRadius.sm,
  },
  contactMessageBubble: { 
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderBottomLeftRadius: BorderRadius.sm,
    ...Shadows.small,
  },
  messageText: { 
    fontSize: Typography.fontSize.base,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.base,
  },
  userMessageText: { color: Colors.text.inverse },
  contactMessageText: { color: Colors.text.primary },
  messageTime: { 
    fontSize: Typography.fontSize.xs, 
    marginTop: Spacing.xs,
  },
  userMessageTime: { 
    color: Colors.text.inverse, 
    textAlign: "right",
    opacity: 0.8,
  },
  contactMessageTime: { 
    color: Colors.text.tertiary, 
    textAlign: "left" 
  },
  loadingOptionsContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  loadingOptionsText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    fontStyle: 'italic',
  },
  loadingOptionsSubtext: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    marginTop: Spacing.xs,
    fontStyle: 'italic',
  },
  suggestedOptionsContainer: {
    position: 'absolute',
    bottom: 20,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    ...Shadows.medium,
  },
  optionsScrollView: {
    flexShrink: 0,
  },
  suggestedOptionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  optionsNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  smallPillButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.primary[50],
    borderColor: Colors.primary[200],
    borderWidth: 1,
    borderRadius: 999,
  },
  smallPillButtonText: {
    color: Colors.primary[700],
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
  },
  smallPillButtonSecondary: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: Colors.surface,
    borderColor: Colors.borderLight,
    borderWidth: 1,
    borderRadius: 999,
  },
  smallPillButtonSecondaryText: {
    color: Colors.text.secondary,
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
  },
  suggestedOptionsTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.secondary
  },
  optionsScrollContent: {
    paddingRight: Spacing.lg,
    flexGrow: 1,
  },
  optionsContainer: {
    flexDirection: 'column',
    gap: Spacing.sm,
  },
  suggestedOptionButton: {
    flexShrink: 1, // Allow button to shrink and wrap text
    minWidth: 0, // Allow text to wrap
    backgroundColor: Colors.primary[50],
    borderWidth: 1,
    borderColor: Colors.primary[200],
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    width: '100%',
    minHeight: 40,
    justifyContent: 'center',
    marginBottom: Spacing.xs,
    ...Shadows.small,
  },
  suggestedOptionText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.medium,
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
    flexWrap: 'wrap',
    flexShrink: 1, // Allow text to wrap instead of truncating
  },
  closureOptionButton: {
    backgroundColor: Colors.success[50],
    borderColor: Colors.success[300],
  },
  closureOptionText: {
    fontSize: Typography.fontSize.xl,
    color: Colors.success[700],
  },

  // 🌟 NEW styles
  aiNoteContainer: {
    backgroundColor: Colors.warning[50],
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.warning[200],
    ...Shadows.small,
  },
  aiNoteTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.warning[800],
    marginBottom: Spacing.xs,
  },
  aiNoteText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.warning[700],
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  tipBoxContainer: {
    backgroundColor: Colors.primary[50],
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.medium,
  },
  tipBoxTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[700],
    marginBottom: Spacing.md,
  },
  tipBoxInput: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
    minHeight: 80,
    textAlignVertical: 'top',
    ...Shadows.small,
  },
  tipBoxCharCount: {
    fontSize: Typography.fontSize.xs,
    textAlign: 'right',
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  tipBoxActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.md,
  },
  tipBoxSkipButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  tipBoxSkipText: {
    color: Colors.text.secondary,
    fontSize: Typography.fontSize.base,
  },
  tipBoxSubmitButton: {
    backgroundColor: Colors.primary[500],
    borderWidth: 2,
    borderColor: Colors.secondary[600],
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    ...Shadows.small,
  },
  tipBoxSubmitText: {
    color: '#FFFFFF',
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    textShadowColor: Colors.secondary[600],
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  hintSubmittedBanner: {
    backgroundColor: Colors.success[50],
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadows.medium,
  },
  hintSubmittedText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.success[700],
    textAlign: 'center',
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },

  // 💬 Hint banner styles (scrollable)
  hintBannerWrapper: {
    backgroundColor: Colors.primary[50],
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary[200],
    maxHeight: 80,
  },
  hintBannerScrollView: {
    maxHeight: 80,
  },
  hintBannerScrollContent: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  hintBannerContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  hintBannerCloseButton: {
    padding: Spacing.xs,
  },
  hintBannerText: {
    flex: 1,
    fontSize: Typography.fontSize.sm,
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.medium,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },

  // ✅ NEW: History button and modal styles
  historyButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadows.small,
  },
  historyModalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  historyModalHeader: {
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
  historyModalTitle: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
  },
  historyModalCloseButton: {
    padding: Spacing.xs,
  },
  historyFilterContainer: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  historyFilterButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  historyFilterButtonActive: {
    backgroundColor: Colors.primary[500],
    borderColor: Colors.primary[600],
  },
  historyFilterText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.secondary,
  },
  historyFilterTextActive: {
    color: Colors.text.inverse,
    fontWeight: Typography.fontWeight.semibold,
  },
  historyMessagesList: {
    flex: 1,
    padding: Spacing.lg,
  },
  historyMessageContainer: {
    marginBottom: Spacing.lg,
  },
  historyMessageMine: {
    alignItems: 'flex-end',
  },
  historyMessageTheirs: {
    alignItems: 'flex-start',
  },
  historyMessageSender: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    fontWeight: Typography.fontWeight.semibold,
    marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  historyMessageBubble: {
    maxWidth: '85%',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xl,
    ...Shadows.small,
  },
  historyMessageBubbleMine: {
    backgroundColor: Colors.secondary[500],
    borderBottomRightRadius: BorderRadius.sm,
  },
  historyMessageBubbleTheirs: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderBottomLeftRadius: BorderRadius.sm,
  },
  historyMessageText: {
    fontSize: Typography.fontSize.base,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.base,
  },
  historyMessageTextMine: {
    color: Colors.text.inverse,
  },
  historyMessageTextTheirs: {
    color: Colors.text.primary,
  },
  historyMessageTime: {
    fontSize: Typography.fontSize.xs,
    marginTop: Spacing.xs,
    color: Colors.text.tertiary,
  },

  // 🔄 Recovery mechanism styles
  recoveryContainer: {
    backgroundColor: Colors.warning[50],
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.warning[200],
    ...Shadows.medium,
  },
  recoveryTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.warning[800],
    marginBottom: Spacing.xs,
  },
  recoveryText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.warning[700],
    marginBottom: Spacing.md,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  recoveryButtonsContainer: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  recoveryButton: {
    flex: 1,
    backgroundColor: Colors.primary[500],
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    ...Shadows.small,
  },
  manualInputButton: {
    backgroundColor: Colors.secondary[500],
  },
  recoveryButtonText: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.inverse,
  },

  // ✍️ Manual input mode styles
  manualInputContainer: {
    backgroundColor: Colors.surfaceElevated,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    ...Shadows.large,
  },
  manualInputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  manualInputTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
  },
  switchToOptionsButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.primary[100],
    borderRadius: BorderRadius.md,
  },
  switchToOptionsText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.medium,
  },
  switchToManualButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.secondary[100],
    borderRadius: BorderRadius.md,
  },
  switchToManualText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.secondary[700],
    fontWeight: Typography.fontWeight.medium,
  },
  manualInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  manualTextInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.fontSize.base,
    maxHeight: 100,
    backgroundColor: Colors.surface,
    color: Colors.text.primary,
  },
  manualSendButton: {
    backgroundColor: Colors.secondary[500],
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    ...Shadows.small,
  },
  manualSendButtonText: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.inverse,
  },
  closureBanner: {
  backgroundColor: Colors.success[50],
  borderBottomWidth: 1,
  borderBottomColor: Colors.success[200],
  paddingVertical: Spacing.sm,
  alignItems: 'center',
  justifyContent: 'center',
},
closureBannerText: {
  color: Colors.success[700],
  fontSize: Typography.fontSize.sm,
  fontWeight: Typography.fontWeight.semibold,
  textAlign: 'center',
},

// Hint tag dropdown styles
hintTagDropdown: {
  backgroundColor: Colors.surface,
  borderWidth: 1,
  borderColor: Colors.borderLight,
  borderRadius: BorderRadius.lg,
  marginBottom: Spacing.sm,
  maxHeight: 150,
  ...Shadows.small,
},
hintDropdownHeader: {
  fontSize: Typography.fontSize.xs,
  fontWeight: Typography.fontWeight.semibold,
  color: Colors.text.secondary,
  paddingHorizontal: Spacing.md,
  paddingVertical: Spacing.xs,
  flexDirection: 'row',
  alignItems: 'center',
  borderBottomWidth: 1,
  borderBottomColor: Colors.borderLight,
},
hintDropdownFooter: {
  fontSize: Typography.fontSize.xs,
  color: Colors.text.tertiary,
  paddingHorizontal: Spacing.md,
  paddingVertical: Spacing.xs,
  fontStyle: 'italic',
  borderTopWidth: 1,
  borderTopColor: Colors.borderLight,
},
hintTagItem: {
  paddingVertical: Spacing.sm,
  paddingHorizontal: Spacing.md,
  flexDirection: 'row',
  alignItems: 'center',
  gap: Spacing.sm,
},
hintTagIndicator: {
  width: 20,
  height: 20,
  borderRadius: BorderRadius.sm,
  justifyContent: 'center',
  alignItems: 'center',
},
hintTagName: {
  fontSize: Typography.fontSize.sm,
  color: Colors.text.primary,
  fontWeight: Typography.fontWeight.medium,
},

});




export default ContactChatScreen;