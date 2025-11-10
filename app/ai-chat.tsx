import React, { useState, useRef, useEffect, useCallback } from "react";
import { Animated } from "react-native";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  Send,
  Check,
  Sparkles,
  AtSign,
  Hash,
  Plus,
  Eye,
} from "lucide-react-native";
import { parseTaggedEntities, getLastTypingTag, replaceTypingTag, getCommonHashTags, extractTags } from "@/lib/tagParser";
import type { TaggedEntity } from "@/lib/tagParser";
import {
  Colors,
  Shadows,
  BorderRadius,
  Spacing,
  Typography,
} from "@/constants/Colors";
// Prevent undefined Colors or constants crash in Expo web
if (!Colors?.primary) console.warn("⚠️ Colors not loaded properly");


interface QAPair {
  question: string;
  answer: string;
  answerType: "text" | "dropdown";
  options?: string[];
}

interface Contact {
  id: string;
  full_name: string | null;
  email: string;
}

type FlowStage = "welcome" | "qa" | "summary" | "ready";

function AIChatScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const {
    contactId,
    mode,
    chatId,
    fromContactChat,
    sent,
    returnStage,
    skipReturnBanner,
    prefillDescription,
  } = useLocalSearchParams();

  const contactIdValue = Array.isArray(contactId) ? contactId[0] : contactId;
  const chatIdValue = Array.isArray(chatId) ? chatId[0] : chatId;
  const fromContactChatValue = Array.isArray(fromContactChat) ? fromContactChat[0] : fromContactChat;
  const sentValue = Array.isArray(sent) ? sent[0] : sent;
  const returnStageValue = Array.isArray(returnStage) ? returnStage[0] : returnStage;
  const skipReturnBannerValue = Array.isArray(skipReturnBanner) ? skipReturnBanner[0] : skipReturnBanner;
  const prefillDescriptionValue = Array.isArray(prefillDescription)
    ? prefillDescription[0]
    : prefillDescription;

  const [flowStage, setFlowStage] = useState<FlowStage>("welcome");
  const [contact, setContact] = useState<Contact | null>(null);
  const [qaPairs, setQAPairs] = useState<QAPair[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string>("");
  const [currentQuestionType, setCurrentQuestionType] = useState<"text" | "dropdown">("text");
  const [currentOptions, setCurrentOptions] = useState<string[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [thoughts, setThoughts] = useState("");
  const [initialDescription, setInitialDescription] = useState("");
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryJustRegenerated, setSummaryJustRegenerated] = useState(false);
  const [taggedEntities, setTaggedEntities] = useState<TaggedEntity[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState<'@' | '#' | null>(null);
  const [contactSuggestions, setContactSuggestions] = useState<any[]>([]);
  const [hashSuggestions, setHashSuggestions] = useState<string[]>([]);
  const [availableContacts, setAvailableContacts] = useState<any[]>([]);
  const [showReturnFromChatBanner, setShowReturnFromChatBanner] = useState(false);
  const [entityRegistryCache, setEntityRegistryCache] = useState<Record<string, { preferred_pronouns: string; entity_name: string }>>({});

  const [isSummaryUnclear, setIsSummaryUnclear] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  
  // Additional state for Stage 3 (must be defined before useCallback that uses it)
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [showEditMode, setShowEditMode] = useState(false);
  const [editedQAPairs, setEditedQAPairs] = useState<QAPair[]>([]);
  const [showGenerateSummaryButton, setShowGenerateSummaryButton] = useState(false);
  const editScrollViewRef = useRef<ScrollView>(null);
  const contextDataRef = useRef<Record<string, any>>({});

  const [chatTitle, setChatTitle] = useState("");

  // Aggregate clarity heuristic: allow short/typo answers if overall info is sufficient
  const hasAggregateClarity = React.useCallback(() => {
    const totalAnswerWords = qaPairs.reduce((sum, p) => sum + ((p.answer || '').trim().split(/\s+/).filter(Boolean).length), 0);
    const initialWords = (initialDescription || '').trim().split(/\s+/).filter(Boolean).length;
    const extraWords = (additionalInfo || '').trim().split(/\s+/).filter(Boolean).length;
    const nonEmptyAnswers = qaPairs.filter(p => (p.answer || '').trim().length > 0).length;
    // Thresholds: either enough words overall, or at least 2 answered items
    return (totalAnswerWords + initialWords + extraWords) >= 20 || nonEmptyAnswers >= 2;
  }, [qaPairs, initialDescription, additionalInfo]);

  // Stage 2: Current answer tagging state
  const [showAnswerTagDropdown, setShowAnswerTagDropdown] = useState<'@' | '#' | null>(null);
  const [answerContactSuggestions, setAnswerContactSuggestions] = useState<any[]>([]);
  const [answerHashSuggestions, setAnswerHashSuggestions] = useState<string[]>([]);
  const [currentAnswerTags, setCurrentAnswerTags] = useState<TaggedEntity[]>([]);

  // Stage 2: Previous answers tagging state
  const [editingAnswerIndex, setEditingAnswerIndex] = useState<number | null>(null);
  const [prevAnswerContactSuggestions, setPrevAnswerContactSuggestions] = useState<any[]>([]);
  const [prevAnswerHashSuggestions, setPrevAnswerHashSuggestions] = useState<string[]>([]);

  // Stage 3: Edit mode tagging state
  const [editModeAnswerIndex, setEditModeAnswerIndex] = useState<number | null>(null);
  const [editModeContactSuggestions, setEditModeContactSuggestions] = useState<any[]>([]);
  const [editModeHashSuggestions, setEditModeHashSuggestions] = useState<string[]>([]);

  // Stage 3: Additional info tagging state
  const [showAdditionalInfoTagDropdown, setShowAdditionalInfoTagDropdown] = useState<'@' | '#' | null>(null);
  const [additionalInfoContactSuggestions, setAdditionalInfoContactSuggestions] = useState<any[]>([]);
  const [additionalInfoHashSuggestions, setAdditionalInfoHashSuggestions] = useState<string[]>([]);
  const [additionalInfoTags, setAdditionalInfoTags] = useState<TaggedEntity[]>([]);

  // Cursor position tracking for all text inputs
  const [descriptionCursorPos, setDescriptionCursorPos] = useState<number>(0);
  const [currentAnswerCursorPos, setCurrentAnswerCursorPos] = useState<number>(0);
  const [prevAnswerCursorPos, setPrevAnswerCursorPos] = useState<{[key: number]: number}>({});
  const [editModeCursorPos, setEditModeCursorPos] = useState<{[key: number]: number}>({});
  const [additionalInfoCursorPos, setAdditionalInfoCursorPos] = useState<number>(0);

  // Pronoun selection state for all stages
  const [showPronounDropdown, setShowPronounDropdown] = useState<'@' | '#' | null>(null);
  const [pronounSelectionContext, setPronounSelectionContext] = useState<{
    stage: 'description' | 'answer' | 'prevAnswer' | 'editAnswer' | 'additionalInfo';
    index?: number;
    pendingContact?: any;
    pendingHashTag?: string;
    cursorPos?: number;
    textField?: string;
  } | null>(null);

  const resolvedContactId = contact?.id ?? contactIdValue ?? null;

  const updateChatRecord = useCallback(
    async (fields: Record<string, any> = {}, contextPatch?: Record<string, any>) => {
      if (!currentChatId) return;
      const payload: Record<string, any> = { ...fields };
      if (contextPatch) {
        const mergedContext = { ...contextDataRef.current, ...contextPatch };
        contextDataRef.current = mergedContext;
        payload.context_data = mergedContext;
      }
      if (Object.keys(payload).length === 0) return;
      await supabase
        .from('chats')
        .update(payload)
        .eq('id', currentChatId);
    },
    [currentChatId]
  );

  const scrollViewRef = useRef<ScrollView>(null);

  const CLAUDE_EDGE_FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/invoke-claude`;

  // --- Helpers: input hygiene and friendly validation ---
  const cleanUpAnswer = (text: string): string => {
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (!collapsed) return "";
    // Avoid forcing punctuation for one-word replies
    const words = collapsed.split(/\s+/);
    if (words.length === 1) return collapsed;
    // Add terminal punctuation if missing
    if (!/[.!?]$/.test(collapsed)) return `${collapsed}.`;
    return collapsed;
  };

  const isClearlyIrrelevant = (text: string): boolean => {
    const t = (text || "").trim();
    if (!t) return true;
    // Reject if mostly emojis or punctuation
    const noLetters = !/[a-zA-Z]/.test(t);
    const manyEmoji = (t.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu) || []).length > 3;
    if (noLetters && manyEmoji) return true;
    // Obvious junk patterns
    if (/(idk|don't know|whatever|nothing|blah|no idea|random|nonsense)/i.test(t)) return true;
    return false; // otherwise allow, even if one-word
  };

  // --- Helper: strict prefix matcher for @ mentions ---
  const filterContactsByPrefix = (query: string, list: any[]) => {
    const q = (query || "").toLowerCase();
    if (q.length === 0) return list;
    return list.filter((c) => {
      const fullName = (c.full_name || "").toLowerCase().trim();
      const email = (c.email || "").toLowerCase().trim();
      const firstName = (fullName.split(" ")[0] || "").trim();
      const emailLocal = (email.split("@")[0] || "").trim();
      // Match only from the START of first name, full name, or email localpart
      return (
        (firstName && firstName.startsWith(q)) ||
        (fullName && fullName.startsWith(q)) ||
        (emailLocal && emailLocal.startsWith(q))
      );
    });
  };

  useEffect(() => {
    console.log('🎯 AI Chat mounted:', {
      contactId: contactIdValue,
      chatId: chatIdValue,
      userId: user?.id,
      mode,
    });
    let kickedOff = false;
    if (user) {
      // If returning from contact chat, prioritize showing Stage 4 (Ready)
      const comingBack = String(fromContactChatValue || '') === '1';
      const hasSent = String(sentValue || '') === '1';
      if (comingBack && !hasSent) {
        kickedOff = true;
        setShowReturnFromChatBanner(String(skipReturnBannerValue || '') === '1' ? false : true);
        if (chatIdValue) {
          (async () => {
            await loadExistingChat();
            setFlowStage('ready');
          })();
        } else {
          setFlowStage('ready');
        }
        // Skip initialization to avoid jumping back to Stage 1
      } else if (mode === 'continue' && chatIdValue) {
        kickedOff = true;
        loadExistingChat();
      } else if (contactIdValue) {
        kickedOff = true;
        initializeChat();
      }
      fetchContacts();
      fetchUserHashtags();
      // Load entity registry cache if chatId exists
      if (chatIdValue) {
        loadEntityRegistryCache(chatIdValue);
      }
    }
    if (!kickedOff) {
      setInitializing(false);
    }
  }, [contactIdValue, chatIdValue, user, mode, fromContactChatValue, sentValue, skipReturnBannerValue]);

  // Define initializeChat before it's used in useEffect
  const initializeChat = async () => {
    if (!contactIdValue || !user) {
      console.log('❌ Missing contactId or user');
      setInitializing(false);
      return;
    }

    console.log('🚀 Initializing AI chat for contactId:', contactIdValue);
    setInitializing(true);

    try {
      const { data: contactRelation, error: contactError } = await supabase
        .from("contacts")
        .select("contact_id")
        .eq("user_id", user.id)
        .eq("contact_id", contactIdValue)
        .maybeSingle();

      if (contactError) {
        console.error('❌ Contact relation fetch error:', contactError);
        throw contactError;
      }

      if (!contactRelation) {
        console.error('❌ Contact relationship not found');
        throw new Error('Contact not found in your contacts list');
      }

      const { data: contactProfile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("id", contactIdValue)
        .single();

      if (profileError) {
        console.error('❌ Profile fetch error:', profileError);
        throw profileError;
      }

      console.log('✅ Contact profile loaded:', contactProfile);

      if (contactProfile) {
        setContact({
          id: contactProfile.id,
          email: contactProfile.email,
          full_name: contactProfile.full_name,
        });
      }

      const defaultSessionName = `Conversation with ${contactProfile?.full_name || contactProfile?.email}`;
      setChatTitle(defaultSessionName);

      const { data: newChat, error } = await supabase
        .from("chats")
        .insert({
          user_id: user.id,
          chat_type: "ai_assistant",
          session_name: defaultSessionName,
          last_message: "Starting new session...",
          last_message_at: new Date().toISOString(),
          context_contact_id: contactIdValue,
          is_resolved: false,
          context_data: {
            contact_backup: {
              id: contactProfile?.id,
              email: contactProfile?.email,
              full_name: contactProfile?.full_name,
            },
            flowStage: 'welcome',
            chat_title: defaultSessionName,
          },
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Chat creation error:', error);
        throw error;
      }

      console.log('✅ Chat created:', newChat.id);
      setCurrentChatId(newChat.id);
      contextDataRef.current = newChat.context_data || { chat_title: defaultSessionName };
      setFlowStage('welcome'); // Set to 'welcome' to show Stage 1 (initial description)
      setInitializing(false);
      
      // Initialize empty entity registry cache for new chat
      await loadEntityRegistryCache(newChat.id);
    } catch (err) {
      console.error('❌ Failed to initialize chat:', err);
      Alert.alert('Error', 'Failed to initialize chat. Please try again.');
      setInitializing(false);
    }
  };

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select(`
          contact_profile:profiles!contacts_contact_id_fkey (
            id,
            email,
            full_name
          ),
          category
        `)
        .eq('user_id', user?.id);

      if (error) throw error;

      const contacts = (data || []).map((c: any) => ({
        id: c.contact_profile.id,
        email: c.contact_profile.email,
        full_name: c.contact_profile.full_name,
        category: c.category
      }));

      setAvailableContacts(contacts);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
    }
  };
  
// ✅ Fetch user's personal hashtags and merge with general list
const fetchUserHashtags = async () => {
  try {
    const { data, error } = await supabase
      .from("user_hashtags")
      .select("tag")
      .eq("user_id", user?.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    const userTags = (data || []).map((d) => d.tag);
    const generalTags = getCommonHashTags();
    const merged = Array.from(new Set([...userTags, ...generalTags]));

    setHashSuggestions(merged);
  } catch (err) {
    console.error("⚠️ Failed to fetch user hashtags:", err);
    setHashSuggestions(getCommonHashTags());
  }
};

// ✅ Save new hashtag to user history
const saveUserHashtag = async (tag: string) => {
  if (!user || !tag.trim()) return;
  try {
    await supabase.from("user_hashtags").upsert({
      user_id: user.id,
      tag: tag.trim().toLowerCase(),
    });
  } catch (err) {
    console.error("⚠️ Failed to save hashtag:", err);
  }
};

  const searchContacts = (query: string) => {
    const filtered = filterContactsByPrefix(query, availableContacts);
    setContactSuggestions(filtered);
  };

// ✅ Load entity registry cache to check for existing pronouns
const loadEntityRegistryCache = async (chatIdParam: string) => {
  if (!chatIdParam) return;
  try {
    const { data, error } = await supabase
      .from('entity_registry')
      .select('entity_name, preferred_pronouns')
      .eq('chat_id', chatIdParam);

    if (error) throw error;
    
    const cache: Record<string, { preferred_pronouns: string; entity_name: string }> = {};
    (data || []).forEach((entity: any) => {
      const key = entity.entity_name.toLowerCase().trim();
      cache[key] = {
        preferred_pronouns: entity.preferred_pronouns,
        entity_name: entity.entity_name,
      };
    });
    
    setEntityRegistryCache(cache);
    console.log('✅ Loaded entity registry cache:', cache);
  } catch (err) {
    console.error('⚠️ Failed to load entity registry cache:', err);
  }
};


  const handleDescriptionChange = (text: string) => {
  setInitialDescription(text);

  const cursorPosition = (descriptionCursorPos !== undefined && descriptionCursorPos <= text.length)
    ? descriptionCursorPos
    : text.length;

  const textUpToCursor = text.substring(0, cursorPosition);
  const typingTag = getLastTypingTag(textUpToCursor, cursorPosition);

  console.log('🔍 Description tag detection:', { typingTag, cursorPosition, textUpToCursor });

  // ✅ Always close opposite dropdown types when switching
  if (typingTag.type === '@') {
    // Show ONLY User B immediately when @ is typed
    // Keep visible until space or selection
    console.log('📧 Showing @ dropdown for User B');
    // Close # dropdown and pronoun dropdown first
    setShowPronounDropdown(null);
    setHashSuggestions([]);
    setShowTagDropdown('@');

    const userBContact = availableContacts.filter(c => c.id === resolvedContactId);
    setContactSuggestions(userBContact);
  } else if (typingTag.type === '#') {
    // Show pronoun list immediately when # is typed (no extra character needed)
    // Keep visible until space or pronoun is selected
    const hasPronounSelected = pronounSelectionContext?.pendingHashTag?.includes(':');

    if (!hasPronounSelected) {
      // Show pronoun dropdown immediately - keep visible until space or selection
      console.log('🏷️ Showing pronoun dropdown for #');
      // Close @ dropdown first
      setShowTagDropdown(null);
      setContactSuggestions([]);
      setHashSuggestions([]);
      setShowPronounDropdown('#');
      setPronounSelectionContext({
        stage: 'description',
        cursorPos: typingTag.startPos,
      });
    } else if (hasPronounSelected) {
      // Pronoun selected, user typing name - hide all dropdowns
      console.log('✏️ Pronoun selected, allowing name typing');
      setShowTagDropdown(null);
      setShowPronounDropdown(null);
      setHashSuggestions([]);
      setContactSuggestions([]);
    }
  } else {
    // No active tag - close all dropdowns
    console.log('🚪 Closing all dropdowns (no active tag or space detected)');
    setShowTagDropdown(null);
    setShowPronounDropdown(null);
    setContactSuggestions([]);
    setHashSuggestions([]);
  }

  const contacts = availableContacts.map(c => ({
    id: c.id,
    name: c.full_name || c.email,
  }));

  const entities = parseTaggedEntities(text, contacts);

  // Handle completed # tags with pronoun assignment
  if (pronounSelectionContext?.pendingHashTag?.includes(':')) {
    const hashTagPattern = /#(\w+)([\s.,!?;:]|$)/g;
    let match;
    const processedTags = new Set<string>();

    while ((match = hashTagPattern.exec(text)) !== null) {
      const tagName = match[1];

      if (processedTags.has(tagName)) continue;
      processedTags.add(tagName);

      const existingEntity = entities.find(e =>
        e.tag === `#${tagName}` && e.preferred_pronouns
      );

      if (!existingEntity) {
        const pronoun = pronounSelectionContext.pendingHashTag.split(':')[1];
        const entity = createStructuredTaggedEntity(
          `#${tagName}`,
          tagName,
          'unregistered',
          undefined,
          pronoun
        );

        entities.push(entity);
        saveTagToEntityRegistry(entity).then(() => {
          setPronounSelectionContext(null);
        });
      }
    }
  }

  setTaggedEntities(entities);
};


  const handleContactSelect = async (contact: any) => {
    const typingTag = getLastTypingTag(initialDescription, descriptionCursorPos);
    if (typingTag.type === '@') {
      // Check if selected contact is the current chat contact (User B)
    const isCurrentChatContact = contact.id === resolvedContactId;
      const contactName = contact.full_name || contact.email;
      
      if (isCurrentChatContact) {
        // Skip pronoun selection, use "you/your/yours" for User B
        const newText = replaceTypingTag(
          initialDescription,
          typingTag.startPos,
          '@',
          contactName
        );
        // Clear all dropdowns first to prevent re-opening
        setContactSuggestions([]);
        setShowTagDropdown(null);
        setShowPronounDropdown(null);
        // Then update text - this will trigger handleDescriptionChange but dropdowns are already closed
        setInitialDescription(newText);

        // Create structured entity for User B
        const entity = createStructuredTaggedEntity(
          `@${contactName}`,
          contactName,
          'registered',
          contact,
          'you/your/yours',
          true // isUserB
        );
        
        // Update tagged entities
        const contacts = availableContacts.map(c => ({
          id: c.id,
          name: c.full_name || c.email,
        }));
        const entities = parseTaggedEntities(newText, contacts);
        
        // Add the structured entity if not already present
        const existingIndex = entities.findIndex(e => e.tag === entity.tag);
        if (existingIndex >= 0) {
          entities[existingIndex] = entity;
        } else {
          entities.push(entity);
        }
        
        setTaggedEntities(entities);
        
        // Save to entity_registry
        await saveTagToEntityRegistry(entity);
      } else {
        // For other registered contacts: 
        // 1. First, insert the contact name in the text box immediately
        const newText = replaceTypingTag(
          initialDescription,
          typingTag.startPos,
          '@',
          contactName
        );
        setInitialDescription(newText);
        setContactSuggestions([]);
        setShowTagDropdown(null);
        
        // Check if we already have pronouns for this contact in cache
        const cacheKey = contactName.toLowerCase().trim();
        const existingEntity = entityRegistryCache[cacheKey];
        
        if (existingEntity && existingEntity.preferred_pronouns) {
          // Use existing pronouns - no need to show dropdown
          const entity = createStructuredTaggedEntity(
            `@${contactName}`,
            contactName,
            'registered',
            contact,
            existingEntity.preferred_pronouns,
            false // isUserB
          );
          
          const contacts = availableContacts.map(c => ({
            id: c.id,
            name: c.full_name || c.email,
          }));
          const entities = parseTaggedEntities(newText, contacts);
          
          const existingIndex = entities.findIndex(e => e.tag === `@${contactName}`);
          if (existingIndex >= 0) {
            entities[existingIndex] = entity;
          } else {
            entities.push(entity);
          }
          
          setTaggedEntities(entities);
          await saveTagToEntityRegistry(entity);
        } else {
          // No existing pronouns - show pronoun dropdown
          setShowPronounDropdown('@');
          setPronounSelectionContext({
            stage: 'description',
            pendingContact: contact,
            cursorPos: typingTag.startPos,
          });
        }
      }
    }
  };

  // ✅ Updated handleHashTagSelect - called when user selects a suggested #tag
const handleHashTagSelect = async (tag: string) => {
  const typingTag = getLastTypingTag(initialDescription, descriptionCursorPos);
  if (typingTag.type === '#') {
    // If we have a pronoun selected from context, use it; otherwise use default
    const selectedPronoun = pronounSelectionContext?.pendingHashTag?.includes(':') 
      ? pronounSelectionContext.pendingHashTag.split(':')[1]
      : 'they/them';
    
    const newText = replaceTypingTag(initialDescription, typingTag.startPos, '#', tag);
    setInitialDescription(newText);
    setHashSuggestions([]);
    setShowTagDropdown(null);
    setShowPronounDropdown(null);
    setPronounSelectionContext(null);

    // Create structured entity
    const entity = createStructuredTaggedEntity(
      `#${tag}`,
      tag,
      'unregistered',
      undefined,
      selectedPronoun
    );
    
    // Update tagged entities
    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));
    const entities = parseTaggedEntities(newText, contacts);
    
    // Add the structured entity
    const existingIndex = entities.findIndex(e => e.tag === entity.tag);
    if (existingIndex >= 0) {
      entities[existingIndex] = entity;
    } else {
      entities.push(entity);
    }
    
    setTaggedEntities(entities);
    
    // Save to entity_registry
    await saveTagToEntityRegistry(entity);
    
    // Also save to user_hashtags for future suggestions
    await saveUserHashtag(tag);
  }
};

// ✅ Handler for pronoun selection - works across all stages
const handlePronounSelect = async (pronoun: string) => {
  if (!pronounSelectionContext) return;
  
  const { stage, pendingContact, cursorPos } = pronounSelectionContext;
  const tagType = showPronounDropdown; // '@' or '#'
  
  setShowPronounDropdown(null);
  
  if (tagType === '@' && pendingContact) {
    // For @ tags: Contact name is already inserted, just save with pronoun
    const contactName = pendingContact.full_name || pendingContact.email;
    const isCurrentChatContact = pendingContact.id === resolvedContactId;
    
    // Get current text and setters based on stage
    let currentText = '';
    let setEntitiesFn: ((entities: TaggedEntity[]) => void) | null = null;
    
    if (stage === 'description') {
      currentText = initialDescription;
      setEntitiesFn = setTaggedEntities;
    } else if (stage === 'answer') {
      currentText = currentAnswer;
      setEntitiesFn = (entities) => setCurrentAnswerTags(entities);
    } else if (stage === 'additionalInfo') {
      currentText = additionalInfo;
      setEntitiesFn = (entities) => setAdditionalInfoTags(entities);
    }
    // Note: prevAnswer and editAnswer stages can be handled similarly if needed
    
    if (currentText && setEntitiesFn) {
      // Create structured entity with selected pronoun
      const entity = createStructuredTaggedEntity(
        `@${contactName}`,
        contactName,
        'registered',
        pendingContact,
        isCurrentChatContact ? 'you/your/yours' : pronoun,
        isCurrentChatContact
      );
      
      // Update tagged entities based on stage
      const contacts = availableContacts.map(c => ({
        id: c.id,
        name: c.full_name || c.email,
      }));
      const entities = parseTaggedEntities(currentText, contacts);
      const existingIndex = entities.findIndex(e => e.tag === entity.tag);
      if (existingIndex >= 0) {
        entities[existingIndex] = entity;
      } else {
        entities.push(entity);
      }
      
      setEntitiesFn(entities);
      
      // Save to entity_registry
      await saveTagToEntityRegistry(entity);
      
      // Clear context and dropdowns
      if (stage === 'description') {
        setShowTagDropdown(null);
        setContactSuggestions([]);
      } else if (stage === 'answer') {
        setShowAnswerTagDropdown(null);
        setAnswerContactSuggestions([]);
      } else if (stage === 'additionalInfo') {
        setShowAdditionalInfoTagDropdown(null);
        setAdditionalInfoContactSuggestions([]);
      }
      setPronounSelectionContext(null);
    }
  } else if (tagType === '#') {
    // For # tags: After pronoun selection, store pronoun in context
    // User will now type the name directly
    setPronounSelectionContext({
      ...pronounSelectionContext,
      pendingHashTag: `pronoun:${pronoun}`,
    });
    
    // Clear dropdowns - user will type the name now
    if (stage === 'description') {
      setShowTagDropdown(null);
      setHashSuggestions([]);
    } else if (stage === 'answer') {
      setShowAnswerTagDropdown(null);
      setAnswerHashSuggestions([]);
    } else if (stage === 'additionalInfo') {
      setShowAdditionalInfoTagDropdown(null);
      setAdditionalInfoHashSuggestions([]);
    }
    setShowPronounDropdown(null);
  }
};

// ✅ Helper: Save structured tag to entity_registry
const saveTagToEntityRegistry = async (entity: TaggedEntity) => {
  if (!user || !currentChatId) return null;
  
  try {
    const entityData: any = {
      chat_id: currentChatId,
      entity_name: entity.entity_name || entity.name || '',
      preferred_pronouns: entity.preferred_pronouns || 'they/them',
      is_registered: entity.is_registered ?? (entity.type === 'registered'),
    };

    if (entity.user_id) {
      entityData.user_id = entity.user_id;
    }

    if (entity.entity_type) {
      entityData.entity_type = entity.entity_type;
    } else if (entity.type === 'registered') {
      entityData.entity_type = 'registered_contact';
    } else {
      entityData.entity_type = entity.category === 'group' ? 'group' : 'third_party_person';
    }

    if (entity.role_in_conversation) {
      entityData.role_in_conversation = entity.role_in_conversation;
    } else if (entity.participant_slot === 'B') {
      entityData.role_in_conversation = 'User B';
      entityData.is_participant = true;
    } else {
      entityData.role_in_conversation = entity.type === 'registered' ? 'mentioned' : 'subject';
    }

    if (entity.is_participant !== undefined) {
      entityData.is_participant = entity.is_participant;
    }

    if (entity.participant_slot) {
      entityData.participant_slot = entity.participant_slot;
    }

    const { data, error } = await supabase
      .from("entity_registry")
      .upsert(entityData, {
        onConflict: 'chat_id,entity_name',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) throw error;
    console.log(`✅ Saved tag to entity_registry:`, entityData);
    
    // Update entity registry cache
    if (data) {
      const entityName = entityData.entity_name?.toLowerCase().trim();
      if (entityName) {
        setEntityRegistryCache(prev => ({
          ...prev,
          [entityName]: {
            preferred_pronouns: entityData.preferred_pronouns || 'they/them',
            entity_name: entityData.entity_name,
          },
        }));
      }
    }
    
    return data;
  } catch (err) {
    console.error("⚠️ Failed to save tag to entity_registry:", err);
    return null;
  }
};

// ✅ Helper: Create structured TaggedEntity object
const createStructuredTaggedEntity = (
  tag: string,
  entityName: string,
  type: 'registered' | 'unregistered',
  contact?: any,
  pronouns?: string,
  isUserB?: boolean
): TaggedEntity => {
  const baseEntity: TaggedEntity = {
    type,
    tag,
    entity_name: entityName,
    tag_symbol: tag.startsWith('@') ? '@' : '#',
    is_registered: type === 'registered',
    preferred_pronouns: pronouns,
  };

  if (type === 'registered') {
    baseEntity.entity_type = 'registered_contact';
    baseEntity.user_id = contact?.id;
    baseEntity.contactId = contact?.id || contactIdValue || null; // Keep for backward compatibility
    baseEntity.name = entityName; // Keep for backward compatibility
    
    if (isUserB) {
      baseEntity.role_in_conversation = 'User B';
      baseEntity.is_participant = true;
      baseEntity.participant_slot = 'B';
      baseEntity.preferred_pronouns = 'you/your/yours';
    } else {
      baseEntity.role_in_conversation = 'mentioned';
      baseEntity.is_participant = false;
    }
  } else {
    // Determine entity_type for unregistered entities
    const category = inferEntityCategory(entityName);
    baseEntity.entity_type = category === 'group' ? 'group' : 
                            category === 'object' ? 'object' : 'third_party_person';
    baseEntity.role_in_conversation = 'subject';
    baseEntity.category = category;
  }

  return baseEntity;
};

// Helper to infer entity category from name
const inferEntityCategory = (name: string): string => {
  const lower = name.toLowerCase();
  const groupIndicators = ['coworkers', 'friends', 'family', 'team', 'members', 'group', 'people'];
  if (groupIndicators.some(ind => lower.includes(ind))) return 'group';
  
  const orgIndicators = ['company', 'organization', 'business', 'corp'];
  if (orgIndicators.some(ind => lower.includes(ind))) return 'organization';
  
  return 'person';
};


  // Stage 2: Handle current answer text change with tagging
  const handleCurrentAnswerChange = (text: string) => {
    setCurrentAnswer(text);

    const typingTag = getLastTypingTag(text, currentAnswerCursorPos);
    console.log('🔍 Answer tag detection:', { typingTag });

    // ✅ Always close opposite dropdown types when switching
    if (typingTag.type === '@') {
      // Show ONLY User B immediately when @ is typed
      console.log('📧 Showing @ dropdown for User B (answer)');
      // Close # dropdown and pronoun dropdown first
      setShowPronounDropdown(null);
      setAnswerHashSuggestions([]);
      setShowAnswerTagDropdown('@');
      const userBContact = availableContacts.filter(c => c.id === resolvedContactId);
      setAnswerContactSuggestions(userBContact);
    } else if (typingTag.type === '#') {
      // Show pronoun list immediately when # is typed
      const hasPronounSelected = pronounSelectionContext?.pendingHashTag?.includes(':');

      if (!hasPronounSelected) {
        // Show pronoun dropdown immediately - keep visible until space or selection
        console.log('🏷️ Showing pronoun dropdown for # (answer)');
        // Close @ dropdown first
        setShowAnswerTagDropdown(null);
        setAnswerContactSuggestions([]);
        setAnswerHashSuggestions([]);
        setShowPronounDropdown('#');
        setPronounSelectionContext({
          stage: 'answer',
          cursorPos: typingTag.startPos,
        });
      } else if (hasPronounSelected) {
        // Pronoun selected, user typing name - hide all dropdowns
        console.log('✏️ Pronoun selected, allowing name typing (answer)');
        setShowAnswerTagDropdown(null);
        setShowPronounDropdown(null);
        setAnswerHashSuggestions([]);
        setAnswerContactSuggestions([]);
      }
    } else {
      // No active tag - close all dropdowns
      console.log('🚪 Closing all dropdowns (answer)');
      setShowAnswerTagDropdown(null);
      setShowPronounDropdown(null);
      setAnswerContactSuggestions([]);
      setAnswerHashSuggestions([]);
    }

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));

    const entities = parseTaggedEntities(text, contacts);
    setCurrentAnswerTags(entities);
  };

  // Handle additional info text change with tagging
  const handleAdditionalInfoChange = (text: string) => {
    setAdditionalInfo(text);

    const typingTag = getLastTypingTag(text, additionalInfoCursorPos);
    console.log('🔍 Additional info tag detection:', { typingTag });

    // ✅ Always close opposite dropdown types when switching
    if (typingTag.type === '@') {
      console.log('📧 Showing @ dropdown for User B (additional info)');
      // Close # dropdown and pronoun dropdown first
      setShowPronounDropdown(null);
      setAdditionalInfoHashSuggestions([]);
      setShowAdditionalInfoTagDropdown('@');
      const userBContact = availableContacts.filter(c => c.id === resolvedContactId);
      setAdditionalInfoContactSuggestions(userBContact);
    } else if (typingTag.type === '#') {
      const hasPronounSelected = pronounSelectionContext?.pendingHashTag?.includes(':');

      if (!hasPronounSelected) {
        console.log('🏷️ Showing pronoun dropdown for # (additional info)');
        // Close @ dropdown first
        setShowAdditionalInfoTagDropdown(null);
        setAdditionalInfoContactSuggestions([]);
        setAdditionalInfoHashSuggestions([]);
        setShowPronounDropdown('#');
        setPronounSelectionContext({
          stage: 'additionalInfo',
          cursorPos: typingTag.startPos,
        });
      } else if (hasPronounSelected) {
        console.log('✏️ Pronoun selected, allowing name typing (additional info)');
        setShowAdditionalInfoTagDropdown(null);
        setShowPronounDropdown(null);
        setAdditionalInfoHashSuggestions([]);
        setAdditionalInfoContactSuggestions([]);
      }
    } else {
      console.log('🚪 Closing all dropdowns (additional info)');
      setShowAdditionalInfoTagDropdown(null);
      setShowPronounDropdown(null);
      setAdditionalInfoContactSuggestions([]);
      setAdditionalInfoHashSuggestions([]);
    }

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));

    const entities = parseTaggedEntities(text, contacts);
    setAdditionalInfoTags(entities);
  };

  // Handle completed # tags with pronoun context (similar to Stage 1)
  const finalizeHashTagWithPronoun = (text: string, stage: string) => {
    if (!pronounSelectionContext?.pendingHashTag?.includes(':') || pronounSelectionContext?.stage !== stage) {
      return;
    }

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));
    const entities = parseTaggedEntities(text, contacts);
      const hashTagPattern = /#(\w+)([\s.,!?;:]|$)/g;
      let match;
      const processedTags = new Set<string>();
      
      while ((match = hashTagPattern.exec(text)) !== null) {
        const tagName = match[1];
        if (processedTags.has(tagName)) continue;
        processedTags.add(tagName);
        
        const existingEntity = entities.find(e => 
          e.tag === `#${tagName}` && e.preferred_pronouns
        );
        
        if (!existingEntity) {
          const pronoun = pronounSelectionContext.pendingHashTag.split(':')[1];
          const entity = createStructuredTaggedEntity(
            `#${tagName}`,
            tagName,
            'unregistered',
            undefined,
            pronoun
          );
          entities.push(entity);
          saveTagToEntityRegistry(entity).then(() => {
            setPronounSelectionContext(null);
          });
        }
      }

    setCurrentAnswerTags(entities);
  };

  // Stage 2: Handle contact selection for current answer
  const handleAnswerContactSelect = async (contact: any) => {
    const typingTag = getLastTypingTag(currentAnswer, currentAnswerCursorPos);
    if (typingTag.type === '@') {
      const isCurrentChatContact = contact.id === resolvedContactId;
      const contactName = contact.full_name || contact.email;
      
      if (isCurrentChatContact) {
        const newText = replaceTypingTag(currentAnswer, typingTag.startPos, '@', contactName);
        setCurrentAnswer(newText);
        setAnswerContactSuggestions([]);
        setShowAnswerTagDropdown(null);
        
        const entity = createStructuredTaggedEntity(
          `@${contactName}`,
          contactName,
          'registered',
          contact,
          'you/your/yours',
          true
        );
        
        const contacts = availableContacts.map(c => ({
          id: c.id,
          name: c.full_name || c.email,
        }));
        const entities = parseTaggedEntities(newText, contacts);
        const existingIndex = entities.findIndex(e => e.tag === entity.tag);
        if (existingIndex >= 0) {
          entities[existingIndex] = entity;
        } else {
          entities.push(entity);
        }
        setCurrentAnswerTags(entities);
        await saveTagToEntityRegistry(entity);
      } else {
        const newText = replaceTypingTag(currentAnswer, typingTag.startPos, '@', contactName);
        setCurrentAnswer(newText);
        setAnswerContactSuggestions([]);
        setShowAnswerTagDropdown(null);
        
        setShowPronounDropdown('@');
        setPronounSelectionContext({
          stage: 'answer',
          pendingContact: contact,
          cursorPos: typingTag.startPos,
        });
      }
    }
  };

  // Stage 2: Handle hashtag selection for current answer
  const handleAnswerHashTagSelect = async (tag: string) => {
    const typingTag = getLastTypingTag(currentAnswer, currentAnswerCursorPos);
    if (typingTag.type === '#') {
      const selectedPronoun = pronounSelectionContext?.pendingHashTag?.includes(':') 
        ? pronounSelectionContext.pendingHashTag.split(':')[1]
        : 'they/them';
      
      const newText = replaceTypingTag(currentAnswer, typingTag.startPos, '#', tag);
      setCurrentAnswer(newText);
      setAnswerHashSuggestions([]);
      setShowAnswerTagDropdown(null);
      setShowPronounDropdown(null);
      setPronounSelectionContext(null);

      const entity = createStructuredTaggedEntity(
        `#${tag}`,
        tag,
        'unregistered',
        undefined,
        selectedPronoun
      );
      
      const contacts = availableContacts.map(c => ({
        id: c.id,
        name: c.full_name || c.email,
      }));
      const entities = parseTaggedEntities(newText, contacts);
      const existingIndex = entities.findIndex(e => e.tag === entity.tag);
      if (existingIndex >= 0) {
        entities[existingIndex] = entity;
      } else {
        entities.push(entity);
      }
      setCurrentAnswerTags(entities);
      await saveTagToEntityRegistry(entity);
      await saveUserHashtag(tag);
    }
  };

  // Stage 2: Handle previous answer text change with tagging
  const handlePreviousAnswerChange = (index: number, text: string) => {
    const words = text.trim().split(/\s+/);
    let nextText = text;
    if (words.length > 15) {
      nextText = words.slice(0, 15).join(" ");
    }

    const updated = [...qaPairs];
    updated[index].answer = nextText;
    setQAPairs(updated);

    setEditingAnswerIndex(index);

    // Detect @ or # anywhere in text - closes on space/punctuation
    const cursorPos = prevAnswerCursorPos[index] || 0;
    const typingTag = getLastTypingTag(nextText, cursorPos);

    if (typingTag.type === '@') {
      const query = typingTag.search.toLowerCase();
      const sorted = [...availableContacts].sort((a, b) =>
        (a.full_name || a.email).localeCompare(b.full_name || b.email)
      );
      const filtered = query.length === 0 ? sorted : filterContactsByPrefix(query, sorted)

      setPrevAnswerContactSuggestions(filtered);
      setPrevAnswerHashSuggestions([]);
    } else if (typingTag.type === '#') {
  setShowAdditionalInfoTagDropdown('#');
  const query = typingTag.search.toLowerCase();

  // ✅ Combine user + default hashtags safely
  const allTags = hashSuggestions && hashSuggestions.length > 0
    ? hashSuggestions
    : getCommonHashTags();

  const sorted = [...allTags].sort((a, b) => a.localeCompare(b));
  const filtered =
    query.length === 0
      ? sorted
      : sorted.filter(tag => tag.toLowerCase().includes(query));
      setPrevAnswerHashSuggestions(filtered);
      setPrevAnswerContactSuggestions([]);
    } else {
      setEditingAnswerIndex(null);
      setPrevAnswerContactSuggestions([]);
      setPrevAnswerHashSuggestions([]);
    }

    // Gentle clarity check for edited answers
    if (text.trim().length > 0) {
      validateMeaningfulness(text).then((ok) => {
        if (!ok) {
          // Suppress noisy alerts while user is editing inline
          // We will enforce clarity when advancing stages instead
        }
      });
    }
  };

  // Stage 3: Handle edit mode answer change with tagging
  const handleEditAnswerWithTags = (index: number, text: string) => {
    const updated = [...editedQAPairs];
    updated[index].answer = text;
    setEditedQAPairs(updated);

    setEditModeAnswerIndex(index);

    // Detect @ or # anywhere in text - closes on space/punctuation
    const cursorPos = editModeCursorPos[index] || 0;
    const typingTag = getLastTypingTag(text, cursorPos);

    // ✅ Always close opposite dropdown types when switching
    if (typingTag.type === '@') {
      // Show ONLY User B (the current chat contact) in dropdown
      // Close # dropdown first
      setEditModeHashSuggestions([]);
      const userBContact = availableContacts.filter(c => c.id === resolvedContactId);
      setEditModeContactSuggestions(userBContact);
    } else if (typingTag.type === '#') {
      // Close @ dropdown first
      setEditModeContactSuggestions([]);
      const query = typingTag.search.toLowerCase();

      // ✅ Combine user + default hashtags safely
      const allTags = hashSuggestions && hashSuggestions.length > 0
        ? hashSuggestions
        : getCommonHashTags();

      const sorted = [...allTags].sort((a, b) => a.localeCompare(b));
      const filtered =
        query.length === 0
          ? sorted
          : sorted.filter(tag => tag.toLowerCase().includes(query));
      setEditModeHashSuggestions(filtered);
    } else {
      // No active tag - close all dropdowns
      setEditModeAnswerIndex(null);
      setEditModeContactSuggestions([]);
      setEditModeHashSuggestions([]);
    }
  };

  // Stage 3: Handle contact selection for additional info
  const handleAdditionalInfoContactSelect = async (contact: any) => {
    const typingTag = getLastTypingTag(additionalInfo, additionalInfoCursorPos);
    if (typingTag.type === '@') {
      const isCurrentChatContact = contact.id === resolvedContactId;
      const contactName = contact.full_name || contact.email;
      
      if (isCurrentChatContact) {
        const newText = replaceTypingTag(additionalInfo, typingTag.startPos, '@', contactName);
        setAdditionalInfo(newText);
        setAdditionalInfoContactSuggestions([]);
        setShowAdditionalInfoTagDropdown(null);
        
        const entity = createStructuredTaggedEntity(
          `@${contactName}`,
          contactName,
          'registered',
          contact,
          'you/your/yours',
          true
        );
        
        const contacts = availableContacts.map(c => ({
          id: c.id,
          name: c.full_name || c.email,
        }));
        const entities = parseTaggedEntities(newText, contacts);
        const existingIndex = entities.findIndex(e => e.tag === entity.tag);
        if (existingIndex >= 0) {
          entities[existingIndex] = entity;
        } else {
          entities.push(entity);
        }
        setAdditionalInfoTags(entities);
        await saveTagToEntityRegistry(entity);
      } else {
        const newText = replaceTypingTag(additionalInfo, typingTag.startPos, '@', contactName);
        setAdditionalInfo(newText);
        setAdditionalInfoContactSuggestions([]);
        setShowAdditionalInfoTagDropdown(null);
        
        setShowPronounDropdown('@');
        setPronounSelectionContext({
          stage: 'additionalInfo',
          pendingContact: contact,
          cursorPos: typingTag.startPos,
        });
      }
    }
  };

  // Stage 3: Handle hashtag selection for additional info
  const handleAdditionalInfoHashTagSelect = async (tag: string) => {
    const typingTag = getLastTypingTag(additionalInfo, additionalInfoCursorPos);
    if (typingTag.type === '#') {
      const selectedPronoun = pronounSelectionContext?.pendingHashTag?.includes(':') 
        ? pronounSelectionContext.pendingHashTag.split(':')[1]
        : 'they/them';
      
      const newText = replaceTypingTag(additionalInfo, typingTag.startPos, '#', tag);
      setAdditionalInfo(newText);
      setAdditionalInfoHashSuggestions([]);
      setShowAdditionalInfoTagDropdown(null);
      setShowPronounDropdown(null);
      setPronounSelectionContext(null);

      const entity = createStructuredTaggedEntity(
        `#${tag}`,
        tag,
        'unregistered',
        undefined,
        selectedPronoun
      );
      
      const contacts = availableContacts.map(c => ({
        id: c.id,
        name: c.full_name || c.email,
      }));
      const entities = parseTaggedEntities(newText, contacts);
      const existingIndex = entities.findIndex(e => e.tag === entity.tag);
      if (existingIndex >= 0) {
        entities[existingIndex] = entity;
      } else {
        entities.push(entity);
      }
      setAdditionalInfoTags(entities);
      await saveTagToEntityRegistry(entity);
      await saveUserHashtag(tag);
    }
  };

  const loadExistingChat = async () => {
    if (!user) {
      console.log('❌ Missing user');
      setInitializing(false);
      return;
    }

    if (!chatIdValue) {
      console.log('❌ Missing chatId for continue mode');
      setInitializing(false);
      Alert.alert('Error', 'Chat session not found');
      router.push('/ai-assistant');
      return;
    }

    console.log('🔄 Loading existing chat:', chatIdValue);
    setInitializing(true);

    try {
      const { data: chatData, error: chatError } = await supabase
        .from('chats')
        .select('*, context_data')
        .eq('id', chatIdValue)
        .eq('user_id', user.id)
        .eq('chat_type', 'ai_assistant')
        .single();

      if (chatError || !chatData) {
        console.error('❌ Failed to load chat:', chatError);
        throw new Error('Chat session not found');
      }

      console.log('✅ Chat data loaded:', chatData);

      setCurrentChatId(chatData.id);
      contextDataRef.current = chatData.context_data || {};
      const existingTitle = (chatData.context_data && chatData.context_data.chat_title) || chatData.session_name || '';
      if (existingTitle && contextDataRef.current.chat_title !== existingTitle) {
        contextDataRef.current = { ...contextDataRef.current, chat_title: existingTitle };
      }
      setChatTitle(existingTitle);
      
      // Load entity registry cache for this chat
      loadEntityRegistryCache(chatData.id);

      let contactProfile = null;
      let contactError = null;

      try {
        const contactIdToLoad = chatData.context_contact_id || contactIdValue;
        console.log('🔍 Loading contact profile for:', contactIdToLoad);

        if (!contactIdToLoad) {
          console.error('❌ No contact ID available');
          throw new Error('Contact ID is missing from chat data');
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .eq('id', contactIdToLoad)
          .maybeSingle();

        contactProfile = data;
        contactError = error;

        if (contactError) {
          console.warn('⚠️ Contact profile fetch error:', contactError);
        }

        if (!contactProfile) {
          console.log('⚠️ Contact not found by profile ID, trying backup...');

          if (chatData.context_data?.contact_backup) {
            console.log('✅ Using contact backup from context_data');
            contactProfile = chatData.context_data.contact_backup;
          }
        }

        if (contactProfile) {
          console.log('✅ Contact profile loaded:', contactProfile.email);
          setContact({
            id: contactProfile.id,
            email: contactProfile.email,
            full_name: contactProfile.full_name,
          });
        } else {
          console.error('❌ Failed to load contact profile');
          throw new Error('Contact profile not found. The contact may have been deleted.');
        }
      } catch (contactErr) {
        console.error('❌ Contact loading error:', contactErr);
        throw new Error('Failed to load contact information');
      }

      if (chatData.context_data) {
        const ctx = chatData.context_data;
        if (ctx.initial_description) setInitialDescription(ctx.initial_description);
        if (ctx.qa_pairs) setQAPairs(ctx.qa_pairs);
        if (ctx.summary) setSummary(ctx.summary);
        if (ctx.thoughts) setThoughts(ctx.thoughts);
        if (ctx.questionCount !== undefined) setQuestionCount(ctx.questionCount);
        if (ctx.currentQuestion) setCurrentQuestion(ctx.currentQuestion);
        if (ctx.currentQuestionType) setCurrentQuestionType(ctx.currentQuestionType);
        if (ctx.flowStage) {
          // Map legacy 'description' to 'welcome' for UI compatibility
          const mappedStage = ctx.flowStage === 'description' ? 'welcome' : ctx.flowStage;
          setFlowStage(mappedStage as FlowStage);
        } else if (chatData.is_resolved) {
          setFlowStage('ready');
        } else if (ctx.summary) {
          setFlowStage('summary');
        } else if (ctx.qa_pairs && ctx.qa_pairs.length > 0) {
          setFlowStage('qa');
        } else if (ctx.initial_description) {
          setFlowStage('qa');
        }

        if (ctx.taggedEntities) setTaggedEntities(ctx.taggedEntities);

        if (ctx.currentAnswer) setCurrentAnswer(ctx.currentAnswer);
        if (ctx.selectedOption) setSelectedOption(ctx.selectedOption);
        if (ctx.currentOptions) setCurrentOptions(ctx.currentOptions);
      }

      console.log('✅ Existing chat loaded successfully');
    } catch (err) {
      console.error('❌ Failed to load existing chat:', err);
      Alert.alert('Error', 'Failed to load chat session. Please try again.');
      router.push('/ai-assistant');
    } finally {
      setInitializing(false);
    }
  };

  // If explicitly asked to show a particular stage on return (e.g., from contact-selection)
  useEffect(() => {
    if (returnStageValue === 'ready') {
      setFlowStage('ready');
      setShowReturnFromChatBanner(true);
    }
  }, [returnStageValue]);

  useEffect(() => {
    if (prefillApplied) return;
    if (typeof prefillDescriptionValue === 'string' && prefillDescriptionValue.length) {
      try {
        const decoded = decodeURIComponent(prefillDescriptionValue);
        if (decoded.trim().length) {
          setInitialDescription((prev) => (prev && prev.trim().length ? prev : decoded.trim()));
        }
      } catch (error) {
        console.warn('Failed to decode prefillDescription', error);
      } finally {
        setPrefillApplied(true);
      }
    }
  }, [prefillDescriptionValue, prefillApplied]);

  // Early returns for loading and error states - MUST come after all hooks
  if (initializing && returnStageValue !== 'ready') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary[500]} />
          <Text style={styles.loadingText}>
            {mode === 'continue' ? 'Loading conversation...' : 'Initializing AI chat...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!contact && returnStageValue !== 'ready') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Contact not found</Text>
          <Text style={styles.stageDescription}>
            Unable to load contact information for this conversation.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.push('/ai-assistant')}
          >
            <Text style={styles.primaryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const handleWelcomeSubmit = async () => {
    const normalizedTitle = chatTitle.trim();

    if (!normalizedTitle) {
      Alert.alert(
        "Add a chat title",
        "Give this session a short title so you can spot it later."
      );
      return;
    }

    if (!initialDescription.trim()) {
      Alert.alert(
        "Please describe the situation",
        "Tell me what happened or what's on your mind."
      );
      return;
    }

    // 💡 Adaptive short-and-crisp alert to reduce token cost
    const wordCount = initialDescription.trim().split(/\s+/).length;

    if (Math.round(wordCount * 1.5) > 150) {
      Alert.alert(
        "Let's simplify together 💛",
        "That's a very detailed story — I love your honesty! Let's keep it short and crisp so I can help faster ❤️"
      );
      return;
    } else if (wordCount > 100) {
      Alert.alert(
        "Keep it short 💬",
        "Try to describe the issue briefly — 2–3 lines is enough so I can help faster ❤️\n\n(Short notes also save AI energy and reduce token cost 💡)"
      );
      return;
    }

    const isMeaningful = await validateMeaningfulness(initialDescription);

    if (!isMeaningful) {
      Alert.alert(
        "Hmm, I didn't understand 🤔",
        "Could you describe your situation a bit more clearly so I can help better?"
      );
      return;
    }

    setLoading(true);
    try {
      const wordCount = initialDescription.trim().split(/\s+/).length;
      const hasEmotion = /(feel|think|want|said|because|angry|upset|happy|worried|hurt|sad|tense|care|sorry|love|hate)/i.test(initialDescription);

      if (wordCount > 120 && hasEmotion) {
        console.log("🧠 Skipping first question — detailed description detected");
        setFlowStage("qa");
        setCurrentQuestion("You've already shared so thoughtfully 💛 Let's just explore it a bit more before I summarize.");
        setQuestionCount(1);
      } else {
        await generateFirstQuestion();
      }
    } finally {
      setLoading(false);
    }

    await updateChatRecord(
      {
        session_name: normalizedTitle,
      },
      {
        chat_title: normalizedTitle,
        initial_description: initialDescription,
        taggedEntities,
        flowStage: 'welcome',
      }
    );
  };

  const generateFirstQuestion = async () => {
    try {
      const tagContext = taggedEntities.length > 0
        ? `\n\nPeople mentioned: ${taggedEntities.map(e => `${e.entity_name || e.name} (${e.type})`).join(', ')}`
        : '';
      
      // Check if there are third-person entities mentioned (unregistered # tags)
      const thirdPersonEntities = taggedEntities.filter(e => 
        e.type === 'unregistered' || (e.type === 'registered' && e.role_in_conversation !== 'User B')
      );
      const thirdPersonContext = thirdPersonEntities.length > 0
        ? `\n\nIMPORTANT: The description mentions third parties: ${thirdPersonEntities.map(e => e.entity_name || e.name).join(', ')}. Consider asking about their role, relationship, or what happened involving them.`
        : '';

      const systemPrompt = `You are a thoughtful assistant helping someone prepare for a conversation with ${contact?.full_name || "their contact"}.

You already know the following from what they said:
"${initialDescription}"${tagContext}${thirdPersonContext}

📌 Instructions:
- Do NOT ask about things already mentioned (who, where, when, event type, relationship, etc.)
- Ask only what is *missing* or *emotionally unclear* — like feelings, intentions, or next steps.
${thirdPersonEntities.length > 0 ? `- CRITICAL: Third parties are mentioned (${thirdPersonEntities.map((e: any) => e.entity_name || e.name).join(', ')}). You MUST ask a question about one of these third parties - their role, relationship, or what happened involving them. This is important for context.` : ''}
- Avoid repeating or obvious questions.
- Ask ONLY ONE question. Do NOT ask multiple questions in a single response. Ask just ONE short, natural question (5–8 words max).
- Keep your tone caring and human, not robotic.`;


      const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 100,
          system: systemPrompt,
          messages: [
            { role: "user", content: initialDescription },
          ],
        }),
      });

      const result = await response.json();

      if (result?.content) {
        setCurrentQuestion(result.content);
        setCurrentQuestionType("text");
        setFlowStage("qa");
        setQuestionCount(1);
      }
    } catch (err) {
      console.error("Failed to generate question:", err);
      Alert.alert("Error", "Failed to generate question. Please try again.");
    }
  };


  const handleAnswerSubmit = async () => {
    const answer = currentQuestionType === "dropdown" ? selectedOption : currentAnswer;
    const normalizedTitle = chatTitle.trim() || contextDataRef.current.chat_title || '';

   if (!answer?.trim() && !isReviewMode) {
  Alert.alert("Answer Required", "Please provide an answer to continue.");
  return;
}

    // Friendly validation: only block clearly irrelevant inputs
    const cleaned = cleanUpAnswer(answer || '');
    // Extra guard for pure gibberish (no vowels and only letters)
    const lettersOnly = /^[a-zA-Z]+$/;
    const hasVowel = /[aeiouAEIOU]/;
    if (isClearlyIrrelevant(cleaned) || (lettersOnly.test(cleaned) && !hasVowel.test(cleaned) && cleaned.length >= 3)) {
      Alert.alert(
        "Answer unclear",
        "That doesn't seem related. Try a short word or phrase."
      );
      return;
    }


// ✅ Double-check all previous answers too
for (const [idx, pair] of qaPairs.entries()) {
  const prevAns = pair.answer?.trim() || "";
  if (!prevAns) continue;
  if (isClearlyIrrelevant(prevAns)) {
    Alert.alert(
      "Let's clarify 💭",
      `Your earlier answer #${idx + 1} seems unclear. Could you rephrase it so I can better understand? ❤️`
    );
    return; // stop moving forward
  }
}

    const newPair: QAPair = {
      question: currentQuestion,
      answer: cleaned || '',
      answerType: currentQuestionType,
      options: currentQuestionType === "dropdown" ? currentOptions : undefined,
    };

    const updatedPairs = [...qaPairs, newPair];
    setQAPairs(updatedPairs);
    setCurrentAnswer("");
    setSelectedOption(null);

    // keep questionCount in sync with visible progress
    setQuestionCount(updatedPairs.length);

    await updateChatRecord(
      {},
      {
        qa_pairs: updatedPairs,
        initial_description: initialDescription,
        flowStage: 'qa',
        questionCount: updatedPairs.length,
        taggedEntities,
        currentAnswer: '',
        selectedOption: null,
        chat_title: normalizedTitle,
      }
    );

    // ✅ Enforce max 5 questions total
    if (updatedPairs.length >= 5) {
      setShowGenerateSummaryButton(true);
      setCurrentQuestion(""); // stop showing new question
      return;
    }

    // If summary button already shown, do not generate more questions
    if (showGenerateSummaryButton) {
      setCurrentQuestion("");
      return;
    }

    if (updatedPairs.length >= 2) {
      await checkIfSufficientInfo(updatedPairs);
    } else {
      await generateNextQuestion(updatedPairs);
    }
  };


  const checkIfSufficientInfo = async (pairs: QAPair[]) => {
    if (pairs.length >= 7) {
      setIsGeneratingSummary(true);
      setCurrentQuestion("");
      await generateSummary(pairs);
      return;
    }

    setLoading(true);
    try {
      const conversationHistory = pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join("\n\n");

      const systemPrompt = `Analyze if we have enough information to help someone prepare for a conversation.

Initial: ${initialDescription}

${conversationHistory}

Respond with JSON only: {"sufficient": true/false, "reason": "brief explanation"}

Minimum 2 questions answered. Consider sufficient if we understand: what happened, emotional context, and what they want to achieve.`;

      const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 100,
          system: systemPrompt,
          messages: [
            { role: "user", content: "Evaluate completeness." },
          ],
        }),
      });

      const result = await response.json();

      if (result?.content) {
        try {
          const cleanJson = result.content.replace(/```json/g, '').replace(/```/g, '').trim();
          const evaluation = JSON.parse(cleanJson);

          if (evaluation.sufficient) {
            setShowGenerateSummaryButton(true);
          }
        } catch (e) {
          console.log('Failed to parse evaluation, continuing with questions');
        }
      }

      await generateNextQuestion(pairs);
    } catch (err) {
      console.error("Failed to check info completeness:", err);
      await generateNextQuestion(pairs);
    } finally {
      setLoading(false);
    }
  };

  const generateNextQuestion = async (pairs: QAPair[]) => {
    // Hard cap: stop generating new questions beyond 5
    if (pairs.length >= 5) {
      setShowGenerateSummaryButton(true);
      setCurrentQuestion("");
      return;
    }
    setLoading(true);
    try {
      const conversationHistory = pairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join("\n\n");
      
      // Collect all tagged entities from initial description and answers
      const allTaggedEntities = [...taggedEntities];
      pairs.forEach(p => {
        const contacts = availableContacts.map(c => ({ id: c.id, name: c.full_name || c.email }));
        const answerEntities = parseTaggedEntities(p.answer, contacts);
        answerEntities.forEach(e => {
          if (!allTaggedEntities.find(existing => existing.tag === e.tag)) {
            allTaggedEntities.push(e);
          }
        });
      });
      
      const thirdPersonEntities = allTaggedEntities.filter(e => 
        e.type === 'unregistered' || (e.type === 'registered' && e.role_in_conversation !== 'User B')
      );
      const thirdPersonContext = thirdPersonEntities.length > 0
        ? `\n\nIMPORTANT: Third parties mentioned: ${thirdPersonEntities.map(e => e.entity_name || e.name).join(', ')}. Consider asking about their relationship, role, or involvement if not yet clear.`
        : '';

      const systemPrompt = `You are a thoughtful assistant helping someone prepare for a conversation with ${contact?.full_name || "their contact"}.

You already know the following context:
Initial description: ${initialDescription}

Conversation so far:
${conversationHistory}${thirdPersonContext}

📌 Instructions:
- Do NOT ask about details already mentioned (names, time, place, relationship, event type, etc.).
- Ask only about new emotional insight, motivation, or next-step clarity.
${thirdPersonEntities.length > 0 ? `- CRITICAL: Third parties are mentioned (${thirdPersonEntities.map((e: any) => e.entity_name || e.name).join(', ')}). You MUST ask a question about one of these third parties - their role, relationship, or what happened involving them, if not yet clear from previous answers.` : ''}
- Avoid repeating questions or asking for information that's already clear.
- Ask ONLY ONE question. Do NOT ask multiple questions in a single response. Ask just ONE short, natural question (5–8 words max).
- Keep it caring and human — not robotic.`;


      const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 100,
          system: systemPrompt,
          messages: [
            { role: "user", content: "Ask me the next question." },
          ],
        }),
      });

      const result = await response.json();

      if (result?.content) {
        setCurrentQuestion(result.content);
        setCurrentQuestionType("text");
        setQuestionCount(questionCount + 1);

        const normalizedTitle = chatTitle.trim() || contextDataRef.current.chat_title || '';
        await updateChatRecord(
          {},
          {
            qa_pairs: pairs,
            initial_description: initialDescription,
            currentQuestion: result.content,
            currentQuestionType: 'text',
            currentAnswer: '',
            selectedOption: null,
            flowStage: 'qa',
            questionCount: questionCount + 1,
            taggedEntities,
            chat_title: normalizedTitle,
          }
        );
      }
    } catch (err) {
      console.error("Failed to generate next question:", err);
      Alert.alert("Error", "Failed to generate next question.");
    } finally {
      setLoading(false);
    }
  };


  // ✅ Hybrid Quality Checker: Local first, AI fallback only if borderline
const validateMeaningfulness = async (text: string): Promise<boolean> => {
  if (!text || text.trim().length < 10) return false;

  const lower = text.toLowerCase();

  // --- 1️⃣ Local quick checks (free, instant) ---
  const meaninglessPatterns =
    /(idk|don't know|whatever|nothing|blah|no idea|random|nonsense|haha|hmm+|ok|fine)/i;
  const verbs =
    /(feel|think|want|said|talk|argue|share|discuss|happened|upset|happy|angry|told|asked|problem|issue)/i;

  const emojiPattern = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;
  const emojiCount = (text.match(emojiPattern) || []).length;

  const words = text.trim().split(/\s+/).length;
  const hasVerb = verbs.test(lower);
  const hasMeaning = !meaninglessPatterns.test(lower);
  const emojiRatio = emojiCount / text.length;

  // Strongly meaningful → pass immediately (no cost)
  if (words > 4 && hasVerb && hasMeaning && emojiRatio < 0.3) return true;

  // Clearly junk → fail immediately (no cost)
  if (words < 3 || emojiRatio > 0.5 || !hasMeaning) return false;

  // --- 2️⃣ Borderline → small AI check (costs ~20 tokens only) ---
  try {
    const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 30,
        system:
          "You are a strict evaluator. Reply only 'true' or 'false' to indicate if the text is meaningful for a real emotional or interpersonal issue.",
        messages: [
          {
            role: "user",
            content: `Text: "${text}"`,
          },
        ],
      }),
    });

    const result = await response.json();
    const reply = result?.content?.toLowerCase() || "";
    return reply.includes("true");
  } catch (err) {
    console.error("AI fallback failed:", err);
    return true; // assume OK if Claude check fails
  }
};

// ✅ Short-input helper to gently limit word count across stages
const enforceShortInput = (text: string, maxWords = 4): boolean => {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords;
};

  const generateSummary = async (pairs: QAPair[]) => {
    setLoading(true);
    setIsGeneratingSummary(true);
    try {
      if (!currentChatId) {
        throw new Error('No chat ID available');
      }

      // ✅ Fetch all entities from entity_registry
      const { data: entitiesFromRegistry, error: entitiesError } = await supabase
        .from('entity_registry')
        .select('*')
        .eq('chat_id', currentChatId);

      if (entitiesError) {
        console.error('Failed to fetch entities:', entitiesError);
      }

      // ✅ Fetch structured context data (all Stage 1-3 answers)
      const { data: structuredContextData, error: structuredError } = await supabase
        .from('structured_context_data')
        .select('*')
        .eq('chat_id', currentChatId)
        .order('created_at', { ascending: true });

      if (structuredError) {
        console.error('Failed to fetch structured context:', structuredError);
      }

      // Identify User A, User B, and other entities
      const userAEntity = entitiesFromRegistry?.find((e: any) => e.role_in_conversation === 'User A' || e.is_participant && e.participant_slot === 'A');
      const userBEntity = entitiesFromRegistry?.find((e: any) => e.role_in_conversation === 'User B' || e.is_participant && e.participant_slot === 'B');
      const otherEntities = entitiesFromRegistry?.filter((e: any) => 
        e.role_in_conversation !== 'User A' && 
        e.role_in_conversation !== 'User B' &&
        !e.is_participant
      ) || [];

      // Build conversation history with structured context
      const conversationHistory = pairs.map((p, idx) => `Q${idx + 1}: ${p.question}\nA${idx + 1}: ${p.answer}`).join("\n\n");

      // Add structured context data to conversation history
      let structuredAnswersText = '';
      if (structuredContextData && structuredContextData.length > 0) {
        structuredAnswersText = '\n\nAdditional Context:\n' + structuredContextData.map((sc: any) => 
          `${sc.question_text}: ${typeof sc.answer_value === 'object' ? JSON.stringify(sc.answer_value.value || sc.answer_value) : sc.answer_value}`
        ).join('\n');
      }

      // Build entity mapping - tags and pronouns
      const entityTagMap: Record<string, string> = {}; // Maps entity names to their tags (@name or #name)
      const entityPronounMap: Record<string, string> = {}; // Maps entity names to their pronouns
      
      entitiesFromRegistry?.forEach((e: any) => {
        const name = e.entity_name?.toLowerCase().trim();
        const fullName = e.entity_name;
        if (name && fullName) {
          // Determine tag symbol based on entity type
          const tagSymbol = e.is_registered ? '@' : '#';
          const tag = `${tagSymbol}${fullName}`;
          entityTagMap[name] = tag;
          
          // Map pronouns based on role
          if (e.role_in_conversation === 'User A' || (e.is_participant && e.participant_slot === 'A')) {
            entityPronounMap[name] = 'I/me/my'; // User A uses first-person
          } else if (e.role_in_conversation === 'User B' || (e.is_participant && e.participant_slot === 'B')) {
            entityPronounMap[name] = 'you/your'; // User B is addressed as "you"
          } else {
            // Third parties use their stored pronouns
            entityPronounMap[name] = e.preferred_pronouns || 'they/them';
          }
        }
      });

      // Build comprehensive context with all tagged entities
      const allTaggedEntitiesList = entitiesFromRegistry && entitiesFromRegistry.length > 0
        ? entitiesFromRegistry.map((e: any) => {
            const tagSymbol = e.is_registered ? '@' : '#';
            const tag = `${tagSymbol}${e.entity_name}`;
            let roleDesc = '';
            if (e.role_in_conversation === 'User A' || (e.is_participant && e.participant_slot === 'A')) {
              roleDesc = ' (User A - the person writing this summary, use "I/me/my")';
            } else if (e.role_in_conversation === 'User B' || (e.is_participant && e.participant_slot === 'B')) {
              roleDesc = ' (User B - the person they\'re talking to, use "you/your")';
            } else {
              roleDesc = ` (third party, use "${e.preferred_pronouns || 'they/them'}")`;
            }
            return `${tag}${roleDesc}`;
          }).join(', ')
        : '';

      const entityContextText = allTaggedEntitiesList
        ? `\n\nTagged Participants and Pronouns:\n${allTaggedEntitiesList}`
        : '';

      // Accumulate ALL information: Stage 1 description + Stage 2 answers + structured context + tags
      const allContextText = `Initial Description (Stage 1):\n${initialDescription}\n\nQuestion & Answer History (Stage 2):\n${conversationHistory}${structuredAnswersText ? `\n\nStructured Context Data:\n${structuredAnswersText}` : ''}${entityContextText}`;

      const systemPrompt = `You are helping someone refine and improve their personal summary. Take ALL the information provided below and create a single, polished paragraph written from their first-person perspective (as if they wrote it themselves).

CRITICAL RULES FOR PRONOUNS AND TAGS:

1. PERSPECTIVE: Write from User A's first-person perspective ("I felt...", "I want to tell you...", "My situation is...")

2. PRONOUNS AND TAGS:
   - User A (the person writing) → Use "I / me / my" ONLY (keep first-person perspective)
   - User B (the person they're talking to) → ALWAYS use their @tag (e.g., "@aradhya") - NEVER use "you/your"
   - Third-party people → ALWAYS use their tag (@name for registered, #name for unregistered) - NEVER use pronouns like "he/she/they/them/their"
   - CRITICAL: Replace ALL pronouns (you, he, she, they, them, their) with explicit tags
   - Example: "you were upset" → "@aradhya was upset", "she felt ignored" → "#Mom felt ignored", "they thought it was rude" → "#Vikram and #Raja thought it was rude"

3. TAGS: 
   - ALWAYS keep @ and # tags in place (e.g., "@aradhya", "#Philip", "#Team")
   - Tags are REQUIRED for all participants except User A (who uses "I/me/my")
   - Tags help link entities correctly for follow-up AI generation
   - Maintain tags mid-sentence - do not simplify or drop them

4. TONE:
   - Sound natural and emotionally clear, like User A is summarizing their own situation
   - Make it grammatically smooth and concise
   - Not robotic or AI-like
   - Example: "I felt hurt when @aradhya said I was jealous. #Philip and #Vikram asked why we were arguing."

5. CONTENT:
   - Accumulate ALL information from:
     * Initial description (Stage 1)
     * All question answers (Stage 2)
     * Any additional/edited inputs
     * All tagged entities and their relationships
   - Create ONE refined, cohesive paragraph
   - Keep it concise but emotionally clear

Complete Context Information:
${allContextText}

Generate:
1. A refined summary paragraph under "📌 Discussion Summary" (written from User A's "I/me/my" perspective)
2. One empathetic insight under "💡 My Thoughts"

Keep total under 100 words. Write naturally, using tags for ALL participants (except "I/me/my" for User A). Never use pronouns like "you", "he", "she", "they", "them", or "their" - always use explicit @ or # tags.

Your response MUST include both "📌 Discussion Summary" and "💡 My Thoughts" in this exact order.
Return only two labeled sections exactly in this order:
"📌 Discussion Summary" followed by "💡 My Thoughts" — no numbering, no bullets.`;



      const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 200,
          system: systemPrompt,
          messages: [
            { role: "user", content: "Generate the summary now." },
          ],
        }),
      });

      const result = await response.json();

     if (result?.content) {
  let rawContent = result.content;
  
  // First, protect existing tags to avoid partial replacements (e.g., #S should not become #Sneha if #S exists)
  const existingTags = new Set<string>();
  const tagProtectionMap: Record<string, string> = {};
  let protectionIndex = 0;
  
  // Extract and protect all existing @ and # tags
  rawContent = rawContent.replace(/(@[\w]+|#[\w]+)/g, (match: string): string => {
    const placeholder = `__TAG_PROTECT_${protectionIndex}__`;
    tagProtectionMap[placeholder] = match;
    existingTags.add(match);
    protectionIndex++;
    return placeholder;
  });
  
  // Post-process summary to replace ALL pronouns with tags (except "I/me/my" for User A)
  // Process entities in reverse length order to match longer names first (e.g., "Sneha" before "S")
  const sortedEntities = [...(entitiesFromRegistry || [])].sort((a: any, b: any) => 
    (b.entity_name?.length || 0) - (a.entity_name?.length || 0)
  );
  
  sortedEntities.forEach((e: any) => {
    const name = e.entity_name?.toLowerCase().trim();
    const fullName = e.entity_name;
    if (name && fullName) {
      const tagSymbol = e.is_registered ? '@' : '#';
      const tag = `${tagSymbol}${fullName}`;
      
      // Skip if this entity already has a tag in the text (to avoid duplicates)
      if (existingTags.has(tag)) {
        return;
      }
      
      // User A -> Keep ONLY first-person "I/me/my" (do not replace these)
      if (e.role_in_conversation === 'User A' || (e.is_participant && e.participant_slot === 'A')) {
        // Only replace generic references, keep "I/me/my" as-is
        const patterns = [
          new RegExp(`\\bthe user\\b`, 'gi'),
          new RegExp(`\\buser a\\b`, 'gi'),
          new RegExp(`\\bthe person preparing\\b`, 'gi'),
          new RegExp(`\\bthe person writing\\b`, 'gi'),
          // Only replace name if it's not already protected as a tag
          new RegExp(`\\b${fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!\\s*(?:__TAG_PROTECT|said|told|asked))`, 'gi'),
        ];
        patterns.forEach((pattern) => {
          rawContent = rawContent.replace(pattern, (match: string, offset: number, original: string): string => {
            const before = original.substring(Math.max(0, offset - 10), offset);
            const after = original.substring(offset + match.length, Math.min(original.length, offset + match.length + 10));
            if (before.includes('__TAG_PROTECT') || after.includes('__TAG_PROTECT')) {
              return match;
            }
            return 'I';
          });
        });
      }
      // User B -> Replace ALL pronouns with @tag
      else if (e.role_in_conversation === 'User B' || (e.is_participant && e.participant_slot === 'B')) {
        // Escape special regex characters in fullName
        const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Replace pronouns with tag - use word boundaries to avoid partial matches
        rawContent = rawContent.replace(new RegExp(`\\byou\\b(?!\\s*${escapedName})`, 'gi'), tag);
        rawContent = rawContent.replace(new RegExp(`\\byour\\b(?!\\s*${escapedName})`, 'gi'), `${tag}'s`);
        rawContent = rawContent.replace(new RegExp(`\\byours\\b(?!\\s*${escapedName})`, 'gi'), `${tag}'s`);
        rawContent = rawContent.replace(new RegExp(`\\byourself\\b(?!\\s*${escapedName})`, 'gi'), tag);
        
        // Replace generic references and bare names (not already protected)
        const patterns = [
          new RegExp(`\\buser b\\b`, 'gi'),
          new RegExp(`\\bthe contact\\b`, 'gi'),
          new RegExp(`\\bthe recipient\\b`, 'gi'),
          new RegExp(`(?!__TAG_PROTECT)\\b${escapedName}\\b(?!\\s*(?:__TAG_PROTECT))`, 'gi'),
        ];
        patterns.forEach((pattern) => {
          rawContent = rawContent.replace(pattern, tag);
        });
      }
      // Third parties -> Replace ALL pronouns with tags
      else {
        // Escape special regex characters in fullName
        const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Replace pronouns based on stored preferred_pronouns
        const pronouns = e.preferred_pronouns || 'they/them';
        if (pronouns.toLowerCase().includes('he/him')) {
          rawContent = rawContent.replace(new RegExp(`\\bhe\\b(?!\\s*${escapedName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bhim\\b(?!\\s*${escapedName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bhis\\b(?!\\s*${escapedName})`, 'gi'), `${tag}'s`);
          rawContent = rawContent.replace(new RegExp(`\\bhimself\\b(?!\\s*${escapedName})`, 'gi'), tag);
        } else if (pronouns.toLowerCase().includes('she/her')) {
          rawContent = rawContent.replace(new RegExp(`\\bshe\\b(?!\\s*${escapedName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bher\\b(?!\\s*${escapedName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bhers\\b(?!\\s*${escapedName})`, 'gi'), `${tag}'s`);
          rawContent = rawContent.replace(new RegExp(`\\bherself\\b(?!\\s*${escapedName})`, 'gi'), tag);
        } else {
          // they/them
          rawContent = rawContent.replace(new RegExp(`\\bthey\\b(?!\\s*${escapedName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bthem\\b(?!\\s*${escapedName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\btheir\\b(?!\\s*${escapedName})`, 'gi'), `${tag}'s`);
          rawContent = rawContent.replace(new RegExp(`\\btheirs\\b(?!\\s*${escapedName})`, 'gi'), `${tag}'s`);
          rawContent = rawContent.replace(new RegExp(`\\bthemselves\\b(?!\\s*${escapedName})`, 'gi'), tag);
        }
        
        // Replace bare names (not already protected)
        rawContent = rawContent.replace(new RegExp(`(?!__TAG_PROTECT|@|#)\\b${escapedName}\\b(?!\\s*(?:__TAG_PROTECT|@|#))`, 'gi'), tag);
      }
    }
  });
  
  // Restore protected tags
  Object.entries(tagProtectionMap).forEach(([placeholder, originalTag]) => {
    rawContent = rawContent.replace(placeholder, originalTag);
  });
  
  // Final cleanup: remove any remaining double @ or # patterns
  rawContent = rawContent.replace(/@@+/g, '@');
  rawContent = rawContent.replace(/##+/g, '#');
  
  // Fix grammar: adjust verb forms if needed after tag replacement
  // e.g., "@aradhya were" → "@aradhya was", "#Team are" → "#Team is" (if singular entity)
  rawContent = rawContent.replace(new RegExp(`(@[\\w]+|#[\\w]+)\\s+were\\b`, 'gi'), "$1 was");
  rawContent = rawContent.replace(new RegExp(`(@[\\w]+|#[\\w]+)\\s+are\\b`, 'gi'), "$1 is");

  // 🧠 Detect unclear or irrelevant summaries
  const isUnclear =
  !rawContent ||
  rawContent.length < 40 || // too short = likely meaningless
  /unclear|unsure|not enough|don't understand|cannot determine|meaningless|irrelevant|incomplete|confused|random|no context/i.test(rawContent) ||
  !rawContent.includes("📌 Discussion Summary") ||
  !rawContent.includes("💡 My Thoughts");


  const summaryText = rawContent
    .split("💡 My Thoughts")[0]
    .replace("📌 Discussion Summary", "")
    .trim();
  const thoughtsText = rawContent.split("💡 My Thoughts")[1]?.trim() || "";

  if (isUnclear && !hasAggregateClarity()) {
    setSummary(summaryText || "The summary is unclear.");
    setThoughts(
      "⚠️ The AI could not clearly interpret the purpose of this discussion."
    );
    setIsSummaryUnclear(true);
    setFlowStage("summary");
    return;
  } else {
    setIsSummaryUnclear(false);
  }


        setSummary(summaryText);
        setThoughts(thoughtsText);

        const normalizedTitle = chatTitle.trim() || contextDataRef.current.chat_title || '';
        await updateChatRecord(
          {},
          {
            summary: summaryText,
            thoughts: thoughtsText,
            qa_pairs: pairs,
            initial_description: initialDescription,
            flowStage: 'summary',
            questionCount: pairs.length,
            taggedEntities,
            chat_title: normalizedTitle,
          }
        );

        setFlowStage("summary");
      }
    } catch (err) {
      console.error("Failed to generate summary:", err);
      Alert.alert("Error", "Failed to generate summary.");
    } finally {
      setLoading(false);
      setIsGeneratingSummary(false);
    }
  };


  const handleAddExtraInfo = () => {
    setShowEditMode(true);
    setEditedQAPairs([...qaPairs]);

    setTimeout(() => {
      editScrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 300);
  };

  const handleEditAnswer = (index: number, newAnswer: string) => {
    const updated = [...editedQAPairs];
    updated[index] = { ...updated[index], answer: newAnswer };
    setEditedQAPairs(updated);
  };

  const handleRegenerateSummary = async () => {
    setLoading(true);
    setSummaryJustRegenerated(true);
    setShowEditMode(false);
    try {
      if (!currentChatId) {
        throw new Error('No chat ID available');
      }

      // Relaxed during edit: allow brief/typos; only block if empty or pure symbols
      if (additionalInfo.trim()) {
        const pureSymbols = /^[-_.!@#$%^&*()+=\d\s]+$/;
        if (pureSymbols.test(additionalInfo.trim())) {
          Alert.alert(
            "Additional info needed",
            "Please provide a short note with letters (not just symbols)."
          );
          setLoading(false);
          return;
        }
      }

      // ✅ Validate each edited answer before regenerating
for (const [idx, pair] of editedQAPairs.entries()) {
  const ans = pair.answer?.trim() || "";
  if (!ans) continue; // allow skipping unchanged items
  const pureSymbols = /^[-_.!@#$%^&*()+=\d\s]+$/;
  if (pureSymbols.test(ans)) {
    Alert.alert(
      "Answer required",
      `Please provide a short answer for #${idx + 1}.`
    );
    setLoading(false);
    return;
  }
}

      // ✅ Fetch all entities from entity_registry
      const { data: entitiesFromRegistry, error: entitiesError } = await supabase
        .from('entity_registry')
        .select('*')
        .eq('chat_id', currentChatId);

      if (entitiesError) {
        console.error('Failed to fetch entities:', entitiesError);
      }

      // ✅ Fetch structured context data (all Stage 1-3 answers)
      const { data: structuredContextData, error: structuredError } = await supabase
        .from('structured_context_data')
        .select('*')
        .eq('chat_id', currentChatId)
        .order('created_at', { ascending: true });

      if (structuredError) {
        console.error('Failed to fetch structured context:', structuredError);
      }

      // Build complete conversation history with edited Q&A pairs
      const conversationHistory = editedQAPairs.map((p, idx) => `Q${idx + 1}: ${p.question}\nA${idx + 1}: ${p.answer}`).join("\n\n");

      const additionalContext = additionalInfo.trim() ? `\n\nAdditional Information: ${additionalInfo}` : '';

      // Add structured context data to conversation history
      let structuredAnswersText = '';
      if (structuredContextData && structuredContextData.length > 0) {
        structuredAnswersText = '\n\nAdditional Context:\n' + structuredContextData.map((sc: any) => 
          `${sc.question_text}: ${typeof sc.answer_value === 'object' ? JSON.stringify(sc.answer_value.value || sc.answer_value) : sc.answer_value}`
        ).join('\n');
      }

      // Build entity mapping - tags and pronouns (same as generateSummary)
      const entityTagMap: Record<string, string> = {};
      const entityPronounMap: Record<string, string> = {};
      
      entitiesFromRegistry?.forEach((e: any) => {
        const name = e.entity_name?.toLowerCase().trim();
        const fullName = e.entity_name;
        if (name && fullName) {
          const tagSymbol = e.is_registered ? '@' : '#';
          const tag = `${tagSymbol}${fullName}`;
          entityTagMap[name] = tag;
          
          if (e.role_in_conversation === 'User A' || (e.is_participant && e.participant_slot === 'A')) {
            entityPronounMap[name] = 'I/me/my';
          } else if (e.role_in_conversation === 'User B' || (e.is_participant && e.participant_slot === 'B')) {
            entityPronounMap[name] = 'you/your';
          } else {
            entityPronounMap[name] = e.preferred_pronouns || 'they/them';
          }
        }
      });

      // Build comprehensive context with all tagged entities
      const allTaggedEntitiesList = entitiesFromRegistry && entitiesFromRegistry.length > 0
        ? entitiesFromRegistry.map((e: any) => {
            const tagSymbol = e.is_registered ? '@' : '#';
            const tag = `${tagSymbol}${e.entity_name}`;
            let roleDesc = '';
            if (e.role_in_conversation === 'User A' || (e.is_participant && e.participant_slot === 'A')) {
              roleDesc = ' (User A - the person writing this summary, use "I/me/my")';
            } else if (e.role_in_conversation === 'User B' || (e.is_participant && e.participant_slot === 'B')) {
              roleDesc = ' (User B - the person they\'re talking to, use "you/your")';
            } else {
              roleDesc = ` (third party, use "${e.preferred_pronouns || 'they/them'}")`;
            }
            return `${tag}${roleDesc}`;
          }).join(', ')
        : '';

      const entityContextText = allTaggedEntitiesList
        ? `\n\nTagged Participants and Pronouns:\n${allTaggedEntitiesList}`
        : '';

      // Accumulate ALL information: Stage 1 + Stage 2 (edited) + additional info + structured context + tags
      const allContextText = `Initial Description (Stage 1):\n${initialDescription}\n\nQuestion & Answer History - EDITED (Stage 2):\n${conversationHistory}${additionalContext ? `\n\nAdditional/Edited Information:\n${additionalContext}` : ''}${structuredAnswersText ? `\n\nStructured Context Data:\n${structuredAnswersText}` : ''}${entityContextText}`;

      const systemPrompt = `You are helping someone refine and improve their personal summary. Take ALL the information provided below and create a single, polished paragraph written from their first-person perspective (as if they wrote it themselves).

CRITICAL RULES FOR PRONOUNS AND TAGS:

1. PERSPECTIVE: Write from User A's first-person perspective ("I felt...", "I want to tell you...", "My situation is...")

2. PRONOUNS AND TAGS:
   - User A (the person writing) → Use "I / me / my" ONLY (keep first-person perspective)
   - User B (the person they're talking to) → ALWAYS use their @tag (e.g., "@aradhya") - NEVER use "you/your"
   - Third-party people → ALWAYS use their tag (@name for registered, #name for unregistered) - NEVER use pronouns like "he/she/they/them/their"
   - CRITICAL: Replace ALL pronouns (you, he, she, they, them, their) with explicit tags
   - Example: "you were upset" → "@aradhya was upset", "she felt ignored" → "#Mom felt ignored", "they thought it was rude" → "#Vikram and #Raja thought it was rude"

3. TAGS: 
   - ALWAYS keep @ and # tags in place (e.g., "@aradhya", "#Philip", "#Team")
   - Tags are REQUIRED for all participants except User A (who uses "I/me/my")
   - Tags help link entities correctly for follow-up AI generation
   - Maintain tags mid-sentence - do not simplify or drop them

4. TONE:
   - Sound natural and emotionally clear, like User A is summarizing their own situation
   - Make it grammatically smooth and concise
   - Not robotic or AI-like
   - Example: "I felt hurt when @aradhya said I was jealous. #Philip and #Vikram asked why we were arguing."

5. CONTENT:
   - Accumulate ALL information from:
     * Initial description (Stage 1)
     * All edited question answers (Stage 2)
     * Any additional/edited inputs
     * All tagged entities and their relationships
   - Create ONE refined, cohesive paragraph
   - Keep it concise but emotionally clear

Complete Context Information (including edits):
${allContextText}

Generate:
1. A refined summary paragraph under "📌 Discussion Summary" (written from User A's "I/me/my" perspective)
2. One empathetic insight under "💡 My Thoughts"

Keep total under 100 words. Write naturally, using tags for ALL participants (except "I/me/my" for User A). Never use pronouns like "you", "he", "she", "they", "them", or "their" - always use explicit @ or # tags.

Your response MUST include both "📌 Discussion Summary" and "💡 My Thoughts" in this exact order.
Return only two labeled sections exactly in this order:
"📌 Discussion Summary" followed by "💡 My Thoughts" — no numbering, no bullets.`;

      const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 200,
          system: systemPrompt,
          messages: [
            { role: "user", content: "Generate the summary now." },
          ],
        }),
      });

      const result = await response.json();

     if (result?.content) {
  let rawContent = result.content;
  
  // First, protect existing tags to avoid partial replacements (same as generateSummary)
  const existingTags = new Set<string>();
  const tagProtectionMap: Record<string, string> = {};
  let protectionIndex = 0;
  
  // Extract and protect all existing @ and # tags
  rawContent = rawContent.replace(/(@[\w]+|#[\w]+)/g, (match: string): string => {
    const placeholder = `__TAG_PROTECT_${protectionIndex}__`;
    tagProtectionMap[placeholder] = match;
    existingTags.add(match);
    protectionIndex++;
    return placeholder;
  });
  
  // Post-process summary to replace ALL pronouns with tags (except "I/me/my" for User A)
  // Process entities in reverse length order to match longer names first
  const sortedEntities = [...(entitiesFromRegistry || [])].sort((a: any, b: any) => 
    (b.entity_name?.length || 0) - (a.entity_name?.length || 0)
  );
  
  sortedEntities.forEach((e: any) => {
    const name = e.entity_name?.toLowerCase().trim();
    const fullName = e.entity_name;
    if (name && fullName) {
      const tagSymbol = e.is_registered ? '@' : '#';
      const tag = `${tagSymbol}${fullName}`;
      
      // User A -> Keep ONLY first-person "I/me/my" (do not replace these)
      if (e.role_in_conversation === 'User A' || (e.is_participant && e.participant_slot === 'A')) {
        // Only replace generic references, keep "I/me/my" as-is
        const patterns = [
          new RegExp(`\\bthe user\\b`, 'gi'),
          new RegExp(`\\buser a\\b`, 'gi'),
          new RegExp(`\\bthe person preparing\\b`, 'gi'),
          new RegExp(`\\bthe person writing\\b`, 'gi'),
          new RegExp(`\\b${fullName}\\b(?!\\s*(?:@|#|said|told|asked))`, 'gi'),
        ];
        patterns.forEach((pattern) => {
          rawContent = rawContent.replace(pattern, (match: string, offset: number, original: string): string => {
            const before = original.substring(Math.max(0, offset - 5), offset);
            const after = original.substring(offset + match.length, Math.min(original.length, offset + match.length + 5));
            if (before.includes('@') || before.includes('#') || after.includes('@') || after.includes('#')) {
              return match;
            }
            return 'I';
          });
        });
      }
      // User B -> Replace ALL pronouns with @tag
      else if (e.role_in_conversation === 'User B' || (e.is_participant && e.participant_slot === 'B')) {
        // First, remove any double @ signs
        rawContent = rawContent.replace(new RegExp(`@@${fullName}`, 'gi'), tag);
        rawContent = rawContent.replace(new RegExp(`@+${fullName}`, 'gi'), tag);
        
        // Replace pronouns with tag
        rawContent = rawContent.replace(new RegExp(`\\byou\\b`, 'gi'), tag);
        rawContent = rawContent.replace(new RegExp(`\\byour\\b`, 'gi'), `${tag}'s`);
        rawContent = rawContent.replace(new RegExp(`\\byours\\b`, 'gi'), `${tag}'s`);
        rawContent = rawContent.replace(new RegExp(`\\byourself\\b`, 'gi'), tag);
        
        // Replace generic references and bare names
        const patterns = [
          new RegExp(`\\buser b\\b`, 'gi'),
          new RegExp(`\\bthe contact\\b`, 'gi'),
          new RegExp(`\\bthe recipient\\b`, 'gi'),
          new RegExp(`(?!@)\\b${fullName}\\b(?!\\s*(?:@|#))`, 'gi'),
        ];
        patterns.forEach((pattern) => {
          rawContent = rawContent.replace(pattern, tag);
        });
      }
      // Third parties -> Replace ALL pronouns with tags
      else {
        // Remove any double @ or # signs first
        rawContent = rawContent.replace(new RegExp(`${tagSymbol}+${fullName}`, 'gi'), tag);
        
        // Replace pronouns based on stored preferred_pronouns
        const pronouns = e.preferred_pronouns || 'they/them';
        if (pronouns.toLowerCase().includes('he/him')) {
          rawContent = rawContent.replace(new RegExp(`\\bhe\\b(?!\\s*${fullName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bhim\\b(?!\\s*${fullName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bhis\\b(?!\\s*${fullName})`, 'gi'), `${tag}'s`);
          rawContent = rawContent.replace(new RegExp(`\\bhimself\\b(?!\\s*${fullName})`, 'gi'), tag);
        } else if (pronouns.toLowerCase().includes('she/her')) {
          rawContent = rawContent.replace(new RegExp(`\\bshe\\b(?!\\s*${fullName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bher\\b(?!\\s*${fullName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bhers\\b(?!\\s*${fullName})`, 'gi'), `${tag}'s`);
          rawContent = rawContent.replace(new RegExp(`\\bherself\\b(?!\\s*${fullName})`, 'gi'), tag);
        } else {
          // they/them
          rawContent = rawContent.replace(new RegExp(`\\bthey\\b(?!\\s*${fullName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\bthem\\b(?!\\s*${fullName})`, 'gi'), tag);
          rawContent = rawContent.replace(new RegExp(`\\btheir\\b(?!\\s*${fullName})`, 'gi'), `${tag}'s`);
          rawContent = rawContent.replace(new RegExp(`\\btheirs\\b(?!\\s*${fullName})`, 'gi'), `${tag}'s`);
          rawContent = rawContent.replace(new RegExp(`\\bthemselves\\b(?!\\s*${fullName})`, 'gi'), tag);
        }
        
        // Replace bare names
        rawContent = rawContent.replace(new RegExp(`(?!@|#)\\b${fullName}\\b(?!\\s*(?:@|#))`, 'gi'), tag);
      }
    }
  });
  
  // Final cleanup: remove any remaining double @ or # patterns
  rawContent = rawContent.replace(/@@+/g, '@');
  rawContent = rawContent.replace(/##+/g, '#');
  
  // Fix grammar: adjust verb forms if needed after tag replacement
  rawContent = rawContent.replace(new RegExp(`(@[\\w]+|#[\\w]+)\\s+were\\b`, 'gi'), "$1 was");
  rawContent = rawContent.replace(new RegExp(`(@[\\w]+|#[\\w]+)\\s+are\\b`, 'gi'), "$1 is");

  // 🧠 Detect unclear or irrelevant summaries
 const isUnclear =
  !rawContent ||
  rawContent.length < 40 || // too short = likely meaningless
  /unclear|unsure|not enough|don't understand|cannot determine|meaningless|irrelevant|incomplete|confused|random|no context/i.test(rawContent) ||
  !rawContent.includes("📌 Discussion Summary") ||
  !rawContent.includes("💡 My Thoughts");


  const summaryText = rawContent
    .split("💡 My Thoughts")[0]
    .replace("📌 Discussion Summary", "")
    .trim();
  const thoughtsText = rawContent.split("💡 My Thoughts")[1]?.trim() || "";

  if (isUnclear && !hasAggregateClarity()) {
    setSummary(summaryText || "The summary is unclear.");
    setThoughts(
      "⚠️ The AI could not clearly interpret the purpose of this discussion."
    );
    setIsSummaryUnclear(true);
    setFlowStage("summary");
    return;
  } else {
    setIsSummaryUnclear(false);
  }

  setSummary(summaryText);
  setThoughts(thoughtsText);

        setQAPairs(editedQAPairs);

        setTimeout(() => {
          setSummaryJustRegenerated(false);
        }, 500);

        await updateChatRecord({
          summary: summaryText,
          thoughts: thoughtsText,
          qa_pairs: editedQAPairs,
          initial_description: initialDescription,
          initial_description_tags: taggedEntities,
          additional_info: additionalInfo,
          additional_info_tags: additionalInfoTags,
          flowStage: 'summary',
          questionCount: editedQAPairs.length,
          taggedEntities: [...taggedEntities, ...additionalInfoTags],
        });
      }
    } catch (err) {
      console.error("Failed to regenerate summary:", err);
      Alert.alert("Error", "Failed to regenerate summary.");
    } finally {
      setLoading(false);
    }
  };

  const handleSummaryApprove = () => {
    setIsEditingMode(false);
    setFlowStage("ready");
  };

  const restartFlowToInitial = () => {
    // Keep user-entered data but restart the staged flow
    setIsEditingMode(false);
    setIsSummaryUnclear(false);
    setSummaryJustRegenerated(false);
    setCurrentQuestion("");
    setSelectedOption(null);
    setFlowStage('welcome');
  };

  const handleReadyToChat = async () => {
    if (!user || !currentChatId || !contactIdValue) return;

    setLoading(true);
    try {
      const { data: contactData } = await supabase
        .from("contacts")
        .select("category")
        .eq("user_id", user.id)
        .eq("contact_id", contactIdValue)
        .maybeSingle();

      const contactCategory = contactData?.category || "General";
      const contactName = contact?.full_name || contact?.email || "Contact";

      const hintPrompt = `Extract a 2-3 word issue summary and timeline from: "${summary}"

Respond ONLY with valid JSON:
{"issue": "2-3 words", "timeline": "today/yesterday/last week or empty"}`;

      const hintResponse = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          system: "Extract key information and respond only with JSON.",
          messages: [{ role: "user", content: hintPrompt }],
        }),
      });

      const hintResult = await hintResponse.json();
      let hintToContact = {
        issue: "recent concern",
        timeline: "",
        full_text: `${contactName} wants to chat`,
      };

      if (hintResult?.content) {
        try {
          const cleanJson = hintResult.content
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();
          const parsed = JSON.parse(cleanJson);
          hintToContact = {
            issue: parsed.issue || "recent concern",
            timeline: parsed.timeline || "",
            full_text: parsed.timeline
              ? `${contactName} wants to talk about **${parsed.issue}** ${parsed.timeline}`
              : `${contactName} wants to talk about **${parsed.issue}**`,
          };
        } catch (e) {
          console.error("Failed to parse hint JSON:", e);
        }
      }

      const normalizedTitle = chatTitle.trim() || contextDataRef.current.chat_title || `Conversation with ${contactName}`;

      await updateChatRecord(
        {
          is_resolved: true,
          session_name: normalizedTitle,
          context_data: { ...contextDataRef.current, session_promoted: true },
        },
        {
          summary,
          thoughts,
          qa_pairs: qaPairs,
          initial_description: initialDescription,
          session_promoted: true,
          chat_title: normalizedTitle,
        }
      );

      // Always create a fresh contact chat for a clean session (no history reuse)
      let contactChatId: string | undefined;
      const { data: newChat } = await supabase
        .from("chats")
        .insert({
          user_id: user.id,
          contact_id: contactIdValue,
          chat_type: "contact_chat",
          participants: [user.id, contactIdValue],
          is_resolved: false,
          ai_source_chat_id: currentChatId,
          ai_confidence_level: "high",
          options_stage: "ai_assisted",
          conversation_phase: "opening",
          turn_count_a: 0,
          turn_count_b: 0,
          resolution_detected: false,
          title: normalizedTitle,
          context_data: {
            summary_a: summary,
            thoughts_a: thoughts,
            hint_to_contact: hintToContact,
            contact_category: contactCategory,
            initial_pending: true,
            chat_title: normalizedTitle,
          },
        })
        .select("id")
        .single();
      contactChatId = newChat?.id;

      // Auto add a Soulroom reflection for this chat start
      try {
        const inferMoodFromText = (text?: string | null): string => {
          if (!text) return 'reflective';
          const lower = text.toLowerCase();
          if (/(calm|relieved|peaceful|steady)/.test(lower)) return 'peaceful';
          if (/(anxious|nervous|worried|tense)/.test(lower)) return 'anxious';
          if (/(sad|down|low|blue)/.test(lower)) return 'sad';
          if (/(angry|mad|upset|frustrated)/.test(lower)) return 'frustrated';
          if (/(happy|grateful|hopeful|excited)/.test(lower)) return 'grateful';
          return 'reflective';
        };

        const reflectionLines: string[] = [];
        if (summary) {
          reflectionLines.push(`Summary: ${summary}`);
        }
        if (thoughts) {
          reflectionLines.push(`My thoughts: ${thoughts}`);
        }
        if (!summary && initialDescription) {
          reflectionLines.push(`Context: ${initialDescription}`);
        }

        const moodPrefill = inferMoodFromText(thoughts || summary || initialDescription);

        const tags = ['post_conversation'];
        if (contactIdValue) {
          tags.push(`contact:${contactIdValue}`);
        }
        if (contactChatId) {
          tags.push(`chat:${contactChatId}`);
        }
 
        await supabase
          .from('soulroom_entries')
          .insert({
            user_id: user.id,
            title: 'Post-conversation note',
            content: reflectionLines.join('\n\n') || 'Processing what I want to share.',
            mood: moodPrefill,
            tags,
            ai_summary: null,
            emotion_tag: null,
          });
      } catch (soulLogError) {
        console.warn('⚠️ Failed to create Soulroom auto note:', soulLogError);
      }

      await supabase
        .from("chats")
        .update({ conversation_phase: "discussion" })
        .eq("id", contactChatId);

      await supabase.functions.invoke("generate-contextual-options", {
        body: {
          chatId: contactChatId,
          recipientId: user.id,
          currentUserId: user.id,
          summary,
          thoughts,
          originalIssueSummary: summary,
          currentMessage: `Starting conversation about: ${summary}`,
          hintToContact,
          conversationHistory: [],
          isInitial: true,
          contactCategory,
          conversationPhase: 'warmup',
          resolutionDetected: false,
          
        },
      });

      let optionsReady = false;
      let pollAttempts = 0;
      const maxPollAttempts = 30;

      while (!optionsReady && pollAttempts < maxPollAttempts) {
        const { data: optionsCheck } = await supabase
          .from("message_options")
          .select("id, options")
          .eq("chat_id", contactChatId!)
          .eq("recipient_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (optionsCheck && optionsCheck.length > 0 && optionsCheck[0].options.length >= 3) {
          optionsReady = true;
        } else {
          pollAttempts++;
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }

      await supabase.from("notifications").insert({
        user_id: contactIdValue,
        type: "chat_request",
        title: `${user.email?.split('@')[0] || 'Someone'} wants to talk`,
        message: hintToContact.full_text,
        data: {
          chat_id: contactChatId,
          sender_id: user.id,
          sender_name: user.email,
          issue: hintToContact.issue,
          timeline: hintToContact.timeline,
          hint_text: hintToContact.full_text,
        },
      });

      router.push(
        `/contact-chat?chatId=${contactChatId}&contactId=${contactIdValue}&isOngoing=true`
      );
    } catch (err) {
      console.error("Error in handleReadyToChat:", err);
      Alert.alert("Error", "Failed to start contact chat. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const renderWelcomeStage = () => (
  <View style={styles.stageContainer}>
    <View style={styles.headerSection}>
      <Sparkles size={36} color={Colors.primary[500]} />
      <Text style={styles.stageTitle}>Stage 1 – Describe the Situation</Text>
      <Text style={styles.stageSubtitle}>
        Tell me what's on your mind about{" "}
        <Text style={styles.contactName}>
          {contact?.full_name || contact?.email}
        </Text>
        .
      </Text>
      <Text style={styles.stageDescription}>
        I'll ask a few questions to help you prepare better.
      </Text>
    </View>

    {/* Text Input + Dropdown Wrapper */}
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>Chat title</Text>
      <TextInput
        style={styles.titleInput}
        value={chatTitle}
        onChangeText={setChatTitle}
        placeholder="e.g. Clearing the weekend misunderstanding"
        placeholderTextColor={Colors.text.tertiary}
        maxLength={80}
        autoCapitalize="sentences"
        returnKeyType="done"
      />
      <Text style={styles.inputHelper}>This appears in your AI prep and shared chat lists.</Text>
    </View>

    <View style={{ position: "relative", width: "100%" }}>
      <TextInput
      style={styles.descriptionInput}
      value={initialDescription}
      onChangeText={(text) => {
        const tokensUsed = Math.round(text.trim().split(/\s+/).length * 1.5);
        if (tokensUsed <= 150) {
          handleDescriptionChange(text);
        } else {
          // Block further typing when limit reached (no alert spam)
        }
      }}
      onSelectionChange={(event) => {
        setDescriptionCursorPos(event.nativeEvent.selection.start);
      }}
      placeholder="Describe the situation … (use @ or # tags)"
      placeholderTextColor={Colors.text.tertiary}
      multiline
      maxLength={800}
    />


    {/* Pronoun Dropdown */}
    {showPronounDropdown && (
      <View style={styles.tagDropdownContainer}>
        <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
          <Text style={styles.tagDropdownHeader}>
            Select Pronouns
          </Text>
          {(showPronounDropdown === '#' 
            ? ['he/him', 'she/her', 'they/them', 'it/its']
            : ['he/him', 'she/her', 'they/them']
          ).map((pronoun) => (
            <TouchableOpacity
              key={pronoun}
              style={styles.tagItem}
              onPress={() => handlePronounSelect(pronoun)}
            >
              <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }]}>
                <Text style={{ fontSize: 12, color: Colors.primary[600] }}>⚧</Text>
              </View>
              <Text style={styles.tagName}>{pronoun}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    )}

    {/* @ Dropdown */}
    {showTagDropdown === '@' && contactSuggestions.length > 0 && (
      <View style={styles.tagDropdownContainer}>
        <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
          <Text style={styles.tagDropdownHeader}>
            <AtSign size={12} color={Colors.primary[600]} /> Registered Contacts
          </Text>
          {contactSuggestions.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.tagItem}
              onPress={() => handleContactSelect(c)}
            >
              <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }]}>
                <AtSign size={12} color={Colors.primary[600]} />
              </View>
              <Text style={styles.tagName}>{c.full_name || c.email}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    )}

    {/* # Dropdown */}
    {showTagDropdown === '#' && hashSuggestions.length > 0 && (
      <View style={styles.tagDropdownContainer}>
        <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
          <Text style={styles.tagDropdownHeader}>
            <Hash size={12} color={Colors.warning[600]} /> People/Groups (not in app)
          </Text>
          {hashSuggestions.map((tag, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.tagItem}
              onPress={() => handleHashTagSelect(tag)}
            >
              <View style={[styles.tagIndicator, { backgroundColor: Colors.warning[100] }]}>
                <Hash size={12} color={Colors.warning[600]} />
              </View>
              <Text style={styles.tagName}>#{tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    )}
  </View>

  <View style={{ marginTop: 4, alignItems: "flex-end" }}>
    <Text
    style={[
      styles.tokenCounter,
      Math.max(0, 150 - Math.round(initialDescription.trim().split(/\s+/).length * 1.5)) === 0
        ? { color: Colors.error[600] }
        : { color: Colors.success[600] },
    ]}
  >
  {Math.max(0, 150 - Math.round(initialDescription.trim().split(/\s+/).length * 1.5))} tokens left 💬
</Text>


    {initialDescription.trim().split(/\s+/).length > 100 && (
      <Text
        style={{
          fontSize: Typography.fontSize.xs,
          color:
            initialDescription.trim().split(/\s+/).length > 100
              ? Colors.error[600]
              : Colors.warning[600],
          fontStyle: "italic",
        }}
      >
        {initialDescription.trim().split(/\s+/).length > 100
          ? "Let's simplify it a bit ❤️"
          : "Try to keep it short and clear 💛"}
      </Text>
    )}
  </View>





    
   {/* bottom buttons */}
  <View style={styles.buttonColumn}>
    <TouchableOpacity
      style={[styles.fullWidthButton, styles.secondaryButton]}
      onPress={() => router.push('/(tabs)/chats')}
    >
      <Text style={styles.secondaryButtonText}>Go to Chats Home</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.fullWidthButton, styles.secondaryButton]}
      onPress={() => router.push('/(tabs)/soulroom')}
    >
      <Text style={styles.secondaryButtonText}>Open Soulroom</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.fullWidthButton, styles.secondaryButton]}
      onPress={() => router.push("/(tabs)/contacts?mode=ai_chat")}
    >
      <Text style={styles.secondaryButtonText}>Choose Different Contact</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.fullWidthButton, styles.primaryButton, loading && styles.primaryButtonDisabled]}
      onPress={handleWelcomeSubmit}
      disabled={loading || !initialDescription.trim()}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.primaryButtonText}>Continue</Text>
      )}
    </TouchableOpacity>
  </View>

  </View>
);


  const renderQAStage = () => (
    <View style={styles.stageContainer}>
      <View style={styles.headerSection}>
        <Text style={styles.stageTitle}>Stage 2: Understanding ({questionCount}/5)</Text>
        <Text style={styles.stageSubtitle}>
          Let me ask a few questions to understand the situation better
        </Text>
      </View>

      <ScrollView style={styles.qaPairsContainer}>
        {qaPairs.map((pair, index) => (
          <View key={index} style={styles.qaCardVertical}>
            <View style={styles.questionSection}>
              <Text style={styles.questionLabel}>Q{index + 1}</Text>
              <Text style={styles.questionText}>{pair.question}</Text>
            </View>
            <View style={styles.answerSection}>

              {/* Tag Dropdown for Previous Answers - @ */}
              {editingAnswerIndex === index && prevAnswerContactSuggestions.length > 0 && (
                <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
                  <Text style={styles.tagDropdownHeader}>
                    <AtSign size={12} color={Colors.primary[600]} /> Registered Contacts
                  </Text>
                  {prevAnswerContactSuggestions.map((contact) => (
                    <TouchableOpacity
                      key={contact.id}
                      style={styles.tagItem}
                      onPress={() => {
                        const cursorPos = prevAnswerCursorPos[index] || 0;
                        const typingTag = getLastTypingTag(pair.answer, cursorPos);
                        if (typingTag.type === '@') {
          const newText = replaceTypingTag(
            pair.answer,
                            typingTag.startPos,
                            '@',
                            contact.full_name || contact.email
                          );
                          const updated = [...qaPairs];
                          updated[index].answer = newText;
                          setQAPairs(updated);
                          setPrevAnswerContactSuggestions([]);
                          setEditingAnswerIndex(null);
                        }
                      }}
                    >
                      <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }]}>
                        <AtSign size={12} color={Colors.primary[600]} />
                      </View>
                      <Text style={styles.tagName}>{contact.full_name || contact.email}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {/* Tag Dropdown for Previous Answers - # */}
              {editingAnswerIndex === index && prevAnswerHashSuggestions.length > 0 && (
                <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
                  <Text style={styles.tagDropdownHeader}>
                    <Hash size={12} color={Colors.warning[600]} /> People/Groups (not in app)
                  </Text>
                  {prevAnswerHashSuggestions.map((tag, tagIdx) => (
                    <TouchableOpacity
                      key={tagIdx}
                      style={styles.tagItem}
                      onPress={() => {
                        const cursorPos = prevAnswerCursorPos[index] || 0;
                        const typingTag = getLastTypingTag(pair.answer, cursorPos);
                        if (typingTag.type === '#') {
          const newText = replaceTypingTag(
            pair.answer,
                            typingTag.startPos,
                            '#',
                            tag
                          );
                          const updated = [...qaPairs];
                          updated[index].answer = newText;
                          setQAPairs(updated);
                          setPrevAnswerHashSuggestions([]);
                          setEditingAnswerIndex(null);
                        }
                      }}
                    >
                      <View style={[styles.tagIndicator, { backgroundColor: Colors.warning[100] }]}>
                        <Hash size={12} color={Colors.warning[600]} />
                      </View>
                      <Text style={styles.tagName}>#{tag}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <TextInput
                style={styles.answerInput}
                value={pair.answer}
                onChangeText={(text) => {
                  const words = text.trim().split(/\s+/);
                  const tokensUsed = Math.round(words.length * (20/15));
                  if (tokensUsed > 20) {
                    const maxWords = Math.floor(20 / (20/15));
                    handlePreviousAnswerChange(index, words.slice(0, maxWords).join(' '));
                  } else {
                    handlePreviousAnswerChange(index, text);
                  }
                }}
                onSelectionChange={(event) => {
                  setPrevAnswerCursorPos({...prevAnswerCursorPos, [index]: event.nativeEvent.selection.start});
                }}
                multiline
                placeholder="Use @ or # to tag someone."
                placeholderTextColor={Colors.text.tertiary}
              />

              <View style={{ marginTop: 4, alignItems: "flex-end" }}>
                <Text
                  style={[
                    styles.tokenCounter,
                    Math.max(0, 20 - Math.round((pair.answer?.trim() ? pair.answer.trim().split(/\s+/).length : 0) * (20/15))) === 0
                      ? { color: Colors.error[600] }
                      : { color: Colors.success[600] },
                  ]}
                >
                  {Math.max(0, 20 - Math.round((pair.answer?.trim() ? pair.answer.trim().split(/\s+/).length : 0) * (20/15)))}
                </Text>
              </View>

            </View>
          </View>
        ))}

        {isGeneratingSummary ? (
          <View style={styles.generatingContainer}>
            <ActivityIndicator size="large" color={Colors.primary[500]} />
            <Text style={styles.generatingText}>Generating Summary...</Text>
            <Text style={styles.generatingSubtext}>Analyzing your responses</Text>
          </View>
        ) : currentQuestion ? (
          <View style={styles.qaCardVertical}>
            <View style={styles.questionSection}>
              <Text style={styles.questionLabel}>Q{qaPairs.length + 1}</Text>
              <Text style={styles.questionText}>{currentQuestion}</Text>
            </View>
            <View style={styles.answerSection}>
              {currentQuestionType === "text" ? (
                <>
                  {/* Pronoun Dropdown for Current Answer */}
                  {showPronounDropdown && pronounSelectionContext?.stage === 'answer' && (
                    <View style={styles.tagDropdownContainer}>
                      <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
                        <Text style={styles.tagDropdownHeader}>
                          Select Pronouns
                        </Text>
                        {(showPronounDropdown === '#' 
                          ? ['he/him', 'she/her', 'they/them', 'it/its']
                          : ['he/him', 'she/her', 'they/them']
                        ).map((pronoun) => (
                          <TouchableOpacity
                            key={pronoun}
                            style={styles.tagItem}
                            onPress={() => handlePronounSelect(pronoun)}
                          >
                            <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }]}>
                              <Text style={{ fontSize: 12, color: Colors.primary[600] }}>⚧</Text>
                            </View>
                            <Text style={styles.tagName}>{pronoun}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Tag Dropdown for Current Answer - @ */}
                  {showAnswerTagDropdown === '@' && answerContactSuggestions.length > 0 && (
                    <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
                      <Text style={styles.tagDropdownHeader}>
                        <AtSign size={12} color={Colors.primary[600]} /> Registered Contacts
                      </Text>
                      {answerContactSuggestions.map((contact) => (
                        <TouchableOpacity
                          key={contact.id}
                          style={styles.tagItem}
                          onPress={() => handleAnswerContactSelect(contact)}
                        >
                          <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }]}>
                            <AtSign size={12} color={Colors.primary[600]} />
                          </View>
                          <Text style={styles.tagName}>{contact.full_name || contact.email}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}

                  {/* Tag Dropdown for Current Answer - # */}
                  {showAnswerTagDropdown === '#' && answerHashSuggestions.length > 0 && (
                    <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
                      <Text style={styles.tagDropdownHeader}>
                        <Hash size={12} color={Colors.warning[600]} /> People/Groups (not in app)
                      </Text>
                      {answerHashSuggestions.map((tag, idx) => (
                        <TouchableOpacity
                          key={idx}
                          style={styles.tagItem}
                          onPress={() => handleAnswerHashTagSelect(tag)}
                        >
                          <View style={[styles.tagIndicator, { backgroundColor: Colors.warning[100] }]}>
                            <Hash size={12} color={Colors.warning[600]} />
                          </View>
                          <Text style={styles.tagName}>#{tag}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}

                  <TextInput
  style={[styles.answerInput, { maxHeight: 50 }]} // 👈 visually stays one-line high
  value={currentAnswer}
  onChangeText={(text) => {
    // Enforce ~20 token budget for current answer
    const words = text.trim().split(/\s+/);
    const tokensUsed = Math.round(words.length * (20/15));
    if (tokensUsed > 20) {
      const maxWords = Math.floor(20 / (20/15)); // ~15 words
      handleCurrentAnswerChange(words.slice(0, maxWords).join(' '));
    } else {
      handleCurrentAnswerChange(text);
    }
  }}
  onSelectionChange={(event) => {
    setCurrentAnswerCursorPos(event.nativeEvent.selection.start);
  }}
  placeholder="Use @ or # to tag someone."
  placeholderTextColor={Colors.text.tertiary}
  multiline
  numberOfLines={1}
  maxLength={200}
/>

                  <View style={{ marginTop: 4, alignItems: "flex-end" }}>
                    <Text
                      style={[
                        styles.tokenCounter,
                        Math.max(0, 20 - Math.round((currentAnswer.trim() ? currentAnswer.trim().split(/\s+/).length : 0) * (20/15))) === 0
                          ? { color: Colors.error[600] }
                          : { color: Colors.success[600] },
                      ]}
                    >
                      {Math.max(0, 20 - Math.round((currentAnswer.trim() ? currentAnswer.trim().split(/\s+/).length : 0) * (20/15)))}
                    </Text>
                  </View>

                </>
              ) : (
                <View style={styles.optionsContainer}>
                  {currentOptions.map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.optionButton,
                        selectedOption === option && styles.optionButtonSelected,
                      ]}
                      onPress={() => setSelectedOption(option)}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          selectedOption === option && styles.optionTextSelected,
                        ]}
                      >
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>

    {/* bottom buttons */}
<View style={styles.qaButtonSection}>
  <View style={styles.buttonRow}>
    <TouchableOpacity
      style={[styles.secondaryButton, styles.halfButton]}
      onPress={() => setFlowStage("welcome")}
      disabled={loading}
    >
      <Text style={styles.secondaryButtonText}>Previous Step</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.secondaryButton, styles.halfButton]}
      onPress={handleAnswerSubmit}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color={Colors.primary[600]} size="small" />
      ) : (
        <Text style={styles.secondaryButtonText}>Next Question</Text>
      )}
    </TouchableOpacity>
  </View>

  {/* Generate Summary button – disabled until at least 2 questions */}
<TouchableOpacity
  style={[
    styles.fullWidthButton,
    styles.primaryButton,
    (loading || qaPairs.length < 2) && styles.primaryButtonDisabled,
  ]}
  onPress={async () => {
    if (qaPairs.length < 2) {
      Alert.alert(
        "Answer more questions 💬",
        "Please answer at least two questions before generating a summary."
      );
      return;
    }
    setIsGeneratingSummary(true);
    setCurrentQuestion("");
    await generateSummary(qaPairs);
  }}
  disabled={loading || qaPairs.length < 2}
>
  <Sparkles size={16} color="#fff" />
  <Text style={styles.primaryButtonText}>Generate Summary</Text>
</TouchableOpacity>

</View>

    </View>
  );

  const renderSummaryStage = () => (
    <View style={styles.stageContainer}>
      <View style={styles.headerSection}>
        <Text style={styles.stageTitle}>Stage 3: Summary</Text>
        <Text style={styles.stageSubtitle}>
          Here's what I understand about your situation
        </Text>
        {/* Small quick-link back to Stage 1 */}
        <TouchableOpacity onPress={restartFlowToInitial} style={styles.smallLinkButton}>
          <Text style={styles.smallLinkButtonText}>Go to Initial Description</Text>
        </TouchableOpacity>
      </View>

      {isSummaryUnclear && (
        <View style={styles.quickTipBox}>
          <Text style={styles.quickTipTitle}>Need a bit more clarity</Text>
          <Text style={styles.quickTipText}>
            I couldn't confidently understand one or more parts. Try editing:
          </Text>
          {qaPairs.map((p, i) => {
            const t = (p.answer || '').trim();
            const looksWeak = t.length < 3 || !/[a-zA-Z]/.test(t) || /^[-_.!@#$%^&*()+=\d\s]+$/.test(t);
            return looksWeak ? (
              <Text key={i} style={styles.quickTipItem}>• Answer #{i + 1}</Text>
            ) : null;
          })}
          {additionalInfo.trim().length > 0 && (additionalInfo.trim().split(/\s+/).length < 3) && (
            <Text style={styles.quickTipItem}>• Additional Information</Text>
          )}
          <Text style={styles.quickTipHint}>Edit only what's flagged above, then press Regenerate Summary.</Text>
        </View>
      )}

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>📌 Discussion Summary</Text>
        <Text style={styles.summaryText}>{summary}</Text>

        <Text style={styles.summaryLabel}>💡 My Thoughts</Text>
        <Text style={styles.summaryText}>{thoughts}</Text>
      </View>

      {isSummaryUnclear ? (
  <>
    <Text style={styles.warningText}>
      ⚠️ Cannot move to Stage 4 (Ready to Chat) as the purpose of this conversation is not clear.
    </Text>
    <View style={styles.buttonRow}>
      {(() => {
        const meaningfulCount = qaPairs.filter(p => {
          const t = (p.answer || '').trim();
          return t.length >= 3 && /[a-zA-Z]/.test(t) && !/^[-_.!@#$%^&*()+=\d\s]+$/.test(t);
        }).length;
        const shouldShowRefine = isSummaryUnclear && !hasAggregateClarity() && meaningfulCount < 2;
        return shouldShowRefine ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setFlowStage("qa")}
          >
            <Text style={styles.secondaryButtonText}>Refine Answers</Text>
          </TouchableOpacity>
        ) : null;
      })()}
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => router.push('/ai-assistant')}
      >
        <Text style={styles.secondaryButtonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  </>
) : showEditMode ? (
  <View style={styles.editModeContainer}>
    <Text style={styles.editModeTitle}>Edit Your Answers</Text>

    <ScrollView
      ref={editScrollViewRef}
      style={styles.editScrollView}
      contentContainerStyle={styles.editScrollViewContent}
    >
      {editedQAPairs.map((pair, index) => (
        <View key={index} style={styles.editQACard}>
          <Text style={styles.editQuestionText}>{pair.question}</Text>

          {/* Tag Dropdown for Edit Mode Answers - @ */}
          {editModeAnswerIndex === index && editModeContactSuggestions.length > 0 && (
            <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
              <Text style={styles.tagDropdownHeader}>
                <AtSign size={12} color={Colors.primary[600]} /> Registered Contacts
              </Text>
              {editModeContactSuggestions.map((contact) => (
                <TouchableOpacity
                  key={contact.id}
                  style={styles.tagItem}
                  onPress={() => {
                    const cursorPos = editModeCursorPos[index] || 0;
                    const typingTag = getLastTypingTag(pair.answer, cursorPos);
                    if (typingTag.type === '@') {
                      const newText = replaceTypingTag(
                        pair.answer,
                        typingTag.startPos,
                        '@',
                        contact.full_name || contact.email
                      );
                      const updated = [...editedQAPairs];
                      updated[index].answer = newText;
                      setEditedQAPairs(updated);
                      setEditModeContactSuggestions([]);
                      setEditModeAnswerIndex(null);
                    }
                  }}
                >
                  <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }]}>
                    <AtSign size={12} color={Colors.primary[600]} />
                  </View>
                  <Text style={styles.tagName}>{contact.full_name || contact.email}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Tag Dropdown for Edit Mode Answers - # */}
          {editModeAnswerIndex === index && editModeHashSuggestions.length > 0 && (
            <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
              <Text style={styles.tagDropdownHeader}>
                <Hash size={12} color={Colors.warning[600]} /> People/Groups (not in app)
              </Text>
              {editModeHashSuggestions.map((tag, tagIdx) => (
                <TouchableOpacity
                  key={tagIdx}
                  style={styles.tagItem}
                  onPress={() => {
                    const cursorPos = editModeCursorPos[index] || 0;
                    const typingTag = getLastTypingTag(pair.answer, cursorPos);
                    if (typingTag.type === '#') {
                      const newText = replaceTypingTag(
                        pair.answer,
                        typingTag.startPos,
                        '#',
                        tag
                      );
                      const updated = [...editedQAPairs];
                      updated[index].answer = newText;
                      setEditedQAPairs(updated);
                      setEditModeHashSuggestions([]);
                      setEditModeAnswerIndex(null);
                    }
                  }}
                >
                  <View style={[styles.tagIndicator, { backgroundColor: Colors.warning[100] }]}>
                    <Hash size={12} color={Colors.warning[600]} />
                  </View>
                  <Text style={styles.tagName}>#{tag}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TextInput
            style={styles.editAnswerInput}
            value={pair.answer}
            onChangeText={(text) => handleEditAnswerWithTags(index, text)}
            onSelectionChange={(event) => {
              setEditModeCursorPos({...editModeCursorPos, [index]: event.nativeEvent.selection.start});
            }}
            multiline
            placeholder="Edit your answer (use @ or #)..."
          />

          <View style={{ marginTop: 4, alignItems: "flex-end" }}>
            <Text
              style={[
                styles.tokenCounter,
                Math.max(0, 20 - Math.round((pair.answer?.trim() ? pair.answer.trim().split(/\s+/).length : 0) * (20/15))) === 0
                  ? { color: Colors.error[600] }
                  : { color: Colors.success[600] },
              ]}
            >
              {Math.max(0, 20 - Math.round((pair.answer?.trim() ? pair.answer.trim().split(/\s+/).length : 0) * (20/15)))}
            </Text>
          </View>
        </View>
      ))}

      <View style={styles.additionalInfoSection}>
        <Text style={styles.additionalInfoLabel}>
          Additional Information (Optional - use @ or # tags)
        </Text>

        {/* Pronoun Dropdown for Additional Info */}
        {showPronounDropdown && pronounSelectionContext?.stage === 'additionalInfo' && (
          <View style={styles.tagDropdownContainer}>
            <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
              <Text style={styles.tagDropdownHeader}>
                Select Pronouns
              </Text>
              {(showPronounDropdown === '#' 
                ? ['he/him', 'she/her', 'they/them', 'it/its']
                : ['he/him', 'she/her', 'they/them']
              ).map((pronoun) => (
                <TouchableOpacity
                  key={pronoun}
                  style={styles.tagItem}
                  onPress={() => handlePronounSelect(pronoun)}
                >
                  <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }]}>
                    <Text style={{ fontSize: 12, color: Colors.primary[600] }}>⚧</Text>
                  </View>
                  <Text style={styles.tagName}>{pronoun}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Tag Dropdown for Additional Info - @ */}
        {showAdditionalInfoTagDropdown === '@' && additionalInfoContactSuggestions.length > 0 && (
          <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
            <Text style={styles.tagDropdownHeader}>
              <AtSign size={12} color={Colors.primary[600]} /> Registered Contacts
            </Text>
            {additionalInfoContactSuggestions.map((contact) => (
              <TouchableOpacity
                key={contact.id}
                style={styles.tagItem}
                onPress={() => handleAdditionalInfoContactSelect(contact)}
              >
                <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }]}>
                  <AtSign size={12} color={Colors.primary[600]} />
                </View>
                <Text style={styles.tagName}>{contact.full_name || contact.email}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Tag Dropdown for Additional Info - # */}
        {showAdditionalInfoTagDropdown === '#' && additionalInfoHashSuggestions.length > 0 && (
          <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled={true}>
            <Text style={styles.tagDropdownHeader}>
              <Hash size={12} color={Colors.warning[600]} /> People/Groups (not in app)
            </Text>
            {additionalInfoHashSuggestions.map((tag, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.tagItem}
                onPress={() => handleAdditionalInfoHashTagSelect(tag)}
              >
                <View style={[styles.tagIndicator, { backgroundColor: Colors.warning[100] }]}>
                  <Hash size={12} color={Colors.warning[600]} />
                </View>
                <Text style={styles.tagName}>#{tag}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <TextInput
  style={styles.additionalInfoInput}
  value={additionalInfo}
  onChangeText={(text) => {
    // Enforce ~20 token budget for additional info
    const words = text.trim().split(/\s+/);
    const tokensUsed = Math.round(words.length * (20/15));
    if (tokensUsed > 20) {
      const maxWords = Math.floor(20 / (20/15)); // ~15 words
      handleAdditionalInfoChange(words.slice(0, maxWords).join(' '));
    } else {
      handleAdditionalInfoChange(text);
    }
  }}
  onSelectionChange={(event) => {
    setAdditionalInfoCursorPos(event.nativeEvent.selection.start);
  }}
  placeholder="Add short note (up to ~20 tokens)…"
  placeholderTextColor={Colors.text.tertiary}
  multiline
  numberOfLines={1}
  maxLength={200}
/>

        <View style={{ marginTop: 4, alignItems: "flex-end" }}>
          <Text
            style={[
              styles.tokenCounter,
              Math.max(0, 20 - Math.round((additionalInfo.trim() ? additionalInfo.trim().split(/\s+/).length : 0) * (20/15))) === 0
                ? { color: Colors.error[600] }
                : { color: Colors.success[600] },
            ]}
          >
            {Math.max(0, 20 - Math.round((additionalInfo.trim() ? additionalInfo.trim().split(/\s+/).length : 0) * (20/15)))}
          </Text>
        </View>


      </View>
    </ScrollView>

    <View style={styles.buttonColumn}>
  <TouchableOpacity
    style={[styles.fullWidthButton, styles.secondaryButton]}
    onPress={() => setShowEditMode(false)}
    disabled={loading}
  >
    <Text style={styles.secondaryButtonText}>Cancel</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[styles.fullWidthButton, styles.primaryButton]}
    onPress={handleRegenerateSummary}
    disabled={loading}
  >
    {loading ? (
      <ActivityIndicator color="#fff" size="small" />
    ) : (
      <>
        <Check size={16} color="#fff" />
        <Text style={styles.primaryButtonText}>Regenerate Summary</Text>
      </>
    )}
  </TouchableOpacity>
</View>

  </View>
) : (
  <View style={styles.buttonColumn}>
  <TouchableOpacity
    style={[styles.fullWidthButton, styles.secondaryButton]}
    onPress={handleAddExtraInfo}
    disabled={loading}
  >
    <Plus size={16} color={Colors.primary[600]} />
    <Text style={styles.secondaryButtonText}>Edit & Add Info</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.fullWidthButton,
      styles.primaryButton,
      summaryJustRegenerated && styles.primaryButtonDisabled,
    ]}
    onPress={handleSummaryApprove}
    disabled={loading || summaryJustRegenerated}
  >
    <Check size={20} color="#fff" />
    <Text style={styles.primaryButtonText}>
      {summaryJustRegenerated ? 'Summary Updated...' : 'Yes, looks good'}
    </Text>
  </TouchableOpacity>
</View>

)}
  </View>
);



  const handleBackToSummary = () => {
    setFlowStage("summary");
    console.log("🔙 Navigating back to Stage 3 (Summary) from Stage 4");
  };

  const renderReadyStage = () => (
    <View style={styles.stageContainer}>
      <View style={styles.headerSection}>
        <Check size={48} color={Colors.success[500]} />
        <Text style={styles.stageTitle}>Stage 4: Ready!</Text>
        <Text style={styles.stageSubtitle}>
          Perfect! I'll use this summary to help you start your chat naturally with{" "}
          <Text style={styles.contactName}>{contact?.full_name || contact?.email}</Text>.
        </Text>
        <Text style={styles.readyMessage}>Ready to begin?</Text>
        {/* Small quick-link back to Stage 1 */}
        <TouchableOpacity onPress={restartFlowToInitial} style={styles.smallLinkButton}>
          <Text style={styles.smallLinkButtonText}>Go to Initial Description</Text>
        </TouchableOpacity>
      </View>

      {showReturnFromChatBanner && (
        <View style={styles.returnBanner}>
          <Text style={styles.returnBannerText}>What would you like to do?</Text>
          <View style={styles.returnBannerRow}>
            <TouchableOpacity style={styles.smallPillButton} onPress={() => router.push('/(tabs)/chats')}>
              <Text style={styles.smallPillButtonText}>Go to Chats Home</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {((summary || '').trim().length > 0 || (thoughts || '').trim().length > 0) ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>📌 Discussion Summary</Text>
          <Text style={styles.summaryText}>{summary}</Text>

          <Text style={styles.summaryLabel}>💡 My Thoughts</Text>
          <Text style={styles.summaryText}>{thoughts}</Text>
        </View>
      ) : (
        <View style={styles.loadingInfoBox}>
          <ActivityIndicator color={Colors.primary[500]} size="small" />
          <Text style={styles.loadingText}>Loading your summary…</Text>
        </View>
      )}


      <View style={[styles.buttonColumn, { marginTop: Spacing.lg }]}>
  <TouchableOpacity
    style={[styles.fullWidthButton, styles.secondaryButton]}
    onPress={handleBackToSummary}
    disabled={loading || (((summary || '').trim().length === 0) && ((thoughts || '').trim().length === 0))}
  >
    <Eye size={16} color={Colors.primary[600]} />
    <Text style={styles.secondaryButtonText}>Edit Summary</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[styles.fullWidthButton, styles.readyButton, loading && styles.primaryButtonDisabled]}
    onPress={handleReadyToChat}
    disabled={loading}
  >
    {loading ? (
      <ActivityIndicator color="#fff" size="small" />
    ) : (
      <Text style={styles.readyButtonText}>Ready to Chat</Text>
    )}
  </TouchableOpacity>
</View>


    {loading && (
  <>
    <View style={styles.loadingInfoBox}>
      <ActivityIndicator color={Colors.primary[500]} size="large" />
      <Text style={styles.loadingText}>Generating conversation options...</Text>
      <Text style={styles.loadingSubtext}>This may take 10–20 seconds</Text>
    </View>
    <Text style={{ textAlign: "center", marginTop: 10, color: Colors.text.secondary }}>
      💬 Preparing your first message options — please wait a moment…
    </Text>
  </>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingTop: Spacing.md }]}
        >
          {flowStage === "welcome" && renderWelcomeStage()}
          {flowStage === "qa" && renderQAStage()}
          {flowStage === "summary" && renderSummaryStage()}
          {flowStage === "ready" && renderReadyStage()}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "600", color: "#1f2937", flex: 1, textAlign: "center" },
  placeholder: { width: 32 },
  content: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.lg,
  },
  loadingText: {
    fontSize: Typography.fontSize.base,
    color: Colors.text.secondary,
    marginTop: Spacing.md,
  },
  stageContainer: {
    flex: 1,
  },
  headerSection: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  stageTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  stageSubtitle: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
    textAlign: "center",
    lineHeight: 18,
  },
  stageDescription: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    marginTop: 2,
    textAlign: "center",
  },
  contactName: {
    fontWeight: Typography.fontWeight.bold,
    color: Colors.primary[600],
  },
  descriptionInput: {
  borderWidth: 1,
  borderColor: Colors.borderLight,
  borderRadius: BorderRadius.lg,
  padding: Spacing.md,
  fontSize: Typography.fontSize.sm,
  backgroundColor: Colors.surface,
  minHeight: 120,
  textAlignVertical: "top",
  marginTop: Spacing.md,
  ...Shadows.small,
},
  qaPairsContainer: {
    flex: 1,
    marginBottom: Spacing.lg,
  },
  qaCardVertical: {
  backgroundColor: Colors.surface,
  borderRadius: BorderRadius.lg,
  padding: Spacing.md,
  marginBottom: Spacing.sm,
  borderWidth: 1,
  borderColor: Colors.borderLight,
  ...Shadows.small,
},
  questionSection: {
    marginBottom: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  answerSection: {
    paddingTop: Spacing.xs,
  },
  questionLabel: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.primary[600],
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
  },
 questionText: {
  fontSize: Typography.fontSize.sm,
  color: Colors.text.primary,
  fontWeight: Typography.fontWeight.semibold,
  lineHeight: 20,
},
  answerLabel: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  answerText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
    lineHeight: 22,
  },
 answerInput: {
  borderWidth: 1,
  borderColor: Colors.borderLight,
  borderRadius: BorderRadius.md,
  padding: Spacing.sm,
  fontSize: Typography.fontSize.base,
  backgroundColor: Colors.surface,
  minHeight: 70,
  textAlignVertical: "top",
},
  optionsContainer: {
    gap: Spacing.sm,
  },
  optionButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.md,
    backgroundColor: "#fff",
  },
  optionButtonSelected: {
    borderColor: Colors.primary[500],
    backgroundColor: Colors.primary[50],
  },
  optionText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
  },
  optionTextSelected: {
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.semibold,
  },
  summaryCard: {
  backgroundColor: Colors.surface,
  borderRadius: BorderRadius.lg,
  padding: Spacing.md,
  borderWidth: 1,
  borderColor: Colors.borderLight,
  marginBottom: Spacing.md,
  ...Shadows.small,
},
summaryLabel: {
  fontSize: Typography.fontSize.base,
  fontWeight: Typography.fontWeight.semibold,
  color: Colors.text.primary,
  marginTop: Spacing.md,   // ✅ keep this as is
  marginBottom: Spacing.xs,
},


summaryText: {
  fontSize: Typography.fontSize.sm,
  color: Colors.text.secondary,
  lineHeight: 20,
},
  confirmQuestion: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
 buttonRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  gap: Spacing.md,
  marginTop: Spacing.lg,
},

  generatingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.md,
  },
  generatingText: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.primary[600],
    marginTop: Spacing.md,
  },
  generatingSubtext: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.tertiary,
  },
tagDropdownContainer: {
  position: "absolute",
  bottom: "100%",        // 👈 replaces top:-180
  left: 0,
  right: 0,
  marginBottom: 6,
  zIndex: 9999,
  elevation: 20,
},


tagDropdownScroll: {
  maxHeight: Math.min(250, Dimensions.get('window').height / 3),
  backgroundColor: Colors.surface,
  borderWidth: 1,
  borderColor: Colors.borderLight,
  borderRadius: BorderRadius.lg,
  ...Shadows.medium,
},



  tagDropdownHeader: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.secondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.neutral[50],
  },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  tagIndicator: {
    width: 24,
    height: 24,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tagName: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
    fontWeight: Typography.fontWeight.medium,
  },
  taggedEntitiesDisplay: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.neutral[50],
    borderRadius: BorderRadius.lg,
  },
  taggedLabel: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  tagsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  tagChipText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.primary,
    fontWeight: Typography.fontWeight.medium,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.primary[500],
    borderWidth: 1,
    borderColor: Colors.primary[400],
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    ...Shadows.small,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },
  secondaryButton: {
     flex: 1,
     flexDirection: 'row',
     alignItems: "center",
     justifyContent: "center",
     gap: Spacing.xs,
     backgroundColor: Colors.surface,
     borderWidth: 1,
     borderColor: Colors.primary[200],
     paddingVertical: Spacing.sm,
     paddingHorizontal: Spacing.lg,
     borderRadius: BorderRadius.lg,
   },
   secondaryButtonText: {
     color: Colors.primary[600],
     fontSize: Typography.fontSize.sm,
     fontWeight: Typography.fontWeight.semibold,
   },
  readyMessage: {
  fontSize: Typography.fontSize.sm,
  fontWeight: Typography.fontWeight.semibold,
  color: Colors.text.primary,
  marginTop: Spacing.md,
  marginBottom: Spacing.sm,
  textAlign: "center",
},
readyButton: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: Spacing.xs,
  backgroundColor: Colors.primary[500],
  borderWidth: 1,
  borderColor: Colors.primary[400],
  paddingVertical: Spacing.sm,
  paddingHorizontal: Spacing.lg,
  borderRadius: BorderRadius.lg,
  ...Shadows.small,
},
readyButtonText: {
  color: "#fff",
  fontSize: Typography.fontSize.sm,
  fontWeight: Typography.fontWeight.semibold,
},
  loadingSubtext: {
    color: Colors.text.tertiary,
    fontSize: Typography.fontSize.xs,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  loadingInfoBox: {
    marginTop: Spacing.xl,
    padding: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  editModeContainer: {
    marginTop: Spacing.lg,
    flex: 1,
  },
  editModeTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  editScrollView: {
    flex: 1,
    marginBottom: Spacing.lg,
  },
  editScrollViewContent: {
    paddingBottom: Spacing.xxl * 2,
  },
  editQACard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  editQuestionText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  editAnswerInput: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
    backgroundColor: "#fff",
    minHeight: 60,
    textAlignVertical: "top",
  },
  additionalInfoSection: {
    marginTop: Spacing.md,
  },
  additionalInfoLabel: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  
  warningText: {
  fontSize: Typography.fontSize.sm,
  color: "#92400e", // deep amber tone
  backgroundColor: "#fef3c7",
  borderRadius: BorderRadius.lg,
  padding: Spacing.md,
  textAlign: "center",
  marginVertical: Spacing.lg,
  borderWidth: 1,
  borderColor: "#fcd34d",
},


  additionalInfoInput: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: Typography.fontSize.base,
    color: Colors.text.primary,
    backgroundColor: "#fff",
    minHeight: 100,
    textAlignVertical: "top",
  },

  buttonColumn: {
  flexDirection: "column",
  alignItems: "stretch",
  gap: Spacing.md,
  marginTop: Spacing.xl,
},

fullWidthButton: {
  width: "100%",
},

  qaButtonSection: {
  marginTop: Spacing.xl,
  gap: Spacing.md,
},

halfButton: {
  flex: 1,
},

  tokenCounter: {
  fontSize: Typography.fontSize.xs,
  textAlign: "right",
  marginRight: 6,
  color: Colors.text.secondary,
  fontStyle: "italic",
},

  // Small link-style button
  smallLinkButton: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.neutral[50],
  },
  smallLinkButtonText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.primary[700],
    fontWeight: Typography.fontWeight.medium,
  },

  // Return from contact chat banner
  returnBanner: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...Shadows.small,
  },
  returnBannerText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  returnBannerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  smallPillButton: {
    backgroundColor: Colors.primary[500],
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
  },
  smallPillButtonText: {
    color: '#fff',
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },
  smallPillButtonSecondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary[300],
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
  },
  smallPillButtonSecondaryText: {
    color: Colors.primary[700],
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },

  quickActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  quickTipBox: {
    backgroundColor: Colors.warning[50],
    borderColor: Colors.warning[200],
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  quickTipTitle: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.warning[800],
  },
  quickTipText: {
    fontSize: Typography.fontSize.xs,
    color: Colors.warning[800],
  },
  quickTipItem: {
    fontSize: Typography.fontSize.xs,
    color: Colors.warning[900],
  },
  quickTipHint: {
    fontSize: Typography.fontSize.xs,
    color: Colors.warning[700],
    fontStyle: 'italic',
  },

  inputGroup: {
    marginBottom: Spacing.md,
  },
  inputLabel: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    fontSize: Typography.fontSize.base,
    backgroundColor: Colors.surface,
    minHeight: 40,
    textAlignVertical: "top",
    marginBottom: Spacing.xs,
    ...Shadows.small,
  },
  inputHelper: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    marginBottom: Spacing.xs,
  },

});

export default AIChatScreen;