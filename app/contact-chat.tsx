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
  const messagesRef = useRef<Message[]>([]); // ✅ FIX: Use ref to avoid stale state in async functions
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false); // ✅ PERFORMANCE: Show UI immediately, load data in background
  const [contact, setContact] = useState<Contact | null>(null);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [showSuggestedOptions, setShowSuggestedOptions] = useState(false);
  const [suggestedOptions, setSuggestedOptions] = useState<string[]>([]);
  const currentPregeneratedTurnRef = useRef<{ turn_number: number; recipient_id: string; options?: string[] } | null>(null); // ✅ Store current pregen turn info
  const currentOptionsSourceRef = useRef<'pregenerated_turns' | 'generate-contextual-options' | null>(null); // ✅ Track which source user actually saw/selected from
  const isGeneratingPregeneratedTurnsRef = useRef<Record<string, boolean>>({}); // ✅ Track if pregenerated turns are being generated per chat
  
  // ✅ Helper to clear pregen turn info when options are cleared
  const clearPregeneratedTurnInfo = () => {
    currentPregeneratedTurnRef.current = null;
    currentOptionsSourceRef.current = null;
  };
  
  // ✅ Helper to set options with source tracking
  const setOptionsWithSource = (options: string[], source: 'pregenerated_turns' | 'generate-contextual-options') => {
    setSuggestedOptions(options);
    currentOptionsSourceRef.current = source;
    console.log(`📝 Options set with source: ${source}`);
  };
  
  // ✅ Helper to show options with delay for turn 3 only (gives next batch more time to generate)
  const showOptionsWithDelay = async (
    options: string[], 
    source: 'pregenerated_turns' | 'generate-contextual-options',
    turnNumber?: number,
    recipientId?: string,  // ✅ CRITICAL: Accept recipient_id from turn data, not user.id
    originalOptions?: string[]  // ✅ Store original options for validation
  ) => {
    // ✅ FIX: Prevent showing options if they're already displayed for the same turn
    if (turnNumber !== undefined && 
        currentPregeneratedTurnRef.current && 
        currentPregeneratedTurnRef.current.turn_number === turnNumber &&
        currentOptionsSourceRef.current === source &&
        showSuggestedOptions &&
        suggestedOptions.length > 0) {
      console.log(`⏸️ Options already displayed for turn ${turnNumber} - skipping refresh to prevent flicker`);
      return; // ⛔ EXIT - don't refresh same turn
    }
    
    // ✅ FIX: Add delay only for turn 3 (User B's 2nd turn)
    // This is when the first batch (0,1,2) is used and next batch (3,4,5) is generating
    // The delay gives the next batch 1.5s more time to complete, reducing fallback
    if (turnNumber === 3) {
      const delay = 1500; // 1.5 seconds
      console.log(`⏳ Delaying options display for turn 3 by ${delay}ms to allow next batch generation`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Show options (no delay for other turns)
    setOptionsWithSource(options, source);
    setShowSuggestedOptions(true);
    
    // ✅ CRITICAL FIX: Store turn info with CORRECT recipient_id from database, not user.id
    // This ensures marking logic can find the correct turn in pregenerated_turns table
    if (turnNumber !== undefined && source === 'pregenerated_turns' && recipientId) {
      currentPregeneratedTurnRef.current = {
        turn_number: turnNumber,
        recipient_id: recipientId,  // ✅ Use actual recipient_id from turn data
        options: originalOptions || options  // ✅ Store original options for validation
      };
      console.log(`✅ Set currentPregeneratedTurnRef: turn ${turnNumber}, recipient ${recipientId}, options count: ${(originalOptions || options).length}`);
    } else if (turnNumber !== undefined && source === 'pregenerated_turns' && !recipientId) {
      console.warn(`⚠️ showOptionsWithDelay called without recipientId for turn ${turnNumber} - ref not set correctly`);
    }
  };
  const [aiSourceChatId, setAiSourceChatId] = useState<string | null>(null); // ✅ Store AI source chat ID for back navigation
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
  // ✅ FIX: Track if we're currently fetching options to prevent duplicate calls
  const isFetchingOptionsRef = useRef(false);
  // ✅ FIX: Track if options initialization has run to prevent dependency loop
  const hasInitializedOptionsRef = useRef(false);
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
    const targetRecipientId = recipientId ?? (user?.id ? String(user.id) : null);
    
    // ✅ FIX: Prevent duplicate calls for the same recipient
    if (waitingForOptions && 
        pendingOptionsRecipientRef.current && 
        String(pendingOptionsRecipientRef.current) === String(targetRecipientId)) {
      console.log('ℹ️ Already waiting for options for this recipient, skipping duplicate call');
      return;
    }
    
    fadeOutCurrentOptions();
    stopOptionShimmer();
    setActiveOptionIndex(null);
    optionAnimationsRef.current = [];
    setShowSuggestedOptions(false);
    setSuggestedOptions([]);
    setManualInputMode(false);
    pendingOptionsRecipientRef.current = targetRecipientId;
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
        // ✅ Store AI source chat ID for back navigation to Stage 4
        if (data.ai_source_chat_id) {
          setAiSourceChatId(data.ai_source_chat_id);
          console.log('✅ Stored AI source chat ID for back navigation:', data.ai_source_chat_id);
        }
        
        // ✅ CRITICAL: Check if chat is closed/resolved and hide options
        const chatIsClosed = data.is_resolved === true && data.closure_state === 'closed';
        setIsChatClosed(chatIsClosed);
        if (chatIsClosed) {
          console.log("🛑 Chat is closed/resolved - hiding options");
          setShowSuggestedOptions(false);
          setSuggestedOptions([]);
          // ✅ FIX: User can stay on closed chat screen - no automatic navigation
          // User can manually navigate back when they're ready
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
          // ✅ FIX: Show hint box when User B enters chat, stay until submitted, never show after submission
          if (user?.id === data.contact_id) {
            const hasHint = Boolean(data.context_data?.hint_from_b);
            
            if (hasHint) {
              // ✅ Hint exists in DB → hide box permanently (already submitted)
              hasSeenHintBoxRef.current = true;
              setShowTipBox(false);
            } else {
              // ✅ No hint exists → show box (don't check hasSeenHintRef - allow it to show)
              // ✅ CRITICAL: Don't mark as seen when showing - only mark after submission
              setShowTipBox(true);
              // ❌ REMOVED: hasSeenHintBoxRef.current = true; // Don't mark as seen when showing
            }
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
    let unsubscribeMessages: (() => void) | undefined;
    let unsubscribeClosure: (() => void) | undefined;
    let unsubscribePregenerated: (() => void) | undefined;
    
    if (user && chatId) {
      const id = chatId as string;
      console.log('🚀 CONTACT CHAT INITIALIZATION:', { chatId: id, userId: user.id });
      
      // ✅ FIX: Reset initialization flag when chatId changes
      hasInitializedOptionsRef.current = false;
      
      // ✅ CRITICAL: Clear messagesRef when chatId changes to prevent stale data
      // This fixes the issue where messagesSentByUser is calculated incorrectly for new chats
      messagesRef.current = [];
      setMessages([]);
      // ✅ FIX 2: Don't reset hint box ref - always check DB state instead
      // The DB check in fetchChatContext will determine if hint box should show
      setShowTipBox(false);
      console.log("🧹 Cleared messagesRef for new chat:", id);
      
      // ✅ CRITICAL: Clean up any existing subscriptions first
      if (messageSubscriptionRef.current) {
        console.log('🧹 Cleaning up existing message subscription before setting up new one');
        try {
          supabase.removeChannel(messageSubscriptionRef.current);
        } catch (e: any) {
          console.warn('⚠️ Error cleaning up old message subscription:', e.message);
        }
        messageSubscriptionRef.current = null;
      }
      
      try {
        setCurrentChatId(id);
        fetchChatContext(id).catch(err => console.error('⚠️ fetchChatContext error:', err));
        fetchMessages().catch(err => {
          console.error('❌ Failed to fetch messages:', err);
          showNotification('error', 'Loading Failed', 'Could not load messages');
          setInitialLoading(false);
        });
        
        unsubscribeOptions = subscribeToOptions(id, user.id);
        
        // ✅ CRITICAL: Wait for pregenerated turns before showing options (for new chats from Stage 3)
        // This ensures User A sees pregenerated turns immediately, not generate-contextual-options
        if (!showSuggestedOptions) {
          // ✅ FIX: Check immediately first (no delay), then poll if needed
          const checkPregeneratedTurns = async () => {
            // ✅ Check immediately first (no delay on first check)
            let pregen = await fetchPregeneratedTurn(id, user.id);
            if (pregen && pregen.options?.length > 0 && String(pregen.recipient_id) === String(user.id)) {
              console.log(`✅ Found pregenerated turns immediately - showing right away`);
              // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
              if (pregen.turn_number !== undefined && pregen.recipient_id) {
                currentPregeneratedTurnRef.current = {
                  turn_number: pregen.turn_number,
                  recipient_id: pregen.recipient_id,  // ✅ Use recipient_id from database
                  options: pregen.options || []
                };
                console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregen.turn_number} for recipient ${pregen.recipient_id}`);
              }
              const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
              setOptionsWithSource(cleaned, 'pregenerated_turns');
              setShowSuggestedOptions(true);
              resolveWaitingForOptions(user.id);
              return; // ⛔ EXIT - don't call fetchInitialOptions
            }
            
            // ✅ If not found immediately, poll for up to 8 seconds (increased for early pregeneration to complete)
            const maxWaitTime = 8000; // ✅ Increased to 8 seconds to allow early pregeneration to complete
            const checkInterval = 300; // Check every 300ms
            let waited = 0;
            
            while (waited < maxWaitTime) {
              await new Promise(resolve => setTimeout(resolve, checkInterval));
              waited += checkInterval;
              pregen = await fetchPregeneratedTurn(id, user.id);
              if (pregen && pregen.options?.length > 0 && String(pregen.recipient_id) === String(user.id)) {
                console.log(`✅ Found pregenerated turns after ${waited}ms - showing immediately`);
                // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
                if (pregen.turn_number !== undefined && pregen.recipient_id) {
                  currentPregeneratedTurnRef.current = {
                    turn_number: pregen.turn_number,
                    recipient_id: pregen.recipient_id,  // ✅ Use recipient_id from database
                    options: pregen.options || []
                  };
                  console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregen.turn_number} for recipient ${pregen.recipient_id}`);
                }
                const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
                setOptionsWithSource(cleaned, 'pregenerated_turns');
                setShowSuggestedOptions(true);
                resolveWaitingForOptions(user.id);
                return; // ⛔ EXIT - don't call fetchInitialOptions
              }
            }
            
            // ✅ Fallback: Only if pregenerated turns truly don't exist after 8 seconds
            console.log("ℹ️ Pregenerated turns not ready after 8s, falling back to fetchInitialOptions");
            fetchInitialOptions(id, user.id, 0, { force: true });
            ensureInitialOptions(id);
          };
          
          // ✅ Start checking immediately (non-blocking)
          checkPregeneratedTurns();
        } else {
          // ✅ If options already showing, just ensure they're up to date
          fetchInitialOptions(id, user.id, 0, { force: true });
        }
        unsubscribeMessages = subscribeToMessages(id, user.id);
        unsubscribeClosure = subscribeToClosureState(id);
        
        // ✅ NEW: Subscribe to pregenerated_turns for instant updates
        console.log('📡 Setting up realtime subscription for pregenerated_turns:', { chatId: id, userId: user.id });
        const pregenChannel = supabase
          .channel(`pregenerated-turns-${id}-${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'pregenerated_turns',
              filter: `chat_id=eq.${id}`,
            },
            async (payload) => {
              console.log('🔔 Pregenerated turn inserted:', payload.new);
              const newTurn = payload.new as any;
              
              // ✅ CRITICAL FIX: Verify recipient_id matches current user
              if (String(newTurn.recipient_id) !== String(user.id)) {
                console.log('ℹ️ Pregenerated turn inserted for other user - ignoring', {
                  turnRecipientId: newTurn.recipient_id,
                  currentUserId: user.id
                });
                return;
              }
              
              // ✅ CRITICAL FIX: Calculate expected turn number to verify this is the correct turn to show
              // This prevents showing turn 1 when turn 0 should be shown
              try {
                // Get chat to determine if user is User A or User B
                const { data: chatData } = await supabase
                  .from("chats")
                  .select("user_id, contact_id")
                  .eq("id", id)
                  .single();
                
                if (!chatData) {
                  console.warn("⚠️ Chat not found in subscription handler - ignoring turn");
                  return;
                }
                
                const isUserA = user.id === chatData.user_id;
                const isUserB = user.id === chatData.contact_id;
                
                if (!isUserA && !isUserB) {
                  console.warn("⚠️ User is neither User A nor User B - ignoring turn");
                  return;
                }
                
                // Count messages sent by this user
                const { data: allMessages } = await supabase
                  .from("messages")
                  .select("sender_id, chat_id")
                  .eq("chat_id", id)
                  .order("created_at", { ascending: true });
                
                const messagesSentByUser = (allMessages || []).filter(m => 
                  String(m.chat_id) === String(id) && String(m.sender_id) === String(user.id)
                ).length;
                
                // ✅ PRIMARY CHECK: Calculate expected turn number based ONLY on messages sent by current user
                // This is the MOST RELIABLE check and must happen FIRST
                // Formula ensures only ONE user can ever match a given turn_number:
                // - User A: expectedTurn = messagesSentByUser * 2      (0→0, 1→2, 2→4, 3→6, ...)
                // - User B: expectedTurn = messagesSentByUser * 2 + 1  (0→1, 1→3, 2→5, 3→7, ...)
                const expectedTurn = isUserA 
                  ? messagesSentByUser * 2      // User A: 0→0, 1→2, 2→4, 3→6, ...
                  : messagesSentByUser * 2 + 1; // User B: 0→1, 1→3, 2→5, 3→7, ...
                
                // ✅ PRIMARY CHECK: If turn_number doesn't match expectedTurn, DO NOT show options
                // This guarantees that even if Supabase inserts multiple turns at once (e.g., 3, 5, 10 turns),
                // only the user whose expectedTurn matches the inserted turn_number will see options.
                // The other user will ALWAYS have a different expectedTurn, so they will never see options for that turn.
                // This works for ALL turns (0 through 100+).
                if (newTurn.turn_number !== expectedTurn) {
                  console.log(`⏸️ PRIMARY CHECK FAILED: Skipping turn ${newTurn.turn_number} - Expected turn ${expectedTurn} for ${isUserA ? 'User A' : 'User B'} with ${messagesSentByUser} messages sent`);
                  return; // ⛔ EXIT IMMEDIATELY - do not show options
                }
                
                // ✅ SECONDARY CHECK: Verify whose turn it is by checking last message sender
                // Only show options if the OTHER user sent the last message (it's current user's turn)
                // This provides additional validation when messages are fully synced
                // If current user sent the last message, it's NOT their turn - don't show options
                if (allMessages && allMessages.length > 0) {
                  const lastMessage = allMessages[allMessages.length - 1];
                  const lastSenderId = String(lastMessage.sender_id);
                  const currentUserId = String(user.id);
                  
                  if (lastSenderId === currentUserId) {
                    console.log(`⏸️ SECONDARY CHECK FAILED: Skipping turn ${newTurn.turn_number} - Current user sent last message (not their turn yet, waiting for other user to respond)`);
                    return; // ⛔ EXIT - do not show options
                  }
                }
                
                // ✅ Check if same turn_number is already displayed - don't refresh if it is
                // EXCEPTION: Allow refresh if it's User B's turn and hint was just submitted (for hint refresh)
                let shouldAllowRefresh = false;
                if (currentPregeneratedTurnRef.current && 
                    currentPregeneratedTurnRef.current.turn_number === newTurn.turn_number &&
                    String(currentPregeneratedTurnRef.current.recipient_id) === String(user.id) &&
                    currentOptionsSourceRef.current === 'pregenerated_turns' &&
                    showSuggestedOptions &&
                    suggestedOptions.length > 0) {
                  
                  // ✅ EXCEPTION: Check if this is User B and hint was just submitted
                  if (isUserB && chatData) {
                    // Check if hint exists in context_data (hint was just submitted)
                    const { data: chatDataForHint } = await supabase
                      .from("chats")
                      .select("context_data")
                      .eq("id", id)
                      .single();
                    
                    const hasHint = chatDataForHint?.context_data?.hint_from_b;
                    if (hasHint) {
                      console.log(`🔄 Allowing refresh: User B's turn ${newTurn.turn_number} regenerated with hint context`);
                      shouldAllowRefresh = true;
                    }
                  }
                  
                  if (!shouldAllowRefresh) {
                    console.log(`⏸️ Skipping refresh: Same turn_number ${newTurn.turn_number} already displayed for user ${user.id}`);
                    return; // ⛔ EXIT - don't refresh same turn
                  }
                }
                
                // ✅ Validate that the turn has options
                if (!newTurn.options || !Array.isArray(newTurn.options) || newTurn.options.length === 0) {
                  console.warn(`⚠️ Inserted turn ${newTurn.turn_number} has no options - ignoring`);
                  return;
                }
                
                // ✅ Use the turn data directly from the payload (don't call fetchPregeneratedTurn)
                console.log(`⚡ Realtime: Showing turn ${newTurn.turn_number} (expected: ${expectedTurn}) - options available immediately`);
                const cleaned = cleanOptionsForDisplay(newTurn.options, contact?.full_name || null);
                // ✅ CRITICAL FIX: Pass recipient_id from turn data, not user.id
                await showOptionsWithDelay(cleaned, 'pregenerated_turns', newTurn.turn_number, newTurn.recipient_id, newTurn.options);
                resolveWaitingForOptions(user.id);
                setLastOptionRefreshTime(Date.now());
              } catch (err) {
                console.error('❌ Error in pregenerated turn subscription handler:', err);
                // Don't show options if there's an error calculating expected turn
              }
            }
          )
          .subscribe(async (status) => {
            console.log('📡 Pregenerated turns subscription status:', status);
            if (status === 'SUBSCRIBED') {
              console.log('✅ Pregenerated turns subscription is ACTIVE');
              
              // ✅ FIX 6: Immediately check for existing pregenerated turns
              // This handles cases where turns exist before subscription starts
              try {
                const existingPregen = await fetchPregeneratedTurn(id, user.id);
                if (existingPregen && existingPregen.options?.length > 0) {
                  if (String(existingPregen.recipient_id) === String(user.id)) {
                    console.log('⚡ Found existing pregenerated turns - showing immediately');
                    const cleaned = cleanOptionsForDisplay(existingPregen.options, contact?.full_name || null);
                    // ✅ CRITICAL FIX: Pass recipient_id from turn data
                    await showOptionsWithDelay(cleaned, 'pregenerated_turns', existingPregen.turn_number, existingPregen.recipient_id, existingPregen.options);
                    resolveWaitingForOptions(user.id);
                    setLastOptionRefreshTime(Date.now());
                  }
                }
              } catch (err) {
                console.warn('⚠️ Error checking for existing pregenerated turns:', err);
                // Non-critical - continue normally
              }
            } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
              console.warn('⚠️ Pregenerated turns subscription error - will use polling fallback');
              // ✅ FIX: The existing fetchPregeneratedTurn calls will handle polling
            }
          });
        
        unsubscribePregenerated = () => {
          console.log('🧹 Cleaning up pregenerated_turns subscription');
          supabase.removeChannel(pregenChannel);
        };
      } catch (err) {
        console.error('❌ Contact chat initialization error:', err);
        showNotification('error', 'Initialization Failed', 'Could not start conversation');
        setInitialLoading(false);
      }
    }
    
    // ✅ FIX: Cleanup all subscriptions on unmount or chatId change
    return () => {
      console.log('🧹 Cleaning up subscriptions for chatId:', chatId);
      if (typeof unsubscribeOptions === 'function') {
        unsubscribeOptions();
      }
      if (typeof unsubscribeMessages === 'function') {
        unsubscribeMessages();
      }
      if (typeof unsubscribeClosure === 'function') {
        unsubscribeClosure();
      }
      if (typeof unsubscribePregenerated === 'function') {
        unsubscribePregenerated();
      }
      // Also clean up message subscription ref
      if (messageSubscriptionRef.current) {
        try {
          supabase.removeChannel(messageSubscriptionRef.current);
        } catch (e: any) {
          console.warn('⚠️ Error cleaning up message subscription in cleanup:', e.message);
        }
        messageSubscriptionRef.current = null;
      }
      isAutoScrollingRef.current = false;
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
      
      // ✅ NEW: Check DB for hint_from_b on every screen focus
      // This ensures UI and DB are always in sync after refresh, navigation, or app reopen
      // Source of truth: context_data.hint_from_b in the chats table
      if (user && currentChatId) {
        fetchChatContext(currentChatId).catch(err => 
          console.error('⚠️ fetchChatContext error on focus:', err)
        );
      }
    }, [isResolved, user, currentChatId])
  );

  // ✅ NEW: Initialize options waiting state when stored session opens
  useEffect(() => {
    // ✅ FIX: Only run once when screen first loads, not on every state change
    if (hasInitializedOptionsRef.current) {
      return;
    }
    
    // Only run when:
    // 1. Initial loading is complete (messages are loaded)
    // 2. Chat ID is set
    // 3. User is available
    // 4. Messages array is populated (either empty or has messages)
    // 5. Chat is not closed
    if (!initialLoading && chatId && user?.id && messages.length >= 0 && !isChatClosed) {
      hasInitializedOptionsRef.current = true; // Mark as initialized
      
      // Determine who should receive options based on last message sender
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const lastSenderId = lastMessage.sender_id;
        const currentUserId = user.id;
        
        // If last sender = current user → next options are for the contact
        // If last sender = contact → next options are for the current user
        if (lastSenderId === currentUserId) {
          // Current user sent last message → contact should receive options
          const recipientId = contactId ? String(contactId) : undefined;
          console.log('✅ Initialization: Last message from current user → options for contact:', recipientId);
          enterWaitingForOptions(recipientId);
        } else {
          // Contact sent last message → current user should receive options
          console.log('✅ Initialization: Last message from contact → options for current user:', currentUserId);
          enterWaitingForOptions(String(currentUserId));
          // ✅ FIX: Don't call fetchInitialOptions here - it's already called on line 391
        }
      } else {
        // No messages yet → current user should receive options (initial turn - Stage 4 scenario)
        console.log('✅ Initialization: No messages → options for current user:', user.id);
        enterWaitingForOptions(String(user.id));
        // ✅ FIX: Don't call fetchInitialOptions here - it's already called on line 391
      }
    }
  }, [initialLoading, chatId, user?.id, messages.length, contactId, enterWaitingForOptions, isChatClosed]); // ✅ FIX: Removed showSuggestedOptions from dependencies
  
  // ✅ NEW: Trigger 3-turn pre-generation when chat becomes active
  useEffect(() => {
    // Only run when:
    // 1. Initial loading is complete
    // 2. Chat ID exists
    // 3. User exists
    // 4. Chat is not closed
    // ✅ FIX: Allow pre-generation even when messages.length === 0 (for first turn)
    if (initialLoading || !chatId || !user?.id || isChatClosed) {
      return;
    }

    // Check if pre-generation has already been done for this chat
    (async () => {
      try {
        const { data: chatData, error: chatError } = await supabase
          .from("chats")
          .select("context_data")
          .eq("id", chatId)
          .single();

        if (chatError || !chatData) {
          console.log("ℹ️ Could not check pregen_done flag:", chatError?.message);
          return;
        }

        const contextData = chatData.context_data || {};
        
        // If pre-generation already done, skip
        if (contextData.pregen_done === true) {
          console.log("ℹ️ Pre-generation already done for this chat");
          return;
        }

        // Trigger pre-generation in background (non-blocking)
        console.log("⚡ Triggering 3-turn pre-generation...");
        
        const { data: invokeData, error: invokeError } = await supabase.functions.invoke(
          "generate-pregenerated-turns",
          {
            body: { chatId }
          }
        );

        if (invokeError) {
          // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
          console.error("❌ Failed to trigger pre-generation:", invokeError);
          console.error("❌ Pre-generation error details:", JSON.stringify(invokeError, null, 2));
          return; // Silently fail - no user-facing error
        }
        
        if (invokeData) {
          console.log("✅ Pre-generation response:", JSON.stringify(invokeData, null, 2));
        }

        // Mark pregen_done flag after successful generation
        const updatedContextData = {
          ...contextData,
          pregen_done: true
        };

        const { error: updateError } = await supabase
          .from("chats")
          .update({ context_data: updatedContextData })
          .eq("id", chatId);

        if (updateError) {
          console.error("❌ Failed to update pregen_done flag:", updateError);
        } else {
          console.log("⚡ Pre-generation done for this chat");
        }
      } catch (err) {
        // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
        console.error("❌ Error during pre-generation trigger:", err);
        // Silently fail - no user-facing error
      }
    })();
  }, [initialLoading, chatId, user?.id, messages.length, isChatClosed]);

  // 🔄 Tab focus refresh logic - regenerate options when user returns
  // Removed tab-focus auto refresh to avoid duplicate orchestrator calls
  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          style={{ paddingLeft: 16 }}
          onPress={async () => {
            if (hasSentMessage.current) {
              // ✅ After first message sent → go to My Talks/Contact Talks conversation page
              if (contactId) {
                router.replace(`/contact-chat-details?contactId=${contactId}`);
              } else {
                // Fallback to chats tab if no contactId
                router.replace('/(tabs)/chats');
              }
            } else {
              // ✅ Before first message sent → go back to Stage 4 to edit details
              // Get the AI source chat ID if not already stored
              let sourceChatId = aiSourceChatId;
              if (!sourceChatId && currentChatId) {
                try {
                  const { data: chatData } = await supabase
                    .from("chats")
                    .select("ai_source_chat_id")
                    .eq("id", currentChatId)
                    .maybeSingle();
                  sourceChatId = chatData?.ai_source_chat_id || null;
                  if (sourceChatId) {
                    setAiSourceChatId(sourceChatId);
                  }
                } catch (err) {
                  console.warn('⚠️ Failed to fetch AI source chat ID:', err);
                }
              }
              
              if (sourceChatId) {
                // ✅ Navigate to AI chat with the source chat ID to restore Stage 4
                console.log('🔙 Navigating back to Stage 4 with AI chat ID:', sourceChatId);
                router.push({
                  pathname: '/ai-chat',
                  params: {
                    contactId: contactId as string,
                    chatId: sourceChatId, // ✅ Use AI source chat ID, not contact chat ID
                    mode: 'continue',
                    returnStage: 'ready',
                    fromContactChat: '1',
                    sent: '0',
                    skipReturnBanner: '1',
                  },
                });
              } else {
                // Fallback: try to find the AI chat by contact ID
                console.warn('⚠️ No AI source chat ID found, trying to find AI chat by contact');
                router.push({
                  pathname: '/ai-chat',
                  params: {
                    contactId: contactId as string,
                    mode: 'continue',
                    returnStage: 'ready',
                    fromContactChat: '1',
                    sent: '0',
                    skipReturnBanner: '1',
                  },
                });
              }
            }
          }}
        >
          <ArrowLeft size={24} color={Colors.text.secondary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, contactId, chatId, summaryParam, thoughtsParam, aiContextParam, hasSentMessage, aiSourceChatId, currentChatId]);
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
  
  // 🔥 PATCH: fetchPregeneratedTurn must match correct turn_number
  const fetchPregeneratedTurn = async (chatId: string, userId: string) => {
    if (!chatId || !userId) return null;
    
    // Get chat to determine if user is User A or User B
    const { data: chatData } = await supabase
      .from("chats")
      .select("user_id, contact_id")
      .eq("id", chatId)
      .single();
    
    if (!chatData) {
      console.warn("⚠️ Chat not found for pregenerated turn lookup - chat may have been deleted");
      // ✅ FIX 3: Don't show error to user - just return null silently
      return null;
    }
    
    const isUserA = userId === chatData.user_id;
    const isUserB = userId === chatData.contact_id;
    
    if (!isUserA && !isUserB) {
      console.error("❌ User is neither User A nor User B");
      return null;
    }
    
    // ✅ FIX: Count messages from database to get accurate count (includes just-sent message)
    // This prevents turn number mismatch when message is just sent but not yet in messagesRef
    const { data: allMessages, error: messagesError } = await supabase
      .from("messages")
      .select("sender_id, chat_id") // ✅ Also select chat_id to verify
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    
    let messagesSentByUser: number;
    let userMessagesCount: number; // ✅ Declare outside blocks for logging
    
    if (messagesError) {
      console.warn("⚠️ Error fetching messages for turn calculation, using messagesRef fallback:", messagesError);
      // Fallback to messagesRef if database query fails
      // ✅ CRITICAL: Filter by chat_id to prevent stale data from other chats
      const userMessages = messagesRef.current.filter(m => 
        m.sender_id === userId && m.chat_id === chatId
      );
      messagesSentByUser = userMessages.length;
      userMessagesCount = userMessages.length; // ✅ Store for logging
    } else {
      // ✅ CRITICAL: Double-check chat_id to prevent cross-chat contamination
      // This fixes the issue where database returns messages from wrong chat
      const validMessages = (allMessages || []).filter(m => 
        String(m.chat_id) === String(chatId) && String(m.sender_id) === String(userId)
      );
      const userMessages = validMessages;
      messagesSentByUser = userMessages.length;
      userMessagesCount = userMessages.length; // ✅ Store for logging
      
      // ✅ CRITICAL: Log if database returned messages from wrong chat
      if (allMessages && allMessages.length > 0) {
        const invalidMessages = allMessages.filter(m => String(m.chat_id) !== String(chatId));
        if (invalidMessages.length > 0) {
          console.error("❌ CRITICAL: Database returned messages from different chat!", {
            expectedChatId: chatId,
            invalidMessages: invalidMessages.length,
            validMessages: validMessages.length,
            allMessagesCount: allMessages.length
          });
        }
      }
      
      // ✅ CRITICAL FIX: If database returns 0 messages, this is a new chat
      // This handles the case when coming from Stage 3 "Send to contact" (new chat)
      if (messagesSentByUser === 0) {
        console.log("✅ New chat detected (0 messages in DB) - will use turn 0 for User A");
        // Verify messagesRef doesn't have messages for this chat
        const messagesForThisChat = messagesRef.current.filter(m => m.chat_id === chatId);
        if (messagesForThisChat.length === 0) {
          console.log("✅ Confirmed: No messages in messagesRef for this chat - new chat");
        } else {
          console.warn("⚠️ Mismatch: DB has 0 messages but messagesRef has messages for this chat");
        }
      }
    }
    
    // ✅ CRITICAL FIX: If this is a new chat (0 messages), ensure we use turn 0 for User A
    // This handles the case when coming from Stage 3 "Send to contact"
    if (messagesSentByUser === 0 && isUserA) {
      // New chat, User A's first turn → should be turn 0
      console.log("✅ New chat detected - User A's first turn should be turn_number 0");
      
      // Try to find turn 0 directly
      const { data: turn0Data, error: turn0Error } = await supabase
        .from("pregenerated_turns")
        .select("*")
        .eq("chat_id", chatId)
        .eq("recipient_id", userId)
        .eq("turn_number", 0)
        .is("used_at", null)
        .limit(1);
      
      if (!turn0Error && turn0Data && turn0Data.length > 0) {
        console.log("✅ Found turn 0 for new chat - returning immediately");
        // ✅ Validate recipient_id
        if (String(turn0Data[0].recipient_id) === String(userId)) {
          currentPregeneratedTurnRef.current = {
            turn_number: 0,
            recipient_id: userId,
            options: turn0Data[0].options || []
          };
          return turn0Data[0];
        }
      }
    }
    
    // ✅ FIX 1 & 3: expectedTurn calculation - prevent jumps, always align with message count
    // Rule 1: Turn numbers must never jump ahead
    // Rule 3: For later batches, continue from last turn, but validate against message count
    // 
    // Strategy:
    // 1. Always calculate expected turn from message count first (most reliable)
    // 2. Check MAX in database
    // 3. Use MAX+1 only if it's close to message count (within 1 turn)
    // 4. If MAX is far from expected, use message count (prevents jumps like 3→6)
    
    // ✅ Step 1: Calculate expected turn from message count (always reliable)
    const expectedFromMessages = isUserA 
      ? messagesSentByUser * 2      // User A: 0→0, 1→2, 2→4, ...
      : messagesSentByUser * 2 + 1; // User B: 0→1, 1→3, 2→5, ...
    
    // ✅ Step 2: Check MAX in database
    const { data: maxTurnData, error: maxTurnError } = await supabase
      .from("pregenerated_turns")
      .select("turn_number")
      .eq("chat_id", chatId)
      .eq("recipient_id", userId)
      .order("turn_number", { ascending: false })
      .limit(1);
    
    let expectedTurn: number;
    if (!maxTurnError && maxTurnData && maxTurnData.length > 0) {
      // ✅ Pregenerated turns exist - validate MAX against message count
      const maxTurn = maxTurnData[0].turn_number;
      const maxBasedTurn = maxTurn + 1;
      const difference = maxBasedTurn - expectedFromMessages; // ✅ Use signed difference to detect if MAX is lower
      
      // ✅ CRITICAL: If MAX is LOWER than expected, always use message count
      // This handles cases where turns were deleted (e.g., hint refresh deletes turn 3, MAX becomes 1, but expected is 3)
      if (difference < 0) {
        // ✅ MAX is lower than expected - use message count (turns were likely deleted)
        expectedTurn = expectedFromMessages;
        console.log(`⚠️ MAX turn ${maxTurn} is LOWER than expected ${expectedFromMessages} (difference: ${difference}) - using message count: ${expectedTurn} (turns may have been deleted)`);
      } else if (difference <= 1) {
        // ✅ MAX is close to expected (within 1 turn) - use MAX+1
        // This handles normal sequential progression
        expectedTurn = maxBasedTurn;
        console.log(`✅ Calculated expectedTurn from MAX: ${expectedTurn} (max was ${maxTurn}, expected from messages: ${expectedFromMessages}, difference: ${difference})`);
      } else {
        // ✅ MAX is far from expected (higher) - use message count to prevent jumps
        // This prevents jumps like 3→6 when MAX=5 but user has only sent 1 message (expected=3)
        expectedTurn = expectedFromMessages;
        console.log(`⚠️ MAX turn ${maxTurn} is far from expected ${expectedFromMessages} (difference: ${difference}) - using message count: ${expectedTurn} to prevent jump`);
      }
    } else {
      // ✅ No existing turns - use message count (Rule 2: first batch uses message count)
      expectedTurn = expectedFromMessages;
      console.log(`✅ No existing turns - calculated expectedTurn from message count: ${expectedTurn}`);
    }
    
    console.log("🔍 fetchPregeneratedTurn DETAILED:", {
      chatId,
      userId,
      isUserA,
      isUserB,
      totalMessages: messagesRef.current.length,
      dbMessagesCount: allMessages?.length || 0, // ✅ Log actual DB count
      userMessagesCount: userMessagesCount, // ✅ FIX: Use stored value instead of userMessages.length
      messagesSentByUser,
      expectedTurn,
      messagesRefMessages: messagesRef.current.filter(m => m.chat_id === chatId).length, // ✅ Only count messages for this chat
      allMessages: messagesRef.current.map(m => ({
        sender_id: m.sender_id,
        chat_id: m.chat_id,
        content: m.content?.substring(0, 50) || ''
      }))
    });
    
    // ✅ FIX 5: Try exact turn first, then try adjacent turns if not found (handles timing issues)
    let turnNumbersToTry = [expectedTurn];
    
    // If exact turn not found, try adjacent turns to handle timing/calculation issues
    turnNumbersToTry = [expectedTurn, expectedTurn - 1, expectedTurn + 1, expectedTurn - 2, expectedTurn + 2];
    
    for (const turnNum of turnNumbersToTry) {
      if (turnNum < 0) continue; // Skip negative turn numbers
      
      const { data, error } = await supabase
        .from("pregenerated_turns")
        .select("*")
        .eq("chat_id", chatId)
        .eq("recipient_id", userId)
        .eq("turn_number", turnNum)
        .is("used_at", null)
        .limit(1);
      
      if (error) {
        console.warn(`⚠️ Error fetching pregenerated turn ${turnNum}:`, error);
        continue; // Try next turn number
      }
      
      if (data && data.length > 0) {
        // ✅ FIX 7: Validate recipient_id with better logging
        if (String(data[0].recipient_id) !== String(userId)) {
          console.warn("⚠️ Pregenerated turn recipient_id mismatch (non-critical):", {
            expectedUserId: userId,
            actualRecipientId: data[0].recipient_id,
            turn_number: turnNum,
            isUserA,
            isUserB,
            expectedAsString: String(userId),
            actualAsString: String(data[0].recipient_id)
          });
          continue; // Try next turn number
        }
        
        // ✅ Found valid turn!
        const foundTurn = turnNum !== expectedTurn 
          ? `turn_number ${turnNum} (expected was ${expectedTurn})`
          : `turn_number ${expectedTurn}`;
        console.log(`✅ Found pregenerated turn for ${isUserA ? 'User A' : 'User B'} at ${foundTurn}`);
        
        // ✅ Store turn info for later use when marking as used
        currentPregeneratedTurnRef.current = {
          turn_number: turnNum, // ✅ Store actual found turn number, not expected
          recipient_id: userId,
          options: data[0].options || [] // ✅ CRITICAL: Store options for validation
        };
        
        return data[0];
      }
    }
    
    // ✅ FIX 5: If still not found, try finding ANY unused turn for this user (last resort)
    console.log(`⚠️ Exact turn ${expectedTurn} not found, trying to find any unused turn...`);
    const { data: anyUnused, error: anyUnusedError } = await supabase
      .from("pregenerated_turns")
      .select("*")
      .eq("chat_id", chatId)
      .eq("recipient_id", userId)
      .is("used_at", null)
      .order("turn_number", { ascending: true })
      .limit(1);
    
    if (!anyUnusedError && anyUnused && anyUnused.length > 0) {
      // ✅ Validate recipient_id one more time
      if (String(anyUnused[0].recipient_id) === String(userId)) {
        console.log(`✅ Found unused turn ${anyUnused[0].turn_number} as fallback (expected was ${expectedTurn})`);
        currentPregeneratedTurnRef.current = {
          turn_number: anyUnused[0].turn_number,
          recipient_id: userId,
          options: anyUnused[0].options || []
        };
        return anyUnused[0];
      }
    }
    
    console.log(`ℹ️ No pregenerated turn found for ${isUserA ? 'User A' : 'User B'} at turn_number ${expectedTurn} (tried adjacent turns and fallback)`);
    return null;
  };
  
  // ---- options bootstrap ----
  const fetchInitialOptions = async (
    chatId: string,
    userId: string,
    _retryCount = 0,
    options: { force?: boolean } = {}
  ) => {
    const { force = false } = options;
    
    // 🔥 CRITICAL: Check pregenerated turns FIRST - before ANY other logic
    // This ensures pregenerated options are ALWAYS used when available
    console.log("🔍 Checking pregenerated turns:", { chatId, userId });
    const pregen = await fetchPregeneratedTurn(chatId, userId);
    if (pregen && pregen.options?.length > 0) {
      // ✅ CRITICAL: Verify it's actually this user's turn before showing options
      // Check if recipient_id matches the requesting user
      if (String(pregen.recipient_id) !== String(userId)) {
        console.error("❌ CRITICAL: Pregenerated turn recipient_id mismatch in fetchInitialOptions!", {
          expectedUserId: userId,
          actualRecipientId: pregen.recipient_id,
          turn_number: pregen.turn_number
        });
        // Don't show options to wrong user
        return;
      }
      
      console.log("⚡ Using pregenerated options:", pregen);
      // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
      if (pregen.turn_number !== undefined && pregen.recipient_id) {
        currentPregeneratedTurnRef.current = {
          turn_number: pregen.turn_number,
          recipient_id: pregen.recipient_id,  // ✅ Use recipient_id from database, not userId parameter
          options: pregen.options || []
        };
        console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregen.turn_number} for recipient ${pregen.recipient_id}`);
      }
      const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
      setOptionsWithSource(cleaned, 'pregenerated_turns');
      setShowSuggestedOptions(true);
      isFetchingOptionsRef.current = false;
      resolveWaitingForOptions(userId);
      setLastOptionRefreshTime(Date.now());
      return; // ⛔ Prevent any AI generation or message_options fetch
    }
    
    // ✅ FIX: Prevent duplicate calls - if already fetching for this user, skip
    if (isFetchingOptionsRef.current && _retryCount === 0) {
      console.log("ℹ️ Already fetching options, skipping duplicate call");
      return;
    }
    
    // ✅ FIX: Set fetching flag only on first attempt
    if (_retryCount === 0) {
      isFetchingOptionsRef.current = true;
    }
    
    console.log("🔍 FETCHING INITIAL OPTIONS", { chatId, userId, forced: force, retryCount: _retryCount });
    
    // ✅ CRITICAL: Check if conversation is closed before fetching options
    const { data: closureCheck } = await supabase
      .from("chats")
      .select("is_resolved, closure_state")
      .eq("id", chatId)
      .single();

    if (closureCheck?.is_resolved === true && closureCheck?.closure_state === 'closed') {
      console.log("🛑 Conversation is closed - no initial options needed");
      isFetchingOptionsRef.current = false; // Clear fetching flag
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
          isFetchingOptionsRef.current = false; // Clear fetching flag
          setShowSuggestedOptions(false);
          setSuggestedOptions([]);
          resolveWaitingForOptions(userId);
          return;
        }
      }
    }

    // ✅ FALLBACK: existing message_options query continues below as-is
    const { data, error } = await supabase
      .from("message_options")
      .select("id, options, context_data, recipient_id, created_at")
      .eq("chat_id", chatId)
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("❌ Failed to fetch initial options:", error);
      isFetchingOptionsRef.current = false; // Clear fetching flag on error
      if (force) {
        resolveWaitingForOptions(userId);
        setOptionsGenerationFailed(true);
        showNotification('error', 'Options Failed', 'Response options could not load. Try regenerating or use manual input.');
      }
      return;
    }
    
    // ✅ FIX: Enhanced retry logic for Stage 4 scenario
    // Check if chat has no messages (indicating this is a fresh Stage 4 transition)
    const { data: messagesCheck } = await supabase
      .from("messages")
      .select("id")
      .eq("chat_id", chatId)
      .limit(1);
    
    const isStage4Scenario = !messagesCheck || messagesCheck.length === 0;
    const noOptionsFound = !data || data.length === 0 || !data[0].options || data[0].options.length === 0;
    
    // ✅ FIX: Retry if no options found, especially for Stage 4 scenario
    if (noOptionsFound && _retryCount < 5) {
      if (isStage4Scenario) {
        console.log(`ℹ️ NO INITIAL OPTIONS FOUND YET (Stage 4 scenario) - retrying (${_retryCount + 1}/5)...`);
      } else {
        console.log(`ℹ️ NO OPTIONS FOUND - retrying (${_retryCount + 1}/5)...`);
      }
      // ✅ FIX: Only enter waiting state on first attempt, not on retries
      if (_retryCount === 0) {
        enterWaitingForOptions(userId);
      }
      // Retry after 2 seconds to allow database transaction to commit
      setTimeout(() => {
        fetchInitialOptions(chatId, userId, _retryCount + 1, options);
      }, 2000);
      return;
    }
    
    if (data && data.length > 0 && data[0].options && Array.isArray(data[0].options) && data[0].options.length >= 1) {
      // 🔥 CRITICAL: Double-check pregenerated turns before processing Stage 4 initial options
      // This prevents message_options from overriding pregenerated options
      console.log("🔍 Double-checking pregenerated turns before processing message_options:", { chatId, userId });
      const pregenCheck = await fetchPregeneratedTurn(chatId, userId);
      if (pregenCheck && pregenCheck.options?.length > 0) {
        // ✅ CRITICAL: Verify recipient_id matches current user before showing options
        if (String(pregenCheck.recipient_id) !== String(userId)) {
          console.error("❌ CRITICAL: Pregenerated turn recipient_id mismatch in Stage 4 double-check!", {
            expectedUserId: userId,
            actualRecipientId: pregenCheck.recipient_id,
            turn_number: pregenCheck.turn_number
          });
          // Don't show options to wrong user
          return;
        }
        
        console.log("🚫 Initial options skipped — pregenerated exists");
        console.log("⚡ Using pregenerated options instead of message_options");
        // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
        if (pregenCheck.turn_number !== undefined && pregenCheck.recipient_id) {
          currentPregeneratedTurnRef.current = {
            turn_number: pregenCheck.turn_number,
            recipient_id: pregenCheck.recipient_id,  // ✅ Use recipient_id from database
            options: pregenCheck.options || []
          };
          console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregenCheck.turn_number} for recipient ${pregenCheck.recipient_id}`);
        }
        const cleaned = cleanOptionsForDisplay(pregenCheck.options, contact?.full_name || null);
        setOptionsWithSource(cleaned, 'pregenerated_turns');
        setShowSuggestedOptions(true);
        isFetchingOptionsRef.current = false;
        resolveWaitingForOptions(userId);
        setLastOptionRefreshTime(Date.now());
        return; // ⛔ EXIT - prevent Stage 4 initial options from overriding
      }
      
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
        // ✅ FIX: For Stage 4 scenario, retry if options aren't valid yet
        if (isStage4Scenario && _retryCount < 5) {
          console.log(`🔄 Options not valid yet (Stage 4) - retrying (${_retryCount + 1}/5)...`);
          setTimeout(() => {
            fetchInitialOptions(chatId, userId, _retryCount + 1, options);
          }, 2000);
          return;
        }
        // ✅ FIX: Only enter waiting state if not already waiting and not retrying
        if (_retryCount === 0 && !waitingForOptions) {
          enterWaitingForOptions(userId);
        }
        return;
      }
      
      const signature = `${data[0].id || ""}|${JSON.stringify(data[0].options || [])}`;
      
      // ✅ FIX: Only skip if signature matches AND not forcing AND options already displayed
      if (!force && signature && lastOptionsSignatureRef.current === signature && showSuggestedOptions && suggestedOptions.length > 0) {
        console.log("ℹ️ Options already applied from initial fetch (signature match)");
        isFetchingOptionsRef.current = false;
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
      
      // ✅ FIX: If forcing, clear old options first to ensure fresh display
      if (force) {
        setShowSuggestedOptions(false);
        setSuggestedOptions([]);
      }
      
      const cleanedOptions = cleanOptionsForDisplay(data[0].options || [], contact?.full_name || null);
      console.log("✅ Applying initial options:", cleanedOptions);
      
      // ✅ FIX: Use setTimeout when forcing to ensure state clears first
      if (force) {
        setTimeout(() => {
          setOptionsWithSource(cleanedOptions, 'generate-contextual-options');
          setShowSuggestedOptions(true);
          pendingOptionsSinceRef.current = null;
          isFetchingOptionsRef.current = false;
          resolveWaitingForOptions(userId);
          setLastOptionRefreshTime(Date.now());
          console.log("✅ Fresh options displayed (forced fetch):", cleanedOptions.length);
        }, 50);
      } else {
        setOptionsWithSource(cleanedOptions, 'generate-contextual-options');
        setShowSuggestedOptions(true);
        pendingOptionsSinceRef.current = null;
        isFetchingOptionsRef.current = false;
        setTimeout(() => {
          resolveWaitingForOptions(userId);
        }, 0);
        setLastOptionRefreshTime(Date.now());
      }
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
      // ✅ FIX: Only enter waiting state on first attempt, not on retries
      if (_retryCount === 0) {
        enterWaitingForOptions(userId);
      }
      
      // ✅ FIX: For initial load (not force), retry once after a short delay
      // This handles cases where options are being generated but not yet in DB
      if (!force && _retryCount < 5) {
        console.log(`🔄 Retrying fetch after 2 seconds for initial options (${_retryCount + 1}/5)...`);
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
                isFetchingOptionsRef.current = false; // Clear fetching flag
                setTimeout(() => {
                  resolveWaitingForOptions(userId);
                }, 0);
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
  // 🔥 IMPORTANT PATCH — ensureInitialOptions must prioritize pregenerated turns
  const ensureInitialOptions = async (chatId: string) => {
    if (!user || !chatId) return;
    
    // ✅ FIX: Don't run if we're already fetching options to prevent race conditions
    if (isFetchingOptionsRef.current) {
      console.log("ℹ️ Already fetching options, skipping ensureInitialOptions");
      return;
    }
    // ✅ FIX: Don't run if options are already displayed
    if (showSuggestedOptions && suggestedOptions.length > 0) {
      console.log("ℹ️ Options already displayed, skipping ensureInitialOptions");
      return;
    }
    
    // 🔥 CRITICAL: Check pregenerated turns FIRST - with polling to wait for generation
    console.log("🔍 Checking pregenerated turns (with polling):", { chatId, userId: user.id });
    
    // ✅ FIX: Check immediately first (no delay on first check)
    let pregen = await fetchPregeneratedTurn(chatId, user.id);
    if (pregen && pregen.options?.length > 0 && String(pregen.recipient_id) === String(user.id)) {
      console.log(`✅ Found pregenerated turns immediately in ensureInitialOptions - showing right away`);
      // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
      if (pregen.turn_number !== undefined && pregen.recipient_id) {
        currentPregeneratedTurnRef.current = {
          turn_number: pregen.turn_number,
          recipient_id: pregen.recipient_id,  // ✅ Use recipient_id from database
          options: pregen.options || []
        };
        console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregen.turn_number} for recipient ${pregen.recipient_id}`);
      }
      const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
      setOptionsWithSource(cleaned, 'pregenerated_turns');
      setShowSuggestedOptions(true);
      resolveWaitingForOptions(user.id);
      setLastOptionRefreshTime(Date.now());
      return; // ⛔ EXIT immediately - prevent message_options lookup
    }
    
    // ✅ If not found immediately, poll for up to 5 seconds (increased for reliability)
    const maxWaitTime = 5000; // ✅ Increased from 3000 to 5000 (5 seconds)
    const checkInterval = 300; // Check every 300ms
    let waited = 0;
    
    while (waited < maxWaitTime && (!pregen || !pregen.options?.length)) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
      pregen = await fetchPregeneratedTurn(chatId, user.id);
      if (pregen && pregen.options?.length > 0 && String(pregen.recipient_id) === String(user.id)) {
        console.log(`✅ Found pregenerated turns after ${waited}ms - showing immediately`);
        // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
        if (pregen.turn_number !== undefined && pregen.recipient_id) {
          currentPregeneratedTurnRef.current = {
            turn_number: pregen.turn_number,
            recipient_id: pregen.recipient_id,  // ✅ Use recipient_id from database
            options: pregen.options || []
          };
          console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregen.turn_number} for recipient ${pregen.recipient_id}`);
        }
        const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
        setOptionsWithSource(cleaned, 'pregenerated_turns');
        setShowSuggestedOptions(true);
        resolveWaitingForOptions(user.id);
        setLastOptionRefreshTime(Date.now());
        return; // ⛔ EXIT immediately - prevent message_options lookup
      }
    }
    
    // ✅ If pregenerated turns not found after polling, check if they're being generated
    const isGenerating = isGeneratingPregeneratedTurnsRef.current[chatId] === true;
    if (isGenerating) {
      console.log("⏳ Pregenerated turns are being generated - waiting for realtime subscription instead of showing message_options");
      // Don't show message_options - wait for pregenerated turns via realtime subscription
      enterWaitingForOptions(user.id);
      return;
    }
    
    // ⬇ FALLBACK: Only show message_options if pregenerated turns don't exist AND aren't being generated
    console.log("🔍 ENSURING INITIAL OPTIONS EXIST", { chatId, userId: user.id });
    
    // ⬇ FALLBACK: existing message_options logic
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
        isFetchingOptionsRef.current = false; // Clear fetching flag
        setTimeout(() => {
          resolveWaitingForOptions(String(user.id));
        }, 0);
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
        if (showSuggestedOptions && suggestedOptions.length > 0) {
          resolveWaitingForOptions(String(user.id));
        }
      }
    } catch (err) {
      console.error("❌ ensureInitialOptions error:", err);
      // Don't enter waiting state if already fetching
      if (!isFetchingOptionsRef.current) {
        enterWaitingForOptions(user ? String(user.id) : undefined);
      }
    }
  };
  // ---- realtime: options ----
  const subscribeToOptions = (chatId: string, currentUserId: string) => {
    console.log("🔔 SETTING UP OPTIONS SUBSCRIPTION", { chatId, currentUserId });
    const handleOptionsUpdate = async (payload: any) => {
      const row = payload.new;
      if (!row || !row.options || !Array.isArray(row.options)) return;
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
      
      // 🔥 CRITICAL: Check pregenerated turns FIRST - before processing message_options
      console.log("🔍 Checking pregenerated turns:", { chatId, userId: currentUserId });
      const pregen = await fetchPregeneratedTurn(chatId, currentUserId);
      if (pregen && pregen.options?.length > 0) {
        // ✅ CRITICAL: Verify it's actually this user's turn before showing options
        if (String(pregen.recipient_id) !== String(currentUserId)) {
          console.error("❌ CRITICAL: Pregenerated turn recipient_id mismatch in handleOptionsUpdate!", {
            expectedUserId: currentUserId,
            actualRecipientId: pregen.recipient_id,
            turn_number: pregen.turn_number
          });
          // Don't show options to wrong user
          return;
        }
        
        // ✅ CRITICAL: If pregenerated turns exist, ALWAYS use them (even if message_options are showing)
        // This ensures pregenerated turns override message_options when they arrive
        // ✅ FIX: Also check if the same turn is already displayed to prevent flicker
        if (currentOptionsSourceRef.current === 'pregenerated_turns' && 
            showSuggestedOptions &&
            currentPregeneratedTurnRef.current &&
            currentPregeneratedTurnRef.current.turn_number === pregen.turn_number &&
            String(currentPregeneratedTurnRef.current.recipient_id) === String(currentUserId)) {
          console.log(`⏸️ Pregenerated options already displayed for turn ${pregen.turn_number} - IGNORING update to prevent flicker`);
          return; // ⛔ EXIT immediately - don't process message_options at all
        }
        
        // ✅ CRITICAL: Override message_options with pregenerated turns (even if message_options are currently showing)
        console.log("⚡ Realtime: Using pregenerated options instead of message_options (overriding if needed)");
        const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
        // ✅ CRITICAL FIX: Pass recipient_id from turn data
        await showOptionsWithDelay(cleaned, 'pregenerated_turns', pregen.turn_number, pregen.recipient_id, pregen.options);
        resolveWaitingForOptions(currentUserId);
        setLastOptionRefreshTime(Date.now());
        return; // ⛔ EXIT immediately - prevent message_options from overriding
      }
      
      // ✅ FIX: Check if pregenerated turns are being generated - if so, wait instead of showing message_options
      const isGenerating = isGeneratingPregeneratedTurnsRef.current[chatId] === true;
      if (isGenerating) {
        console.log("⏳ Pregenerated turns are being generated - waiting instead of showing message_options");
        // Don't show message_options - wait for pregenerated turns via realtime subscription
        return;
      }
      
      // ⬇ FALLBACK: apply message_options normally (only if pregenerated turns don't exist AND aren't being generated)
      // ✅ CRITICAL: Final check - query pregenerated turns one more time before showing message_options
      // This catches cases where the first check missed them due to timing or query issues
      const finalPregenCheck = await fetchPregeneratedTurn(chatId, currentUserId);
      if (finalPregenCheck && finalPregenCheck.options?.length > 0 && String(finalPregenCheck.recipient_id) === String(currentUserId)) {
        // ✅ FIX: Check if the same turn is already displayed
        if (currentPregeneratedTurnRef.current &&
            currentPregeneratedTurnRef.current.turn_number === finalPregenCheck.turn_number &&
            currentOptionsSourceRef.current === 'pregenerated_turns' &&
            showSuggestedOptions) {
          console.log(`⏸️ Final check: Options already displayed for turn ${finalPregenCheck.turn_number} - skipping refresh`);
          return; // ⛔ EXIT - don't refresh same turn
        }
        
        console.log("⚡ Final check in handleOptionsUpdate: Found pregenerated turns - using them instead of message_options");
        const cleaned = cleanOptionsForDisplay(finalPregenCheck.options, contact?.full_name || null);
        // ✅ CRITICAL FIX: Pass recipient_id from turn data
        await showOptionsWithDelay(cleaned, 'pregenerated_turns', finalPregenCheck.turn_number, finalPregenCheck.recipient_id, finalPregenCheck.options);
        resolveWaitingForOptions(currentUserId);
        setLastOptionRefreshTime(Date.now());
        return; // ⛔ EXIT - don't show message_options
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
        // ✅ FIX: Don't re-enter waiting state if already waiting for this user
        if (!waitingForOptions || String(pendingOptionsRecipientRef.current) !== String(currentUserId)) {
          enterWaitingForOptions(currentUserId);
        }
        return;
      }

      console.log("✅ Final validated options received for", recipientId, {
        isInitial: isInitialOptions,
        isSubsequent: isFinalSubsequentOptions,
        optionsCount: optionsArray.length
      });
      
      const newSignature = `${row.id || ""}|${JSON.stringify(row.options || [])}`;
      
      // ✅ FIX: Always update if signature is different OR if we're waiting for options
      if (lastOptionsSignatureRef.current === newSignature && !waitingForOptions) {
        console.log("ℹ️ Options signature matches and not waiting - already displayed");
        return;
      }
      
      lastOptionsSignatureRef.current = newSignature;

      // ✅ CRITICAL: Don't apply options if chat is closed
      if (isChatClosed) {
        console.log("🛑 Chat is closed - not applying options from realtime subscription");
        resolveWaitingForOptions(recipientId);
        return;
      }
      
      // ✅ FIX: Clear old options first to ensure UI updates properly
      setShowSuggestedOptions(false);
      setSuggestedOptions([]);
      
      // Use small delay to ensure state clears before setting new options
      setTimeout(() => {
        const cleanedOptions = cleanOptionsForDisplay(optionsArray, contact?.full_name || null);
        setOptionsWithSource(cleanedOptions, 'generate-contextual-options');
        setShowSuggestedOptions(true);
        resolveWaitingForOptions(recipientId);
        setLastOptionRefreshTime(Date.now());
        console.log("✅ New options displayed via realtime:", cleanedOptions.length);
      }, 50);

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
        if (status === 'SUBSCRIBED') {
          console.log("✅ Options subscription is ACTIVE and ready for live updates");
          // ✅ FIX: Once subscribed, do a quick fetch to catch any options that arrived before subscription
          // Use closure variables to ensure we have the correct chatId and userId
          const subscribedChatId = chatId;
          const subscribedUserId = currentUserId;
          setTimeout(async () => {
            if (!subscribedChatId || !subscribedUserId) return;
            
            // 🔥 CRITICAL: Check pregenerated turns FIRST - before quick fetch
            console.log("🔍 Checking pregenerated turns:", { chatId: subscribedChatId, userId: subscribedUserId });
            const pregen = await fetchPregeneratedTurn(subscribedChatId, subscribedUserId);
            if (pregen && pregen.options?.length > 0) {
              // ✅ CRITICAL: Verify recipient_id matches current user before showing options
              if (String(pregen.recipient_id) !== String(subscribedUserId)) {
                console.error("❌ CRITICAL: Pregenerated turn recipient_id mismatch in quick fetch!", {
                  expectedUserId: subscribedUserId,
                  actualRecipientId: pregen.recipient_id,
                  turn_number: pregen.turn_number
                });
                // Don't show options to wrong user
                return;
              }
              
              console.log("⚡ Quick fetch skipped — pregenerated options already exist");
              // Apply pregenerated options immediately
              // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
              if (pregen.turn_number !== undefined && pregen.recipient_id) {
                currentPregeneratedTurnRef.current = {
                  turn_number: pregen.turn_number,
                  recipient_id: pregen.recipient_id,  // ✅ Use recipient_id from database
                  options: pregen.options || []
                };
                console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregen.turn_number} for recipient ${pregen.recipient_id}`);
              }
              const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
              setOptionsWithSource(cleaned, 'pregenerated_turns');
              setShowSuggestedOptions(true);
              resolveWaitingForOptions(subscribedUserId);
              setLastOptionRefreshTime(Date.now());
              return; // ⛔ EXIT immediately - prevent fetchInitialOptions
            }
            
            console.log("🔄 Quick fetch — no pregenerated options found");
            fetchInitialOptions(subscribedChatId, subscribedUserId, 0, { force: false });
          }, 500);
        }
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
            console.log("🎉 Both smileys detected → chat closed, navigating immediately");
            
            // ✅ NEW: Archive pregenerated turns when chat closes (from realtime)
            (async () => {
              try {
                console.log("📦 Archiving pregenerated turns for closed chat (realtime)...");
                const { error: archiveError } = await supabase.functions.invoke("archive-pregenerated-turns", {
                  body: { chatId: chatId }
                });
                if (archiveError) {
                  console.error("❌ Failed to archive pregenerated turns:", archiveError);
                } else {
                  console.log("✅ Pregenerated turns archived successfully");
                }
              } catch (err) {
                console.error("❌ Error archiving pregenerated turns:", err);
                // Non-blocking - continue with closure even if archiving fails
              }
            })();
            
            // ✅ FIX: Immediately hide options when chat closes
            setIsChatClosed(true);
            setShowSuggestedOptions(false);
            setSuggestedOptions([]);
            resolveWaitingForOptions(String(user?.id || ''));
            // ✅ FIX: Navigate to history tab immediately (no delay, no notification, no animation)
            console.log('🚀 Navigating to history tab immediately after closure (from realtime)');
            if (contactId) {
              router.replace({
                pathname: '/contact-chat-details',
                params: { contactId: contactId, autoSwitchToHistory: 'true' }
              });
            } else {
              // Fallback: navigate to chats if contactId is missing
              console.warn('⚠️ contactId missing, navigating to chats tab');
              router.replace('/(tabs)/chats');
            }
          }
        }
      )
    return () => {
      supabase.removeChannel(channel);
    };
  };
  // ---- realtime: messages ----
  const subscribeToMessages = (chatId: string, currentUserId: string) => {
    // ✅ CRITICAL: Clean up existing subscription if it exists (for different chatId)
    if (messageSubscriptionRef.current) {
      console.log("🧹 Cleaning up existing message subscription before creating new one");
      try {
        supabase.removeChannel(messageSubscriptionRef.current);
      } catch (e: any) {
        console.warn("⚠️ Error cleaning up existing subscription:", e.message);
      }
      messageSubscriptionRef.current = null;
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
            console.log(" Message already in list?", exists, "Message ID:", newMsg.id);
            if (exists) {
              console.log("⚠️ Duplicate message detected (by ID), skipping:", newMsg.id);
              return prev; // Return unchanged array
            }
            
            // ✅ FIX: Also check by content + sender_id + timestamp to catch duplicates with different IDs
            const isDuplicate = prev.some((m) => 
              m.content === newMsg.content && 
              m.sender_id === newMsg.sender_id &&
              Math.abs(new Date(m.created_at).getTime() - new Date(newMsg.created_at).getTime()) < 5000 // Within 5 seconds
            );
            
            if (isDuplicate) {
              console.log("⚠️ Duplicate message detected by content/timestamp, skipping");
              return prev;
            }
            
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
          // 🔥 PATCH: On receiving message from other user, use pregenerated first
          if (user && newMsg.sender_id !== user.id) {
            // Message came from the other person → now it's MY turn
            // ✅ CRITICAL: Check if conversation is closed before generating options
            if (isChatClosed) {
              console.log("🛑 Chat is closed (local state) - skipping option generation");
              resolveWaitingForOptions(currentUserId);
              return;
            }
            const { data: closureCheck } = await supabase
              .from("chats")
              .select("is_resolved, closure_state")
              .eq("id", currentChatId)
              .single();

            if (closureCheck?.is_resolved === true && closureCheck?.closure_state === 'closed') {
              console.log("🛑 Conversation is closed - skipping option generation");
              setIsChatClosed(true);
              resolveWaitingForOptions(currentUserId);
              return;
            }
            
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
              recipientIdForOptions,
              currentUserId
            });
            
            // ✅ CRITICAL FIX: Only proceed if current user is the recipient
            // This prevents both users from receiving options simultaneously (especially after turn 5)
            if (String(recipientIdForOptions) !== String(currentUserId)) {
              console.log("ℹ️ Options are for different user - current user is not the recipient, exiting early");
              resolveWaitingForOptions(currentUserId);
              return; // ⛔ EXIT immediately - don't fetch or show options for wrong user
            }
            
            // 🔥 CRITICAL: Check pregenerated turns FIRST - before generating new options
            console.log("🔍 Checking pregenerated turns:", { chatId, userId: recipientIdForOptions });
            let pregen = await fetchPregeneratedTurn(chatId, recipientIdForOptions);
            
            // ✅ FIX: If options exist, use immediately. Only retry if they don't exist (generation in progress)
            if (!pregen || !pregen.options?.length) {
              console.log("ℹ️ No pregenerated turn found, polling for generation (max 5 seconds)...");
              
              // ✅ FIX: Poll with increasing intervals (faster initial checks, longer later)
              // Generation takes 2-5 seconds, so we poll for up to 5 seconds (increased for reliability)
              const maxWaitTime = 5000; // ✅ Increased from 2500 to 5000 (5 seconds)
              const checkInterval = 300; // Check every 300ms
              let waited = 0;
              
              while (waited < maxWaitTime && (!pregen || !pregen.options?.length)) {
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                waited += checkInterval;
                pregen = await fetchPregeneratedTurn(chatId, recipientIdForOptions);
                
                if (pregen && pregen.options?.length > 0) {
                  console.log(`✅ Found pregenerated turn after ${waited}ms`);
                  break;
                }
              }
              
              if (!pregen || !pregen.options?.length) {
                console.log("ℹ️ No pregenerated turn found after polling, will fall back to generate-contextual-options (hardest situation)");
                
                // ✅ NEW: Check if we need to trigger regeneration before falling back
                // Only regenerate if chat is not in pending closure state
                const { data: closureStateCheck } = await supabase
                  .from("chats")
                  .select("closure_state, is_resolved")
                  .eq("id", chatId)
                  .single();
                
                const isPendingClosure = closureStateCheck?.closure_state?.startsWith('pending_');
                const isClosed = closureStateCheck?.is_resolved === true;
                
                if (!isClosed && !isPendingClosure) {
                  // ✅ Check remaining turns count
                  const { data: remainingTurns } = await supabase
                    .from("pregenerated_turns")
                    .select("id")
                    .eq("chat_id", chatId)
                    .is("used_at", null)
                    .limit(4);
                  
                  const remainingCount = remainingTurns?.length || 0;
                  
                  // ✅ Trigger regeneration if turns are running low
                  if (remainingCount <= 1) {
                    // ✅ CRITICAL: Check pendingHint BEFORE triggering regeneration
                    // This prevents premature regeneration when User B submits hint during User A's active turn
                    const { data: chatDataForPendingCheck } = await supabase
                      .from("chats")
                      .select("context_data, user_id")
                      .eq("id", chatId)
                      .single();
                    
                    const pendingHint = chatDataForPendingCheck?.context_data?.pendingHint === true;
                    const hintFromB = chatDataForPendingCheck?.context_data?.hint_from_b || null;
                    
                    // ✅ FIX: Check if latest message is from User A (determines if latestMessageFromA exists)
                    let latestMessageFromA: string | null = null;
                    if (pendingHint && chatDataForPendingCheck) {
                      const { data: latestMessage } = await supabase
                        .from("messages")
                        .select("sender_id, content")
                        .eq("chat_id", chatId)
                        .order("created_at", { ascending: false })
                        .limit(1)
                        .single();
                      
                      if (latestMessage) {
                        const isLatestMessageFromA = String(latestMessage.sender_id) === String(chatDataForPendingCheck.user_id);
                        latestMessageFromA = isLatestMessageFromA ? latestMessage.content : null;
                      }
                    }
                    
                    // ✅ FIX: Use backend rule: block if pendingHint && !latestMessageFromA
                    if (pendingHint && !latestMessageFromA) {
                      console.log("🛑 BLOCKING regeneration from message subscription: pendingHint flag is set and User A has not selected");
                      console.log("📊 Regeneration blocked until User A selects their active turn");
                      console.log("✅ This prevents premature regeneration before User A's message is in conversation history");
                      return; // ✅ EXIT - don't regenerate
                    }
                    
                    console.log("⚡ Triggering regeneration from message subscription (turns running low)");
                    
                    if (currentChatId) {
                      isGeneratingPregeneratedTurnsRef.current[currentChatId] = true;
                    }
                    
                    supabase.functions.invoke("generate-pregenerated-turns", {
                      body: { 
                        chatId: chatId,
                        hintFromB: hintFromB,
                        ...(latestMessageFromA && { latestMessageFromA }) // ✅ Pass if available
                      }
                    }).then(({ data, error }) => {
                      if (currentChatId) {
                        isGeneratingPregeneratedTurnsRef.current[currentChatId] = false;
                      }
                      if (error) {
                        // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
                        console.error("❌ Failed to trigger regeneration from message subscription:", error);
                        // Silently fail - no user-facing error
                      } else {
                        console.log("✅ Regeneration triggered from message subscription:", data);
                      }
                    }).catch(err => {
                      if (currentChatId) {
                        isGeneratingPregeneratedTurnsRef.current[currentChatId] = false;
                      }
                      // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
                      console.error("❌ Error triggering regeneration from message subscription:", err);
                      // Silently fail - no user-facing error
                    });
                  }
                }
                
                // Realtime subscription will still handle new options when they're ready
              }
            }
            
            if (pregen && pregen.options?.length > 0) {
              // ✅ CRITICAL: Verify it's actually the recipient's turn before showing options
              if (String(pregen.recipient_id) !== String(recipientIdForOptions)) {
                console.error("❌ CRITICAL: Pregenerated turn recipient_id mismatch in onMessageReceived!", {
                  expectedRecipientId: recipientIdForOptions,
                  actualRecipientId: pregen.recipient_id,
                  turn_number: pregen.turn_number,
                  currentUserId: currentUserId
                });
                // Don't show options to wrong user
                return;
              }
              
              // ✅ CRITICAL: Only show options if it's the current user's turn
              if (String(recipientIdForOptions) !== String(currentUserId)) {
                console.log("ℹ️ Pregenerated options are for different user - not showing to current user");
                return;
              }
              
              console.log("⚡ onMessageReceived: Using pregenerated options");
              const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
              // ✅ CRITICAL FIX: Pass recipient_id from turn data
              await showOptionsWithDelay(cleaned, 'pregenerated_turns', pregen.turn_number, pregen.recipient_id, pregen.options);
              resolveWaitingForOptions(recipientIdForOptions);
              return; // ⛔ EXIT immediately - prevent generate-contextual-options
            }
            
            // ⬇ FALLBACK: existing generate-contextual-options logic
            // 🔥 CRITICAL: Double-check pregenerated turns before orchestration
            // This prevents orchestration and generate-contextual-options from running
            console.log("🔍 Double-checking pregenerated turns before orchestration:", { chatId, userId: recipientIdForOptions });
            let pregenCheck = await fetchPregeneratedTurn(chatId, recipientIdForOptions);
            
            // ✅ FIX: Poll for pregenerated turns if they don't exist (generation in progress)
            if (!pregenCheck || !pregenCheck.options?.length) {
              console.log("ℹ️ Double-check: No pregenerated turn found, polling for generation (max 5 seconds)...");
              
              // ✅ FIX: Poll with increasing intervals (faster initial checks, longer later)
              const maxWaitTime = 5000; // ✅ Increased from 2500 to 5000 (5 seconds)
              const checkInterval = 300; // Check every 300ms
              let waited = 0;
              
              while (waited < maxWaitTime && (!pregenCheck || !pregenCheck.options?.length)) {
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                waited += checkInterval;
                pregenCheck = await fetchPregeneratedTurn(chatId, recipientIdForOptions);
                
                if (pregenCheck && pregenCheck.options?.length > 0) {
                  console.log(`✅ Double-check: Found pregenerated turn after ${waited}ms`);
                  break;
                }
              }
              
              if (!pregenCheck || !pregenCheck.options?.length) {
                console.log("ℹ️ Double-check: No pregenerated turn found after polling, will fall back to orchestration (hardest situation)");
                // Realtime subscription will still handle new options when they're ready
              }
            }
            
            if (pregenCheck && pregenCheck.options?.length > 0) {
              // ✅ CRITICAL: Verify recipient_id matches current user before displaying
              // Only show options if they're meant for the current user
              if (String(pregenCheck.recipient_id) !== String(currentUserId)) {
                console.log("ℹ️ Pregenerated options are for different user (recipient_id mismatch) - not showing to current user");
                // Don't show options - they're for the other user
                // Continue to orchestration/generation
              } else if (String(recipientIdForOptions) !== String(currentUserId)) {
                console.log("ℹ️ Pregenerated options are for different user (recipientIdForOptions mismatch) - not showing to current user");
                // Don't show options - they're for the other user
                // Continue to orchestration/generation
              } else {
                console.log("🚫 Orchestration skipped — pregenerated exists");
                console.log("⚡ Using pregenerated options instead of generating new ones");
                const cleaned = cleanOptionsForDisplay(pregenCheck.options, contact?.full_name || null);
                // ✅ CRITICAL FIX: Pass recipient_id from turn data
                await showOptionsWithDelay(cleaned, 'pregenerated_turns', pregenCheck.turn_number, pregenCheck.recipient_id, pregenCheck.options);
                setShowSuggestedOptions(true);
                resolveWaitingForOptions(recipientIdForOptions);
                return; // ⛔ EXIT - prevent orchestration and generate-contextual-options
              }
            }
            
            // ✅ CRITICAL: Final check - if pregenerated turns exist, skip orchestration entirely
            // This ensures we never call orchestration/generate-contextual-options if pregenerated turns are available
            const finalPregenCheck = await fetchPregeneratedTurn(chatId, recipientIdForOptions);
            if (finalPregenCheck && finalPregenCheck.options?.length > 0 && String(finalPregenCheck.recipient_id) === String(recipientIdForOptions)) {
              // ✅ FIX: Check if the same turn is already displayed
              if (currentPregeneratedTurnRef.current &&
                  currentPregeneratedTurnRef.current.turn_number === finalPregenCheck.turn_number &&
                  String(currentPregeneratedTurnRef.current.recipient_id) === String(recipientIdForOptions) &&
                  currentOptionsSourceRef.current === 'pregenerated_turns' &&
                  showSuggestedOptions) {
                console.log(`⏸️ Final check: Options already displayed for turn ${finalPregenCheck.turn_number} - skipping refresh`);
                resolveWaitingForOptions(recipientIdForOptions);
                return; // ⛔ EXIT - don't refresh same turn
              }
              
              console.log("🚫 Orchestration skipped — final check found pregenerated turns");
              console.log("⚡ Using pregenerated options instead of orchestration");
              const cleaned = cleanOptionsForDisplay(finalPregenCheck.options, contact?.full_name || null);
              // ✅ CRITICAL FIX: Pass recipient_id from turn data
              await showOptionsWithDelay(cleaned, 'pregenerated_turns', finalPregenCheck.turn_number, finalPregenCheck.recipient_id, finalPregenCheck.options);
              setShowSuggestedOptions(true);
              resolveWaitingForOptions(recipientIdForOptions);
              return; // ⛔ EXIT - prevent orchestration and generate-contextual-options
            }
            
            console.log("\n" + "=".repeat(60));
            console.log("📤 CONTACT REPLIED - GENERATING OPTIONS FOR CURRENT USER (FALLBACK ONLY)");
            console.log("=".repeat(60));
            console.log("📬 Contact's message (currentMessage):", newMsg.content.substring(0, 80));
            
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
            console.log("✅ Messages subscription is ACTIVE and ready for live updates");
            // ✅ FIX: Once subscribed, refresh messages to catch any that arrived before subscription
            // Use closure variables to ensure we have the correct chatId and userId
            const subscribedChatId = chatId;
            const subscribedUserId = currentUserId;
            setTimeout(async () => {
              if (subscribedChatId && subscribedUserId) {
                console.log("🔄 Quick refresh after subscription active to catch any missed messages");
                // Fetch messages directly using the subscribed chatId
                try {
                  const { data, error } = await supabase
                    .from("messages")
                    .select("*")
                    .eq("chat_id", subscribedChatId)
                    .order("created_at", { ascending: true });
                  if (error) throw error;
                  if (data) {
                    setMessages((prev) => {
                      // Merge with existing messages, avoiding duplicates
                      const existingIds = new Set(prev.map(m => m.id));
                      const newMessages = (data || []).filter(msg => !existingIds.has(msg.id));
                      if (newMessages.length === 0) return prev;
                      return [...prev, ...newMessages.map((msg) => ({
                        id: msg.id,
                        content: msg.content,
                        sender_type: (msg.sender_id === subscribedUserId ? "user" : "contact") as "user" | "contact",
                        sender_id: msg.sender_id,
                        created_at: msg.created_at,
                      }))];
                    });
                  }
                } catch (err) {
                  console.error("⚠️ Error refreshing messages after subscription:", err);
                }
              }
            }, 500);
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
      // ✅ CRITICAL: Check if this will be the first message (but don't mark yet)
      let isFirstMessage = false;
      let sourceChatId: string | null = null;
      
      if (chatCheck) {
        const { count: existingMessageCount } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("chat_id", currentChatId);
        
        isFirstMessage = (existingMessageCount || 0) === 0;
        sourceChatId = chatCheck.ai_source_chat_id || null;
      }

      // ✅ Insert message FIRST
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
      
      // ✅ FIX: Update messagesRef immediately so turn calculation is accurate
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.id)) return prev;
        const newMessages = [
          ...prev,
          {
            id: data.id,
            content: data.content,
            sender_type: "user",
            sender_id: user?.id || "",
            created_at: data.created_at,
          },
        ];
        // ✅ CRITICAL: Update messagesRef immediately for accurate turn calculation
        messagesRef.current = newMessages;
        return newMessages;
      });
      
      // ✅ CRITICAL: Only mark as sent_to_contact AFTER successful message insert
      if (isFirstMessage && sourceChatId) {
        const { data: sourceChat } = await supabase
          .from("chats")
          .select("context_data")
          .eq("id", sourceChatId)
          .eq("chat_type", "ai_assistant")
          .single();
        
        if (sourceChat?.context_data) {
          await supabase
            .from("chats")
            .update({
              context_data: {
                ...sourceChat.context_data,
                sent_to_contact: true, // ✅ Mark as sent ONLY after message is successfully sent
              },
            })
            .eq("id", sourceChatId)
            .eq("chat_type", "ai_assistant");
          console.log("✅ Marked source AI chat as sent_to_contact: true");
        }
      }
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
      // 😊 Mutual emoji detection for proper closure - ANY emoji triggers closure, not just closure smileys
      // Check if the message is emoji-only (any emoji)
      const isEmojiOnly = /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(content.trim()) && 
                          content.trim().length > 0 &&
                          !/[a-zA-Z0-9]/.test(content.trim()); // Ensure no letters/numbers
      
      if (isEmojiOnly) {
        // ✅ FIX 1: Check for consecutive smileys (last 2 messages must both be smileys from different users)
        const { data: lastMessages } = await supabase
          .from("messages")
          .select("id, sender_id, content, created_at")
          .eq("chat_id", currentChatId)
          .order("created_at", { ascending: false })
          .limit(2);
        
        const isConsecutiveSmileys = lastMessages && lastMessages.length === 2 && 
          lastMessages[0].sender_id !== lastMessages[1].sender_id &&
          /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(lastMessages[0].content.trim()) &&
          !/[a-zA-Z0-9]/.test(lastMessages[0].content.trim()) &&
          /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(lastMessages[1].content.trim()) &&
          !/[a-zA-Z0-9]/.test(lastMessages[1].content.trim());
        
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
            // ✅ FIX 1: Only close if last 2 messages are consecutive smileys from different users
          if (isConsecutiveSmileys) {
            // ✅ Consecutive smileys from different users → fully closed
            updateData.closure_state = 'closed';
            updateData.is_resolved = true;
            updateData.closure_achieved_at = new Date().toISOString();
            console.log("✅ Consecutive smileys detected - conversation closed!");
            
            // ✅ NEW: Archive pregenerated turns when chat closes
            (async () => {
              try {
                console.log("📦 Archiving pregenerated turns for closed chat...");
                const { error: archiveError } = await supabase.functions.invoke("archive-pregenerated-turns", {
                  body: { chatId: currentChatId }
                });
                if (archiveError) {
                  console.error("❌ Failed to archive pregenerated turns:", archiveError);
                } else {
                  console.log("✅ Pregenerated turns archived successfully");
                }
              } catch (err) {
                console.error("❌ Error archiving pregenerated turns:", err);
                // Non-blocking - continue with closure even if archiving fails
              }
            })();
            
            // ✅ FIX: Immediately hide options and stop generating new ones
            setIsChatClosed(true);
            setShowSuggestedOptions(false);
            setSuggestedOptions([]);
            resolveWaitingForOptions(String(user?.id || ''));
            // ✅ FIX: Navigate to history tab immediately (no delay, no notification)
            console.log('🚀 Navigating to history tab immediately after closure (from message send)');
            if (contactId) {
              router.replace({
                pathname: '/contact-chat-details',
                params: { contactId: contactId, autoSwitchToHistory: 'true' }
              });
            } else {
              console.warn('⚠️ contactId missing, navigating to chats tab');
              router.replace('/(tabs)/chats');
            }
            // Notify both via Supabase trigger — don't show banner here yet
          } else {
            // 🕊 Not consecutive smileys → only mark pending, no closure yet
            updateData.closure_state = isUserA
              ? 'pending_user_b_smiley'
              : 'pending_user_a_smiley';
            console.log(`⏳ Not consecutive smileys - waiting for ${isUserA ? 'User B' : 'User A'} to send emoji`);
            showNotification('success', 'Closure Pending', 'Waiting for the other person to confirm completion');
          }
          await supabase
            .from("chats")
            .update(updateData)
            .eq("id", currentChatId);
          if (isConsecutiveSmileys) {
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
      
      // ✅ CRITICAL FIX: Fetch fresh context_data to preserve hint_from_b and pendingHint
      // This prevents the hint from being lost when User A sends a message
      const { data: freshChatData } = await supabase
        .from("chats")
        .select("context_data")
        .eq("id", currentChatId)
        .single();
      
      const updatedContextData = freshChatData?.context_data
        ? { 
            ...freshChatData.context_data, // ✅ Use fresh data to preserve hint_from_b and pendingHint
            initial_pending: false, 
            session_promoted: true 
          }
        : { initial_pending: false, session_promoted: true };
      
      console.log("🔍 Context data preservation check:", {
        hasHintFromB: !!freshChatData?.context_data?.hint_from_b,
        hasPendingHint: !!freshChatData?.context_data?.pendingHint,
        hintLength: freshChatData?.context_data?.hint_from_b?.length || 0
      });
      
      // ✅ FIX 1: Ensure last_message_at is ALWAYS updated for chat count
      const { error: updateChatError } = await supabase
        .from("chats")
        .update({
          last_message: content,
          last_message_at: new Date().toISOString(), // ✅ CRITICAL: Always update for chat count
          context_data: updatedContextData,
        })
        .eq("id", currentChatId);
      
      if (updateChatError) {
        console.error("❌ Failed to update chat last_message_at:", updateChatError);
        // ✅ Don't throw - just log, but ensure message is still sent
      } else {
        console.log("✅ Updated chat last_message_at for chat count");
      }
      
      // ✅ CRITICAL FIX: DO NOT trigger regeneration after every message send
      // This was causing unnecessary regeneration and overwriting existing turns (0,1,2)
      // The issue: After User A sends turn 0, backend recalculates startingTurnNumber=1
      // and expects turns 1,2,3. Since turn 3 doesn't exist, it regenerates and overwrites!
      // Solution: Only rely on remainingCount check (when <= 1 turn remains) to trigger regeneration
      if (recipientId && currentChatId) {
        // ✅ Just enter waiting state - existing pregenerated turns will be shown via realtime subscription
        // If turns don't exist, the remainingCount check will trigger regeneration when needed (<= 1 turn remaining)
        console.log("ℹ️ Message sent - using existing pregenerated turns (regeneration only happens when remainingCount <= 1)");
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

      // 🔥 CRITICAL: Check pregenerated turns BEFORE orchestration in sendMessage
      // This prevents orchestration and generate-contextual-options from running
      if (recipientId && currentChatId) {
        console.log("🔍 Checking pregenerated turns before orchestration (sendMessage):", { chatId: currentChatId, userId: recipientId });
        let pregenCheck = await fetchPregeneratedTurn(currentChatId, recipientId);
        
        // ✅ FIX: Poll for pregenerated turns if they don't exist (generation in progress)
        if (!pregenCheck || !pregenCheck.options?.length) {
          console.log("ℹ️ No pregenerated turn found, polling for generation (max 7 seconds)...");
          
          // ✅ FIX: Poll with increasing intervals (faster initial checks, longer later)
          const maxWaitTime = 7000; // ✅ Changed from 2500 to 7000 (7 seconds)
          const checkInterval = 300; // Check every 300ms
          let waited = 0;
          
          while (waited < maxWaitTime && (!pregenCheck || !pregenCheck.options?.length)) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waited += checkInterval;
            pregenCheck = await fetchPregeneratedTurn(currentChatId, recipientId);
            
            if (pregenCheck && pregenCheck.options?.length > 0) {
              console.log(`✅ Found pregenerated turn after ${waited}ms (sendMessage)`);
              break;
            }
          }
          
          if (!pregenCheck || !pregenCheck.options?.length) {
            // ✅ CRITICAL: Check if generation is in progress before falling back
            const isGenerating = isGeneratingPregeneratedTurnsRef.current[currentChatId];
            
            if (isGenerating) {
              console.log("⏳ Pregenerated turns generation in progress - waiting for realtime subscription instead of falling back");
              // Don't fall back - wait for realtime subscription to deliver the options
              enterWaitingForOptions(recipientId);
              return; // ⛔ EXIT - don't call orchestrate-conversation
            }
            
            console.log("ℹ️ No pregenerated turn found after polling, will fall back to orchestration - sendMessage");
            // Realtime subscription will still handle new options when they're ready
          }
        }
        
        if (pregenCheck && pregenCheck.options?.length > 0) {
          // ✅ CRITICAL: Verify recipient_id matches current user before displaying
          // Only show options if they're meant for the current user
          if (String(pregenCheck.recipient_id) !== String(user?.id)) {
            console.log("ℹ️ Pregenerated options are for different user (recipientId) - not showing to current user");
            // Don't show options - they're for the other user
            // Continue to orchestration/generation for the correct recipient
          } else if (String(recipientId) !== String(user?.id)) {
            console.log("ℹ️ Pregenerated options are for different user (calculated recipientId) - not showing to current user");
            // Don't show options - they're for the other user
            // Continue to orchestration/generation for the correct recipient
          } else {
            console.log("🚫 Orchestration skipped — pregenerated exists (sendMessage)");
            console.log("⚡ Using pregenerated options instead of generating new ones");
            // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
            if (pregenCheck.turn_number !== undefined && pregenCheck.recipient_id) {
              currentPregeneratedTurnRef.current = {
                turn_number: pregenCheck.turn_number,
                recipient_id: pregenCheck.recipient_id,  // ✅ Use recipient_id from database
                options: pregenCheck.options || []
              };
              console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregenCheck.turn_number} for recipient ${pregenCheck.recipient_id}`);
            }
            const cleaned = cleanOptionsForDisplay(pregenCheck.options, contact?.full_name || null);
            setOptionsWithSource(cleaned, 'pregenerated_turns');
            setShowSuggestedOptions(true);
            setLoading(false);
            resolveWaitingForOptions(recipientId);
            setLastOptionRefreshTime(Date.now());
            return; // ⛔ EXIT - prevent orchestration and generate-contextual-options
          }
        }
      }
      
      // ✅ CRITICAL: Final check - if pregenerated turns exist OR are being generated, don't call generate-contextual-options
      // This prevents generate-contextual-options from running and creating message_options that cause flickering
      if (recipientId && currentChatId) {
        // Check if pregenerated turns are currently being generated
        if (isGeneratingPregeneratedTurnsRef.current[currentChatId]) {
          console.log("⏳ Pregenerated turns generation in progress - waiting before allowing fallback...");
          // Wait a bit more and check again
          await new Promise(resolve => setTimeout(resolve, 1000));
          const pregenCheck = await fetchPregeneratedTurn(currentChatId, recipientId);
          if (pregenCheck && pregenCheck.options?.length > 0 && String(pregenCheck.recipient_id) === String(recipientId)) {
            console.log("✅ Pregenerated turns found after waiting - SKIPPING generate-contextual-options");
            setLoading(false);
            return; // ⛔ EXIT - don't call generate-contextual-options
          }
        }
        
        // Check if pregenerated turns already exist
        const finalPregenCheck = await fetchPregeneratedTurn(currentChatId, recipientId);
        if (finalPregenCheck && finalPregenCheck.options?.length > 0 && String(finalPregenCheck.recipient_id) === String(recipientId)) {
          console.log("🚫 Final check: Pregenerated turns exist - SKIPPING orchestration and generate-contextual-options completely");
          console.log("⚡ Pregenerated options will be displayed via realtime subscription - no need to generate new ones");
          setLoading(false);
          return; // ⛔ EXIT - don't call generate-contextual-options at all
        }
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
    setTimeout(async () => {
      setShowSuggestedOptions(false);
      
      // ✅ CRITICAL: Send option EXACTLY as generated - no frontend blending needed
      // The AI already generates options with acknowledgments built-in (two-part structure)
      // Users see and send the same message - maintaining trust and consistency
      const trimmedOption = option.trim();
      
      // ✅ Only special case: Emoji-only messages (no text)
      // Check if the message is ONLY emoji(s) - no text characters
      // This regex matches Unicode emoji characters (including variations, modifiers, and zero-width joiners)
      const isEmojiOnly = /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(trimmedOption) && 
                          trimmedOption.trim().length > 0 &&
                          !/[a-zA-Z0-9]/.test(trimmedOption); // Ensure no letters/numbers
      
      // ✅ CRITICAL FIX: Save currentPregeneratedTurnRef BEFORE sendMessage
      // sendMessage calls fetchPregeneratedTurn for the recipient, which overwrites the ref
      // We need to preserve the ref for the CURRENT user's turn (the one being selected)
      let savedTurnInfo = currentPregeneratedTurnRef.current ? {
        turn_number: currentPregeneratedTurnRef.current.turn_number,
        recipient_id: currentPregeneratedTurnRef.current.recipient_id,
        options: currentPregeneratedTurnRef.current.options || []
      } : null;
      
      // ✅ CRITICAL FIX: Log savedTurnInfo to debug hint submission scenario
      console.log("🔍🔍🔍 SAVED TURN INFO FOR MARKING:", {
        hasSavedTurnInfo: !!savedTurnInfo,
        turn_number: savedTurnInfo?.turn_number,
        recipient_id: savedTurnInfo?.recipient_id,
        optionsCount: savedTurnInfo?.options?.length || 0,
        currentPregeneratedTurnRef: currentPregeneratedTurnRef.current ? {
          turn_number: currentPregeneratedTurnRef.current.turn_number,
          recipient_id: currentPregeneratedTurnRef.current.recipient_id
        } : null
      });
      
      // ✅ FIX 3: Await sendMessage() to ensure message is committed before deferred regeneration
      // ✅ CRITICAL: Marking logic will ALWAYS run, even if sendMessage fails
      let messageSentSuccessfully = false;
      try {
        if (isEmojiOnly) {
          console.log('😊 Emoji-only message detected - sending as-is:', trimmedOption);
          await sendMessage(trimmedOption);
        } else {
          // ✅ Send the option exactly as the user selected it
          // The AI generation already includes acknowledgments in the options via two-part structure
          console.log('📤 Sending option exactly as selected (no frontend blending):', trimmedOption.substring(0, 80));
          await sendMessage(trimmedOption);
        }
        messageSentSuccessfully = true;
        console.log("✅ Message sent and committed to DB");
      } catch (error) {
        console.error("❌ Failed to send message (marking will still proceed):", error);
        // ✅ Continue - marking logic will still run even if sendMessage fails
      }

      // ✅ NEW: Mark the selected option as used in the correct table based on source
      // ✅ CRITICAL: Store selectedOption in outer scope so it's accessible in async function
      // ✅ CRITICAL: Marking logic ALWAYS runs (regardless of sendMessage result)
      const selectedOption = trimmedOption; // ✅ Use the original option (no blending)
      (async () => {
        if (!currentChatId || !user) return;

        const actualSource = currentOptionsSourceRef.current;
        console.log(`📝 Marking option as used - source: ${actualSource}`);

        // ✅ FIX: Track if we successfully marked from pregenerated_turns
        let turnMarkedFromPregenerated = false;
        
        // ✅ FIX: Store turn info for deferred regeneration BEFORE clearing ref
        let savedTurnInfoForDeferredRegen: { turn_number: number; recipient_id: string; selected_option: string } | null = null;

        // ✅ FIX: Declare optionMatches outside if block for use in fallback logic
        let optionMatches = false;

        // ✅ FIX 2 & 3: Update the correct table based on actual source used
        if (actualSource === 'pregenerated_turns') {
          // ✅ CRITICAL FIX: Use savedTurnInfo instead of currentPregeneratedTurnRef.current
          // sendMessage() overwrites the ref when it fetches turns for the recipient
          // savedTurnInfo preserves the CURRENT user's turn info (the one being selected)
          let storedTurnInfo = savedTurnInfo;
        
          // ✅ CRITICAL FIX: If savedTurnInfo is null, try to fetch it from DB
          if (!storedTurnInfo) {
            console.log("⚠️ savedTurnInfo is null - attempting to fetch from DB...");
            
            // Calculate expected turn number
            const userMessages = messagesRef.current.filter(m => m.sender_id === user?.id);
            const messagesSentByUser = userMessages.length;
            const { data: chatData } = await supabase
              .from("chats")
              .select("user_id, contact_id")
              .eq("id", currentChatId)
              .single();
            
            if (chatData) {
              const isUserA = user?.id === chatData.user_id;
              const expectedTurn = isUserA ? messagesSentByUser * 2 : messagesSentByUser * 2 + 1;
              
              // Try to fetch the turn from DB
              const { data: turnFromDB, error: fetchError } = await supabase
                .from("pregenerated_turns")
                .select("turn_number, recipient_id, options")
                .eq("chat_id", currentChatId)
                .eq("turn_number", expectedTurn)
                .eq("recipient_id", user?.id)
                .is("used_at", null)
                .single();
              
              if (!fetchError && turnFromDB) {
                console.log("✅ Found turn from DB - using it for marking:", {
                  turn_number: turnFromDB.turn_number,
                  recipient_id: turnFromDB.recipient_id
                });
                
                // Use the fetched turn info
                storedTurnInfo = {
                  turn_number: turnFromDB.turn_number,
                  recipient_id: turnFromDB.recipient_id,
                  options: turnFromDB.options || []
                };
                
                // Update savedTurnInfo for consistency
                savedTurnInfo = storedTurnInfo;
              } else {
                console.error("❌ Could not fetch turn from DB:", fetchError);
              }
            }
          }
        
          if (!storedTurnInfo) {
            console.log("⚠️ No stored pregen turn info found or recipient mismatch - attempting fallback...");
            
            // ✅ FIX: Try to find the most recent unused turn for this user first
            const { data: unusedTurns, error: findError } = await supabase
              .from("pregenerated_turns")
              .select("turn_number, recipient_id")
              .eq("chat_id", currentChatId)
              .eq("recipient_id", user.id)
              .is("used_at", null)
              .order("turn_number", { ascending: false })
              .limit(1);
            
            if (!findError && unusedTurns && unusedTurns.length > 0) {
              const turnToMark = unusedTurns[0].turn_number;
              console.log(`✅ Fallback: Found unused turn ${turnToMark} for user ${user.id}`);
              
              // Mark this turn as used
              const { error: markError } = await supabase
                .from("pregenerated_turns")
                .update({
                  selected_message: selectedOption,
                  used_at: new Date().toISOString(),
                  source: 'pregenerated_turns' // ✅ Set source ONLY when user selects (not on insert)
                })
                .eq("chat_id", currentChatId)
                .eq("recipient_id", user.id)
                .eq("turn_number", turnToMark)
                .is("used_at", null);
              
              if (!markError) {
                console.log(`✅ Fallback: Marked pregen turn ${turnToMark} as used - keeping all turns in table`);
                
                // ✅ FIX: REMOVED deletion of future turns - all turns must remain in sequence
                // const recipientIdToDelete = unusedTurns[0].recipient_id;
                // await supabase
                //   .from("pregenerated_turns")
                //   .delete()
                //   .eq("chat_id", currentChatId)
                //   .eq("recipient_id", recipientIdToDelete)
                //   .gt("turn_number", turnToMark)
                //   .is("used_at", null);
                // console.log(`✅ Fallback: Deleted future turns for recipient ${recipientIdToDelete} after turn ${turnToMark}`);
              } else {
                console.error(`❌ Fallback: Could not mark turn ${turnToMark} as used:`, markError);
              }
            } else {
              // ✅ FALLBACK: Try to find the turn by recalculating as last resort
              const userMessages = messagesRef.current.filter(m => m.sender_id === user.id);
              const messagesSentByUser = userMessages.length;
              const { data: chatData } = await supabase
                .from("chats")
                .select("user_id, contact_id")
                .eq("id", currentChatId)
                .single();
              
              if (chatData) {
                const isUserA = user.id === chatData.user_id;
                const expectedTurn = isUserA ? messagesSentByUser * 2 : messagesSentByUser * 2 + 1;
                
                // Try to mark this turn as used
                const { error: markError } = await supabase
                  .from("pregenerated_turns")
                  .update({
                  selected_message: selectedOption,
                  used_at: new Date().toISOString(),
                  source: 'pregenerated_turns' // ✅ Set source ONLY when user selects (not on insert)
                  })
                  .eq("chat_id", currentChatId)
                  .eq("recipient_id", user.id)
                  .eq("turn_number", expectedTurn)
                  .is("used_at", null);
                
                if (!markError) {
                  console.log(`✅ Fallback (calculated): Marked pregen turn ${expectedTurn} as used - keeping all turns in table`);
                  
                  // ✅ FIX: REMOVED deletion of future turns - all turns must remain in sequence
                  // await supabase
                  //   .from("pregenerated_turns")
                  //   .delete()
                  //   .eq("chat_id", currentChatId)
                  //   .eq("recipient_id", user.id)
                  //   .gt("turn_number", expectedTurn + 2)
                  //   .is("used_at", null);
                  // console.log(`✅ Fallback (calculated): Deleted future turns for recipient ${user.id} after turn ${expectedTurn}`);
                } else {
                  console.error(`❌ Fallback (calculated): Could not mark turn ${expectedTurn} as used:`, markError);
                }
              }
            }
            return;
          }
          
          const turnNumberToMark = storedTurnInfo.turn_number;

          console.log(`🔍 Marking pregen turn as used:`, {
            userId: user.id,
            turnNumberToMark,
            storedTurnInfo,
            source: actualSource,
            recipientIdMatch: String(storedTurnInfo.recipient_id) === String(user.id)
          });

          // ✅ CRITICAL: Verify selected option matches one of the stored options before marking
          // This prevents marking pregenerated turns when options came from generate-contextual-options
          let storedOptions = storedTurnInfo.options || [];
          
          // ✅ FIX: If options are empty in ref, fetch them from database as fallback
          if (storedOptions.length === 0 && turnNumberToMark !== undefined) {
            console.log("⚠️ Options not in ref - fetching from database for validation");
            const { data: turnData } = await supabase
              .from("pregenerated_turns")
              .select("options")
              .eq("chat_id", currentChatId)
              .eq("recipient_id", storedTurnInfo.recipient_id)
              .eq("turn_number", turnNumberToMark)
              .is("used_at", null)
              .single();
            
            if (turnData?.options && Array.isArray(turnData.options)) {
              storedOptions = turnData.options;
              // Update ref with fetched options
              if (currentPregeneratedTurnRef.current) {
                currentPregeneratedTurnRef.current = {
                  ...currentPregeneratedTurnRef.current,
                  options: storedOptions
                };
              }
              console.log(`✅ Fetched ${storedOptions.length} options from database for validation`);
            } else {
              console.warn("⚠️ Could not fetch options from database - will proceed with validation anyway");
            }
          }
          
          optionMatches = storedOptions.length > 0 && storedOptions.some(opt => {
            const stored = opt.trim();
            const selected = selectedOption.trim();
            
            // ✅ FIX: Direct comparison first (works for emojis)
            if (stored === selected) return true;
            
            // ✅ FIX: For emoji-only, use direct comparison without lowercasing
            const isEmojiOnly = /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(selected);
            if (isEmojiOnly) {
              // For emojis, only exact match (no includes check needed)
              return stored === selected;
            }
            
            // ✅ For text options, use normalized comparison
            const normalizedStored = stored.toLowerCase();
            const normalizedSelected = selected.toLowerCase();
            return normalizedStored.includes(normalizedSelected) || 
                   normalizedSelected.includes(normalizedStored);
          });

          if (!optionMatches) {
            // ✅ FIX 6: Change to warning - don't show as error to users
            console.warn("⚠️ Selected option doesn't match stored pregenerated options (non-critical)", {
              selectedOption: selectedOption.substring(0, 100),
              storedOptionsCount: storedOptions.length, // ✅ Don't log full options array
              source: actualSource,
              turnNumber: turnNumberToMark
            });
            // ✅ FIX: If option doesn't match, it's likely from generate-contextual-options
            // Fall through to message_options marking logic instead
            console.log("⚠️ Option mismatch - will mark message_options instead");
            // Continue to message_options marking logic below - DON'T return here
          } else {
            // ✅ FIX 2: Mark this pregenerated turn as used with source tracking and retry logic
            let markError: any = null;
            let markSuccess = false;
            
            // ✅ CRITICAL FIX 1: Always update selected_message, regardless of used_at status
            // First try: with used_at check (preferred - only updates unused turns)
            const { error: firstTryError, data: firstTryData } = await supabase
              .from("pregenerated_turns")
              .update({
                selected_message: selectedOption,
                used_at: new Date().toISOString(),
                source: 'pregenerated_turns'
              })
              .eq("chat_id", currentChatId)
              .eq("recipient_id", storedTurnInfo.recipient_id)
              .eq("turn_number", turnNumberToMark)
              .is("used_at", null)
              .select(); // ✅ CRITICAL: Select to verify update
            
            if (firstTryError) {
              console.warn("⚠️ First attempt to mark pregenerated turn failed, retrying without used_at check:", firstTryError);
              
              // ✅ Retry: without used_at check (in case it was marked between checks)
              // This ensures selected_message is ALWAYS updated, even if used_at is already set
              const { error: retryError, data: retryData } = await supabase
                .from("pregenerated_turns")
                .update({
                  selected_message: selectedOption,  // ✅ Always update selected_message
                  used_at: new Date().toISOString(),  // ✅ Update used_at even if already set
                  source: 'pregenerated_turns'
                })
                .eq("chat_id", currentChatId)
                .eq("recipient_id", storedTurnInfo.recipient_id)
                .eq("turn_number", turnNumberToMark)
                .select(); // ✅ CRITICAL: Select to verify update
              
              if (retryError) {
                markError = retryError;
                console.error("❌ Retry also failed:", retryError);
              } else {
                markSuccess = true;
                console.log(`✅ Marked pregenerated turn ${turnNumberToMark} as used (retry succeeded)`, {
                  selected_message: retryData?.[0]?.selected_message ? `${retryData[0].selected_message.substring(0, 50)}...` : 'NULL',
                  used_at: retryData?.[0]?.used_at || 'NULL',
                  verified: !!retryData?.[0]?.selected_message
                });
              }
            } else {
              markSuccess = true;
              console.log(`✅ Marked pregenerated turn ${turnNumberToMark} as used`, {
                selected_message: firstTryData?.[0]?.selected_message ? `${firstTryData[0].selected_message.substring(0, 50)}...` : 'NULL',
                used_at: firstTryData?.[0]?.used_at || 'NULL',
                verified: !!firstTryData?.[0]?.selected_message
              });
            }
            
            if (markSuccess) {
              // ✅ FIX: REMOVED deletion of future turns - all turns must remain in sequence
              // Previous logic deleted future turns to keep table clean, but this caused:
              // - Missing turns in the sequence after hint submission
              // - Loss of old turns when new batches are generated
              // - Inability to preserve User A's selected messages when User B submits hint
              // Now all turns stay in the table and are archived when chat closes
              
              // const recipientIdToDelete = storedTurnInfo.recipient_id;
              // const { error: deleteError } = await supabase
              //   .from("pregenerated_turns")
              //   .delete()
              //   .eq("chat_id", currentChatId)
              //   .eq("recipient_id", recipientIdToDelete)
              //   .gt("turn_number", turnNumberToMark + 2)
              //   .is("used_at", null);
              // 
              // if (deleteError) {
              //   console.error("❌ Failed to delete future pregenerated turns:", deleteError);
              // } else {
              //   console.log(`✅ Deleted future turns for recipient ${recipientIdToDelete} after turn ${turnNumberToMark}`);
              // }
              
              console.log(`✅ Marked turn ${turnNumberToMark} as used - keeping all turns in table for sequential storage`);
              
              // ✅ FIX: Save turn info BEFORE clearing ref (needed for deferred regeneration)
              savedTurnInfoForDeferredRegen = {
                turn_number: turnNumberToMark,
                recipient_id: storedTurnInfo.recipient_id,
                selected_option: selectedOption
              };
              
              console.log("🔍 Saved turn info for deferred regeneration:", savedTurnInfoForDeferredRegen);
              
              // Clear stored turn info after marking
              currentPregeneratedTurnRef.current = null;
              
              // ✅ FIX: Mark that we successfully marked from pregenerated_turns
              turnMarkedFromPregenerated = true;
              console.log("✅ Pregenerated turn marked as used successfully - will continue to regeneration logic");
              
              // ✅ REQUIREMENT: Wait immediately after marking to ensure DB commit
              console.log("📨 LIVE MESSAGE RECEIVED - waiting for DB commit...");
              await new Promise(res => setTimeout(res, 120));
              console.log("✅ Wait complete - selected_message is fully committed, proceeding to regeneration logic...");
              
              // ✅ Store savedTurnInfo in a way that deferred regeneration can access
              // We'll use it in the deferred regeneration check below
              // ... (continue to deferred regeneration section)
              
              // Don't return early - let code continue to regeneration logic below
            } else {
              // ✅ FIX: If marking fails, fall through to message_options instead
              console.log("⚠️ Marking failed - will try message_options instead");
            }
            // ✅ If marking failed, continue to message_options below
          }
          
          // ✅ FIX: If option doesn't match pregenerated turns, fall through to message_options
          // This handles the case where options came from generate-contextual-options but source was incorrectly set
          // Don't return here - let it fall through to the message_options block below
        }
        
        // ✅ FIX: Handle generate-contextual-options source (either direct or fallback from pregenerated_turns mismatch)
        if (actualSource === 'generate-contextual-options' || (actualSource === 'pregenerated_turns' && !optionMatches)) {
          // ✅ FIX 2: Update message_options table with selected_message
          console.log("🔍 Marking message_options as used (generate-contextual-options)");
          
          // ✅ FIX: REMOVED cleanup of unused pregenerated turns - all turns must remain in sequence
          // Previous logic deleted unused turns when fallback was used, but this caused:
          // - Loss of turns that should be preserved in the sequence
          // - Inability to maintain complete conversation history
          // All turns are now preserved and archived when chat closes
          
          // const { error: cleanupError } = await supabase
          //   .from("pregenerated_turns")
          //   .delete()
          //   .eq("chat_id", currentChatId)
          //   .eq("recipient_id", user.id)
          //   .is("used_at", null);
          // 
          // if (cleanupError) {
          //   console.warn("⚠️ Failed to cleanup unused pregenerated turns (non-critical):", cleanupError);
          // } else {
          //   console.log("✅ Cleaned up unused pregenerated turns (fallback was used)");
          // }
          
          console.log("✅ Marked message_options as used - keeping all pregenerated turns in table for sequential storage");
          
          // Find the most recent message_options for this chat and recipient
          const { data: messageOptionsData, error: fetchError } = await supabase
            .from("message_options")
            .select("id")
            .eq("chat_id", currentChatId)
            .eq("recipient_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
          
          if (fetchError || !messageOptionsData) {
            console.error("❌ Failed to find message_options to update:", fetchError);
          } else {
            // Update message_options with selected_message and source
            const { error: updateError } = await supabase
              .from("message_options")
              .update({
                selected_message: selectedOption,
                source: 'generate-contextual-options' // ✅ Set source ONLY when user selects (not on insert)
              })
              .eq("id", messageOptionsData.id);
            
            if (updateError) {
              console.error("❌ Failed to update message_options.selected_message:", updateError);
            } else {
              console.log("✅ Updated message_options.selected_message and source");
            }
          }
        } else if (!turnMarkedFromPregenerated) {
          // ✅ FIX 4: Only show warning if we didn't successfully mark from pregenerated_turns
          console.warn("⚠️ Unknown source for selected option:", actualSource);
        }
        
        // Clear source tracking after marking
        currentOptionsSourceRef.current = null;

        // ✅ FIX 3: DEFERRED REGENERATION: Only check if message was sent successfully
        // This ensures the message is committed to DB before regeneration runs
        // Regeneration needs the message to calculate correct firstTurnRole and include it in conversation history
        console.log("🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵");
        console.log("🚀 DEFERRED REGENERATION CHECK STARTED");
        console.log("🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵");
        console.log("🔍 Deferred regeneration check:", {
          messageSentSuccessfully,
          actualSource,
          currentChatId,
          userId: user?.id,
          selectedOption: selectedOption.substring(0, 50) + "..."
        });
        
        // ✅ REQUIREMENT 4: Add top-level flag to track deferred regeneration
        let didDeferredRegeneration = false;
        
        if (messageSentSuccessfully) {
          // ✅ DEFERRED REGENERATION: Check for pending hint after option selection
          // If hint was submitted during User A's turn, trigger regeneration now that User A has selected
          console.log("🔍 Step 1: Checking for pendingHint flag...");
          const { data: chatDataForPendingHint, error: pendingHintFetchError } = await supabase
            .from("chats")
            .select("context_data")
            .eq("id", currentChatId)
            .single();

          if (pendingHintFetchError) {
            console.error("❌ Failed to fetch chat data for pendingHint check:", pendingHintFetchError);
          }

          const hasPendingHint = chatDataForPendingHint?.context_data?.pendingHint === true;
          let hintFromB = chatDataForPendingHint?.context_data?.hint_from_b || null;

          // ✅ CRITICAL FIX: If pendingHint=true but hintFromB is missing, retry fetching to handle DB race conditions
          // This ensures hintFromB is ALWAYS available when pendingHint=true, regardless of DB freshness
          if (hasPendingHint && !hintFromB) {
            console.log("⚠️ pendingHint=true but hintFromB is missing - retrying fetch to handle DB race condition...");
            
            let retryAttempts = 0;
            const maxRetries = 5;
            const retryDelay = 100;
            
            while (!hintFromB && retryAttempts < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              retryAttempts++;
              
              const { data: retryChatData, error: retryError } = await supabase
                .from("chats")
                .select("context_data")
                .eq("id", currentChatId)
                .single();
              
              if (!retryError && retryChatData?.context_data?.hint_from_b) {
                hintFromB = retryChatData.context_data.hint_from_b;
                console.log(`✅ Successfully fetched hintFromB on retry attempt ${retryAttempts}:`, {
                  hintLength: hintFromB.length,
                  hintPreview: hintFromB.substring(0, 50) + "..."
                });
                break;
              } else {
                console.log(`⏳ Retry attempt ${retryAttempts}/${maxRetries} - hintFromB still not found...`);
              }
            }
            
            if (!hintFromB) {
              console.error("❌ CRITICAL: pendingHint is true but hint_from_b is missing after retries!");
              console.error("❌ Context data:", JSON.stringify(chatDataForPendingHint?.context_data, null, 2));
              return;
            }
          }
          
          // Original error block replaced with retry logic above
          if (false) {
            console.error("❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌");
            console.error("❌ CRITICAL: pendingHint is true but hint_from_b is missing!");
            console.error("❌ This means hint was not saved correctly - deferred regeneration cannot proceed");
            console.error("❌ Context data:", JSON.stringify(chatDataForPendingHint?.context_data, null, 2));
            console.error("❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌");
            // Don't proceed - this is a critical error that would cause regeneration without hint
            return;
          }

          console.log("🔍 Pending hint check result:", {
            hasPendingHint,
            hintFromB: hintFromB ? `${hintFromB.substring(0, 50)}...` : null,
            hintLength: hintFromB?.length || 0,
            hintVerified: hasPendingHint ? !!hintFromB : 'N/A',
            contextData: chatDataForPendingHint?.context_data ? {
              hasHintFromB: !!chatDataForPendingHint.context_data.hint_from_b,
              pendingHint: chatDataForPendingHint.context_data.pendingHint,
              hintSubmittedAt: chatDataForPendingHint.context_data.hint_submitted_at
            } : null
          });

          if (hasPendingHint) {
            console.log("🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄");
            console.log("🔄 Pending hint detected - triggering deferred regeneration after option selection");
            console.log("⏳ Verifying User A's message and selected_message are committed to DB...");
            console.log("🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄");
            
            // ✅ CRITICAL: Wait for DB operations to complete before regeneration
            // This is DIFFERENT from normal regeneration - we MUST include User A's selected message
            // in conversation history when generating turns 5,6,7 with hint context
            
            // Step 1: Wait for selected_message to be stored in pregenerated_turns
            let selectedMessageStored = false;
            
            // ✅ FIX: Get turn number from savedTurnInfoForDeferredRegen (saved before clearing ref)
            // OR use currentPregeneratedTurnRef as fallback
            let turnNumberToCheck: number | undefined = undefined;
            let recipientIdToCheck: string | undefined = undefined;
            
            if (actualSource === 'pregenerated_turns') {
              // ✅ FIX: Use savedTurnInfoForDeferredRegen first (saved before clearing ref)
              if (savedTurnInfoForDeferredRegen) {
                turnNumberToCheck = savedTurnInfoForDeferredRegen.turn_number;
                recipientIdToCheck = savedTurnInfoForDeferredRegen.recipient_id;
                console.log("🔍 Using savedTurnInfoForDeferredRegen for deferred regeneration:", {
                  turn_number: turnNumberToCheck,
                  recipient_id: recipientIdToCheck,
                  selected_option: savedTurnInfoForDeferredRegen.selected_option.substring(0, 50) + "..."
                });
              } else if (currentPregeneratedTurnRef.current) {
                turnNumberToCheck = currentPregeneratedTurnRef.current.turn_number;
                recipientIdToCheck = currentPregeneratedTurnRef.current.recipient_id;
                console.log("🔍 Using currentPregeneratedTurnRef for deferred regeneration (fallback):", {
                  turn_number: turnNumberToCheck,
                  recipient_id: recipientIdToCheck
                });
              } else {
                // ✅ FIX: Try to find the turn that was just marked
                // Since we just marked it, we can query for the most recent turn with selected_message
                console.log("🔍 currentPregeneratedTurnRef is null - searching for recently marked turn...");
                
                // Get the most recent turn that matches the selected option
                const { data: recentTurns } = await supabase
                  .from("pregenerated_turns")
                  .select("turn_number, recipient_id, selected_message")
                  .eq("chat_id", currentChatId)
                  .eq("selected_message", selectedOption)
                  .order("turn_number", { ascending: false })
                  .limit(1);
                
                if (recentTurns && recentTurns.length > 0) {
                  turnNumberToCheck = recentTurns[0].turn_number;
                  recipientIdToCheck = recentTurns[0].recipient_id;
                  console.log("🔍 Found recently marked turn:", {
                    turn_number: turnNumberToCheck,
                    recipient_id: recipientIdToCheck
                  });
                } else {
                  // Fallback: calculate expected turn
                  const userMessages = messagesRef.current.filter(m => m.sender_id === user?.id);
                  const messagesSentByUser = userMessages.length;
                  const { data: chatData } = await supabase
                    .from("chats")
                    .select("user_id, contact_id")
                    .eq("id", currentChatId)
                    .single();
                  
                  if (chatData) {
                    const isUserA = user?.id === chatData.user_id;
                    turnNumberToCheck = isUserA ? messagesSentByUser * 2 : messagesSentByUser * 2 + 1;
                    recipientIdToCheck = user?.id;
                    console.log("🔍 Calculated expected turn for deferred regeneration:", {
                      turn_number: turnNumberToCheck,
                      recipient_id: recipientIdToCheck,
                      messagesSentByUser,
                      isUserA
                    });
                  }
                }
              }
            }
            
            console.log("🔍 Step 2: Waiting for selected_message to be stored in pregenerated_turns...");
            console.log("🔍 Turn info for verification:", {
              turnNumberToCheck,
              recipientIdToCheck,
              actualSource,
              hasCurrentPregeneratedTurnRef: !!currentPregeneratedTurnRef.current
            });
            
            if (turnNumberToCheck && recipientIdToCheck) {
              let attempts = 0;
              const maxAttempts = 10; // ✅ Increased from 6 to 10 (2.5 seconds max wait)
              
              while (!selectedMessageStored && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 250)); // Wait 250ms between checks
                
                const { data: turnCheck, error: turnCheckError } = await supabase
                  .from("pregenerated_turns")
                  .select("selected_message")
                  .eq("chat_id", currentChatId)
                  .eq("turn_number", turnNumberToCheck)
                  .eq("recipient_id", recipientIdToCheck)
                  .single();
                
                if (turnCheckError) {
                  console.error(`⚠️ Error checking turn ${turnNumberToCheck} (attempt ${attempts + 1}):`, turnCheckError);
                }
                
                if (turnCheck?.selected_message) {
                  selectedMessageStored = true;
                  console.log(`✅ Verified selected_message is stored in DB for turn ${turnNumberToCheck}`);
                  console.log(`✅ Selected message: ${turnCheck.selected_message.substring(0, 50)}...`);
                } else {
                  attempts++;
                  if (attempts < maxAttempts) {
                    console.log(`⏳ Waiting for selected_message to be stored (attempt ${attempts}/${maxAttempts})...`);
                    console.log(`⏳ Turn ${turnNumberToCheck} selected_message: ${turnCheck?.selected_message || 'NULL'}`);
                  }
                }
              }
              
              if (!selectedMessageStored) {
                // Final check
                const { data: finalTurnCheck } = await supabase
                  .from("pregenerated_turns")
                  .select("selected_message")
                  .eq("chat_id", currentChatId)
                  .eq("turn_number", turnNumberToCheck)
                  .eq("recipient_id", recipientIdToCheck)
                  .single();
                
                console.warn(`⚠️ selected_message not stored after ${maxAttempts} attempts - proceeding anyway (may cause issues)`);
                console.warn(`⚠️ Final check - Turn ${turnNumberToCheck} still has selected_message:`, finalTurnCheck?.selected_message || 'NULL');
              }
            } else {
              // Not from pregenerated_turns, skip this check
              selectedMessageStored = true;
              console.log("ℹ️ Source is not pregenerated_turns or turn info not available - skipping selected_message verification");
            }
            
            // Step 2: Wait for User A's message to be committed to DB and visible
            console.log("🔍 Step 3: Waiting for User A's message to be committed to DB...");
            let messageCommitted = false;
            let messageAttempts = 0;
            const maxMessageAttempts = 10; // ✅ Increased from 6 to 10 (2.5 seconds max wait)
            
            while (!messageCommitted && messageAttempts < maxMessageAttempts) {
              await new Promise(resolve => setTimeout(resolve, 250)); // Wait 250ms between checks
              
              // Check if the message exists in DB with matching content
              const { data: messageCheck, error: messageCheckError } = await supabase
                .from("messages")
                .select("id, content, sender_id, created_at")
                .eq("chat_id", currentChatId)
                .eq("sender_id", user?.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .single();
              
              if (messageCheckError) {
                console.error(`⚠️ Error checking message (attempt ${messageAttempts + 1}):`, messageCheckError);
              }
              
              if (messageCheck && messageCheck.content === selectedOption) {
                messageCommitted = true;
                console.log(`✅ Verified User A's message is committed to DB (message ID: ${messageCheck.id})`);
                console.log(`✅ Message content: ${messageCheck.content.substring(0, 50)}...`);
              } else {
                messageAttempts++;
                if (messageAttempts < maxMessageAttempts) {
                  console.log(`⏳ Waiting for User A's message to be committed (attempt ${messageAttempts}/${maxMessageAttempts})...`);
                  if (messageCheck) {
                    console.log(`⏳ Latest message in DB: ${messageCheck.content.substring(0, 50)}...`);
                    console.log(`⏳ Looking for: ${selectedOption.substring(0, 50)}...`);
                    console.log(`⏳ Match: ${messageCheck.content === selectedOption}`);
                  } else {
                    console.log(`⏳ No message found in DB yet`);
                  }
                }
              }
            }
            
            if (!messageCommitted) {
              console.warn(`⚠️ Message not committed after ${maxMessageAttempts} attempts - proceeding anyway (may cause issues)`);
            }
            
            // Step 3: Both operations verified - now trigger regeneration
            // The edge function will now see User A's selected message in conversation history
            console.log("🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄");
            console.log("✅ User A's message and selected_message are now in DB - backend will include them in regeneration");
            console.log("📊 Deferred regeneration will generate turns 5,6,7 with User A's message + User B's hint in conversation history");
            console.log("🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄🔄");
            
            // Step 3: Both operations verified - now trigger regeneration
            // The edge function will now see User A's selected message in conversation history
            // ✅ NOTE: Wait already happened after marking - no need to wait again here
            
            // ✅ CRITICAL: Verify hint is available before triggering regeneration
            if (!hintFromB || hintFromB.trim().length === 0) {
              console.error("❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌");
              console.error("❌ CRITICAL ERROR: No hint found for deferred regeneration!");
              console.error("❌ This means turns 5,6,7 will be generated WITHOUT hint context!");
              console.error("❌ Context data:", JSON.stringify(chatDataForPendingHint?.context_data, null, 2));
              console.error("❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌");
              // Don't proceed without hint - this is critical
              return;
            }
            
            console.log("🔍 Hint verification for deferred regeneration:", {
              hintFromB: `${hintFromB.substring(0, 100)}...`,
              hintLength: hintFromB.length,
              willPassToBackend: true
            });
            
            // ✅ REQUIREMENT 2: Do NOT clear pendingHint until AFTER first batch is generated
            // Keep pendingHint true during regeneration - it will be cleared in the .then() callback
            
            // Trigger regeneration with hint - NOW it includes User A's selected message
            console.log("🚀 Triggering deferred regeneration with hint...");
            if (currentChatId) {
              isGeneratingPregeneratedTurnsRef.current[currentChatId] = true;
            }
            
            // ✅ REQUIREMENT 3: Always pass hintFromB + selectedMessageFromA into generate-pregenerated-turns for the first batch
            supabase.functions.invoke("generate-pregenerated-turns", {
              body: { 
                chatId: currentChatId,
                hintFromB: hintFromB,  // ✅ Explicitly pass hint
                latestMessageFromA: selectedOption  // ✅ REQUIREMENT 3: Always pass selected message from User A
              }
            }).then(({ data, error }) => {
              if (currentChatId) {
                isGeneratingPregeneratedTurnsRef.current[currentChatId] = false;
              }
              if (error) {
                console.error("❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌");
                console.error("❌ Failed to trigger deferred regeneration:", error);
                console.error("❌ Error details:", JSON.stringify(error, null, 2));
                console.error("❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌");
                
                // ✅ REQUIREMENT 2: Clear pendingHint even on error (to prevent blocking)
                const updatedContext = {
                  ...chatDataForPendingHint?.context_data,
                  pendingHint: false
                };
                supabase
                  .from("chats")
                  .update({ context_data: updatedContext })
                  .eq("id", currentChatId)
                  .then(() => {
                    console.log("✅ Cleared pendingHint flag after error");
                  });
              } else {
                console.log("✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅");
                console.log("✅ Deferred regeneration completed:", {
                  success: data?.success,
                  stored: data?.stored,
                  turnNumbers: data?.turnNumbers,
                  startingTurnNumber: data?.startingTurnNumber,
                  hintWasPassed: !!hintFromB,
                  hintLength: hintFromB?.length || 0,
                  messageFromAPassed: !!selectedOption,
                  message: data?.message
                });
                console.log("✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅");
                
                if (!data?.success) {
                  console.error("❌ Deferred regeneration returned success=false:", data);
                }
                
                // ✅ REQUIREMENT 2: Clear pendingHint AFTER first batch (turns 5,6,7) is generated
                console.log("🔍 Clearing pendingHint flag AFTER first batch generation...");
                const updatedContext = {
                  ...chatDataForPendingHint?.context_data,
                  pendingHint: false
                };
                supabase
                  .from("chats")
                  .update({ context_data: updatedContext })
                  .eq("id", currentChatId)
                  .then(() => {
                    console.log("✅ Cleared pendingHint flag after first batch generation");
                  });
              }
            }).catch(err => {
              if (currentChatId) {
                isGeneratingPregeneratedTurnsRef.current[currentChatId] = false;
              }
              console.error("❌ Error triggering deferred regeneration:", err);
              
              // ✅ REQUIREMENT 2: Clear pendingHint even on error (to prevent blocking)
              const updatedContext = {
                ...chatDataForPendingHint?.context_data,
                pendingHint: false
              };
              supabase
                .from("chats")
                .update({ context_data: updatedContext })
                .eq("id", currentChatId)
                .then(() => {
                  console.log("✅ Cleared pendingHint flag after error");
                });
            });
            
            // ✅ REQUIREMENT 4: Mark that deferred regeneration was triggered
            didDeferredRegeneration = true;
            
            // ✅ CRITICAL FIX: Return immediately after deferred regeneration
            // Do NOT continue to remainingCount check - deferred regeneration is the ONLY regeneration for this event
            // This ensures generate-pregenerated-turns is called exactly ONCE per cycle
            console.log("✅ Deferred regeneration triggered - EXITING to prevent double regeneration");
            }
          
          // 🚫 EXIT AFTER DEFERRED REGENERATION (prevents double regen)
          if (hasPendingHint) {
            return;
          } 

            
          
          // ⬅️ ADD THIS HERE
        

          else {
            console.log("ℹ️ No pendingHint flag - skipping deferred regeneration");
            console.log("ℹ️ Context data check:", {
              hasContextData: !!chatDataForPendingHint?.context_data,
              pendingHint: chatDataForPendingHint?.context_data?.pendingHint,
              hasHintFromB: !!chatDataForPendingHint?.context_data?.hint_from_b
            });
          }
        } else {
          console.log("⚠️ Message not sent successfully - skipping deferred regeneration check");
        }

        // ✅ FIX 1: Check if smiley was selected from pregenerated turn and handle closure
        const isSmileyOnly = /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(selectedOption.trim());

        if (isSmileyOnly) {
          console.log("😊 Smiley detected from pregenerated turn - checking closure...");
          
          // ✅ FIX 1: Check for consecutive smileys (last 2 messages must both be smileys from different users)
          const { data: lastMessages } = await supabase
            .from("messages")
            .select("id, sender_id, content, created_at")
            .eq("chat_id", currentChatId)
            .order("created_at", { ascending: false })
            .limit(2);
          
          const isConsecutiveSmileys = lastMessages && lastMessages.length === 2 && 
            lastMessages[0].sender_id !== lastMessages[1].sender_id &&
            /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(lastMessages[0].content.trim()) &&
            !/[a-zA-Z0-9]/.test(lastMessages[0].content.trim()) &&
            /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(lastMessages[1].content.trim()) &&
            !/[a-zA-Z0-9]/.test(lastMessages[1].content.trim());
          
          // Fetch current chat state
          const { data: chatData } = await supabase
            .from("chats")
            .select("user_id, contact_id, user_a_smiley_sent, user_b_smiley_sent, is_resolved, closure_state")
            .eq("id", currentChatId)
            .single();
          
          if (chatData && user) {
            const isUserA = user.id === chatData.user_id;
            const updateData: any = {};
            
            if (isUserA) {
              updateData.user_a_smiley_sent = true;
            } else {
              updateData.user_b_smiley_sent = true;
            }
            
            // ✅ FIX 1: Only close if last 2 messages are consecutive smileys from different users
            if (isConsecutiveSmileys) {
              // ✅ Consecutive smileys from different users → fully closed
              updateData.closure_state = 'closed';
              updateData.is_resolved = true;
              updateData.closure_achieved_at = new Date().toISOString();
              console.log("✅ Consecutive smileys detected - conversation closed!");
              
              // Archive pregenerated turns
              (async () => {
                try {
                  const { error: archiveError } = await supabase.functions.invoke("archive-pregenerated-turns", {
                    body: { chatId: currentChatId }
                  });
                  if (archiveError) {
                    console.error("❌ Failed to archive pregenerated turns:", archiveError);
                  }
                } catch (err) {
                  console.error("❌ Error archiving:", err);
                }
              })();
              
              setIsChatClosed(true);
              setShowSuggestedOptions(false);
              setSuggestedOptions([]);
              resolveWaitingForOptions(String(user?.id || ''));
              
              // Navigate to history
              if (contactId) {
                router.replace({
                  pathname: '/contact-chat-details',
                  params: { contactId: contactId, autoSwitchToHistory: 'true' }
                });
              }
            } else {
              // Not consecutive smileys → mark pending, no closure yet
              updateData.closure_state = isUserA
                ? 'pending_user_b_smiley'
                : 'pending_user_a_smiley';
              console.log(`⏳ Not consecutive smileys - waiting for ${isUserA ? 'User B' : 'User A'} to send emoji`);
              showNotification('success', 'Closure Pending', 'Waiting for the other person to confirm completion');
            }
            
            await supabase
              .from("chats")
              .update(updateData)
              .eq("id", currentChatId);
          }
        }

        // ✅ FIX: Check if we need more pre-generated turns and trigger re-generation
        // Only skip regeneration if chat is fully closed (both users sent smileys)
        // Reuse isSmileyOnly already declared above
        const wasEmojiMatch = isSmileyOnly && optionMatches && (actualSource === 'pregenerated_turns');
        
        // ✅ CRITICAL FIX: Check if chat is fully closed before skipping regeneration
        let shouldSkipRegeneration = false;
        if (wasEmojiMatch) {
          // Check if chat is fully closed (both users sent smileys)
          const { data: chatCheck } = await supabase
            .from("chats")
            .select("is_resolved, closure_state")
            .eq("id", currentChatId)
            .single();
          
          shouldSkipRegeneration = chatCheck?.is_resolved && chatCheck?.closure_state === 'closed';
          
          if (shouldSkipRegeneration) {
            console.log("😊 Emoji matched and chat is fully closed - skipping regeneration");
          } else {
            console.log("😊 Emoji matched but chat not fully closed - will regenerate next batch");
          }
        }
        
        // Only check for regeneration if chat is not fully closed
        if (!shouldSkipRegeneration) {
          // ✅ REQUIREMENT 4: Ensure remainingCount regeneration NEVER runs before deferred regeneration
          if (didDeferredRegeneration) {
            console.log("✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅");
            console.log("✅ Skipping remainingCount regeneration because deferred regeneration already handled this turn");
            console.log("📊 This prevents double regeneration and ensures hint + User A's message are included");
            console.log("✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅");
            return;
          }
          
          const { data: remainingTurns } = await supabase
            .from("pregenerated_turns")
            .select("id")
            .eq("chat_id", currentChatId)
            .is("used_at", null)
            .limit(4); // Check for up to 4 turns to see if we're down to 3 or less

          const remainingCount = remainingTurns?.length || 0;
          
          // ✅ FIX: Trigger re-generation when 1 or fewer unused turns remain (just-in-time)
          // This ensures the next batch is generated just before the current batch is exhausted
          // AI generation takes 2-5 seconds, so we start when only 1 turn remains
          // ✅ CRITICAL: This threshold only affects WHEN next batch is generated
          // It does NOT affect turn number calculation (which stays in sync with backend)
          // Backend uses same formula: User A = messagesSent * 2, User B = messagesSent * 2 + 1
          if (remainingCount <= 1) {
          // ✅ FIX: Fetch chat data to check hint status and determine next recipient
          const { data: chatDataForHint } = await supabase
            .from("chats")
            .select("user_id, contact_id, context_data")
            .eq("id", currentChatId)
            .single();
          
          if (chatDataForHint) {
            // ✅ FIX: Determine next recipient based on last message
            const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
            const lastSenderId = lastMessage ? String(lastMessage.sender_id) : null;
            const nextRecipientId = lastSenderId === String(chatDataForHint.user_id) 
              ? chatDataForHint.contact_id  // User A sent last → next is User B
              : chatDataForHint.user_id;     // User B sent last → next is User A
            
            // ✅ FIX: Check if it's User B's turn and if they haven't submitted a hint
            const isNextRecipientUserB = String(nextRecipientId) === String(chatDataForHint.contact_id);
            const hasUserBHint = Boolean(chatDataForHint?.context_data?.hint_from_b);
            
            if (isNextRecipientUserB && !hasUserBHint) {
              console.log(`⏸️ Skipping pregenerated turns regeneration: Next turn is User B's but no hint submitted yet (${remainingCount} turn(s) remaining)`);
              // Don't regenerate - User B needs to submit hint first
              // Existing pregenerated turns will be used (if any)
              return; // ⛔ EXIT - don't regenerate without hint
            }
          }
          
          // ✅ CRITICAL FIX: Don't regenerate if current user is viewing pregenerated turns
          // This prevents deletion of turns that are currently displayed, which causes flickering
          if (currentPregeneratedTurnRef.current && 
              currentOptionsSourceRef.current === 'pregenerated_turns' &&
              user &&
              String(currentPregeneratedTurnRef.current.recipient_id) === String(user.id)) {
            console.log(`⏸️ Skipping pregenerated turns regeneration: Current user is viewing turn ${currentPregeneratedTurnRef.current.turn_number} - waiting until they select an option`);
            return; // ⛔ EXIT - don't regenerate while user is viewing options
          }
          
          // ✅ FIX 1: Hard guard - skip remainingCount regeneration when pendingHint is true
          // This ensures only deferred regeneration path handles hint scenarios
          // ✅ CRITICAL FIX: Always fetch FRESH context_data right before checking pendingHint
          const { data: chatDataForPendingCheck2 } = await supabase
            .from("chats")
            .select("context_data, user_id")
            .eq("id", currentChatId)
            .single();
          
          const pendingHint = chatDataForPendingCheck2?.context_data?.pendingHint === true;
          
          if (pendingHint) {
            console.log("🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑");
            console.log("⛔ SKIPPING remainingCount regeneration: pendingHint flag is set");
            console.log("📊 Only deferred regeneration path will handle this scenario");
            console.log("✅ This prevents early wrong batch generation without hint + User A's message");
            console.log("🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑");
            return; // ✅ EXIT IMMEDIATELY - don't regenerate via remainingCount path
          }
          
          // ✅ FIX 2: Fetch hintFromB for non-pendingHint scenarios
          const hintFromB = chatDataForPendingCheck2?.context_data?.hint_from_b || null;
          
          // ✅ FIX 3: Get latestMessageFromA from pregenerated_turns.selected_message (not messages table)
          // This is the correct source because User A's selected message is stored in pregenerated_turns
          let latestMessageFromA: string | null = null;
          if (chatDataForPendingCheck2) {
            const { data: latestUserATurn } = await supabase
              .from("pregenerated_turns")
              .select("selected_message, recipient_id, turn_number")
              .eq("chat_id", currentChatId)
              .eq("recipient_id", chatDataForPendingCheck2.user_id) // User A's turns
              .not("selected_message", "is", null) // Only turns with selected_message
              .order("turn_number", { ascending: false })
              .limit(1)
              .single();
            
            if (latestUserATurn?.selected_message) {
              latestMessageFromA = latestUserATurn.selected_message;
              console.log("✅ Found latestMessageFromA from pregenerated_turns:", {
                turnNumber: latestUserATurn.turn_number,
                messagePreview: (latestMessageFromA || "").substring(0, 50) + "..."
              });
            } else {
              console.log("ℹ️ No selected_message found in pregenerated_turns for User A");
            }
          }
          
          console.log(`⚡ Only ${remainingCount} pre-generated turn(s) remaining, triggering re-generation just-in-time...`);
          // ✅ CRITICAL: Mark that we're generating pregenerated turns for this chat
          if (currentChatId) {
            isGeneratingPregeneratedTurnsRef.current[currentChatId] = true;
          }
          
          // ✅ FIX 4: Build payload conditionally - only include latestMessageFromA if it exists
          const payload: any = { 
            chatId: currentChatId,
            hintFromB: hintFromB || null // Explicitly pass hint (null if not available)
          };
          
          if (latestMessageFromA && latestMessageFromA.trim().length > 0) {
            payload.latestMessageFromA = latestMessageFromA;
            console.log("✅ Including latestMessageFromA in regeneration payload");
          } else {
            console.log("ℹ️ Not including latestMessageFromA (not available or empty)");
          }
          
          // Trigger re-generation in background (non-blocking)
          supabase.functions.invoke("generate-pregenerated-turns", {
            body: payload
          }).then(({ data, error }) => {
            if (currentChatId) {
              isGeneratingPregeneratedTurnsRef.current[currentChatId] = false;
            }
            if (error) {
              // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
              console.error("❌ Failed to trigger re-generation:", error);
              // Silently fail - no user-facing error
            } else {
              console.log("✅ Re-generation triggered successfully:", data);
            }
          }).catch(err => {
            if (currentChatId) {
              isGeneratingPregeneratedTurnsRef.current[currentChatId] = false;
            }
            // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
            console.error("❌ Error triggering re-generation:", err);
            // Silently fail - no user-facing error
          });
        } else {
          console.log(`ℹ️ ${remainingCount} pre-generated turn(s) remaining, no re-generation needed yet`);
        }
        } else {
          console.log("😊 Chat is fully closed - skipping regeneration check");
        }
      })();
    }, 140);
  };
  // 🔄 Regenerate options function
  const regenerateOptions = async () => {
    if (!currentChatId || !user) return;
    // ✅ CRITICAL: Don't regenerate options if chat is closed
    if (isChatClosed) {
      console.log("🛑 Chat is closed - cannot regenerate options");
      return;
    }
    
    // 🔥 CRITICAL: Check pregenerated turns FIRST - before regenerating
    console.log("🔍 Checking pregenerated turns:", { chatId: currentChatId, userId: user.id });
    const pregen = await fetchPregeneratedTurn(currentChatId, user.id);
    if (pregen && pregen.options?.length > 0) {
      // ✅ CRITICAL: Verify recipient_id matches current user before showing options
      if (String(pregen.recipient_id) !== String(user.id)) {
        console.error("❌ CRITICAL: Pregenerated turn recipient_id mismatch in regenerateOptions!", {
          expectedUserId: user.id,
          actualRecipientId: pregen.recipient_id,
          turn_number: pregen.turn_number
        });
        // Don't show options to wrong user
        return;
      }
      
      console.log("⚡ regenerateOptions: Using pregenerated options");
      // ✅ CRITICAL FIX: Set currentPregeneratedTurnRef with correct turn_number and recipient_id from database
      if (pregen.turn_number !== undefined && pregen.recipient_id) {
        currentPregeneratedTurnRef.current = {
          turn_number: pregen.turn_number,
          recipient_id: pregen.recipient_id,  // ✅ Use recipient_id from database, not user.id
          options: pregen.options || []
        };
        console.log(`✅ Set currentPregeneratedTurnRef to turn ${pregen.turn_number} for recipient ${pregen.recipient_id}`);
      }
      const cleaned = cleanOptionsForDisplay(pregen.options, contact?.full_name || null);
      setOptionsWithSource(cleaned, 'pregenerated_turns');
      setShowSuggestedOptions(true);
      setOptionsGenerationFailed(false);
      resolveWaitingForOptions(user.id);
      setLastOptionRefreshTime(Date.now());
      return; // ⛔ Prevent regeneration if pregenerated exists
    }
    
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

  // ✅ PERFORMANCE: Removed blocking loading screen - UI shows immediately while data loads in background
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
                    // ✅ Hide hint box only for current session (no DB save)
                    // On next navigation or refresh, hint box will appear again unless hint_from_b exists in DB
                    setShowTipBox(false);
                    console.log("✅ Hint box skipped - hidden for current session only");
                  }}
                >
                  <Text style={styles.tipBoxSkipText}>Skip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.tipBoxSubmitButton}
                  onPress={async () => {
                    // ✅ NEW: EARLY BLOCKER CHECK - Prevent regeneration if User A's turn is active
                    // This MUST happen BEFORE updating context_data to prevent race conditions
                    console.log("🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵");
                    console.log("🚀 HINT SUBMISSION STARTED");
                    console.log("🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵");
                    
                    if (!currentChatId || !user) {
                      console.log("❌ EARLY EXIT: Missing currentChatId or user");
                      return;
                    }
                    
                    console.log("🔍 HINT SUBMISSION DEBUG:", {
                      currentChatId,
                      userId: user.id,
                      hintText: tipText.substring(0, 50) + "...",
                      hintLength: tipText.length
                    });
                    
                    try {
                      // Step 1: Check User A's turn status FIRST (before any DB updates)
                      console.log("🔍 Step 1: Fetching chat data for early blocker check...");
                      const { data: chatCheck, error: chatCheckError } = await supabase
                        .from("chats")
                        .select("user_id, contact_id, context_data")
                        .eq("id", currentChatId)
                        .single();
                      
                      if (chatCheckError) {
                        console.error("❌ Failed to fetch chat data:", chatCheckError);
                        throw chatCheckError;
                      }
                      
                      console.log("🔍 Chat data fetched:", {
                        chatUserId: chatCheck?.user_id,
                        chatContactId: chatCheck?.contact_id,
                        currentUserId: user.id,
                        isUserB: user.id === chatCheck?.contact_id,
                        hasContextData: !!chatCheck?.context_data
                      });
                      
                      if (chatCheck && user.id === chatCheck.contact_id) {
                        console.log("✅ User B confirmed - checking if User A's turn is active");
                        
                        // User B is submitting hint - check if User A's turn is active
                        console.log("🔍 Step 2: Fetching all messages to calculate turn numbers...");
                        const { data: allMessages, error: messagesError } = await supabase
                          .from("messages")
                          .select("sender_id")
                          .eq("chat_id", currentChatId)
                          .order("created_at", { ascending: true });
                        
                        if (messagesError) {
                          console.error("❌ Failed to fetch messages:", messagesError);
                          throw messagesError;
                        }
                        
                        const messagesFromA = (allMessages || []).filter(m => String(m.sender_id) === String(chatCheck.user_id)).length;
                        const messagesFromB = (allMessages || []).filter(m => String(m.sender_id) === String(chatCheck.contact_id)).length;
                        const userACurrentTurn = messagesFromA * 2;
                        const userBCurrentTurn = messagesFromB * 2 + 1;
                        
                        console.log("🔍 Message and turn calculation:", {
                          totalMessages: allMessages?.length || 0,
                          messagesFromA,
                          messagesFromB,
                          userACurrentTurn,
                          userBCurrentTurn,
                          userAId: chatCheck.user_id,
                          userBId: chatCheck.contact_id
                        });
                        
                        // Check if User A's turn exists and is active (not selected yet)
                        console.log("🔍 Step 3: Checking if User A's turn exists and is active...");
                        const { data: userATurnCheck, error: turnCheckError } = await supabase
                          .from("pregenerated_turns")
                          .select("turn_number, selected_message, options")
                          .eq("chat_id", currentChatId)
                          .eq("recipient_id", chatCheck.user_id)
                          .eq("turn_number", userACurrentTurn)
                          .maybeSingle();
                        
                        if (turnCheckError) {
                          console.error("❌ Failed to check User A's turn:", turnCheckError);
                        }
                        
                        // ✅ ALSO CHECK: Get ALL User A's turns to see the full picture
                        const { data: allUserATurns, error: allTurnsError } = await supabase
                          .from("pregenerated_turns")
                          .select("turn_number, selected_message, recipient_id")
                          .eq("chat_id", currentChatId)
                          .eq("recipient_id", chatCheck.user_id)
                          .order("turn_number", { ascending: true });
                        
                        console.log("🔍 All User A turns in database:", {
                          totalTurns: allUserATurns?.length || 0,
                          turns: allUserATurns?.map(t => ({
                            turn_number: t.turn_number,
                            hasSelectedMessage: t.selected_message !== null,
                            selectedMessage: t.selected_message?.substring(0, 50) || null
                          })) || [],
                          error: allTurnsError
                        });
                        
                        // ✅ ALSO CHECK: Get ALL turns to see the full picture
                        const { data: allTurns, error: allTurnsError2 } = await supabase
                          .from("pregenerated_turns")
                          .select("turn_number, selected_message, recipient_id")
                          .eq("chat_id", currentChatId)
                          .order("turn_number", { ascending: true });
                        
                        console.log("🔍 ALL turns in database:", {
                          totalTurns: allTurns?.length || 0,
                          turns: allTurns?.map(t => ({
                            turn_number: t.turn_number,
                            recipient_id: t.recipient_id === chatCheck.user_id ? "User A" : "User B",
                            hasSelectedMessage: t.selected_message !== null
                          })) || []
                        });
                        
                        console.log("🔍 User A turn check result:", {
                          userACurrentTurn,
                          turnExists: !!userATurnCheck,
                          turnData: userATurnCheck ? {
                            turn_number: userATurnCheck.turn_number,
                            hasSelectedMessage: userATurnCheck.selected_message !== null,
                            selectedMessage: userATurnCheck.selected_message?.substring(0, 50) || null,
                            hasOptions: (userATurnCheck.options?.length || 0) > 0,
                            optionsCount: userATurnCheck.options?.length || 0
                          } : null,
                          turnCheckError
                        });
                        
                        const isUserATurnActive = userATurnCheck && userATurnCheck.selected_message === null;
                        
                        console.log("🔍🔍🔍 EARLY BLOCKER DECISION:", {
                          isUserATurnActive,
                          willBlock: isUserATurnActive,
                          reason: isUserATurnActive 
                            ? "✅ User A's turn is active - WILL BLOCK regeneration"
                            : userATurnCheck 
                              ? "❌ User A's turn exists but already has selected_message (already selected)"
                              : "❌ User A's turn doesn't exist in DB (will continue with normal flow)",
                          userACurrentTurn,
                          turnExists: !!userATurnCheck,
                          hasSelectedMessage: userATurnCheck?.selected_message !== null
                        });
                        
                        if (isUserATurnActive) {
                          // ✅ BLOCK REGENERATION: User A's turn is active - set pendingHint and return
                          console.log("🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑");
                          console.log("🛑 BLOCKING REGENERATION: User A's turn is active");
                          console.log(`📊 User A is viewing turn ${userACurrentTurn} - regeneration BLOCKED until User A selects option`);
                          console.log("✅ Hint will be saved but regeneration will happen AFTER User A's message is in conversation history");
                          console.log("🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑");
                          
                          // Update context_data with hint AND pendingHint flag
                          const blockedContext = {
                            ...(chatCheck.context_data || {}),
                            hint_from_b: tipText,
                            hint_submitted_at: new Date().toISOString(),
                            hint_tagged_entities: hintTaggedEntities,
                            pendingHint: true  // ✅ CRITICAL: Set flag to block ALL regeneration
                          };
                          
                          console.log("🔍 Updating context_data with hint and pendingHint flag...");
                          const { error: updateError } = await supabase
                            .from("chats")
                            .update({ context_data: blockedContext })
                            .eq("id", currentChatId);
                          
                          if (updateError) {
                            console.error("❌ Failed to update context_data:", updateError);
                            throw updateError;
                          }
                          
                          console.log("✅ Context_data updated successfully with:", {
                            hasHintFromB: !!blockedContext.hint_from_b,
                            hintLength: blockedContext.hint_from_b?.length || 0,
                            pendingHint: blockedContext.pendingHint,
                            hintSubmittedAt: blockedContext.hint_submitted_at
                          });
                          
                          // Delete future turns but preserve User A's active turn
                          console.log(`🔍 Deleting future turns (preserving User A's active turn ${userACurrentTurn})...`);
                          
                          // ✅ CRITICAL FIX: First verify User A's turn exists before deletion
                          const { data: verifyUserATurn, error: verifyError } = await supabase
                            .from("pregenerated_turns")
                            .select("turn_number, recipient_id, selected_message, options")
                            .eq("chat_id", currentChatId)
                            .eq("turn_number", userACurrentTurn)
                            .eq("recipient_id", chatCheck.user_id)
                            .single();
                          
                          if (verifyError || !verifyUserATurn) {
                            console.error("❌ CRITICAL: User A's turn not found before deletion!", {
                              userACurrentTurn,
                              verifyError,
                              turnExists: !!verifyUserATurn
                            });
                            // Don't delete if User A's turn doesn't exist - this would be a critical error
                          } else {
                            console.log("✅ Verified User A's turn exists before deletion:", {
                              turn_number: verifyUserATurn.turn_number,
                              hasSelectedMessage: verifyUserATurn.selected_message !== null,
                              hasOptions: (verifyUserATurn.options?.length || 0) > 0
                            });
                            
                            // Now safely delete future turns
                            const { error: deleteFutureError } = await supabase
                              .from("pregenerated_turns")
                              .delete()
                              .eq("chat_id", currentChatId)
                              .gt("turn_number", userACurrentTurn)
                              .is("selected_message", null);
                            
                            if (deleteFutureError) {
                              console.error("⚠️ Failed to delete future turns:", deleteFutureError);
                            } else {
                              console.log(`✅ Deleted future turns (preserved User A's active turn ${userACurrentTurn})`);
                            }
                            
                            // ✅ CRITICAL: Re-verify User A's turn still exists after deletion
                            const { data: verifyAfter, error: verifyAfterError } = await supabase
                              .from("pregenerated_turns")
                              .select("turn_number, recipient_id, selected_message, options")
                              .eq("chat_id", currentChatId)
                              .eq("turn_number", userACurrentTurn)
                              .eq("recipient_id", chatCheck.user_id)
                              .single();
                            
                            if (verifyAfterError || !verifyAfter) {
                              console.error("❌❌❌ CRITICAL: User A's turn was deleted! This should never happen!", {
                                userACurrentTurn,
                                verifyAfterError,
                                turnExists: !!verifyAfter
                              });
                            } else {
                              console.log("✅ Verified User A's turn still exists after deletion:", {
                                turn_number: verifyAfter.turn_number,
                                hasSelectedMessage: verifyAfter.selected_message !== null,
                                hasOptions: (verifyAfter.options?.length || 0) > 0
                              });
                              
                              // ✅ CRITICAL: Update currentPregeneratedTurnRef to ensure it's set correctly
                              // This ensures User A can still mark the turn even after hint submission
                              if (!currentPregeneratedTurnRef.current || currentPregeneratedTurnRef.current.turn_number !== userACurrentTurn) {
                                console.log("🔧 Updating currentPregeneratedTurnRef to match User A's turn:", {
                                  oldTurn: currentPregeneratedTurnRef.current?.turn_number,
                                  newTurn: userACurrentTurn
                                });
                                currentPregeneratedTurnRef.current = {
                                  turn_number: verifyAfter.turn_number,
                                  recipient_id: verifyAfter.recipient_id,
                                  options: verifyAfter.options || []
                                };
                              }
                            }
                          }
                          
                          setShowTipBox(false);
                          setHintSubmitted(true);
                          // ✅ CRITICAL FIX 2: Show notification BEFORE returning
                          // This ensures user gets feedback that hint was saved
                          showNotification('success', 'Context Saved', 'Your perspective will guide future responses');
                          console.log("✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅");
                          console.log("✅ Hint saved with pendingHint flag - regeneration COMPLETELY BLOCKED until User A selects option");
                          console.log("✅ Notification shown to user");
                          console.log("✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅");
                          return; // ✅ EXIT EARLY - NO REGENERATION AT ALL
                        } else {
                          // ✅ DEBUG: Log why we're NOT blocking
                          console.log("⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️");
                          console.log("⚠️ EARLY BLOCKER: NOT blocking regeneration");
                          console.log("⚠️ Reason:", {
                            userACurrentTurn,
                            turnExists: !!userATurnCheck,
                            hasSelectedMessage: userATurnCheck?.selected_message !== null,
                            explanation: !userATurnCheck 
                              ? "Turn doesn't exist - will continue with normal hint submission flow"
                              : "Turn exists but has selected_message - User A already selected"
                          });
                          console.log("⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️");
                        }
                      } else {
                        console.log("ℹ️ Not User B submitting hint - skipping early blocker check");
                        console.log("ℹ️ User ID comparison:", {
                          currentUserId: user.id,
                          chatContactId: chatCheck?.contact_id,
                          isUserB: user.id === chatCheck?.contact_id
                        });
                      }
                    } catch (earlyCheckError) {
                      console.error("❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌");
                      console.error("⚠️ Error in early blocker check:", earlyCheckError);
                      console.error("❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌");
                      // Continue with normal flow if check fails
                    }
                    
                    // ✅ Continue with existing hint submission logic (for when User A's turn is NOT active)
                    // ✅ FIX 1: Flag to track if we should skip immediate regeneration
                    let shouldSkipImmediateRegeneration = false;
                    
                    try {
                      const { data: existing, error: fetchErr } = await supabase
                        .from("chats")
                        .select("context_data, user_id, contact_id")
                        .eq("id", currentChatId)
                        .single();
                      if (fetchErr) throw fetchErr;
                      
                      // ✅ CRITICAL FIX: Check if User A's turn is active BEFORE saving mergedContext
                      // This ensures pendingHint is set in the initial save, not just in deferred update
                      let isUserATurnActive = false;
                      if (user && user.id === existing?.contact_id && existing?.user_id && currentChatId) {
                        // Calculate User A's current turn number
                        const { data: allMessages } = await supabase
                          .from("messages")
                          .select("sender_id")
                          .eq("chat_id", currentChatId)
                          .order("created_at", { ascending: true });
                        
                        const messagesFromA = (allMessages || []).filter(m => String(m.sender_id) === String(existing.user_id)).length;
                        const userACurrentTurn = messagesFromA * 2;
                        
                        // Check if User A's current turn exists and is active (not selected yet)
                        const { data: userATurnData } = await supabase
                          .from("pregenerated_turns")
                          .select("turn_number, selected_message")
                          .eq("chat_id", currentChatId)
                          .eq("recipient_id", existing.user_id)
                          .eq("turn_number", userACurrentTurn)
                          .maybeSingle();
                        
                        isUserATurnActive = !!(userATurnData && userATurnData.selected_message === null);
                        
                        if (isUserATurnActive) {
                          console.log(`🔍 User A's turn ${userACurrentTurn} is active - will set pendingHint in initial save`);
                        }
                      }
                      
                      const mergedContext = {
                        ...(existing?.context_data || {}),
                        hint_from_b: tipText,
                        hint_submitted_at: new Date().toISOString(),
                        hint_tagged_entities: hintTaggedEntities, // Store tagged entities from hint
                        // ✅ CRITICAL: Set pendingHint if User A's turn is active (ensures it's in initial save)
                        ...(isUserATurnActive ? { pendingHint: true } : {})
                      };
                      await supabase
                        .from("chats")
                        .update({ context_data: mergedContext })
                        .eq("id", currentChatId);
                      
                      // ✅ CRITICAL FIX: Invalidate pre-generated turns when hint is submitted
                      // Scenario 1: User B submits hint when it's NOT their turn (User A viewing turn 4)
                      //   → Preserve User A's turn 4 completely (options + selected_message in DB)
                      //   → Only regenerate turns 5, 6, 7 with hint
                      // Scenario 2: User B submits hint during their turn (User B viewing turn 5)
                      //   → DELETE User B's turn 5 (so it refreshes with hint immediately)
                      //   → Regenerate turns 5, 6, 7 with hint
                      // Rule: Turns with selected_message are NEVER deleted or regenerated
                      try {
                        // User B is the contact in this chat
                        if (user && user.id === existing?.contact_id && existing?.user_id && currentChatId) {
                          // ✅ FIX: Calculate both users' current turn numbers
                          const { data: allMessages } = await supabase
                            .from("messages")
                            .select("sender_id")
                            .eq("chat_id", currentChatId)
                            .order("created_at", { ascending: true });
                          
                          const messagesFromA = (allMessages || []).filter(m => String(m.sender_id) === String(existing.user_id)).length;
                          const messagesFromB = (allMessages || []).filter(m => String(m.sender_id) === String(existing.contact_id)).length;
                          const userACurrentTurn = messagesFromA * 2;
                          const userBCurrentTurn = messagesFromB * 2 + 1;
                          
                          console.log(`🔍 User A's current turn: ${userACurrentTurn} (${messagesFromA} messages sent)`);
                          console.log(`🔍 User B's current turn: ${userBCurrentTurn} (${messagesFromB} messages sent)`);
                          
                          // ✅ Check if User A's current turn exists and has selected_message (already selected)
                          const { data: userATurnData } = await supabase
                            .from("pregenerated_turns")
                            .select("turn_number, selected_message, options")
                            .eq("chat_id", currentChatId)
                            .eq("recipient_id", existing.user_id)
                            .eq("turn_number", userACurrentTurn)
                            .maybeSingle();
                          
                          // ✅ Check if User B's current turn is active (being viewed but not selected)
                          const { data: userBTurnData } = await supabase
                            .from("pregenerated_turns")
                            .select("turn_number, selected_message")
                            .eq("chat_id", currentChatId)
                            .eq("recipient_id", existing.contact_id)
                            .eq("turn_number", userBCurrentTurn)
                            .maybeSingle();
                          
                          const isUserATurnSelected = userATurnData && userATurnData.selected_message !== null;
                          // ✅ Use the already-calculated isUserATurnActive from above, or recalculate if needed
                          const isUserATurnActiveLocal = userATurnData && userATurnData.selected_message === null;
                          const isUserBTurnActive = userBTurnData && userBTurnData.selected_message === null;
                          
                          // ✅ SCENARIO 2: User B submits hint during their turn - DELETE their current turn to refresh it
                          if (isUserBTurnActive) {
                            console.log(`🔄 User B's turn ${userBCurrentTurn} is active - will delete it to refresh with hint context`);
                            
                            // Delete User B's current turn (so it gets regenerated with hint)
                            const { error: deleteUserBTurnError } = await supabase
                              .from("pregenerated_turns")
                              .delete()
                              .eq("chat_id", currentChatId)
                              .eq("recipient_id", existing.contact_id)
                              .eq("turn_number", userBCurrentTurn)
                              .is("selected_message", null); // ✅ CRITICAL: Only delete if not selected
                            
                            if (deleteUserBTurnError) {
                              console.error("⚠️ Failed to delete User B's current turn for refresh:", deleteUserBTurnError);
                            } else {
                              console.log(`✅ Deleted User B's current turn ${userBCurrentTurn} - will regenerate with hint context`);
                            }
                            
                            // Delete User B's future turns (only unused ones)
                            const { error: deleteUserBFutureError } = await supabase
                              .from("pregenerated_turns")
                              .delete()
                              .eq("chat_id", currentChatId)
                              .eq("recipient_id", existing.contact_id)
                              .gt("turn_number", userBCurrentTurn)
                              .is("used_at", null)
                              .is("selected_message", null); // ✅ CRITICAL: Only delete unused turns
                            
                            // ✅ SCENARIO 1: Preserve User A's turn 4 completely (options + selected_message)
                            if (isUserATurnSelected) {
                              console.log(`✅ Preserving User A's turn ${userACurrentTurn} - already selected (selected_message exists, options preserved in DB)`);
                              // Turn 4 is already selected - do NOT touch it at all
                              // Only delete User A's future turns (after turn 4)
                              const { error: deleteUserAFutureError } = await supabase
                                .from("pregenerated_turns")
                                .delete()
                                .eq("chat_id", currentChatId)
                                .eq("recipient_id", existing.user_id)
                                .gt("turn_number", userACurrentTurn)
                                .is("used_at", null)
                                .is("selected_message", null);
                              
                              if (deleteUserAFutureError) {
                                console.error("⚠️ Failed to invalidate User A's future turns:", deleteUserAFutureError);
                              } else {
                                console.log(`✅ Invalidated User A's future turns (preserved turn ${userACurrentTurn} with selected_message)`);
                              }
                            } else if (isUserATurnActiveLocal) {
                              console.log(`✅ Preserving User A's current turn ${userACurrentTurn} (active - User A is viewing it)`);
                              // Only delete User A's future turns
                              const { error: deleteUserAFutureError } = await supabase
                                .from("pregenerated_turns")
                                .delete()
                                .eq("chat_id", currentChatId)
                                .eq("recipient_id", existing.user_id)
                                .gt("turn_number", userACurrentTurn)
                                .is("used_at", null)
                                .is("selected_message", null);
                              
                              if (deleteUserAFutureError) {
                                console.error("⚠️ Failed to invalidate User A's future turns:", deleteUserAFutureError);
                              } else {
                                console.log(`✅ Invalidated User A's future turns (preserved turn ${userACurrentTurn})`);
                              }
                            } else {
                              // User A's turn not active - delete all unused turns
                              const { error: deleteUserAError } = await supabase
                                .from("pregenerated_turns")
                                .delete()
                                .eq("chat_id", currentChatId)
                                .eq("recipient_id", existing.user_id)
                                .is("used_at", null)
                                .is("selected_message", null);
                              
                              if (deleteUserAError) {
                                console.error("⚠️ Failed to invalidate User A's unused turns:", deleteUserAError);
                              }
                            }
                            
                            console.log(`✅ User B's turn will refresh with hint context (preserved User A's turn if active/selected)`);
                          } else {
                            // ✅ SCENARIO 1: User B submits hint when it's NOT their turn
                            // Preserve User A's turn 4 completely (options + selected_message)
                            if (isUserATurnSelected) {
                              console.log(`✅ Preserving User A's turn ${userACurrentTurn} - already selected (selected_message exists, options preserved in DB)`);
                              // Turn 4 is already selected - do NOT touch it at all
                              // Only delete User A's future turns (after turn 4)
                              const { error: deleteUserAFutureError } = await supabase
                                .from("pregenerated_turns")
                                .delete()
                                .eq("chat_id", currentChatId)
                                .eq("recipient_id", existing.user_id)
                                .gt("turn_number", userACurrentTurn)
                                .is("used_at", null)
                                .is("selected_message", null);
                              
                              // Delete all User B's unused turns
                              const { error: deleteUserBError } = await supabase
                                .from("pregenerated_turns")
                                .delete()
                                .eq("chat_id", currentChatId)
                                .eq("recipient_id", existing.contact_id)
                                .is("used_at", null)
                                .is("selected_message", null);
                              
                              if (deleteUserAFutureError || deleteUserBError) {
                                console.error("⚠️ Failed to invalidate future turns:", deleteUserAFutureError || deleteUserBError);
                              } else {
                                console.log(`✅ Invalidated future turns (preserved User A's turn ${userACurrentTurn} with selected_message)`);
                              }
                            } else if (isUserATurnActiveLocal) {
                              console.log(`✅ Preserving User A's current turn ${userACurrentTurn} (active - User A is viewing it)`);
                              
                              // Only delete User A's future turns
                              const { error: deleteUserAFutureError } = await supabase
                                .from("pregenerated_turns")
                                .delete()
                                .eq("chat_id", currentChatId)
                                .eq("recipient_id", existing.user_id)
                                .gt("turn_number", userACurrentTurn)
                                .is("used_at", null)
                                .is("selected_message", null);
                              
                              // Delete all User B's unused turns
                              const { error: deleteUserBError } = await supabase
                                .from("pregenerated_turns")
                                .delete()
                                .eq("chat_id", currentChatId)
                                .eq("recipient_id", existing.contact_id)
                                .is("used_at", null)
                                .is("selected_message", null);
                              
                              if (deleteUserAFutureError || deleteUserBError) {
                                console.error("⚠️ Failed to invalidate future turns:", deleteUserAFutureError || deleteUserBError);
                              } else {
                                console.log(`✅ Invalidated future turns (preserved User A's current turn ${userACurrentTurn})`);
                              }
                              
                              // ✅ DEFERRED REGENERATION: User A's turn is active - defer regeneration until User A selects option
                              // Note: mergedContext already has pendingHint: true from initial save, but ensure it's set here too
                              const deferredContext = {
                                ...mergedContext,
                                pendingHint: true  // ✅ Ensure pendingHint is set (may already be set in mergedContext)
                              };
                              await supabase
                                .from("chats")
                                .update({ context_data: deferredContext })
                                .eq("id", currentChatId);
                              
                              console.log("⏸️ Hint submitted during User A's active turn - regeneration deferred until User A selects option");
                              console.log("✅ Hint saved:", tipText.substring(0, 50));
                              setShowTipBox(false);
                              setHintSubmitted(true);
                              console.log("✅ Hint submitted - hint box will never appear again (DB has hint_from_b)");
                              
                              // ✅ CRITICAL: Don't regenerate options if chat is closed
                              if (isChatClosed) {
                                console.log("🛑 Chat is closed - cannot regenerate options after hint submission");
                                return;
                              }
                              
                              // ✅ FIX 1: Set flag to skip immediate regeneration
                              shouldSkipImmediateRegeneration = true;
                              // Don't return here - let code continue to check the flag
                            } else {
                              // No active turns - safe to delete all unused turns
                              console.log(`✅ No active turns - deleting all unused turns`);
                              const { error: invalidateError } = await supabase
                                .from("pregenerated_turns")
                                .delete()
                                .eq("chat_id", currentChatId)
                                .in("recipient_id", [existing.user_id, existing.contact_id])
                                .is("used_at", null)
                                .is("selected_message", null); // ✅ CRITICAL: Only delete unused turns
                              
                              if (invalidateError) {
                                console.error("⚠️ Failed to invalidate pre-generated turns:", invalidateError);
                              } else {
                                console.log("✅ All unused pre-generated turns invalidated (hint submitted)");
                              }
                            }
                          }
                        }
                      } catch (err) {
                        console.error("⚠️ Error invalidating pre-generated turns on hint:", err);
                      }
                      
                      // ✅ FIX 1: Only trigger regeneration if we didn't defer it
                      if (shouldSkipImmediateRegeneration) {
                        console.log("⏸️ Skipping immediate regeneration - deferred until User A selects option");
                        console.log("📊 Deferred regeneration will happen after User A selects turn 4");
                        return; // ✅ Exit early here instead
                      }
                      
                      // ✅ CRITICAL: Trigger pregenerated turns regeneration with hint included (non-blocking)
                      // This ensures future turns for BOTH users include User B's hint context
                      // Only triggers if User B's turn is active (immediate regeneration)
                      // If User A's turn is active, regeneration is deferred (handled above with flag check)
                      if (user && user.id === existing?.contact_id && currentChatId) {
                        // ✅ CRITICAL: Check pendingHint BEFORE triggering regeneration
                        // This ensures we follow the backend rule even in hint-triggered path
                        const { data: hintCheckData } = await supabase
                          .from("chats")
                          .select("context_data, user_id")
                          .eq("id", currentChatId)
                          .single();
                        
                        const pendingHint = hintCheckData?.context_data?.pendingHint === true;
                        
                        // ✅ FIX: Check if latest message is from User A (determines if latestMessageFromA exists)
                        let latestMessageFromA: string | null = null;
                        if (pendingHint && hintCheckData) {
                          const { data: latestMessage } = await supabase
                            .from("messages")
                            .select("sender_id, content")
                            .eq("chat_id", currentChatId)
                            .order("created_at", { ascending: false })
                            .limit(1)
                            .single();
                          
                          if (latestMessage) {
                            const isLatestMessageFromA = String(latestMessage.sender_id) === String(hintCheckData.user_id);
                            latestMessageFromA = isLatestMessageFromA ? latestMessage.content : null;
                          }
                        }
                        
                        // ✅ FIX: Use backend rule: block if pendingHint && !latestMessageFromA
                        if (pendingHint && !latestMessageFromA) {
                          console.log("🛑 BLOCKING hint-triggered regeneration: pendingHint flag is set and User A has not selected");
                          console.log("📊 Regeneration blocked until User A selects their active turn");
                          console.log("✅ This prevents premature regeneration before User A's message is in conversation history");
                          return; // ✅ EXIT - don't regenerate
                        }
                        
                        // ✅ SCENARIO 2: User B's turn is active - regenerate immediately
                        // Note: isUserBTurnActive was already calculated earlier (line 5066)
                        // If we reach here, it means User B's turn was active (or neither turn was active)
                        // In the case where User B's turn was active, we already deleted it, so we should regenerate
                        // In the case where neither turn was active, we should also regenerate
                        // ✅ CRITICAL: Pass hint directly in request body to avoid race condition
                        // This ensures generate-pregenerated-turns receives the hint immediately
                        // without waiting for database commit/replication
                        console.log("🔄 Triggering pregenerated turns regeneration with User B's hint (affects both users)...");
                        isGeneratingPregeneratedTurnsRef.current[currentChatId] = true;
                        supabase.functions.invoke("generate-pregenerated-turns", {
                          body: { 
                            chatId: currentChatId,
                            hintFromB: tipText.trim(), // ⭐ Pass hint directly to avoid race condition
                            ...(latestMessageFromA && { latestMessageFromA }) // ✅ Pass if available
                          }
                        }).then(({ data, error }) => {
                          isGeneratingPregeneratedTurnsRef.current[currentChatId] = false;
                          if (error) {
                            // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
                            console.error("❌ Failed to regenerate pregenerated turns with hint:", error);
                            // Silently fail - no user-facing error
                          } else {
                            console.log("✅ Pregenerated turns regenerated with User B's hint context (both users' options now hint-influenced)");
                          }
                        }).catch(err => {
                          isGeneratingPregeneratedTurnsRef.current[currentChatId] = false;
                          // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
                          console.error("❌ Error triggering pregenerated turns regeneration:", err);
                          // Silently fail - no user-facing error
                        });
                      }
                      
                      console.log("✅ Hint saved:", tipText.substring(0, 50));
                      setShowTipBox(false);
                      setHintSubmitted(true);
                      // ✅ DB is now source of truth - fetchChatContext will handle visibility on next focus
                      // The hint_from_b field in context_data ensures hint box never appears again
                      console.log("✅ Hint submitted - hint box will never appear again (DB has hint_from_b)");
                      
                      // ✅ CRITICAL: Don't regenerate options if chat is closed
                      if (isChatClosed) {
                        console.log("🛑 Chat is closed - cannot regenerate options after hint submission");
                        return;
                      }
                      
                      // ✅ CRITICAL FIX: Check if it's actually User B's turn before showing options
                      const { data: chatData } = await supabase
                        .from("chats")
                        .select("user_id, contact_id")
                        .eq("id", currentChatId)
                        .single();

                      if (!chatData || !user) {
                        console.error("❌ Could not determine turn status");
                        showNotification('success', 'Context Saved', 'Your perspective will guide future responses');
                        return;
                      }

                      const isUserB = user.id === chatData.contact_id;
                      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
                      // User B's turn if last message was from User A (not from User B)
                      const isUserBTurn = isUserB && lastMessage && lastMessage.sender_id !== user.id;

                      console.log("🔍 Turn check after hint submission:", {
                        isUserB,
                        lastMessageSender: lastMessage?.sender_id,
                        currentUserId: user.id,
                        isUserBTurn,
                        hasOptionsShowing: showSuggestedOptions
                      });

                      if (isUserBTurn && showSuggestedOptions) {
                        // ✅ SCENARIO 1: It IS User B's turn AND options are already showing
                        // → Refresh options immediately with hint context
                        console.log("✅ User B's turn with options showing - refreshing options with hint");
                        enterWaitingForOptions(user?.id ? String(user.id) : undefined);
                        
                        const latestContactMessage = messages
                          .filter((m) => m.sender_id !== user?.id)
                          .pop();
                        
                        if (latestContactMessage) {
                          const conversationHistory = buildHistory();
                          const isCurrentUserA = user?.id === existing?.user_id;
                          console.log("📤 Regenerating options with hint:", {
                            currentUserRole: isCurrentUserA ? "User A" : "User B",
                            hintLength: tipText.length,
                            latestMessagePreview: latestContactMessage.content.substring(0, 50),
                          });
                          
                          const summaryA = existing?.context_data?.summary_a || existing?.context_data?.summary || "";
                          const thoughtsA = existing?.context_data?.thoughts_a || existing?.context_data?.thoughts || "";
                          
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
                                lastMessageTimestamp: latestContactMessage.created_at,
                                wordLimit: 15,
                              },
                            }
                          );
                          
                          if (regenError) {
                            console.error("❌ Failed to regenerate options with hint:", regenError);
                            showNotification('warning', 'Context Saved', 'Your perspective is saved but options could not be updated');
                            if (user?.id) {
                              resolveWaitingForOptions(String(user.id));
                            }
                          } else {
                            console.log("✅ Options regenerated with hint context");
                            showNotification('success', 'Options Updated', 'Your response choices now reflect your perspective');
                          }
                        }
                      } else if (!isUserBTurn) {
                        // ✅ SCENARIO 2: It's NOT User B's turn (it's User A's turn)
                        // → User A is currently viewing their options - DO NOT refresh them
                        // → Just store hint, invalidate future turns, trigger regeneration for future turns
                        // → User A's currently displayed options remain unchanged
                        console.log("ℹ️ Not User B's turn (User A's turn) - storing hint for future turns, NOT refreshing User A's currently displayed options");
                        showNotification('success', 'Context Saved', 'Your perspective will guide your next response');
                        // Don't enter waiting state - it's not User B's turn
                        // User A's current options stay as-is, future options will be hint-influenced
                      } else {
                        // ✅ SCENARIO 3: It IS User B's turn but no options showing yet
                        // → Wait for pregenerated turns to be regenerated with hint
                        console.log("ℹ️ User B's turn but no options yet - waiting for regenerated turns with hint");
                        enterWaitingForOptions(user?.id ? String(user.id) : undefined);
                        showNotification('info', 'Context Saved', 'Options will update shortly with your perspective');
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
  {shouldShowComposing && !isChatClosed && (
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