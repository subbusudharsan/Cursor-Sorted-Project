import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  Animated,
  Easing,
  Modal,
  Pressable,
} from "react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
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
import type { RealtimeChannel } from "@supabase/supabase-js";
// ADD THIS LINE HERE
import { useNavigation } from '@react-navigation/native';
import KeyboardSafeView from '@/components/KeyboardSafeView';

type MessageAnimationState = {
  bubbleOpacity: Animated.Value;
  bubbleTranslate: Animated.Value;
  bubbleScale: Animated.Value;
  timeOpacity: Animated.Value;
};

type OptionAnimationState = {
  appear: Animated.Value;
  translate: Animated.Value;
  scale: Animated.Value;
  rippleScale: Animated.Value;
  rippleOpacity: Animated.Value;
};

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

const INITIAL_VISIBLE_MESSAGES = 18;

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
  // ✅ FIX 1: Track if hint box has been seen/dismissed to prevent re-showing
  const hasSeenHintBoxRef = useRef(false);
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
  const headerGlowAnim = React.useRef(new Animated.Value(0)).current;
  const headerIntroAnim = useRef(new Animated.Value(0)).current;
  const headerInfoIntroAnim = useRef(new Animated.Value(0)).current;
  const headerActionsIntroAnim = useRef(new Animated.Value(0)).current;
  const messageAnimationsRef = useRef<Record<string, MessageAnimationState>>({});
  const previousMessageIdsRef = useRef<string[]>([]);
  const initialMessageRenderRef = useRef(true);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activePulseId, setActivePulseId] = useState<string | null>(null);
  const optionAnimationsRef = useRef<OptionAnimationState[]>([]);
  const optionShimmerAnim = useRef(new Animated.Value(0)).current;
  const scrollAnim = useRef(new Animated.Value(0)).current; // ← ADD: For custom smooth scroll
  const scrollListenerRef = useRef<string | null>(null);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const containerHeightRef = useRef(0);
  const pendingAutoScrollRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
const hasAutoScrolledInitially = useRef(false);
const pendingOptionsRecipientRef = useRef<string | null>(null);
const pendingOptionsSinceRef = useRef<number | null>(null);
const messageSubscriptionRef = useRef<RealtimeChannel | null>(null);

  const optionShimmerLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const [showFullHistory, setShowFullHistory] = useState(false);
  useEffect(() => {
    setShowFullHistory(false);
    hasAutoScrolledInitially.current = false;
  }, [chatId]);
  const [activeOptionIndex, setActiveOptionIndex] = useState<number | null>(null);
  const stopOptionShimmer = useCallback(() => {
    if (optionShimmerLoopRef.current) {
      optionShimmerLoopRef.current.stop();
      optionShimmerLoopRef.current = null;
    }
    // FIX: Stop and reset to avoid native/JS conflict on re-use
    optionShimmerAnim.stopAnimation(() => {
      optionShimmerAnim.setValue(0);
    });
  }, [optionShimmerAnim]);
  // ✅ NEW: History view with filters
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'mine' | 'theirs'>('all');
  // 🔄 Recovery mechanism state
  const [optionsGenerationFailed, setOptionsGenerationFailed] = useState(false);
  const [manualInputMode, setManualInputMode] = useState(false);
  // 🔄 Option refresh tracking
  const [, setLastOptionRefreshTime] = useState<number>(0);
  const lastOptionsSignatureRef = useRef<string | null>(null);
  const fadeOutCurrentOptions = useCallback(() => {
    optionAnimationsRef.current.forEach((state) => {
      if (!state) return;
      // FIX: Change to true (opacity/translate supported by native)
      Animated.parallel([
        Animated.timing(state.appear, {
          toValue: 0,
          duration: 120,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true, // FIX: Was false
        }),
        Animated.timing(state.translate, {
          toValue: 6,
          duration: 120,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true, // FIX: Was false
        }),
      ]).start();
    });
  }, []);
const enterWaitingForOptions = useCallback(
  (recipientId?: string) => {
    fadeOutCurrentOptions();
    stopOptionShimmer();
    setActiveOptionIndex(null);
    optionAnimationsRef.current = [];
    setShowSuggestedOptions(false);
    setSuggestedOptions([]);
    setManualInputMode(false);
    pendingOptionsRecipientRef.current =
      recipientId ?? (user?.id ? String(user.id) : null);
    pendingOptionsSinceRef.current = Date.now();
    if (!waitingForOptions) {
      setWaitingForOptions(true);
    }
    lastOptionsSignatureRef.current = null;
  },
  [fadeOutCurrentOptions, stopOptionShimmer, waitingForOptions, user?.id]
);

const resolveWaitingForOptions = useCallback((recipientId?: string | null) => {
  if (
    recipientId === null ||
    recipientId === undefined ||
    !pendingOptionsRecipientRef.current
  ) {
    pendingOptionsRecipientRef.current = null;
    pendingOptionsSinceRef.current = null;
    setWaitingForOptions(false);
    return;
  }
  if (
    pendingOptionsRecipientRef.current &&
    String(pendingOptionsRecipientRef.current) === String(recipientId)
  ) {
    pendingOptionsRecipientRef.current = null;
    pendingOptionsSinceRef.current = null;
    setWaitingForOptions(false);
  }
}, []);
  // ---- add near the other state declarations ----
  const hasSentMessage = useRef(false); // ← NEW
  // 🌈 NEW — closure resolution indicator + animation
  const [isResolved, setIsResolved] = useState(false);
  const [isChatClosed, setIsChatClosed] = useState(false); // Track if chat is closed/resolved
  const closureAnim = useRef(new Animated.Value(0)).current;
  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => {
    setNotification({ visible: true, type, title, message });
  };
  const scrollViewRef = useRef<ScrollView>(null);
  const manualInputRef = useRef<string>('');
  const userScrollingRef = useRef(false); // ← ADD: Tracks manual scroll (disables auto during touch)

  
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
        .select("context_data, user_id, contact_id, ai_confidence_level, conversation_phase, is_resolved, closure_state, ai_source_chat_id, session_name, user_a_smiley_sent, user_b_smiley_sent")
        .eq("id", cid)
        .maybeSingle();
      if (!error && data) {
        // ✅ CRITICAL: Check if chat is closed/resolved and hide options
        const chatIsClosed = data.is_resolved === true && data.closure_state === 'closed';
        setIsChatClosed(chatIsClosed);
        if (chatIsClosed) {
          console.log("🛑 Chat is closed/resolved - hiding options");
          setShowSuggestedOptions(false);
          setSuggestedOptions([]);
        }
        
        if (data.context_data) {
          setChatContext(data);
          // Set User A's context
          setChatSummary(String(data.context_data.summary_a || data.context_data.summary || ""));
          setChatThoughts(String(data.context_data.thoughts_a || data.context_data.thoughts || ""));
          // 💬 Show hint banner if current user is User B
          if (user?.id === data.contact_id && data.context_data.hint_to_contact) {
            setHintToContact(data.context_data.hint_to_contact);
            setShowHintBanner(true);
          }
          // 🌟 Only show tip box if User B hasn't provided hint yet AND hasn't seen/dismissed it before
          if (user?.id === data.contact_id && !data.context_data.hint_from_b && !hasSeenHintBoxRef.current) {
            setShowTipBox(true);
            hasSeenHintBoxRef.current = true; // Mark as seen
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
      if (typeof unsubscribeOptions === 'function') {
        unsubscribeOptions();
      }
      isAutoScrollingRef.current = false; // ← ADD: Reset scroll guard on exit (stops orphans)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, chatId]);
  // ✨ Replace any old router.addListener or useEffect for closure animation
  useFocusEffect(
    useCallback(() => {
      if (isResolved) {
        // FIX: Stop any running anim before reset to avoid native state issues
        closureAnim.stopAnimation();
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
  // Removed tab-focus auto refresh to avoid duplicate orchestrator calls
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
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(optionsSlideAnim, {
        toValue: 300,
        duration: 340,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [showSuggestedOptions]);
 
  useEffect(() => {
    if (hintSubmitted) {
      const timer = setTimeout(() => {
        setHintSubmitted(false); // hide the green box after 5s
      }, 10000); // 5000 ms = 5 seconds
      return () => clearTimeout(timer); // cleanup if component re-renders
    }
  }, [hintSubmitted]);
 
  const attachScrollListener = useCallback(() => {
    if (scrollListenerRef.current) {
      scrollAnim.removeListener(scrollListenerRef.current);
    }
    scrollListenerRef.current = scrollAnim.addListener(({ value }) => {
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollTo({ y: value, animated: false });
      }
    });
  }, [scrollAnim]);

  const detachScrollListener = useCallback(() => {
    if (scrollListenerRef.current) {
      scrollAnim.removeListener(scrollListenerRef.current);
      scrollListenerRef.current = null;
    }
  }, [scrollAnim]);

  const displayedMessages = useMemo(() => {
    if (showFullHistory) {
      return messages;
    }
    const start = Math.max(0, messages.length - INITIAL_VISIBLE_MESSAGES);
    return messages.slice(start);
  }, [messages, showFullHistory]);

  const scrollToBottom = useCallback(
    (options: { immediate?: boolean } = {}) => {
      if (!scrollViewRef.current) return;

      const { immediate = false } = options;
      const shouldImmediate = immediate || !hasAutoScrolledInitially.current;
      const containerHeight = containerHeightRef.current;
      const contentHeight = contentHeightRef.current;
      const tentativeOffset = Math.max(0, contentHeight - containerHeight);
      const targetOffset = Math.max(scrollOffsetRef.current, tentativeOffset);

      if (containerHeight <= 0) {
        pendingAutoScrollRef.current = true;
        scrollOffsetRef.current = targetOffset;
        return;
      }

      if (shouldImmediate) {
        pendingAutoScrollRef.current = false;
        isAutoScrollingRef.current = false;
        scrollAnim.stopAnimation();
        detachScrollListener();
        scrollOffsetRef.current = targetOffset;
        hasAutoScrolledInitially.current = true;
        scrollViewRef.current.scrollTo({ y: targetOffset, animated: false });
        return;
      }

      if (userScrollingRef.current) {
        pendingAutoScrollRef.current = true;
        return;
      }

      if (Math.abs(targetOffset - scrollOffsetRef.current) < 1) {
        pendingAutoScrollRef.current = false;
        return;
      }

      scrollAnim.stopAnimation((value) => {
        if (typeof value === "number") {
          scrollOffsetRef.current = value;
        }
      });

      pendingAutoScrollRef.current = false;
      isAutoScrollingRef.current = false;
      scrollOffsetRef.current = targetOffset;
      scrollViewRef.current.scrollTo({ y: targetOffset, animated: false });
      if (!hasAutoScrolledInitially.current) {
        hasAutoScrolledInitially.current = true;
      }
    },
    [attachScrollListener, detachScrollListener, scrollAnim]
  );

  useEffect(() => {
    return () => {
      detachScrollListener();
      scrollAnim.stopAnimation();
      isAutoScrollingRef.current = false;
      pendingAutoScrollRef.current = false;
    };
  }, [detachScrollListener, scrollAnim]);

  useEffect(() => {
    if (!hasAutoScrolledInitially.current) {
      if (!userScrollingRef.current) {
        scrollToBottom({ immediate: true });
      }
      return;
    }

    const timer = setTimeout(() => {
      if (!userScrollingRef.current) {
        scrollToBottom();
      } else {
        pendingAutoScrollRef.current = true;
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [messages.length, scrollToBottom]);
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
    _retryCount = 0,
    options: { force?: boolean } = {}
  ) => {
    const { force = false } = options;
    console.log("🔍 FETCHING INITIAL OPTIONS", { chatId, userId, forced: force });
    
    // ✅ CRITICAL: Check if conversation is closed before fetching options
    const { data: closureCheck } = await supabase
      .from("chats")
      .select("is_resolved, closure_state")
      .eq("id", chatId)
      .single();

    if (closureCheck?.is_resolved === true && closureCheck?.closure_state === 'closed') {
      console.log("🛑 Conversation is closed - no initial options needed");
      resolveWaitingForOptions(userId);
      return;
    }
    if (!force) {
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
          setSuggestedOptions([]);
          resolveWaitingForOptions(userId);
          return;
        }
      }
    }
    const { data, error } = await supabase
      .from("message_options")
      .select("id, options, context_data, recipient_id, created_at")
      .eq("chat_id", chatId)
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("❌ Failed to fetch initial options:", error);
      if (force) {
        resolveWaitingForOptions(userId);
        setOptionsGenerationFailed(true);
        showNotification('error', 'Options Failed', 'Response options could not load. Try regenerating or use manual input.');
      }
      return;
    } else if (data && data.length > 0 && data[0].options && Array.isArray(data[0].options) && data[0].options.length >= 1) {
      console.log(`✅ INITIAL OPTIONS FOUND (${data[0].options.length} total)`, data[0].options);
      console.log(" Recipient ID from DB:", data[0].recipient_id);
      console.log(" Current User ID:", userId);
      
      // ✅ CRITICAL FIX: Validate recipient_id before proceeding
      if (String(data[0].recipient_id) !== String(userId)) {
        console.warn("⚠️ SECURITY BLOCK: Options recipient_id mismatch!", {
          recipientIdFromDB: data[0].recipient_id,
          currentUserId: userId,
          chatId: chatId,
          optionId: data[0].id
        });
        console.warn("⚠️ BLOCKED: Not applying options - wrong recipient");
        return;
      }
      console.log("✅ Recipient ID validated - proceeding to apply options");
      
      const ctx = data[0].context_data || {};
      // ✅ FIX: Validate initial options same way as realtime handler
      const isInitialOptions = 
        ctx.isVeryFirstMessage === true && 
        (ctx.turnCount === 0 || ctx.turnCount === undefined) &&
        data[0].options.length >= 3 &&
        ctx.fallback !== true;
      
      const isFinalSubsequentOptions =
        data[0].options.length > 0 &&
        ctx.turnCount > 0 &&
        ctx.isVeryFirstMessage === false &&
        ctx.fallback !== true;
      
      const isValidOptions = isInitialOptions || isFinalSubsequentOptions;
      
      if (!isValidOptions) {
        console.log("⏳ Options found but not ready yet:", {
          isVeryFirstMessage: ctx.isVeryFirstMessage,
          turnCount: ctx.turnCount,
          optionsCount: data[0].options.length,
          fallback: ctx.fallback
        });
        // Enter waiting state and let realtime handler process when ready
        enterWaitingForOptions(userId);
        return;
      }
      
      const signature = `${data[0].id || ""}|${JSON.stringify(data[0].options || [])}`;
      if (signature && lastOptionsSignatureRef.current === signature) {
        console.log("ℹ️ Options already applied from initial fetch");
        resolveWaitingForOptions(userId);
        return;
      }
      const fetchedOptionId = data[0].id ? String(data[0].id) : null;
      const createdAtMs = data[0].created_at ? Date.parse(data[0].created_at) : Date.now();
      
      // ✅ FIX: For initial options (from Stage 4), always apply if valid
      // Don't block them based on timestamp since they're created before navigation
      if (isInitialOptions) {
        console.log("✅ Initial options from Stage 4 - applying immediately");
        // Apply initial options regardless of timestamp
      } else {
        // For subsequent options, check timestamp to avoid stale options
        const awaitingForCurrentUser =
          waitingForOptions &&
          pendingOptionsRecipientRef.current &&
          String(pendingOptionsRecipientRef.current) === String(userId);
        if (
          awaitingForCurrentUser &&
          pendingOptionsSinceRef.current &&
          createdAtMs < pendingOptionsSinceRef.current
        ) {
          console.log("ℹ️ Ignoring stale options while waiting for fresh batch (initial fetch)");
          return;
        }
        const shouldApplyOptions =
          !isPendingForCurrentUser ||
          !pendingOptionsSinceRef.current ||
          createdAtMs >= pendingOptionsSinceRef.current;
        if (!shouldApplyOptions) {
          console.log("ℹ️ Ignoring stale options while waiting for fresh batch (initial fetch)");
          return;
        }
      }
      lastOptionsSignatureRef.current = signature;
      // ✅ CRITICAL: Don't apply options if chat is closed
      if (isChatClosed) {
        console.log("🛑 Chat is closed - not applying options");
        resolveWaitingForOptions(userId);
        return;
      }
      const cleanedOptions = cleanOptionsForDisplay(data[0].options || [], contact?.full_name || null);
      console.log("✅ Applying initial options:", cleanedOptions);
      setSuggestedOptions(cleanedOptions);
      setShowSuggestedOptions(true);
      pendingOptionsSinceRef.current = null;
      resolveWaitingForOptions(userId);
      setLastOptionRefreshTime(Date.now());
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
      // ✅ FIX: Enter waiting state when no options found
      enterWaitingForOptions(userId);
      
      // ✅ FIX: For initial load (not force), retry once after a short delay
      // This handles cases where options are being generated but not yet in DB
      if (!force) {
        console.log("🔄 Retrying fetch after 2 seconds for initial options...");
        setTimeout(async () => {
          // Retry fetch once
          const { data: retryData, error: retryError } = await supabase
            .from("message_options")
            .select("id, options, context_data, recipient_id, created_at")
            .eq("chat_id", chatId)
            .eq("recipient_id", userId)
            .order("created_at", { ascending: false })
            .limit(1);
          
          if (!retryError && retryData && retryData.length > 0 && retryData[0].options && Array.isArray(retryData[0].options) && retryData[0].options.length >= 1) {
            const retryCtx = retryData[0].context_data || {};
            const retryIsInitialOptions = 
              retryCtx.isVeryFirstMessage === true && 
              (retryCtx.turnCount === 0 || retryCtx.turnCount === undefined) &&
              retryData[0].options.length >= 3 &&
              retryCtx.fallback !== true;
            
            if (retryIsInitialOptions) {
              console.log("✅ Initial options found on retry - applying");
              
              // ✅ CRITICAL FIX: Validate recipient_id before applying
              console.log("🔍 Retry validation - Recipient ID from DB:", retryData[0].recipient_id);
              console.log("🔍 Retry validation - Current User ID:", userId);
              if (String(retryData[0].recipient_id) !== String(userId)) {
                console.warn("⚠️ SECURITY BLOCK: Retry options recipient_id mismatch!", {
                  recipientIdFromDB: retryData[0].recipient_id,
                  currentUserId: userId,
                  chatId: chatId,
                  optionId: retryData[0].id
                });
                console.warn("⚠️ BLOCKED: Not applying retry options - wrong recipient");
                return;
              }
              console.log("✅ Retry recipient ID validated - proceeding to apply options");
              
              const retrySignature = `${retryData[0].id || ""}|${JSON.stringify(retryData[0].options || [])}`;
              if (retrySignature !== lastOptionsSignatureRef.current) {
                lastOptionsSignatureRef.current = retrySignature;
                // ✅ CRITICAL: Don't apply options if chat is closed
                if (isChatClosed) {
                  console.log("🛑 Chat is closed - not applying options from retry");
                  resolveWaitingForOptions(userId);
                  return;
                }
                const retryCleanedOptions = cleanOptionsForDisplay(retryData[0].options || [], contact?.full_name || null);
                setSuggestedOptions(retryCleanedOptions);
                setShowSuggestedOptions(true);
                resolveWaitingForOptions(userId);
                setLastOptionRefreshTime(Date.now());
                if (retryData[0].context_data) {
                  setAiPerspective(retryData[0].context_data.newPerspective || "");
                  setAiClosure(retryData[0].context_data.closure || "");
                }
              }
            }
          }
        }, 2000);
      } else {
        // Force mode - don't retry, just resolve
        resolveWaitingForOptions(userId);
        setOptionsGenerationFailed(true);
        // ✅ FIX: Only show notification if waiting state is for current user
        if (pendingOptionsRecipientRef.current && String(pendingOptionsRecipientRef.current) === String(userId)) {
          showNotification('warning', 'Options Delayed', 'Response options are taking longer than expected. They will appear when ready.');
        }
      }
    }
  };
  const ensureInitialOptions = async (chatId: string) => {
    if (!user) return;
    console.log("🔍 ENSURING INITIAL OPTIONS EXIST", { chatId, userId: user.id });
    try {
      const { data, error } = await supabase
        .from("message_options")
        .select("id, options, context_data, recipient_id")
        .eq("chat_id", chatId)
        .eq("recipient_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      
      // ✅ FIX: Validate initial options same way as other handlers
      if (!data || data.length === 0 || !data[0].options || data[0].options.length < 3) {
        console.log("ℹ️ No initial options found in DB — waiting for generation.");
        enterWaitingForOptions(String(user.id));
        // Set a timeout to stop waiting after 30 seconds (increased from 20)
        setTimeout(() => {
          // ✅ FIX: Only resolve and show notification if still waiting for this specific user
          if (pendingOptionsRecipientRef.current && String(pendingOptionsRecipientRef.current) === String(user.id)) {
            resolveWaitingForOptions(String(user.id));
            if (!showSuggestedOptions) {
              console.warn("⚠️ Options generation timeout after 30 seconds");
              showNotification('info', 'Options Delayed', 'You can send a message manually or wait for AI-generated options.');
            }
          }
        }, 30000);
        return;
      }
      
      const ctx = data[0].context_data || {};
      const optionsArray = Array.isArray(data[0].options) ? data[0].options : [];
      
      // ✅ FIX: Validate if options are valid initial options
      const isInitialOptions = 
        ctx.isVeryFirstMessage === true && 
        (ctx.turnCount === 0 || ctx.turnCount === undefined) &&
        optionsArray.length >= 3 &&
        ctx.fallback !== true;
      
      const isFinalSubsequentOptions =
        optionsArray.length > 0 &&
        ctx.turnCount > 0 &&
        ctx.isVeryFirstMessage === false &&
        ctx.fallback !== true;
      
      const isValidOptions = isInitialOptions || isFinalSubsequentOptions;
      
      if (!isValidOptions) {
        console.log("⏳ Options found but not valid yet:", {
          isVeryFirstMessage: ctx.isVeryFirstMessage,
          turnCount: ctx.turnCount,
          optionsCount: optionsArray.length,
          fallback: ctx.fallback,
          validated: ctx.validated
        });
        enterWaitingForOptions(String(user.id));
        // Wait for realtime handler to process when options become valid
        return;
      }
      
      console.log("✅ Valid initial options already exist", {
        isInitial: isInitialOptions,
        optionsCount: optionsArray.length
      });
      // ✅ FIX: Apply valid options directly if they exist
      // This handles the case where options exist but fetchInitialOptions hasn't found them yet
      const signature = `${data[0].id || ""}|${JSON.stringify(data[0].options || [])}`;
      if (signature !== lastOptionsSignatureRef.current) {
        // ✅ CRITICAL FIX: Validate recipient_id before applying
        console.log("🔍 ensureInitialOptions validation - Recipient ID from DB:", data[0].recipient_id);
        console.log("🔍 ensureInitialOptions validation - Current User ID:", user.id);
        if (String(data[0].recipient_id) !== String(user.id)) {
          console.warn("⚠️ SECURITY BLOCK: ensureInitialOptions recipient_id mismatch!", {
            recipientIdFromDB: data[0].recipient_id,
            currentUserId: user.id,
            chatId: chatId,
            optionId: data[0].id
          });
          console.warn("⚠️ BLOCKED: Not applying options from ensureInitialOptions - wrong recipient");
          return;
        }
        console.log("✅ ensureInitialOptions recipient ID validated - proceeding to apply options");
        
        lastOptionsSignatureRef.current = signature;
        // ✅ CRITICAL: Don't apply options if chat is closed
        if (isChatClosed) {
          console.log("🛑 Chat is closed - not applying options from ensureInitialOptions");
          resolveWaitingForOptions(String(user.id));
          return;
        }
        const cleanedOptions = cleanOptionsForDisplay(data[0].options || [], contact?.full_name || null);
        console.log("✅ Applying valid options from ensureInitialOptions:", cleanedOptions);
        setSuggestedOptions(cleanedOptions);
        setShowSuggestedOptions(true);
        resolveWaitingForOptions(String(user.id));
        setLastOptionRefreshTime(Date.now());
        if (data[0].context_data) {
          setAiPerspective(data[0].context_data.newPerspective || "");
          setAiClosure(data[0].context_data.closure || "");
          if (data[0].context_data.conversationStage) {
            setConversationStage(data[0].context_data.conversationStage);
          }
          if (data[0].context_data.turnCount !== undefined) {
            setTurnCount(data[0].context_data.turnCount);
          }
        }
      } else {
        // Options already applied, just resolve waiting
        resolveWaitingForOptions(String(user.id));
      }
    } catch (err) {
      console.error("❌ ensureInitialOptions error:", err);
      enterWaitingForOptions(user ? String(user.id) : undefined);
    }
  };
  // ---- realtime: options ----
  const subscribeToOptions = (chatId: string, currentUserId: string) => {
    console.log("🔔 SETTING UP OPTIONS SUBSCRIPTION", { chatId, currentUserId });
    const handleOptionsUpdate = (payload: any) => {
      const row = payload.new;
      if (!row) return;
      if (row.chat_id && row.chat_id !== chatId) {
        return;
      }

      const recipientId = String(row.recipient_id || "");
      console.log("🔍 Realtime subscription - Recipient ID from payload:", recipientId);
      console.log("🔍 Realtime subscription - Current User ID:", currentUserId);
      
      // ✅ Security check: Only proceed if options are for current user
      // Silently ignore options for other user (no notice, no display)
      if (recipientId !== String(currentUserId)) {
        console.log("ℹ️ Options received for other user - silently ignoring (no notice)");
        return; // Don't show anything to current user for other user's options
      }
      
      const ctx = row.context_data || {};
      const optionsArray = Array.isArray(row.options) ? row.options : [];
      
      // ✅ FIX: Handle both initial options (from Stage 4) and subsequent options
      const isInitialOptions = 
        ctx.isVeryFirstMessage === true && 
        (ctx.turnCount === 0 || ctx.turnCount === undefined) &&
        optionsArray.length >= 3 && // Initial options should have at least 3 (or 5)
        ctx.fallback !== true;
      
      const isFinalSubsequentOptions =
        optionsArray.length > 0 &&
        ctx.turnCount > 0 &&
        ctx.isVeryFirstMessage === false &&
        ctx.fallback !== true;
      
      const isFinal = isInitialOptions || isFinalSubsequentOptions;

      if (!isFinal) {
        console.log("⏳ Options not ready yet:", { 
          isVeryFirstMessage: ctx.isVeryFirstMessage,
          turnCount: ctx.turnCount,
          optionsCount: optionsArray.length,
          fallback: ctx.fallback
        });
        enterWaitingForOptions(currentUserId);
        return;
      }

      console.log("✅ Final validated options received for", recipientId, {
        isInitial: isInitialOptions,
        isSubsequent: isFinalSubsequentOptions,
        optionsCount: optionsArray.length
      });
      lastOptionsSignatureRef.current = `${row.id || ""}|${JSON.stringify(row.options || [])}`;

      // ✅ CRITICAL: Don't apply options if chat is closed
      if (isChatClosed) {
        console.log("🛑 Chat is closed - not applying options from realtime subscription");
        resolveWaitingForOptions(recipientId);
        return;
      }
      const cleanedOptions = cleanOptionsForDisplay(optionsArray, contact?.full_name || null);
      setSuggestedOptions(cleanedOptions);
      setShowSuggestedOptions(true);
      resolveWaitingForOptions(recipientId);
      setLastOptionRefreshTime(Date.now());

      if (row.context_data) {
        setAiPerspective(row.context_data.newPerspective || "");
        setAiClosure(row.context_data.closure || "");
      }
    };
    const channel = supabase
      .channel(`options-${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_options",
          // ✅ FIX: Listen for ALL options in the chat (not just current user's)
          filter: `chat_id=eq.${chatId}`,
        },
        handleOptionsUpdate
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_options",
          // ✅ FIX: Listen for ALL options in the chat (not just current user's)
          filter: `chat_id=eq.${chatId}`,
        },
        handleOptionsUpdate
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_options",
          // ✅ FIX: Listen for ALL options in the chat (not just current user's)
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const recipientId = String(payload.old?.recipient_id || "");
          // ✅ Only handle deletions for current user
          if (recipientId !== String(currentUserId)) {
            console.log("ℹ️ Options deleted for other user - silently ignoring");
            return; // Don't show anything to current user
          }
          console.log("🧹 Options deleted for current user - waiting for regenerated set");
          lastOptionsSignatureRef.current = null;
          enterWaitingForOptions(recipientId);
        }
      )
      .subscribe((status) => {
        console.log("📡 Options subscription status:", status);
      });
    return () => {
      console.log("🔌 Unsubscribing from options channel");
      supabase.removeChannel(channel);
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
          // FIX: Removed duplicate if-block; consolidated logic
          if (updatedChat.closure_state === 'closed' && updatedChat.is_resolved) {
            console.log("🎉 Both smileys detected → showing closure banner");
            // ✅ FIX: Immediately hide options when chat closes
            setIsChatClosed(true);
            setShowSuggestedOptions(false);
            setSuggestedOptions([]);
            resolveWaitingForOptions(String(user?.id || ''));
            setIsResolved(true);
            showNotification('success', 'Conversation Closed', '🌈 This conversation has peacefully concluded.');
            // FIX: Stop before new anim to clear native state
            closureAnim.stopAnimation();
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
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  };
  // ---- realtime: messages ----
  const subscribeToMessages = (chatId: string, currentUserId: string) => {
    // ✅ FIX: Prevent duplicate subscriptions
    if (messageSubscriptionRef.current) {
      console.log("ℹ️ Using existing message subscription");
      return;
    }

    console.log("\n" + "🔔".repeat(30));
    console.log("📡 SETTING UP MESSAGE SUBSCRIPTION");
    console.log(" Chat ID:", chatId);
    console.log(" Current User ID:", currentUserId);
    console.log(" Filter:", `chat_id=eq.${chatId}`);
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
          console.log("📨 LIVE MESSAGE RECEIVED:", newMsg.content);
          console.log("\n" + "📨".repeat(30));
          console.log("📬 NEW MESSAGE RECEIVED VIA REALTIME");
          console.log(" Message ID:", newMsg.id);
          console.log(" Sender ID:", newMsg.sender_id);
          console.log(" Current User ID:", currentUserId);
          console.log(" Content:", newMsg.content?.substring(0, 50));
          console.log(" Is from current user?", newMsg.sender_id === currentUserId);
          console.log(" Will display as:", newMsg.sender_id === currentUserId ? "user" : "contact");
          console.log("📨".repeat(30) + "\n");
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === newMsg.id);
            console.log(" Message already in list?", exists);
            if (exists) return prev;
            const newMessage: Message = {
              id: newMsg.id,
              content: newMsg.content,
              sender_type: (newMsg.sender_id === currentUserId ? "user" : "contact") as "user" | "contact",
              sender_id: newMsg.sender_id,
              created_at: newMsg.created_at,
            };
            console.log(" ✅ Adding message to list as:", newMessage.sender_type);
            return [...prev, newMessage];
          });
          setTimeout(() => {
            scrollToBottom();
          }, 150);
          const messageFromOtherUser = String(newMsg.sender_id) !== String(currentUserId);
          if (messageFromOtherUser) {
            console.log("🧹 New message from other user → waiting for fresh options");
            enterWaitingForOptions(currentUserId);
            lastOptionsSignatureRef.current = null;
          }
          // CONTACT replied → generate options for current user
          console.log(" Checking if should generate options...");
          console.log(" newMsg.sender_id:", newMsg.sender_id);
          console.log(" contactId:", contactId);
          console.log(" contactId type:", typeof contactId);
          console.log(" Matches?", newMsg.sender_id === contactId);
          console.log(" Matches (string)?", String(newMsg.sender_id) === String(contactId));
          if (String(newMsg.sender_id) === String(contactId)) {
            // ✅ CRITICAL: Check if conversation is closed before generating options
            const { data: closureCheck } = await supabase
              .from("chats")
              .select("is_resolved, closure_state")
              .eq("id", currentChatId)
              .single();

            if (closureCheck?.is_resolved === true && closureCheck?.closure_state === 'closed') {
              console.log("🛑 Conversation is closed - skipping option generation");
              resolveWaitingForOptions(currentUserId);
              return;
            }
            
            console.log("\n" + "=".repeat(60));
            console.log("📤 CONTACT REPLIED - GENERATING OPTIONS FOR CURRENT USER");
            console.log("=".repeat(60));
            console.log("📬 Contact's message (currentMessage):", newMsg.content.substring(0, 80));
            
            // ✅ FIX: Fetch chat context FIRST to determine recipient before entering waiting state
            const { data: chatCtx } = await supabase
              .from("chats")
              .select("context_data, user_id, contact_id, closure_state, user_a_smiley_sent, user_b_smiley_sent, conversation_phase")
              .eq("id", chatId)
              .single();
            
            // ✅ FIX: Determine recipient based on who sent the message (NOT currentUserId)
            const senderId = String(newMsg.sender_id);
            const recipientIdForOptions =
              senderId === String(chatCtx?.contact_id)
                ? String(chatCtx?.user_id)      // User B sent → options for User A
                : String(chatCtx?.contact_id);  // User A sent → options for User B

            console.log("🔍 Corrected Recipient:", {
              senderId,
              chatUserA: chatCtx?.user_id,
              chatUserB: chatCtx?.contact_id,
              recipientIdForOptions
            });
            
            // ✅ CRITICAL FIX: Enter waiting state with recipientIdForOptions, not currentUserId
            // This ensures the correct user sees the composing notice and receives options
            enterWaitingForOptions(recipientIdForOptions);
            
            const conversationHistory = buildHistory({
              sender_id: String(newMsg.sender_id),
              content: String(newMsg.content || ""),
            });
            
            const isCurrentUserA = currentUserId === chatCtx?.user_id;
            console.log("💾 Context data being sent to validation:");
            console.log(" Role:", isCurrentUserA ? "User A" : "User B");
            console.log(" Summary:", (isCurrentUserA ? chatCtx?.context_data?.summary_a : chatCtx?.context_data?.summary_b)?.substring(0, 50) || "❌ MISSING");
            console.log(" Thoughts:", (isCurrentUserA ? chatCtx?.context_data?.thoughts_a : chatCtx?.context_data?.thoughts_b)?.substring(0, 50) || "❌ MISSING");
            console.log(" Hint from B:", chatCtx?.context_data?.hint_from_b?.substring(0, 50) || "⚠️ Not provided");
            console.log(" History length:", conversationHistory.length);
            const summaryA = chatCtx?.context_data?.summary_a || chatCtx?.context_data?.summary || "";
            const thoughtsA = chatCtx?.context_data?.thoughts_a || chatCtx?.context_data?.thoughts || "";
            const summaryB = chatCtx?.context_data?.summary_b || "";
            const thoughtsB = chatCtx?.context_data?.thoughts_b || "";
            const summaryToSend = isCurrentUserA ? summaryA : (summaryB || summaryA);
            const thoughtsToSend = isCurrentUserA ? thoughtsA : (thoughtsB || thoughtsA);
            
            // 🌙 Closure blending start
            // Compute closure stage for progressive option blending
            const closureState = chatCtx?.closure_state || 'active';
            const userASmileySent = chatCtx?.user_a_smiley_sent || false;
            const userBSmileySent = chatCtx?.user_b_smiley_sent || false;
            const conversationPhaseFromCtx = chatCtx?.conversation_phase || conversationPhase;
            const closureStage = computeClosureStage(
              closureState,
              userASmileySent,
              userBSmileySent,
              conversationPhaseFromCtx,
              conversationHistory
            );
            console.log("🌙 Closure stage computed (message subscription):", {
              closureState,
              userASmileySent,
              userBSmileySent,
              conversationPhase: conversationPhaseFromCtx,
              closureStage,
              historyLength: conversationHistory.length
            });
            // 🌙 Closure blending end
            
            console.log("📤 Generating options with FULL context:");
            console.log(" Original Issue (User A):", summaryA.substring(0, 60));
            console.log(" Recipient context:", summaryToSend.substring(0, 60));
            // 🧠 STEP 1: Call orchestrate-conversation FIRST to get intelligent guidance
            console.log("🧠 ORCHESTRATION: Calling orchestrate-conversation for intelligent coordination...");
            let orchestrationGuidance = null;
            try {
              const { data: orchData, error: orchError } = await supabase.functions.invoke(
                "orchestrate-conversation",
                {
                  body: {
                    chatId,
                    recipientId: recipientIdForOptions, // ✅ FIX: Use recipientIdForOptions instead of currentUserId
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
                    conversationPhase,
                    resolutionDetected: false,
                    lastMessageTimestamp: newMsg.created_at,
                    wordLimit: 15,
                  },
                }
              );
              if (orchError) {
                console.error("❌ Orchestration guidance failed:", orchError);
              } else {
                orchestrationGuidance = orchData?.guidance ?? null;
                console.log("✅ Orchestration guidance received:", orchestrationGuidance);
              }
            } catch (orchCallError) {
              console.error("💥 Orchestration call failed:", orchCallError);
            }
            // 🧠 STEP 2: Generate contextual options with Claude (orchestration guidance included)
            console.log("🧠 CLAUDE: Generating contextual options (with fallbacks)...");
            try {
              const { error } = await supabase.functions.invoke(
                "generate-contextual-options",
                {
                  body: {
                    chatId,
                    recipientId: recipientIdForOptions, // ✅ FIX: Use recipientIdForOptions instead of currentUserId
                    currentUserId,
                    summary: summaryToSend,
                    thoughts: thoughtsToSend,
                    summary_shared_neutral: chatCtx?.context_data?.summary_shared_neutral || "",
                    summaryB,
                    thoughtsB,
                    conversationHistory,
                    contactCategory: contact?.category || "General",
                    orchestrationGuidance,
                    // ✅ CRITICAL: Always pass hintFromB for context, but edge function MUST enforce perspective isolation based on recipientId
                    hintFromB: chatCtx?.context_data?.hint_from_b || "",
                    hintToContact: chatCtx?.context_data?.hint_to_contact || null,
                    conversationPhase,
                    lastMessage: newMsg.content || "",
                    isVeryFirstMessage: false,
                    // 🌙 Closure blending start
                    closureState: closureState,
                    userASmileySent: userASmileySent,
                    userBSmileySent: userBSmileySent,
                    closureStage: closureStage,
                    // 🌙 Closure blending end
                  },
                }
              );
              if (error) {
                console.error("❌ Failed to generate options:", error);
                showNotification('error', 'Options Failed', 'Could not generate response options. You can type manually.');
                resolveWaitingForOptions(recipientIdForOptions); // ✅ FIX: Use recipientIdForOptions
              } else {
                console.log("✅ Options generation request sent with original issue context");
              }
            } catch (generationError) {
              console.error("💥 ERROR generating options:", generationError);
              showNotification('error', 'Options Failed', 'Could not generate response options. Please try again.');
              resolveWaitingForOptions(recipientIdForOptions); // ✅ FIX: Use recipientIdForOptions
            }
          }
        }
      )
      .subscribe((status: string) => {
        switch (status) {
          case "SUBSCRIBED":
            console.log("📡 Messages connected");
            break;

          case "CHANNEL_ERROR":
            console.warn("⚠️ Real-time channel error (dev only). App continues normally.");
            break;

          case "TIMED_OUT":
            console.warn("⏱️ Real-time timeout (dev only). Auto-reconnect will handle.");
            break;

          case "CLOSED":
            console.warn("🔌 Real-time closed (dev only). Auto-reconnect pending.");
            messageSubscriptionRef.current = null;
            break;

          default:
            console.log("📡 Status:", status);
        }
      });
    
    // ✅ FIX: Store channel reference
    messageSubscriptionRef.current = channel;
    
    return () => {
      if (messageSubscriptionRef.current) {
        try {
          supabase.removeChannel(messageSubscriptionRef.current);
          console.log("🧹 Cleaned up message subscription");
        } catch (e: any) {
          console.warn("⚠️ Cleanup error (dev only):", e.message);
        }
      }
      messageSubscriptionRef.current = null;
    };
  };
  // 🌙 Closure blending start
  // Helper function to compute closure stage based on conversation state
  const computeClosureStage = (
    closureState: string | null | undefined,
    userASmileySent: boolean,
    userBSmileySent: boolean,
    conversationPhase: string,
    conversationHistory: Array<{ sender_id: string; content: string }>
  ): "active" | "early_closure" | "mid_closure" | "final_closure" => {
    // Default to active if uncertain
    if (!closureState || closureState === 'active' || closureState === 'closed') {
      return "active";
    }

    // Count closure-related signals in recent conversation history
    const CLOSURE_SMILEYS = ["👍", "🙂", "🤝", "❤️", "😊", "💖", "🌟", "✨", "🙏", "💞"];
    const recentMessages = conversationHistory.slice(-5); // Last 5 messages
    const closureSignals = recentMessages.filter(msg => {
      const content = msg.content?.trim() || "";
      // Check for smileys
      if (CLOSURE_SMILEYS.some(smiley => content === smiley)) return true;
      // Check for closure-related phrases
      const lower = content.toLowerCase();
      if (lower.includes('thanks') || lower.includes('thank you') || 
          lower.includes('appreciate') || lower.includes('grateful') ||
          lower.includes('sounds good') || lower.includes('works for me') ||
          lower.includes('all set') || lower.includes('resolved')) return true;
      return false;
    }).length;

    // Determine stage based on closure state and signals
    if (closureState === 'pending_user_a_smiley' || closureState === 'pending_user_b_smiley') {
      // One user has sent a smiley - check how close we are
      if (userASmileySent && userBSmileySent) {
        // Both sent smileys but not closed yet - final stage
        return "final_closure";
      } else if (closureSignals >= 3 || conversationPhase === 'resolution') {
        // Multiple closure signals or in resolution phase - mid stage
        return "mid_closure";
      } else {
        // Early closure - one smiley sent but few signals
        return "early_closure";
      }
    }

    // If conversation phase suggests closure
    if (conversationPhase === 'resolution' && closureSignals >= 2) {
      return closureSignals >= 3 ? "mid_closure" : "early_closure";
    }

    // Default to active
    return "active";
  };
  // 🌙 Closure blending end

  // ---- send message ----
  const sendMessage = async (messageContent: string) => {
    const content = messageContent.trim();
    if (!content || !currentChatId || loading) return;
      // ← ADD THIS LINE
      hasSentMessage.current = true;
    // Check if conversation is already resolved
    const { data: chatCheck } = await supabase
      .from("chats")
      .select("is_resolved, closure_state, user_id, contact_id, user_a_smiley_sent, user_b_smiley_sent, ai_source_chat_id")
      .eq("id", currentChatId)
      .single();
    if (chatCheck?.is_resolved && chatCheck?.closure_state === 'closed') {
      console.log("🛑 Conversation is already closed - preventing new messages");
      showNotification('info', 'Conversation Closed', 'This conversation has been completed and closed.');
      return;
    }
    console.log("\n" + "🚀".repeat(30));
    console.log("📤 SENDING MESSAGE");
    console.log(" From User ID:", user?.id);
    console.log(" To Chat ID:", currentChatId);
    console.log(" Content:", content.substring(0, 50));
    console.log("🚀".repeat(30) + "\n");
    setLoading(true);
    setShowSuggestedOptions(false);
    
    // ✅ CRITICAL FIX: Determine recipient based on who is sending
    // If current user is User A (user_id), recipient is User B (contact_id)
    // If current user is User B (contact_id), recipient is User A (user_id)
    let recipientId: string | null = null;
    if (chatCheck) {
      const isCurrentUserA = user?.id === chatCheck.user_id;
      recipientId = isCurrentUserA 
        ? String(chatCheck.contact_id)  // User A sends to User B
        : String(chatCheck.user_id);    // User B sends to User A
      
      console.log("✅ RECIPIENT ID DETERMINATION:", {
        currentUserId: user?.id,
        chatUserA: chatCheck.user_id,
        chatContactB: chatCheck.contact_id,
        isCurrentUserA,
        recipientId,
        recipientIsUserA: recipientId === String(chatCheck.user_id),
        recipientIsUserB: recipientId === String(chatCheck.contact_id)
      });
    } else {
      // Fallback to old logic if chatCheck not available
      recipientId = contactId ? String(contactId) : null;
      console.warn("⚠️ Using fallback recipientId (chatCheck not available):", recipientId);
    }
    try {
      // ✅ CRITICAL: Check if this will be the first message and mark source AI chat
      let isFirstMessage = false;
      if (chatCheck) {
        const { count: existingMessageCount } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("chat_id", currentChatId);
        
        isFirstMessage = (existingMessageCount || 0) === 0;
        
        // If this will be the first message and there's a source AI chat, mark it
        if (isFirstMessage && chatCheck.ai_source_chat_id) {
          const { data: sourceChat } = await supabase
            .from("chats")
            .select("context_data")
            .eq("id", chatCheck.ai_source_chat_id)
            .eq("chat_type", "ai_assistant")
            .single();
          
          if (sourceChat?.context_data) {
            await supabase
              .from("chats")
              .update({
                context_data: {
                  ...sourceChat.context_data,
                  sent_to_contact: true, // ✅ Mark as sent when first message is sent
                },
              })
              .eq("id", chatCheck.ai_source_chat_id)
              .eq("chat_type", "ai_assistant");
            console.log("✅ Marked source AI chat as sent_to_contact: true");
          }
        }
      }

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
      console.log(" Message ID:", data.id);
      if (recipientId) {
        try {
          // Fetch current chat to check initial_pending flag (first delivery after Stage-4)
          const { data: chatRow } = await supabase
            .from("chats")
            .select("id, context_data")
            .eq("id", currentChatId)
            .single();

          const wasInitialPending = !!chatRow?.context_data?.initial_pending;

          const senderDisplay =
            (user?.user_metadata as any)?.full_name ||
            user?.email?.split("@")[0] ||
            "Someone";
          const preview =
            content.length > 120 ? `${content.slice(0, 117)}…` : content;

          await supabase.from("notifications").insert({
            user_id: recipientId,
            type: wasInitialPending ? "chat_request" : "message",
            title: `${senderDisplay} sent you a message`,
            message: preview || "New message waiting for you.",
            data: {
              chat_id: currentChatId,
              sender_id: user?.id,
              sender_name: senderDisplay,
              message_preview: preview,
              issue: chatContext?.context_data?.hint_to_contact?.issue || null,
              timeline:
                chatContext?.context_data?.hint_to_contact?.timeline || null,
            },
          });

          // Flip initial_pending=false after first delivery
          if (wasInitialPending) {
            await supabase
              .from("chats")
              .update({
                context_data: {
                  ...(chatRow?.context_data || {}),
                  initial_pending: false,
                },
              })
              .eq("id", currentChatId);
            console.log("✅ initial_pending=false after first delivered message");
          }
        } catch (notifyError) {
          console.error(
            "⚠️ Failed to enqueue notification for contact message:",
            notifyError
          );
        }
      }
      // 😊 Mutual smiley detection for proper closure
      const CLOSURE_SMILEYS = ["👍", "🙂", "🤝", "❤️", "😊", "💖", "🌟", "✨", "🙏", "💞"];
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
            // ✅ FIX: Immediately hide options and stop generating new ones
            setShowSuggestedOptions(false);
            setSuggestedOptions([]);
            resolveWaitingForOptions(String(user?.id || ''));
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
              const summaryA = contextData.summary_a_perspective || contextData.summary_a || contextData.summary || '';
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
      } else if (chatCheck) {
        if (
          chatCheck.user_a_smiley_sent ||
          chatCheck.user_b_smiley_sent ||
          chatCheck.closure_state !== 'active'
        ) {
          const resetData: Record<string, any> = {
            user_a_smiley_sent: false,
            user_b_smiley_sent: false,
            closure_state: 'active',
            is_resolved: false,
          };
          await supabase
            .from("chats")
            .update(resetData)
            .eq("id", currentChatId);
        }
      }
      let chatData = chatContext;
      if (!chatData) {
        const { data: fetched } = await supabase
          .from("chats")
          .select("user_id, contact_id, context_data, ai_source_chat_id, session_name, ai_confidence_level, conversation_phase, is_resolved, user_a_smiley_sent, user_b_smiley_sent, closure_state")
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
      if (recipientId) {
        enterWaitingForOptions(recipientId);
      }
      const conversationHistory = buildHistory({
        sender_id: String(user?.id || ""),
        content,
      }) || []; // ✅ Ensure it's always an array
      
      // 🌙 Closure blending start
      // Compute closure stage for progressive option blending
      const closureState = (chatData as any).closure_state || 'active';
      const userASmileySent = (chatData as any).user_a_smiley_sent || false;
      const userBSmileySent = (chatData as any).user_b_smiley_sent || false;
      const closureStage = computeClosureStage(
        closureState,
        userASmileySent,
        userBSmileySent,
        conversationPhase,
        conversationHistory
      );
      console.log("🌙 Closure stage computed:", {
        closureState,
        userASmileySent,
        userBSmileySent,
        conversationPhase,
        closureStage,
        historyLength: conversationHistory.length
      });
      // 🌙 Closure blending end
      // ✅ FIX: Determine if current user is User A or User B to send correct context
      const isCurrentUserA = user?.id === chatData.user_id;
      // ✅ FIX: Use fresh context from database, not stale component state
      // Send User A's context when generating options for User B
      // ✅ CRITICAL: For option generation, BOTH users MUST use summary_shared_neutral (factual, third-person)
      // ❌ NEVER use summary_a_perspective for options - that's ONLY for Stage 3 UI
      // ❌ NEVER use summary_b for options - removed completely
      const summarySharedNeutral = chatData.context_data?.summary_shared_neutral || "";
      const thoughtsA = chatData.context_data?.thoughts_a || chatData.context_data?.thoughts || "";
      const thoughtsB = chatData.context_data?.thoughts_b || "";
      
      // Determine recipient's context
      const isRecipientUserA = recipientId === chatData.user_id;
      
      // ✅ CRITICAL: BOTH User A and User B MUST use summary_shared_neutral for option generation
      // ❌ User A should NEVER use summary_a_perspective (emotional) for option generation
      // ❌ summary_b removed - both users now use summary_shared_neutral
      // summary_a_perspective is ONLY shown in Stage 3 UI, NEVER used for chat options
      const recipientSummary = summarySharedNeutral; // ✅ BOTH users use summary_shared_neutral
      const recipientThoughts = isRecipientUserA ? thoughtsA : thoughtsB;
      
      if (!recipientSummary) {
        console.warn(`⚠️ WARNING: summary_shared_neutral missing for ${isRecipientUserA ? "User A" : "User B"} options!`);
      } else {
        console.log(`✅ For ${isRecipientUserA ? "User A" : "User B"}: Using summary_shared_neutral for option generation (factual, third-person)`);
        console.log(`   Summary preview: ${recipientSummary.substring(0, 100)}`);
        console.log("   Note: summary_a_perspective is NEVER used for option generation");
        console.log("   Note: summary_b removed - both users now use summary_shared_neutral");
      }
      
      // ✅ FIX: Check if chat is closed before generating options
      if (chatData.is_resolved && chatData.closure_state === 'closed') {
        console.log("🛑 Chat is closed - skipping option generation");
        setLoading(false);
        resolveWaitingForOptions(recipientId || '');
        return;
      }

      console.log("💾 Context data being sent to edge function:", {
        currentUserRole: isCurrentUserA ? "User A" : "User B",
        recipientRole: isRecipientUserA ? "User A" : "User B",
        recipientSummaryType: "summary_shared_neutral (BOTH users)",
        recipientSummary: recipientSummary?.substring(0, 50) || "❌ MISSING",
        hasSummarySharedNeutral: !!summarySharedNeutral,
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
              summary_shared_neutral: summarySharedNeutral || "",
              thoughtsB: thoughtsB,
              // ✅ CRITICAL: Always pass hintFromB for context, but edge function MUST enforce perspective isolation based on recipientId
              // recipientId determines the perspective - hints are shared for empathy but POV remains locked
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
            recipientId, // ✅ CRITICAL: This determines perspective isolation - edge function MUST use this to generate correct POV
            currentUserId: user?.id,
            currentMessage: String(content || ""), // ✅ CRITICAL: User's latest message for recipient to respond to
            summary: recipientSummary || "",
            thoughts: recipientThoughts || "",
            summary_shared_neutral: summarySharedNeutral || "",
            recipientSummary: recipientSummary || "",
            // ✅ CRITICAL: Always pass hintFromB for context, but edge function MUST enforce perspective isolation based on recipientId
            // recipientId === chatData.user_id → User A perspective (acknowledge hint, express own side)
            // recipientId === chatData.contact_id → User B perspective (use hint as own context)
            hint_from_b: chatData.context_data?.hint_from_b || '',
            // ✅ CRITICAL: Always pass User A's original issue context (for backward compatibility only)
            originalIssue: {
              summary: chatData.context_data?.summary_a_perspective || chatData.context_data?.summary_a || chatData.context_data?.summary || "",
              thoughts: thoughtsA,
            },
            // ✅ CRITICAL: Always pass hintFromB for context, but edge function MUST enforce perspective isolation based on recipientId
            // recipientId === chatData.user_id → User A perspective (acknowledge hint, express own side)
            // recipientId === chatData.contact_id → User B perspective (use hint as own context)
            hintFromB: chatData.context_data?.hint_from_b || "",
            hintToContact: chatData.context_data?.hint_to_contact || null,
            thoughtsB: thoughtsB || "",
            conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
            isInitial: false,
            contactCategory: contact?.category || "General",
            conversationPhase: conversationPhase,
            resolutionDetected: false,
            // 🌙 Closure blending start
            closureState: closureState,
            userASmileySent: userASmileySent,
            userBSmileySent: userBSmileySent,
            closureStage: closureStage,
            // 🌙 Closure blending end
            lastMessageTimestamp: data.created_at, // ⏰ For timing-aware context
            wordLimit: 15, // ✅ Pass word limit
          },
        }
      );
      if (funcError) {
        console.error("❌ Edge function error:", funcError);
        console.error(" Error details:", JSON.stringify(funcError, null, 2));
        console.error(" Chat ID:", currentChatId);
        console.error(" Recipient ID (User B):", recipientId);
        console.error(" Current User ID (User A):", user?.id);
       
        // ✅ Don't block the chat flow - allow manual typing
        showNotification('error', 'Options Failed', 'Could not generate response options. You can type manually.');
        resolveWaitingForOptions(recipientId);
        // Don't throw - allow user to continue chatting manually
      } else {
        console.log("✅ Options generation completed for recipient:", recipientId);
        console.log(" Original issue context: INCLUDED");
        console.log(" Options will be validated and context-aware");
        console.log(" User B should see these options in their chat screen");
        console.log("=".repeat(60) + "\n");
      }
    } catch (err) {
      console.error("❌ Error sending message:", err);
      resolveWaitingForOptions(recipientId);
      Alert.alert("Error", "Failed to send message");
    } finally {
      setLoading(false);
    }
  };
  const handleSuggestedOptionPress = (option: string, index: number) => {
    hasSentMessage.current = true;
    triggerOptionSelectVisuals(index);
    setTimeout(() => {
      setShowSuggestedOptions(false);
      
      // ✅ FIX: Check if option is a single smiley - if so, send it alone without blending
      const trimmedOption = option.trim();
      const CLOSURE_SMILEYS = ["👍", "🙂", "🤝", "❤️", "😊", "💖", "🌟", "✨", "🙏", "💞"];
      const isSingleSmiley = CLOSURE_SMILEYS.includes(trimmedOption);
      
      if (isSingleSmiley) {
        console.log('😊 Single smiley option detected - sending without acknowledgment:', trimmedOption);
        sendMessage(trimmedOption);
        return;
      }
      
      // ✅ Lightweight blending layer: Get latest message from other person
      const otherPersonMessages = messages.filter(
        (msg) => msg.sender_id !== user?.id
      );
      const latestOtherMessage = otherPersonMessages[otherPersonMessages.length - 1];
      
      // ✅ Helper function to blend acknowledgment with option naturally
      // Format: "Acknowledgment. Main suggestion."
      const blendAcknowledgment = (acknowledgment: string, originalOption: string): string => {
        const ackTrimmed = acknowledgment.trim();
        const optionTrimmed = originalOption.trim();
        
        // Ensure acknowledgment ends with proper punctuation
        let ack = ackTrimmed;
        if (!/[.!]$/.test(ack)) {
          ack = ack + '.';
        }
        
        // Capitalize option if needed
        let opt = optionTrimmed;
        if (/^[a-z]/.test(opt)) {
          opt = opt.charAt(0).toUpperCase() + opt.slice(1);
        }
        
        // Blend: "Acknowledgment. Main suggestion."
        return `${ack} ${opt}`;
      };
      
      // ✅ Determine natural acknowledgment based on emotional tone of latest message
      let finalMessage = option;
      if (latestOtherMessage && latestOtherMessage.content) {
        const prevMessage = latestOtherMessage.content.trim();
        const prevMessageLower = prevMessage.toLowerCase();
        
        // Check if option already has natural acknowledgment
        const optionLower = option.toLowerCase();
        const hasAcknowledgment = (
          optionLower.startsWith('yeah') ||
          optionLower.startsWith('that makes sense') ||
          optionLower.startsWith('oh okay') ||
          optionLower.startsWith('got it') ||
          optionLower.startsWith('i see') ||
          optionLower.startsWith('thanks for') ||
          optionLower.startsWith('okay') ||
          optionLower.startsWith('alright') ||
          optionLower.startsWith('i get') ||
          optionLower.startsWith('i understand') ||
          optionLower.startsWith('makes sense') ||
          optionLower.startsWith('that helps') ||
          /^(ok|okay|sure|yeah|yes),/i.test(option.trim())
        );
        
        // Only add acknowledgment if it's missing
        if (!hasAcknowledgment) {
          let acknowledgment = '';
          
          // ✅ Detect emotional tone of the message
          const isSad = /(sad|hurt|upset|disappointed|frustrated|down|depressed|lonely|broken|heartbroken|tears|crying|painful|pain)/i.test(prevMessage);
          const isAngry = /(angry|mad|furious|annoyed|irritated|pissed|rage|hate|resent|fuming)/i.test(prevMessage);
          const isConfused = /(confused|don't understand|don't get|unclear|not sure|what do you mean|huh|puzzled|confusing)/i.test(prevMessage);
          const isGrateful = /(thank|thanks|appreciate|grateful|means a lot)/i.test(prevMessage);
          const isApologetic = /(sorry|apologize|my bad|forgive|regret)/i.test(prevMessage);
          const isQuestion = prevMessage.includes('?');
          const isHowAreYou = /(how are you|how are|how're)/i.test(prevMessage);
          
          // ✅ Select natural acknowledgment based on tone (NO robotic phrases)
          if (isHowAreYou) {
            acknowledgment = "I'm okay, but";
          } else if (isGrateful) {
            acknowledgment = "You're welcome";
          } else if (isApologetic) {
            // Response to apology - soft and accepting
            acknowledgment = "Okay, I understand";
          } else if (isSad) {
            // Response to sadness - soft and reassuring
            const sadAcks = [
              "I get what you mean",
              "That makes sense",
              "Thanks for sharing that",
              "I see what you mean"
            ];
            acknowledgment = sadAcks[Math.floor(Math.random() * sadAcks.length)];
          } else if (isAngry) {
            // Response to anger - grounded and calm
            const angryAcks = [
              "Okay, I see what you mean",
              "Got it",
              "I understand",
              "Alright, that helps"
            ];
            acknowledgment = angryAcks[Math.floor(Math.random() * angryAcks.length)];
          } else if (isConfused) {
            // Response to confusion - clarifying
            const confusedAcks = [
              "Oh okay, I get it now",
              "I see what you mean",
              "Got it",
              "Okay, I understand"
            ];
            acknowledgment = confusedAcks[Math.floor(Math.random() * confusedAcks.length)];
          } else if (isQuestion) {
            // Response to question
            if (prevMessageLower.match(/^(what|why|when|where|how|who|can|could|would|will|do|did|does)/)) {
              acknowledgment = "Thanks for asking";
            } else {
              acknowledgment = "Oh okay, I get it";
            }
          } else {
            // Default for normal messages - neutral and warm
            const normalAcks = [
              "Yeah, I get what you mean",
              "That makes sense",
              "Oh okay, I understand",
              "Got it",
              "I see what you mean",
              "Makes sense",
              "Okay, I see",
              "I understand",
              "That helps"
            ];
            acknowledgment = normalAcks[Math.floor(Math.random() * normalAcks.length)];
          }
          
          // ✅ Blend acknowledgment with option using natural structure: "Acknowledgment. Main suggestion."
          finalMessage = blendAcknowledgment(acknowledgment, option);
          
          console.log('🔄 Blended option with natural acknowledgment:', {
            originalOption: option,
            previousMessage: prevMessage.substring(0, 50),
            emotionalTone: isSad ? 'sad' : isAngry ? 'angry' : isConfused ? 'confused' : isGrateful ? 'grateful' : isApologetic ? 'apologetic' : isQuestion ? 'question' : 'normal',
            acknowledgment,
            finalMessage: finalMessage.substring(0, 80)
          });
        }
      }
      
      sendMessage(finalMessage);
    }, 140);
  };
  // 🔄 Regenerate options function
  const regenerateOptions = async () => {
    if (!currentChatId || !user) return;
    setOptionsGenerationFailed(false);
    enterWaitingForOptions(String(user.id));
    await fetchInitialOptions(currentChatId, user.id, 0, { force: true });
  };
  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  useEffect(() => {
    // FIX: Set to false for header (conflicts with color interpolates)
    Animated.timing(headerIntroAnim, {
      toValue: 1,
      duration: 480,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // FIX: Was true
    }).start();
    Animated.stagger(120, [
      Animated.timing(headerInfoIntroAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false, // FIX: Was true
      }),
      Animated.timing(headerActionsIntroAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false, // FIX: Was true
      }),
    ]).start();
  }, [headerIntroAnim, headerInfoIntroAnim, headerActionsIntroAnim]);
  useEffect(() => {
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(headerGlowAnim, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(headerGlowAnim, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );
    glowLoop.start();
    return () => {
      glowLoop.stop();
    };
  }, [headerGlowAnim]);
  useEffect(() => {
    const animations = messageAnimationsRef.current;
    const currentIds = messages.map((m) => m.id);
    Object.keys(animations).forEach((id) => {
      if (!currentIds.includes(id)) {
        delete animations[id];
      }
    });
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage &&
      !previousMessageIdsRef.current.includes(lastMessage.id) &&
      lastMessage.sender_id === user?.id
    ) {
      const state = animations[lastMessage.id];
      if (state) {
        // FIX: Change to true (scale supported)
        Animated.sequence([
          Animated.spring(state.bubbleScale, {
            toValue: 1.05,
            friction: 5,
            tension: 90,
            useNativeDriver: true, // FIX: Was false
          }),
          Animated.spring(state.bubbleScale, {
            toValue: 1,
            friction: 6,
            tension: 90,
            useNativeDriver: true, // FIX: Was false
          }),
        ]).start();
      }
    }
    previousMessageIdsRef.current = currentIds;
    if (initialMessageRenderRef.current) {
      initialMessageRenderRef.current = false;
    }
  }, [messages, user?.id]);
  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) {
        clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, []);
  useEffect(() => {
    if (!showSuggestedOptions || suggestedOptions.length === 0) {
      optionAnimationsRef.current = [];
      setActiveOptionIndex(null);
      stopOptionShimmer();
      return;
    }
    optionAnimationsRef.current = [];
    setActiveOptionIndex(null);
    stopOptionShimmer();
    optionShimmerLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(optionShimmerAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(optionShimmerAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ])
    );
    optionShimmerLoopRef.current.start();
  }, [optionShimmerAnim, showSuggestedOptions, stopOptionShimmer, suggestedOptions]);
  useEffect(() => () => {
    stopOptionShimmer();
  }, [stopOptionShimmer]);
  const ensureMessageAnimationState = useCallback((message: Message, index: number) => {
    let state = messageAnimationsRef.current[message.id];
    if (!state) {
      state = {
        bubbleOpacity: new Animated.Value(0),
        bubbleTranslate: new Animated.Value(12),
        bubbleScale: new Animated.Value(0.95),
        timeOpacity: new Animated.Value(0),
      };
      messageAnimationsRef.current[message.id] = state;
      const baseDelay = initialMessageRenderRef.current ? index * 100 : 0;
      // FIX: All supported by native; change to true
      Animated.sequence([
        Animated.delay(baseDelay),
        Animated.parallel([
          Animated.timing(state.bubbleOpacity, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true, // FIX: Was false
          }),
          Animated.timing(state.bubbleTranslate, {
            toValue: 0,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true, // FIX: Was false
          }),
          Animated.timing(state.bubbleScale, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true, // FIX: Was false
          }),
        ]),
        Animated.delay(150),
        Animated.timing(state.timeOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true, // FIX: Was false
        }),
      ]).start();
    }
    return state;
  }, []);
  const runMessagePulse = useCallback((id: string) => {
    const state = messageAnimationsRef.current[id];
    if (!state) return;
    if (pulseTimeoutRef.current) {
      clearTimeout(pulseTimeoutRef.current);
    }
    setActivePulseId(id);
    // FIX: Change to true (scale supported)
    Animated.sequence([
      Animated.spring(state.bubbleScale, {
        toValue: 1.04,
        friction: 6,
        tension: 120,
        useNativeDriver: true, // FIX: Was false
      }),
      Animated.spring(state.bubbleScale, {
        toValue: 1,
        friction: 6,
        tension: 120,
        useNativeDriver: true, // FIX: Was false
      }),
    ]).start();
    pulseTimeoutRef.current = setTimeout(() => {
      setActivePulseId((current) => (current === id ? null : current));
    }, 180);
  }, []);
  const ensureOptionAnimationState = useCallback((index: number) => {
    let state = optionAnimationsRef.current[index];
    if (!state) {
      state = {
        appear: new Animated.Value(0),
        translate: new Animated.Value(12),
        scale: new Animated.Value(1),
        rippleScale: new Animated.Value(0),
        rippleOpacity: new Animated.Value(0),
      };
      optionAnimationsRef.current[index] = state;
      // FIX: Change to true (opacity/translate supported)
      Animated.sequence([
        Animated.delay(index * 100),
        Animated.parallel([
          Animated.timing(state.appear, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true, // FIX: Was false
          }),
          Animated.timing(state.translate, {
            toValue: 0,
            duration: 280,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true, // FIX: Was false
          }),
        ]),
      ]).start();
    }
    return state;
  }, []);
  const handleOptionPressIn = useCallback((index: number) => {
     const state = optionAnimationsRef.current[index];
     if (!state) return;
     // FIX: Change to true (scale supported)
     Animated.spring(state.scale, {
       toValue: 0.96,
       friction: 6,
       tension: 140,
       useNativeDriver: true, // FIX: Was false
     }).start();
   }, []);
   const handleOptionPressOut = useCallback((index: number) => {
     const state = optionAnimationsRef.current[index];
     if (!state) return;
     // FIX: Change to true
     Animated.spring(state.scale, {
       toValue: 1,
       friction: 6,
       tension: 140,
       useNativeDriver: true, // FIX: Was false
     }).start();
   }, []);
  const triggerOptionSelectVisuals = useCallback((index: number) => {
    const state = optionAnimationsRef.current[index];
    if (!state) return;
    setActiveOptionIndex(index);
    // FIX: Change to true (opacity/scale supported)
    Animated.parallel([
      Animated.timing(state.rippleOpacity, {
        toValue: 0.25,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true, // FIX: Was false
       }),
       Animated.timing(state.rippleScale, {
         toValue: 1,
         duration: 260,
         easing: Easing.out(Easing.cubic),
         useNativeDriver: true, // FIX: Was false
       }),
    ]).start(() => {
      state.rippleOpacity.setValue(0);
      state.rippleScale.setValue(0);
    });
    // FIX: Change to true
    Animated.sequence([
      Animated.spring(state.scale, {
        toValue: 1.03,
        friction: 5,
        tension: 140,
        useNativeDriver: true, // FIX: Was false
      }),
      Animated.spring(state.scale, {
        toValue: 1,
        friction: 6,
        tension: 120,
        useNativeDriver: true, // FIX: Was false
      }),
    ]).start();
  }, []);
  const headerBackground = headerGlowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#FFF176", "#FFF9C4"],
  });
  const headerBorder = headerGlowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["#F9E79F", "#FFE082"],
  });
  const headerLift = headerGlowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -2],
  });
  const headerIntroTranslate = headerIntroAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-12, 0],
  });
  const headerInfoTranslate = headerInfoIntroAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  const headerActionsTranslate = headerActionsIntroAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  const recentMessageLift = optionsSlideAnim.interpolate({
    inputRange: [0, 300],
    outputRange: [-Spacing.sm, 0],
    extrapolate: 'clamp',
  });
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const isUserTurn =
    !lastMessage || String(lastMessage.sender_id) !== String(user?.id || '');
  const computeIsPendingForUser = useCallback((recipientId?: string) => {
    if (!waitingForOptions) return false;
    const target = recipientId ?? user?.id;
    if (!target) return false;
    const pendingId = pendingOptionsRecipientRef.current;
    if (pendingId === null || pendingId === undefined) return false;
    return String(pendingId) === String(target);
  }, [waitingForOptions, user?.id]);
  const isPendingForCurrentUser = computeIsPendingForUser();
  // ✅ FIX: Show composing notice ONLY when waiting for current user's options AND it's their turn
  const shouldShowComposing = waitingForOptions && isPendingForCurrentUser && isUserTurn;
  const recentThreshold = Math.max(0, displayedMessages.length - 2);

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <LoadingSpinner size="large" />
        <Text style={styles.loadingText}>Loading conversation...</Text>
      </SafeAreaView>
    );
  }
  return (
    <>
      <NotificationBanner
        {...notification}
        onDismiss={() => setNotification(prev => ({ ...prev, visible: false }))}
      />
      <KeyboardSafeView
        style={styles.container}
        contentStyle={styles.flexOne}
        offset={(insets.top || 0) + 8}
        edges={['top', 'left', 'right']}
      >
        <View style={styles.contentWrapper}>
      {/* 🌟 Animated Header with Fade + Slide */}
      <Animated.View
        style={[
          styles.header,
          { marginTop: insets.top ? 0 : Spacing.xs },
          {
            backgroundColor: headerBackground,
            borderColor: headerBorder,
            opacity: headerIntroAnim,
            transform: [{ translateY: headerIntroTranslate }, { translateY: headerLift }],
            shadowOpacity: headerGlowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.15, 0.35],
            }),
          },
        ]}
      >
        {/* Avatar + Contact Info */}
        <Animated.View
          style={[
            styles.headerInfo,
            { marginLeft: Spacing.sm },
            {
              opacity: headerInfoIntroAnim,
              transform: [{ translateY: headerInfoTranslate }],
            },
          ]}
        >
          {!showSuggestedOptions && (
            <View style={styles.contactAvatar}>
              <User size={22} color={Colors.success[500]} />
            </View>
          )}
          <Text 
  style={styles.headerTitle}
  numberOfLines={1} // Limits to 1 line with ellipsis (...) if too long
  ellipsizeMode="tail" // Adds ... at end for overflow
>
  {contact?.full_name || contact?.email || "Contact"}
</Text>
        </Animated.View>
        {/* Icons row */}
<Animated.View
  style={[
    styles.headerActions,
    {
      opacity: headerActionsIntroAnim,
      transform: [{ translateY: headerActionsTranslate }], // No anim mix (from prior fix)
    },
  ]}
>
  <TouchableOpacity 
    style={styles.historyButton} 
    onPress={() => router.push('/(tabs)/chats')}
    activeOpacity={0.7} // Subtle press feedback
  >
    <Text style={{ 
      fontSize: 16, // Matches contact name
      color: '#6A1B9A', // Bright purple
      textShadowColor: 'rgba(0,0,0,0.1)',
      textShadowOffset: { width: 0, height: 0.5 },
      textShadowRadius: 1,
      lineHeight: 16, // Perfect centering
    }}>
      🏠
    </Text>
  </TouchableOpacity>
  <TouchableOpacity 
    style={styles.historyButton} 
    onPress={() => setShowHistoryModal(true)}
    activeOpacity={0.7} // Subtle press feedback
  >
    <Text style={{ 
      fontSize: 16, // Matches contact name
      color: '#1565C0', // Bright blue
      textShadowColor: 'rgba(0,0,0,0.1)',
      textShadowOffset: { width: 0, height: 0.5 },
      textShadowRadius: 1,
      lineHeight: 16, // Perfect centering
    }}>
      ⏰
    </Text>
  </TouchableOpacity>
</Animated.View>
      </Animated.View>
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
      <View style={styles.chatContainer}>
        <ScrollView
             ref={scrollViewRef}
             style={styles.messagesContainer}
             contentContainerStyle={[
               styles.messagesContent,
               waitingForOptions ? styles.messagesContentAwaiting : null,
             ]}
             showsVerticalScrollIndicator={false}
             onLayout={(event: LayoutChangeEvent) => {
               containerHeightRef.current = event.nativeEvent.layout.height;
               if (!userScrollingRef.current) {
                 scrollToBottom({ immediate: !hasAutoScrolledInitially.current });
               }
             }}
             onContentSizeChange={(_: number, height: number) => {
               contentHeightRef.current = height;
               if (userScrollingRef.current) {
                 pendingAutoScrollRef.current = true;
               } else {
                 scrollToBottom({ immediate: !hasAutoScrolledInitially.current });
               }
             }}
            onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
              const offsetY = event.nativeEvent.contentOffset.y;
              scrollOffsetRef.current = offsetY;
              if (
                !showFullHistory &&
                hasAutoScrolledInitially.current &&
                offsetY <= 12 &&
                messages.length > displayedMessages.length
              ) {
                setShowFullHistory(true);
              }
            }}
             onScrollBeginDrag={() => {
               userScrollingRef.current = true;
               pendingAutoScrollRef.current = false;
               if (isAutoScrollingRef.current) {
                 scrollAnim.stopAnimation();
                 detachScrollListener();
                 isAutoScrollingRef.current = false;
               }
             }}
             onScrollEndDrag={() => {
               userScrollingRef.current = false;
               if (pendingAutoScrollRef.current) {
                 const shouldScroll = pendingAutoScrollRef.current;
                 pendingAutoScrollRef.current = false;
                 if (shouldScroll) {
                   scrollToBottom();
                 }
               }
             }}
             onMomentumScrollEnd={() => {
               userScrollingRef.current = false;
               if (pendingAutoScrollRef.current) {
                 const shouldScroll = pendingAutoScrollRef.current;
                 pendingAutoScrollRef.current = false;
                 if (shouldScroll) {
                   scrollToBottom();
                 }
               }
             }}
             scrollEventThrottle={16}
           >
          {displayedMessages.map((m, index) => {
             const animState = ensureMessageAnimationState(m, index);
             const transforms: any[] = [];
             const containerAnimatedStyle: any = {};
             if (animState) {
              // 🔥 SIMPLE FIX: all user messages full opacity
              containerAnimatedStyle.opacity =
                m.sender_type === "user" ? 1 : animState.bubbleOpacity;
            
              transforms.push({ translateY: animState.bubbleTranslate });
            }
            

             const isRecent = index >= recentThreshold;
             if (isRecent) {
               transforms.push({ translateY: recentMessageLift });
             }
             if (transforms.length > 0) {
               containerAnimatedStyle.transform = transforms;
             }
             const bubbleAnimatedStyle = animState
               ? {
                   transform: [{ scale: animState.bubbleScale }],
                 }
               : undefined;
             const timeAnimatedStyle = animState
               ? { opacity: animState.timeOpacity }
               : undefined;
             return (
               <Animated.View
                 key={m.id}
                 style={[
                   styles.messageContainer,
                   m.sender_type === "user"
                     ? styles.userMessageContainer
                     : styles.contactMessageContainer,
                   containerAnimatedStyle,
                 ]}
               >
                 <Pressable
                   onPress={() => runMessagePulse(m.id)}
                   android_ripple={{ color: "rgba(255,255,255,0.08)", borderless: false }}
                   style={styles.messagePressable}
                 >
                   <Animated.View
                     style={[
                       styles.messageBubble,
                       m.sender_type === "user"
                         ? styles.userMessageBubble
                         : styles.contactMessageBubble,
                       bubbleAnimatedStyle,
                       activePulseId === m.id ? styles.messagePulseShadow : null,
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
                     <Animated.Text
                       style={[
                         styles.messageTime,
                         m.sender_type === "user"
                           ? styles.userMessageTime
                           : styles.contactMessageTime,
                         timeAnimatedStyle,
                       ]}
                     >
                       {formatTime(m.created_at)}
                     </Animated.Text>
                   </Animated.View>
                 </Pressable>
               </Animated.View>
             );
           })}
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
                  onPress={() => {
                    setShowTipBox(false);
                    hasSeenHintBoxRef.current = true; // Mark as seen when dismissed
                  }}
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
                      enterWaitingForOptions(user?.id ? String(user.id) : undefined);
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
                          showNotification(
                            'warning',
                            'Context Saved',
                            'Your perspective is saved but options could not be updated'
                          );
                          // ✅ Make sure 💞 composing banner does not get stuck forever
                          if (user?.id) {
                            resolveWaitingForOptions(String(user.id));
                          } else {
                            resolveWaitingForOptions(null);
                          }
                        } else {
                          console.log("✅ Options regenerated with hint context");
                          showNotification(
                            'success',
                            'Options Updated',
                            'Your response choices now reflect your perspective'
                          );
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
  {shouldShowComposing && (
    <View style={styles.notificationContainer}>
      <Text style={styles.notificationText}>
      💞 Composing some thoughtful replies... one sec!
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
        disabled={waitingForOptions} // ← NEW: stops clicking while loading
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
        {showSuggestedOptions && suggestedOptions.length > 0 && !manualInputMode && !waitingForOptions && !isChatClosed && (
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
              {suggestedOptions.map((opt, i) => {
                const anim = ensureOptionAnimationState(i);
                const appearStyle = anim
                  ? {
                      opacity: anim.appear,
                      transform: [{ translateY: anim.translate }],
                    }
                  : undefined;
                const buttonAnimatedStyle = anim
                  ? {
                      transform: [{ scale: anim.scale }],
                    }
                  : undefined;
                const rippleAnimatedStyle = anim
                  ? {
                      opacity: anim.rippleOpacity,
                      transform: [{ scale: anim.rippleScale }],
                    }
                  : undefined;
                const shimmerOpacity = optionShimmerAnim.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0, 0.18, 0],
                });
                const isClosureOption = opt === "🙂";
                const isActive = activeOptionIndex === i;
                return (
                  <Animated.View key={i} style={[styles.optionWrapper, appearStyle]}>
                    <Pressable
                      onPressIn={() => handleOptionPressIn(i)}
                      onPressOut={() => handleOptionPressOut(i)}
                      onPress={() => handleSuggestedOptionPress(opt, i)}
                      android_ripple={{ color: "rgba(255, 255, 255, 0.15)", borderless: false }}
                      style={styles.optionPressable}
                    >
                      <Animated.View
                        style={[
                          styles.suggestedOptionButton,
                          isClosureOption && styles.closureOptionButton,
                          isActive && styles.suggestedOptionActive,
                          buttonAnimatedStyle,
                        ]}
                      >
                        <Animated.View
                          pointerEvents="none"
                          style={[styles.optionShimmerOverlay, { opacity: shimmerOpacity }]}
                        />
                        <Animated.View
                          pointerEvents="none"
                          style={[styles.optionRipple, rippleAnimatedStyle]}
                        />
                        <Text
                          style={[
                            styles.suggestedOptionText,
                            isClosureOption && styles.closureOptionText,
                          ]}
                        >
                          {opt}
                        </Text>
                      </Animated.View>
                    </Pressable>
                  </Animated.View>
                );
              })}
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
                    hasSentMessage.current = true; // ← NEW
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
      </View>
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
      </View>
      </KeyboardSafeView>
  </>
);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background
  },
  flexOne: {
    flex: 1,
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
    paddingHorizontal: Spacing.md,
    paddingVertical: 10, // taller, elegant height
    marginHorizontal: Spacing.md,
    marginTop: 0,
    marginBottom: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F9E79F", // soft lemon border
    backgroundColor: "#FFF176", // 🍋 full lemon yellow fill
    ...Shadows.medium,
    minHeight: 56, // not too thin, looks balanced
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
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.secondary[50],
    borderWidth: 1,
    borderColor: Colors.secondary[100],
    marginRight: Spacing.xs,
  },
 
  contactInfo: {
    alignItems: 'flex-start',
  },

  headerTitle: {
    fontSize: Typography.fontSize.base + 1,
    fontWeight: Typography.fontWeight.semibold,
    color: "#333333",
    textAlign: 'center', // Centers in available space
    letterSpacing: 0.3,
    flexShrink: 1, // ← ADD: Allows text to shrink without breaking layout
    flexWrap: 'nowrap', // ← ADD: Prevents unwanted wrapping
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  historyButton: {
  width: 34,
  height: 34,
  borderRadius: 8,
  backgroundColor: "#FFF9C4", // lighter yellow tone
  justifyContent: 'center',
  alignItems: 'center',
  borderWidth: 1,
  borderColor: "#F9E79F",
  ...Shadows.small,
},
 
  keyboardWrapper: {
    flex: 1,
  },
  contentWrapper: {
    flex: 1,
  },
  chatContainer: { flex: 1 },
  messagesContainer: { flex: 1 },
  messagesContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  messagesContentAwaiting: {
    paddingBottom: Spacing.xxxl,
  },
  messageContainer: { marginBottom: Spacing.lg },
  userMessageContainer: { alignItems: "flex-end" },
  contactMessageContainer: { alignItems: "flex-start" },
  messagePressable: {
    alignSelf: 'auto',
    maxWidth: '100%',
  },
  messageBubble: {
    maxWidth: "80%",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: "transparent",   // prevent override
    backgroundColor: "transparent", // do NOT set a color here
    ...Shadows.small,
},

  // userMessageBubble: {
  //   backgroundColor: Colors.chat.userBubble,
  //   borderColor: Colors.chat.userBubble,
  //   borderBottomRightRadius: BorderRadius.md,
  // },

  userMessageBubble: {
    backgroundColor: Colors.chat.userBubble,
    borderColor: Colors.chat.userBubble,
    borderBottomRightRadius: BorderRadius.md,
    overflow: "hidden",   // <-- IMPORTANT: stops white bleed & animation bleed
},

  userMessageText: {
    color: Colors.text.inverse,
    fontWeight: Typography.fontWeight.semibold,
    letterSpacing: 0.15,
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 1.2,
  },
  
  contactMessageBubble: {
    backgroundColor: Colors.chat.contactBubble,
    borderColor: Colors.warning[200],
    borderBottomLeftRadius: BorderRadius.md,
  },
  messageText: {
    fontSize: Typography.fontSize.xs,
    lineHeight: Typography.fontSize.xs * 1.6,
    fontWeight: Typography.fontWeight.medium,
  },
  //userMessageText: { color: Colors.text.inverse },
  contactMessageText: { color: Colors.text.primary },
  messageTime: {
    fontSize: Typography.fontSize.xs,
    marginTop: Spacing.xs,
    fontWeight: Typography.fontWeight.normal,
  },
  userMessageTime: {
    color: 'rgba(255,255,255,0.9)',
    textAlign: "right",
    fontWeight: Typography.fontWeight.medium,
    letterSpacing: 0.1,
  },
  contactMessageTime: {
    color: Colors.text.secondary,
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
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.primary[100],
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
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
  optionWrapper: {
    width: '100%',
  },
  optionPressable: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: BorderRadius.lg,
  },
  suggestedOptionButton: {
    flexShrink: 1,
    minWidth: 0,
    backgroundColor: Colors.primary[50],
    borderWidth: 1,
    borderColor: Colors.primary[200],
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    width: '100%',
    minHeight: 40,
    justifyContent: 'center',
    marginBottom: Spacing.xs,
    ...Shadows.small,
  },
  suggestedOptionActive: {
     shadowOpacity: 0.25,
     shadowRadius: 12,
     elevation: 8,
     borderColor: Colors.primary[300],
     backgroundColor: Colors.primary[100],
   },
  suggestedOptionText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.secondary[700],
    fontWeight: Typography.fontWeight.semibold,
    textAlign: 'center',
    lineHeight: Typography.fontSize.xs * 1.5,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  optionRipple: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: BorderRadius.lg,
    opacity: 0,
  },
  optionShimmerOverlay: {
    position: 'absolute',
    top: 0,
    left: -40,
    right: -40,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    transform: [{ skewX: '-12deg' }],
  },
  closureOptionButton: {
    backgroundColor: Colors.success[50],
    borderColor: Colors.success[300],
  },
  closureOptionText: {
    fontSize: Typography.fontSize.xl,
    color: Colors.success[700],
  },
  messagePulseShadow: {
    shadowColor: Colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
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
    color: Colors.secondary[500], // Bright blue matching app theme
    fontWeight: Typography.fontWeight.medium,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  // ✅ NEW: History button and modal styles
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
    lineHeight: Typography.fontSize.base * 1.45,
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
notificationContainer: {
  padding: 12,
  marginVertical: 8,
  marginHorizontal: 16,
  borderRadius: BorderRadius.lg,
  backgroundColor: '#E3F2FD', // Bright blue background (light blue-50)
  borderWidth: 1,
  borderColor: '#90CAF9', // Bright blue border (blue-300)
  alignItems: 'center',
},
notificationText: {
  color: '#1565C0', // Bright blue text (blue-800)
  fontSize: Typography.fontSize.sm,
  fontStyle: 'italic',
  textAlign: 'center',
  lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
},
hintTagName: {
  fontSize: Typography.fontSize.sm,
  color: Colors.text.primary,
  fontWeight: Typography.fontWeight.medium,
},
});
export default ContactChatScreen;