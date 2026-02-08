import React, { useState, useRef, useEffect, useCallback } from "react";
import { Animated } from "react-native";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Dimensions,
  Modal,
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
  Trash2,
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
import { MY_TALKS_LIMIT, getCompletedMyTalksCount, buildMyTalksLimitMessage } from "@/lib/myTalksLimit";
import KeyboardSafeView from '@/components/KeyboardSafeView';
// Prevent undefined Colors or constants crash in Expo web
if (!Colors?.primary) console.warn("⚠️ Colors not loaded properly");


interface QAPair {
  question: string;
  answer: string;
  answerType: "text" | "dropdown";
  options?: string[];
  saved?: boolean;
}

interface Contact {
  id: string;
  full_name: string | null;
  email: string;
}

type FlowStage = "welcome" | "qa" | "summary";
type TagStage = 'description' | 'answer' | 'additionalInfo' | 'editAnswer';
type TypingTagMatch = ReturnType<typeof getLastTypingTag>;

// OutlineText component for stage titles with dark-blue outline
const OutlineText = ({ children, style, outlineStyle }: { children: React.ReactNode; style?: any; outlineStyle?: any }) => {
  return (
    <View style={{ position: 'relative', alignItems: 'center' }}>
      {/* 4 outline layers behind the text */}
      <Text style={[style, outlineStyle, { position: 'absolute', top: -1, left: -1 }]}>{children}</Text>
      <Text style={[style, outlineStyle, { position: 'absolute', top: -1, left: 1 }]}>{children}</Text>
      <Text style={[style, outlineStyle, { position: 'absolute', top: 1, left: -1 }]}>{children}</Text>
      <Text style={[style, outlineStyle, { position: 'absolute', top: 1, left: 1 }]}>{children}</Text>
      {/* Main yellow text on top */}
      <Text style={style}>{children}</Text>
    </View>
  );
};

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
  const [savedAnswers, setSavedAnswers] = useState<{[key: number]: string}>({});
  const [currentAnswerSaved, setCurrentAnswerSaved] = useState(false);
  const [currentAnswerSavedText, setCurrentAnswerSavedText] = useState<string>('');
  const [currentQuestion, setCurrentQuestion] = useState<string>("");
  const [currentQuestionType, setCurrentQuestionType] = useState<"text" | "dropdown">("text");
  const [currentOptions, setCurrentOptions] = useState<string[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState("");
  // ✅ NEW: Store pre-generated questions array
  const [preGeneratedQuestions, setPreGeneratedQuestions] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
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
  
  const [isSummaryUnclear, setIsSummaryUnclear] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);
  
  // Additional state for Stage 3 (must be defined before useCallback that uses it)
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [showEditMode, setShowEditMode] = useState(false);
  const [editedQAPairs, setEditedQAPairs] = useState<QAPair[]>([]);
  const [showGenerateSummaryButton, setShowGenerateSummaryButton] = useState(false);
  const [showSummaryNoticeModal, setShowSummaryNoticeModal] = useState(false);
  // ✅ Cost optimization: Track original values when entering edit mode
  const [originalQAPairsForEdit, setOriginalQAPairsForEdit] = useState<QAPair[]>([]);
  const [originalAdditionalInfoForEdit, setOriginalAdditionalInfoForEdit] = useState("");
  // ✅ NEW: Track original values when navigating from Stage 3 to Stage 1/2
  const [originalInitialDescriptionForStage1, setOriginalInitialDescriptionForStage1] = useState<string>("");
  const [originalQAPairsForStage2, setOriginalQAPairsForStage2] = useState<QAPair[]>([]);
  const editScrollViewRef = useRef<ScrollView>(null);
  const contextDataRef = useRef<Record<string, any>>({});

  // Stage-2 (Questions) prompt – used by loadStage2QuestionsOnce()
  // NOTE: This constant is added per request to update the prompt content only.
  // If a single-call Stage-2 loader uses a `userPrompt`, it should reference this constant verbatim.
  const STAGE2_QUESTIONS_PROMPT = `
Return exactly this JSON with 5 SHORT and UNIQUE questions:

{
  "questions": ["Q1", "Q2", "Q3", "Q4", "Q5"]
}

STRICT RULES:
- All 5 questions MUST be completely different from each other.
- No overlapping meaning, no rephrasing, no soft duplicates.
- Cover 5 different dimensions of the situation:
  1) What happened (specific incident)
  2) What matters to them (values/priorities)
  3) Their feelings (brief, natural)
  4) What they want the other person to understand
  5) What outcome they hope for
- Each question must be:
  * ONE single sentence only (no multiple sentences, no compound questions)
  * Medium length: 6-10 words (not too short, not too long)
  * Warm, simple, and non-therapeutic (human, friendly)
- No instructions, no extra wording, no explanations in output.
- If any two questions are partially similar, regenerate until all 5 are clearly unique.
- Output ONLY valid JSON with the exact structure above.

Context (brief):
- These questions help a user prepare before chatting with their contact.
- Keep them broadly applicable, not tailored to any specific topic.
`.trim();

  const [chatTitle, setChatTitle] = useState("");

  const hasCommittedStage1Ref = useRef(false);
  const currentChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentChatIdRef.current = currentChatId;
  }, [currentChatId]);

  useEffect(() => {
    return () => {
      const chatId = currentChatIdRef.current;
      if (chatId && !hasCommittedStage1Ref.current) {
        (async () => {
          try {
            // ✅ CRITICAL: Check if session has meaningful content before deleting
            const { data: chatData, error: fetchError } = await supabase
              .from('chats')
              .select('id, session_name, context_data')
              .eq('id', chatId)
              .eq('chat_type', 'ai_assistant')
              .single();

            if (fetchError || !chatData) {
              console.log('⚠️ Could not fetch chat for cleanup check, skipping deletion');
              return;
            }

            const ctx = chatData.context_data || {};
            
            // Check if session has ANY meaningful content
            const hasTitle = chatData.session_name && chatData.session_name.trim().length > 0;
            const hasDescription = ctx.initial_description && ctx.initial_description.trim().length > 0;
            const hasQAPairs = ctx.qa_pairs && Array.isArray(ctx.qa_pairs) && ctx.qa_pairs.length > 0;
            const hasSummary = ctx.summary && ctx.summary.trim().length > 0;
            const hasCurrentAnswer = ctx.currentAnswer && ctx.currentAnswer.trim().length > 0;
            const hasCurrentQuestion = ctx.currentQuestion && ctx.currentQuestion.trim().length > 0;
            const hasAdditionalInfo = ctx.additional_info && ctx.additional_info.trim().length > 0;
            
            // ✅ NEVER delete if session has ANY content
            if (hasTitle || hasDescription || hasQAPairs || hasSummary || hasCurrentAnswer || hasCurrentQuestion || hasAdditionalInfo) {
              console.log('✅ Session has content, preserving:', chatId);
              return;
            }

            // ✅ Only delete if truly empty (no title, no description, no qa_pairs, no summary, no context_data)
            await supabase
              .from('chats')
              .delete()
              .eq('id', chatId)
              .eq('chat_type', 'ai_assistant');
            console.log('🧹 Removed unused AI prep session (truly empty)', chatId);
          } catch (cleanupErr) {
            console.warn('⚠️ Failed to clean up unused AI prep session', cleanupErr);
          }
        })();
      }
    };
  }, []);

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
  const descriptionAutosaveReadyRef = useRef(false);
  const titleAutosaveReadyRef = useRef(false);
  const descriptionAutosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleAutosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pronoun selection state for all stages
  const [showPronounDropdown, setShowPronounDropdown] = useState<'@' | '#' | null>(null);
  const [pronounSelectionContext, setPronounSelectionContext] = useState<{
    stage: 'description' | 'answer' | 'additionalInfo' | 'editAnswer';
    index?: number;
    pendingContact?: any;
    pendingHashTag?: string;
  } | null>(null);
  const pendingHashPromptRef = useRef<string | null>(null);
  const [entityRegistryCache, setEntityRegistryCache] = useState<Record<string, { preferred_pronouns: string; entity_name: string }>>({});

  const pendingHashTagSelectionRef = useRef<{
    tagName: string;
    stage: TagStage;
    tagStartPos: number;
    tagEndPos: number;
    maxAllowedLength: number; // Maximum allowed text length when tag was created
    index?: number;
  } | null>(null);

  const [hashTagWarning, setHashTagWarning] = useState<string | null>(null);

  const suppressTagDropdownRef = useRef<Record<TagStage, '@' | '#' | null>>({
    description: null,
    answer: null,
    additionalInfo: null,
    editAnswer: null,
  });

  const applyTaggedEntitiesForStage = useCallback(
    (
      stage: TagStage,
      entities: TaggedEntity[],
      index?: number,
    ) => {
      switch (stage) {
        case 'description':
          setTaggedEntities(entities);
          break;
        case 'answer':
          setCurrentAnswerTags(entities);
          break;
        case 'additionalInfo':
          setAdditionalInfoTags(entities);
          break;
        case 'editAnswer':
          setTaggedEntities(entities);
          break;
        default:
          break;
      }
    },
    [setTaggedEntities, setCurrentAnswerTags, setAdditionalInfoTags]
  );

  const markTagDropdownSuppressed = useCallback(
    (stage: TagStage, type: '@' | '#') => {
      suppressTagDropdownRef.current[stage] = type;
    },
    []
  );

  const shouldSuppressTagDropdown = useCallback(
    (stage: TagStage, typingTag: TypingTagMatch) => {
      const suppressType = suppressTagDropdownRef.current[stage];

      if (!typingTag || !typingTag.type || typingTag.startPos === undefined || typingTag.startPos < 0) {
        suppressTagDropdownRef.current[stage] = null;
        return false;
      }

      if (!suppressType) {
        return false;
      }

      if (typingTag.type !== suppressType) {
        suppressTagDropdownRef.current[stage] = null;
        return false;
      }

      if (!typingTag.search || typingTag.search.length === 0) {
        suppressTagDropdownRef.current[stage] = null;
        return false;
      }

      return true;
    },
    []
  );

  const triggerHashPronounPrompt = useCallback(
    ({
      stage,
      text,
      entities,
      index,
    }: {
      stage: TagStage;
      text: string;
      entities: TaggedEntity[];
      index?: number;
    }) => {
            // Only match COMPLETED tags (with explicit space or punctuation after tag)
      // This regex ensures we only trigger when tag is finished with a boundary
      const hashPattern = /(^|\s)#([A-Za-z0-9_-]+)(?=[\s,.!?;:])/g;
      const seen = new Set<string>();
      let match: RegExpExecArray | null;
      let workingEntities = entities;
      let foundPendingTag = false;

      // Reset the regex to scan from beginning
      hashPattern.lastIndex = 0;

      if (!text || !text.includes('#')) {
        // Only clear if there's no pending tag waiting for gender
        if (!pendingHashTagSelectionRef.current || pendingHashTagSelectionRef.current.stage !== stage) {
          pendingHashPromptRef.current = null;
        }
        return;
      }

      while ((match = hashPattern.exec(text)) !== null) {
        const tagName = match[2];
        if (!tagName) continue;

        const normalized = tagName.toLowerCase().trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);

        const cachedPronoun = entityRegistryCache[normalized]?.preferred_pronouns ?? null;
        const key = `#${tagName}`.toLowerCase();
        const existingIndex = workingEntities.findIndex(
          (entity) => entity.tag?.toLowerCase() === key,
        );
        const existingEntity = existingIndex >= 0 ? workingEntities[existingIndex] : undefined;

        if (cachedPronoun) {
          // Name exists in registry - auto-apply pronoun
          // Clear pending state if this was the pending tag
          if (pendingHashTagSelectionRef.current?.stage === stage && 
              pendingHashTagSelectionRef.current.tagName.toLowerCase() === normalized) {
            pendingHashTagSelectionRef.current = null;
            pendingHashPromptRef.current = null;
            setHashTagWarning(null);
          }

          if (existingEntity && existingEntity.preferred_pronouns === cachedPronoun) {
            continue;
          }

          const structured = createStructuredTaggedEntity(
            `#${tagName}`,
            tagName,
            'unregistered',
            undefined,
            cachedPronoun,
          );

          const nextEntities = existingIndex >= 0 ? [...workingEntities] : [...workingEntities, structured];
          const targetIndex = existingIndex >= 0 ? existingIndex : nextEntities.length - 1;
          nextEntities[targetIndex] = {
            ...nextEntities[targetIndex],
            preferred_pronouns: cachedPronoun,
          };

          workingEntities = nextEntities;
          applyTaggedEntitiesForStage(stage, workingEntities, index);
          continue;
        }

                // 🚫 DO NOT show prompt unless the tag is COMPLETED with explicit boundary
        // Determine exact end of just the tag name
        const tagEndIndex = match.index! + match[1].length + 1 + tagName.length;
        const afterChar = text[tagEndIndex];

        // Tag is only completed if there's an explicit boundary character after it
        // If no character after tag (end of string) or character is not a boundary, skip
        if (!afterChar || !/[\s,.!?;:]/.test(afterChar)) {
          // Still typing or at end without boundary → do NOT open prompt
          continue;
        }



        // No cached pronoun - this tag needs gender selection
        // Check if we already have a pending tag for this stage
        if (pendingHashTagSelectionRef.current?.stage === stage) {
          // Already tracking a pending tag - check if it's the same one
          if (pendingHashTagSelectionRef.current.tagName.toLowerCase() === normalized) {
            // Same tag - keep prompt open, don't reset
            foundPendingTag = true;
            return;
          } else {
            // Different tag - user finished a new tag, update pending
            const tagStartPos = match.index! + match[1].length;
            const tagEndPos = tagStartPos + 1 + tagName.length;
            
            pendingHashPromptRef.current = normalized;
            pendingHashTagSelectionRef.current = {
              tagName,
              stage,
              tagStartPos,
              tagEndPos,
              maxAllowedLength: text.length, // Record current text length as maximum allowed
              index,
            };
            setShowPronounDropdown('#');
            setPronounSelectionContext({ stage, pendingHashTag: tagName, index });
            foundPendingTag = true;
            return;
          }
        }

        // New tag needs gender - show prompt
        const tagStartPos = match.index! + match[1].length;
        const tagEndPos = tagStartPos + 1 + tagName.length;

        pendingHashPromptRef.current = normalized;
        pendingHashTagSelectionRef.current = {
          tagName,
          stage,
          tagStartPos,
          tagEndPos,
          maxAllowedLength: text.length, // Record current text length as maximum allowed
          index,
        };
        setShowPronounDropdown('#');
        setPronounSelectionContext({ stage, pendingHashTag: tagName, index });
        foundPendingTag = true;
        return;
      }

      // No completed tags found that need gender
      // Only clear pending state if there's no pending tag for this stage
      if (!foundPendingTag && (!pendingHashTagSelectionRef.current || pendingHashTagSelectionRef.current.stage !== stage)) {
        // No pending tag or different stage - safe to clear
        if (pendingHashTagSelectionRef.current?.stage !== stage) {
          pendingHashPromptRef.current = null;
        }
      }
    },
    [applyTaggedEntitiesForStage, entityRegistryCache, setPronounSelectionContext, setShowPronounDropdown]
  );

  const finalizedContactMention = useCallback((text: string, startPos: number, contactName: string) => {
    const replaced = replaceTypingTag(text, startPos, '@', `${contactName}`);
    return replaced.endsWith(' ') ? replaced : `${replaced} `;
  }, []);

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
  useEffect(() => {
    descriptionAutosaveReadyRef.current = false;
    titleAutosaveReadyRef.current = false;
  }, [currentChatId]);

  useEffect(() => {
    if (!currentChatId) return;
    if (!titleAutosaveReadyRef.current) {
      titleAutosaveReadyRef.current = true;
      return;
    }

    if (titleAutosaveTimeoutRef.current) {
      clearTimeout(titleAutosaveTimeoutRef.current);
    }

    titleAutosaveTimeoutRef.current = setTimeout(() => {
      const normalized = chatTitle.trim();
      const fields: Record<string, any> = {};
      if (normalized.length > 0) {
        fields.session_name = normalized;
      }
      updateChatRecord(fields, {
        chat_title: normalized || contextDataRef.current?.chat_title || '',
      });
    }, 500);

    return () => {
      if (titleAutosaveTimeoutRef.current) {
        clearTimeout(titleAutosaveTimeoutRef.current);
      }
    };
  }, [chatTitle, currentChatId, updateChatRecord]);

  useEffect(() => {
    if (!currentChatId) return;
    if (!descriptionAutosaveReadyRef.current) {
      descriptionAutosaveReadyRef.current = true;
      return;
    }

    if (descriptionAutosaveTimeoutRef.current) {
      clearTimeout(descriptionAutosaveTimeoutRef.current);
    }

    descriptionAutosaveTimeoutRef.current = setTimeout(() => {
      const trimmed = initialDescription.trim();
      const fields: Record<string, any> = {};
      if (trimmed.length > 0) {
        const preview = trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
        fields.last_message = preview;
        fields.last_message_at = new Date().toISOString();
      }
      const contextPatch: Record<string, any> = {
        initial_description: initialDescription,
        taggedEntities,
      };
      if (flowStage === 'welcome') {
        contextPatch.flowStage = 'welcome';
      }
      updateChatRecord(fields, contextPatch);
    }, 600);

    return () => {
      if (descriptionAutosaveTimeoutRef.current) {
        clearTimeout(descriptionAutosaveTimeoutRef.current);
      }
    };
  }, [initialDescription, JSON.stringify(taggedEntities), currentChatId, updateChatRecord, flowStage]);


  const scrollViewRef = useRef<ScrollView>(null);
  const scrollToEnd = () => scrollViewRef.current?.scrollToEnd({ animated: true });

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
      fromContactChat: fromContactChatValue,
      sent: sentValue,
    });
    let kickedOff = false;
    if (user) {
      // If returning from contact chat, prioritize showing Stage 3 (Summary)
      const comingBack = String(fromContactChatValue || '') === '1';
      const hasSent = String(sentValue || '') === '1';
      if (comingBack && !hasSent) {
        kickedOff = true;
        setShowReturnFromChatBanner(String(skipReturnBannerValue || '') === '1' ? false : true);
        // ✅ CRITICAL FIX: Reset states IMMEDIATELY before any async operations
        setLoading(false);
        setInitializing(false);
        
        // ✅ PERFORMANCE OPTIMIZATION: Check if data is already in state
        // If we have summary and other data, skip DB fetch and show Stage 3 immediately
        const hasExistingData = summary.trim() !== '' || 
                                contextDataRef.current?.summary_a_perspective?.trim() !== '' ||
                                (qaPairs.length > 0 && initialDescription.trim() !== '');
        
        if (hasExistingData && currentChatId === chatIdValue) {
          // ✅ Data already in state - show Stage 3 immediately (no DB fetch needed)
          console.log('✅ Using existing state data - skipping DB fetch for faster load');
          setFlowStage('summary');
          setLoading(false);
          setInitializing(false);
          
          // ✅ Lightweight check for sent status in background (non-blocking)
          if (chatIdValue) {
            (async () => {
              try {
                const { data: chatData } = await supabase
                  .from('chats')
                  .select('context_data')
                  .eq('id', chatIdValue)
                  .single();
                
                const actuallySent = chatData?.context_data?.sent_to_contact === true;
                if (!actuallySent) {
                  setLoading(false);
                  setInitializing(false);
                }
              } catch (error) {
                // Silent fail - not critical for UI
                console.log('ℹ️ Could not check sent status:', error);
              }
            })();
          }
        } else if (chatIdValue) {
          // ✅ Data not in state - fetch from DB
          (async () => {
            try {
              await loadExistingChat();
              // ✅ Check if message was actually sent by querying the chat
              const { data: chatData } = await supabase
                .from('chats')
                .select('context_data')
                .eq('id', chatIdValue)
                .single();
              
              // ✅ If sent_to_contact is true in context_data, user already sent message - buttons should work
              // ✅ If false, user can still edit and send
              const actuallySent = chatData?.context_data?.sent_to_contact === true;
              if (!actuallySent) {
                // ✅ CRITICAL: User hasn't sent yet - ensure buttons are enabled
                // Reset states again after async operation completes
                setLoading(false);
                setInitializing(false);
              }
              
              setFlowStage('summary');
            } catch (error) {
              console.error('❌ Error loading chat:', error);
              // ✅ CRITICAL: Always reset states on error
              setLoading(false);
              setInitializing(false);
            } finally {
              // ✅ CRITICAL: Ensure states are cleared after async operations
              setLoading(false);
              setInitializing(false);
            }
          })();
        } else {
          setFlowStage('summary');
          setLoading(false);
          setInitializing(false);
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

  // ✅ FIX: Reset loading/initializing states when returning from contact chat (swipe back)
  // This handles the case where user swipes back before navigation completes
  useEffect(() => {
    const comingBack = String(fromContactChatValue || '') === '1';
    const hasSent = String(sentValue || '') === '1';
    
    // If coming back and hasn't sent, ensure states are reset
    if (comingBack && !hasSent) {
      // Use a small delay to ensure this runs after navigation completes
      const timer = setTimeout(() => {
        console.log('🔄 Resetting states after return from contact chat');
        setLoading(false);
        setInitializing(false);
        
        // Ensure we're on summary stage
        if (flowStage !== 'summary' && currentChatId) {
          setFlowStage('summary');
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [fromContactChatValue, sentValue, flowStage, currentChatId]);

  // ✅ ADDITIONAL FIX: Watch for loading state and reset if stuck
  // This handles edge cases where loading gets stuck
  useEffect(() => {
    if (loading && flowStage === 'summary') {
      // If we're on summary stage and loading is true, check if we should reset
      const comingBack = String(fromContactChatValue || '') === '1';
      const hasSent = String(sentValue || '') === '1';
      
      if (comingBack && !hasSent) {
        // User came back and hasn't sent - loading should be false
        const timer = setTimeout(() => {
          console.log('🔄 Loading state stuck - resetting');
          setLoading(false);
        }, 500);
        
        return () => clearTimeout(timer);
      }
    }
  }, [loading, flowStage, fromContactChatValue, sentValue]);

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
        .select("id, email, full_name, nickname")
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

      // ✅ FIX: Only check limit when creating a NEW chat, not when re-initializing existing chat
      // This prevents unwanted "Take a pause" notification during active chats
      // Skip limit check if we're already in an active chat session (currentChatId or chatIdValue exists)
      if (!currentChatId && !chatIdValue) {
        const completedMyTalks = await getCompletedMyTalksCount(user.id, contactIdValue);
        if (completedMyTalks >= MY_TALKS_LIMIT) {
          const friendlyName = contactProfile?.full_name || contactProfile?.email || 'this contact';
          Alert.alert('Limit Reached', buildMyTalksLimitMessage(friendlyName));
          setInitializing(false);
          router.push('/ai-assistant');
          return;
        }
      }

      // ✅ Get first name or nickname for default title
      const getContactDisplayName = (profile: any) => {
        if (!profile) return '';
        // Check for nickname first (if available in future)
        if (profile.nickname) return profile.nickname;
        // Otherwise use first name from full_name
        if (profile.full_name) {
          const firstName = profile.full_name.split(' ')[0];
          return firstName;
        }
        // Fallback to email
        return profile.email || '';
      };
      
      const contactDisplayName = getContactDisplayName(contactProfile);
      const defaultSessionName = `Chat with ${contactDisplayName} 💬`;
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
            session_started_at: new Date().toISOString(),
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
    // Check if there's a pending # tag that needs gender selection
    if (pendingHashTagSelectionRef.current && 
        pendingHashTagSelectionRef.current.stage === 'description') {
      const pending = pendingHashTagSelectionRef.current;
      const cursorPosition = (descriptionCursorPos !== undefined && descriptionCursorPos <= text.length)
        ? descriptionCursorPos
        : text.length;

      // Check if the pending tag still exists in the text
      const tagMatch = text.substring(pending.tagStartPos).match(/^#([A-Za-z0-9_-]+)/);
      if (!tagMatch || tagMatch[1].toLowerCase() !== pending.tagName.toLowerCase()) {
        // Tag was deleted or modified - clear pending state
        pendingHashTagSelectionRef.current = null;
        pendingHashPromptRef.current = null;
        setHashTagWarning(null);
      } else {
        // Allow editing within the tag name or before it
        if (cursorPosition >= pending.tagStartPos && cursorPosition <= pending.tagEndPos) {
          // User is editing the tag name itself - allow it
          // Update pending tag end position if tag name changed
          const oldTagEndPos = pending.tagEndPos;
          pending.tagEndPos = pending.tagStartPos + tagMatch[0].length;
          pending.tagName = tagMatch[1];
          // Update maxAllowedLength to account for tag name length changes
          const lengthDiff = pending.tagEndPos - oldTagEndPos;
          pending.maxAllowedLength = pending.maxAllowedLength + lengthDiff;
          setHashTagWarning(null);
        } else if (cursorPosition <= pending.tagStartPos) {
          // Cursor is before the tag - allow editing
          setHashTagWarning(null);
        } else if (text.length > pending.maxAllowedLength) {
          // User is trying to add characters after the tag - block it
          setHashTagWarning("Please select a pronoun before continuing.");
          // Don't update the text - block the change
          return;
        } else {
          // Text length is within allowed limit (deleting is fine)
          setHashTagWarning(null);
        }
      }
    } else {
      setHashTagWarning(null);
    }

    setInitialDescription(text);

    const cursorPosition = (descriptionCursorPos !== undefined && descriptionCursorPos <= text.length)
      ? descriptionCursorPos
      : text.length;

    const textUpToCursor = text.substring(0, cursorPosition);
    const typingTag = getLastTypingTag(textUpToCursor, cursorPosition);

    console.log('🔍 Description tag detection:', { typingTag, cursorPosition, textUpToCursor });

    const dropdownSuppressed = shouldSuppressTagDropdown('description', typingTag);

    if (dropdownSuppressed) {
      setShowTagDropdown(null);
      setShowPronounDropdown(null);
      setContactSuggestions([]);
      setHashSuggestions([]);
    } else if (typingTag.type === '@') {
      console.log('📧 Showing @ dropdown for User B');
      setShowPronounDropdown(null);
      setHashSuggestions([]);
      setShowTagDropdown('@');

      const userBContact = availableContacts.filter(c => c.id === resolvedContactId);
      setContactSuggestions(userBContact);
    } else if (typingTag.type === '#') {
      console.log("waiting for boundary");
    } else {
      console.log('🚪 Closing all dropdowns (no active tag or space detected)');
      setShowTagDropdown(null);
      if (!pendingHashTagSelectionRef.current) {
        setShowPronounDropdown(null);
      }
      
      setContactSuggestions([]);
      setHashSuggestions([]);
      suppressTagDropdownRef.current.description = null;
    }

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));

    const entities = parseTaggedEntities(text, contacts);
    setTaggedEntities(entities);
    triggerHashPronounPrompt({ stage: 'description', text, entities });
  };


  const handleContactSelect = async (contact: any) => {
    const typingTag = getLastTypingTag(initialDescription, descriptionCursorPos);
    if (typingTag.type !== '@') return;

    const contactName = contact.full_name || contact.email || '';
    const cacheKey = contactName.toLowerCase().trim();
    const cachedPronoun = entityRegistryCache[cacheKey]?.preferred_pronouns ?? null;

    const newText = finalizedContactMention(initialDescription, typingTag.startPos, contactName);
    setInitialDescription(newText);
    setContactSuggestions([]);
    setShowTagDropdown(null);
    markTagDropdownSuppressed('description', '@');

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));
    const entities = parseTaggedEntities(newText, contacts);

    if (cachedPronoun) {
      const entity = createStructuredTaggedEntity(
        `@${contactName}`,
        contactName,
        'registered',
        contact,
        cachedPronoun,
        false
      );

      const existingIndex = entities.findIndex(e => e.tag === entity.tag);
      if (existingIndex >= 0) {
        entities[existingIndex] = entity;
      } else {
        entities.push(entity);
      }

      setTaggedEntities(entities);
      setShowPronounDropdown(null);
      setPronounSelectionContext(null);
      return;
    }

    setTaggedEntities(entities);
    setShowPronounDropdown('@');
    setPronounSelectionContext({ stage: 'description', pendingContact: contact });
  };

  // ✅ Updated handleHashTagSelect - called when user selects a suggested #tag
const handleHashTagSelect = async (tag: string) => {
  const typingTag = getLastTypingTag(initialDescription, descriptionCursorPos);
  if (typingTag.type !== '#') return;

  const newText = replaceTypingTag(initialDescription, typingTag.startPos, '#', tag);
  setInitialDescription(newText);
  setHashSuggestions([]);
  setShowTagDropdown(null);

  const normalizedTag = tag.toLowerCase().trim();
  const cachedPronoun = entityRegistryCache[normalizedTag]?.preferred_pronouns ?? null;
  const contacts = availableContacts.map(c => ({
    id: c.id,
    name: c.full_name || c.email,
  }));
  const entities = parseTaggedEntities(newText, contacts);

  if (cachedPronoun) {
    const entity = createStructuredTaggedEntity(
      `#${tag}`,
      tag,
      'unregistered',
      undefined,
      cachedPronoun
    );

    const existingIndex = entities.findIndex(e => e.tag === entity.tag);
    if (existingIndex >= 0) {
      entities[existingIndex] = entity;
    } else {
      entities.push(entity);
    }

    setTaggedEntities(entities);
    setShowPronounDropdown(null);
    setPronounSelectionContext(null);
    await saveUserHashtag(tag);
    return;
  }

  // Don't trigger prompt here - let triggerHashPronounPrompt handle it when tag is completed
  setTaggedEntities(entities);
  // Check if tag is completed (has space/punctuation after it) - if so, triggerHashPronounPrompt will show prompt
  triggerHashPronounPrompt({ stage: 'description', text: newText, entities });
};

// ✅ Handler for pronoun selection - works across all stages
const handlePronounSelect = async (pronoun: string) => {
  if (!pronounSelectionContext) return;

  const { stage, pendingContact, pendingHashTag, index } = pronounSelectionContext;
  const tagType = showPronounDropdown;

  setShowPronounDropdown(null);

  let fieldText = '';
  let commitEntities: ((entities: TaggedEntity[]) => void) | null = null;

  switch (stage) {
    case 'description':
      fieldText = initialDescription;
      commitEntities = setTaggedEntities;
      break;
    case 'answer':
      fieldText = currentAnswer;
      commitEntities = setCurrentAnswerTags;
      break;
    case 'additionalInfo':
      fieldText = additionalInfo;
      commitEntities = setAdditionalInfoTags;
      break;
    case 'editAnswer':
      if (typeof index === 'number') {
        fieldText = showEditMode ? (editedQAPairs[index]?.answer ?? '') : (qaPairs[index]?.answer ?? '');
        commitEntities = setTaggedEntities;
      } else if (showEditMode && editModeAnswerIndex !== null) {
        fieldText = editedQAPairs[editModeAnswerIndex]?.answer ?? '';
        commitEntities = setTaggedEntities;
      }
      break;
  }

  if (!fieldText || !commitEntities) {
    setPronounSelectionContext(null);
    return;
  }

  const contacts = availableContacts.map(c => ({
    id: c.id,
    name: c.full_name || c.email,
  }));
  const entities = parseTaggedEntities(fieldText, contacts);

  if (tagType === '@' && pendingContact) {
    const contactName = pendingContact.full_name || pendingContact.email || '';
    const cacheKey = contactName.toLowerCase().trim();

    const entity = createStructuredTaggedEntity(
      `@${contactName}`,
      contactName,
      'registered',
      pendingContact,
      pronoun,
      false
    );

    const existingIndex = entities.findIndex(e => e.tag === entity.tag);
    if (existingIndex >= 0) {
      entities[existingIndex] = entity;
    } else {
      entities.push(entity);
    }

    commitEntities(entities);
    await saveTagToEntityRegistry(entity);
    setEntityRegistryCache(prev => ({
      ...prev,
      [cacheKey]: {
        preferred_pronouns: pronoun,
        entity_name: contactName,
      },
    }));

    setPronounSelectionContext(null);
    setShowTagDropdown(null);
    setShowAnswerTagDropdown(null);
    setShowAdditionalInfoTagDropdown(null);
    return;
  }

  if (tagType === '#') {
    const tagName = pendingHashTag;
    if (!tagName) {
      setPronounSelectionContext(null);
      pendingHashTagSelectionRef.current = null;
      pendingHashPromptRef.current = null;
      setHashTagWarning(null);
      return;
    }

    const entity = createStructuredTaggedEntity(
      `#${tagName}`,
      tagName,
      'unregistered',
      undefined,
      pronoun
    );

    const existingIndex = entities.findIndex(e => e.tag === entity.tag);
    if (existingIndex >= 0) {
      entities[existingIndex] = entity;
    } else {
      entities.push(entity);
    }

    commitEntities(entities);
    await saveTagToEntityRegistry(entity);
    await saveUserHashtag(tagName);
    setEntityRegistryCache(prev => ({
      ...prev,
      [tagName.toLowerCase().trim()]: {
        preferred_pronouns: pronoun,
        entity_name: tagName,
      },
    }));

    // Clear pending tag selection state after gender is saved
    if (pendingHashTagSelectionRef.current?.stage === stage && 
        pendingHashTagSelectionRef.current.tagName.toLowerCase() === tagName.toLowerCase()) {
      pendingHashTagSelectionRef.current = null;
    }
    pendingHashPromptRef.current = null;
    setHashTagWarning(null);

    setPronounSelectionContext(null);
    setShowTagDropdown(null);
    setShowAnswerTagDropdown(null);
    setShowAdditionalInfoTagDropdown(null);
    return;
  }

  setPronounSelectionContext(null);
  pendingHashPromptRef.current = null;
  pendingHashTagSelectionRef.current = null;
  setHashTagWarning(null);
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
  const handleCurrentAnswerChange = (text: string, suppressCleanup = true) => {
    // Check if there's a pending # tag that needs gender selection
    if (pendingHashTagSelectionRef.current && 
        pendingHashTagSelectionRef.current.stage === 'answer') {
      const pending = pendingHashTagSelectionRef.current;
      const cursorPosition = (currentAnswerCursorPos !== undefined && currentAnswerCursorPos <= text.length)
        ? currentAnswerCursorPos
        : text.length;

      // Check if the pending tag still exists in the text
      const tagMatch = text.substring(pending.tagStartPos).match(/^#([A-Za-z0-9_-]+)/);
      if (!tagMatch || tagMatch[1].toLowerCase() !== pending.tagName.toLowerCase()) {
        // Tag was deleted or modified - clear pending state
        pendingHashTagSelectionRef.current = null;
        pendingHashPromptRef.current = null;
        setHashTagWarning(null);
      } else {
        // Allow editing within the tag name or before it
        if (cursorPosition >= pending.tagStartPos && cursorPosition <= pending.tagEndPos) {
          // User is editing the tag name itself - allow it
          const oldTagEndPos = pending.tagEndPos;
          pending.tagEndPos = pending.tagStartPos + tagMatch[0].length;
          pending.tagName = tagMatch[1];
          const lengthDiff = pending.tagEndPos - oldTagEndPos;
          pending.maxAllowedLength = pending.maxAllowedLength + lengthDiff;
          setHashTagWarning(null);
        } else if (cursorPosition <= pending.tagStartPos) {
          // Cursor is before the tag - allow editing
          setHashTagWarning(null);
        } else if (text.length > pending.maxAllowedLength) {
          // User is trying to add characters after the tag - block it
          setHashTagWarning("Please select a pronoun before continuing.");
          return;
        } else {
          // Text length is within allowed limit (deleting is fine)
          setHashTagWarning(null);
        }
      }
    } else {
      setHashTagWarning(null);
    }

    setCurrentAnswer(text);
    
    // If answer was previously saved but text changed, mark as unsaved
    if (currentAnswerSaved && currentAnswerSavedText !== text.trim()) {
      setCurrentAnswerSaved(false);
    }

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
      setShowAnswerTagDropdown(null);
      setAnswerHashSuggestions([]);
      setAnswerContactSuggestions([]);
    } else {
      console.log('🚪 Closing all dropdowns (answer)');
      
      // ❗ Do NOT clean up if suppressCleanup = true
      if (!suppressCleanup) {
        setShowAnswerTagDropdown(null);
    
        if (!pendingHashTagSelectionRef.current) {
          setShowPronounDropdown(null);
        }
    
        setAnswerContactSuggestions([]);
        setAnswerHashSuggestions([]);
      }
    }
    
    

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));

    const entities = parseTaggedEntities(text, contacts);
    setCurrentAnswerTags(entities);

    if (!suppressCleanup) {
      triggerHashPronounPrompt({ stage: 'answer', text, entities });
    }
    
  };

  // Handle additional info text change with tagging
  const handleAdditionalInfoChange = (text: string) => {
    // Check if there's a pending # tag that needs gender selection
    if (pendingHashTagSelectionRef.current && 
        pendingHashTagSelectionRef.current.stage === 'additionalInfo') {
      const pending = pendingHashTagSelectionRef.current;
      const cursorPosition = (additionalInfoCursorPos !== undefined && additionalInfoCursorPos <= text.length)
        ? additionalInfoCursorPos
        : text.length;

      // Check if the pending tag still exists in the text
      const tagMatch = text.substring(pending.tagStartPos).match(/^#([A-Za-z0-9_-]+)/);
      if (!tagMatch || tagMatch[1].toLowerCase() !== pending.tagName.toLowerCase()) {
        // Tag was deleted or modified - clear pending state
        pendingHashTagSelectionRef.current = null;
        pendingHashPromptRef.current = null;
        setHashTagWarning(null);
      } else {
        // Allow editing within the tag name or before it
        if (cursorPosition >= pending.tagStartPos && cursorPosition <= pending.tagEndPos) {
          // User is editing the tag name itself - allow it
          const oldTagEndPos = pending.tagEndPos;
          pending.tagEndPos = pending.tagStartPos + tagMatch[0].length;
          pending.tagName = tagMatch[1];
          const lengthDiff = pending.tagEndPos - oldTagEndPos;
          pending.maxAllowedLength = pending.maxAllowedLength + lengthDiff;
          setHashTagWarning(null);
        } else if (cursorPosition <= pending.tagStartPos) {
          // Cursor is before the tag - allow editing
          setHashTagWarning(null);
        } else if (text.length > pending.maxAllowedLength) {
          // User is trying to add characters after the tag - block it
          setHashTagWarning("Please select a pronoun before continuing.");
          return;
        } else {
          // Text length is within allowed limit (deleting is fine)
          setHashTagWarning(null);
        }
      }
    } else {
      setHashTagWarning(null);
    }

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
      setShowAdditionalInfoTagDropdown(null);
      setAdditionalInfoHashSuggestions([]);
      setAdditionalInfoContactSuggestions([]);
    } else {
      console.log('🚪 Closing all dropdowns (additional info)');
      setShowAdditionalInfoTagDropdown(null);
      if (!pendingHashTagSelectionRef.current) {
        setShowPronounDropdown(null);
      }
      
      setAdditionalInfoContactSuggestions([]);
      setAdditionalInfoHashSuggestions([]);
    }

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));

    const entities = parseTaggedEntities(text, contacts);
    setAdditionalInfoTags(entities);
    triggerHashPronounPrompt({ stage: 'additionalInfo', text, entities });
  };

  // Stage 2: Handle contact selection for current answer
  const handleAnswerContactSelect = async (contact: any) => {
    const typingTag = getLastTypingTag(currentAnswer, currentAnswerCursorPos);
    if (typingTag.type !== '@') return;

    const contactName = contact.full_name || contact.email || '';
    const cacheKey = contactName.toLowerCase().trim();
    const cachedPronoun = entityRegistryCache[cacheKey]?.preferred_pronouns ?? null;

    const newText = finalizedContactMention(currentAnswer, typingTag.startPos, contactName);
    setCurrentAnswer(newText);
    setAnswerContactSuggestions([]);
    setShowAnswerTagDropdown(null);
    markTagDropdownSuppressed('answer', '@');

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));
    const entities = parseTaggedEntities(newText, contacts);

    if (cachedPronoun) {
      const entity = createStructuredTaggedEntity(
        `@${contactName}`,
        contactName,
        'registered',
        contact,
        cachedPronoun,
        false
      );

      const existingIndex = entities.findIndex(e => e.tag === entity.tag);
      if (existingIndex >= 0) {
        entities[existingIndex] = entity;
      } else {
        entities.push(entity);
      }

      setCurrentAnswerTags(entities);
      setShowPronounDropdown(null);
      setPronounSelectionContext(null);
      return;
    }

    setCurrentAnswerTags(entities);
    setShowPronounDropdown('@');
    setPronounSelectionContext({ stage: 'answer', pendingContact: contact });
  };

  // Stage 2: Handle hashtag selection for current answer
  const handleAnswerHashTagSelect = async (tag: string) => {
    const typingTag = getLastTypingTag(currentAnswer, currentAnswerCursorPos);
    if (typingTag.type !== '#') return;

    const newText = replaceTypingTag(currentAnswer, typingTag.startPos, '#', tag);
    setCurrentAnswer(newText);
    setAnswerHashSuggestions([]);
    setShowAnswerTagDropdown(null);

    const normalizedTag = tag.toLowerCase().trim();
    const cachedPronoun = entityRegistryCache[normalizedTag]?.preferred_pronouns ?? null;

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));
    const entities = parseTaggedEntities(newText, contacts);

    if (cachedPronoun) {
      const entity = createStructuredTaggedEntity(
        `#${tag}`,
        tag,
        'unregistered',
        undefined,
        cachedPronoun
      );

      const existingIndex = entities.findIndex(e => e.tag === entity.tag);
      if (existingIndex >= 0) {
        entities[existingIndex] = entity;
      } else {
        entities.push(entity);
      }

      setCurrentAnswerTags(entities);
      setShowPronounDropdown(null);
      setPronounSelectionContext(null);
      await saveUserHashtag(tag);
      return;
    }

    // Don't trigger prompt here - let triggerHashPronounPrompt handle it when tag is completed
    setCurrentAnswerTags(entities);
    // Check if tag is completed (has space/punctuation after it) - if so, triggerHashPronounPrompt will show prompt
    triggerHashPronounPrompt({ stage: 'answer', text: newText, entities });
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
    
    // If answer was previously saved but text changed, mark as unsaved
    if (updated[index].saved && savedAnswers[index] !== nextText.trim()) {
      updated[index].saved = false;
    }
    
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
      console.log("waiting for boundary");
      setPrevAnswerHashSuggestions([]);
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
      console.log("waiting for boundary");
      setEditModeContactSuggestions([]);
      setEditModeHashSuggestions([]);
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
    if (typingTag.type !== '@') return;

    const contactName = contact.full_name || contact.email || '';
    const cacheKey = contactName.toLowerCase().trim();
    const cachedPronoun = entityRegistryCache[cacheKey]?.preferred_pronouns ?? null;

    const newText = finalizedContactMention(additionalInfo, typingTag.startPos, contactName);
    setAdditionalInfo(newText);
    setAdditionalInfoContactSuggestions([]);
    setShowAdditionalInfoTagDropdown(null);
    markTagDropdownSuppressed('additionalInfo', '@');

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));
    const entities = parseTaggedEntities(newText, contacts);

    if (cachedPronoun) {
      const entity = createStructuredTaggedEntity(
        `@${contactName}`,
        contactName,
        'registered',
        contact,
        cachedPronoun,
        false
      );

      const existingIndex = entities.findIndex(e => e.tag === entity.tag);
      if (existingIndex >= 0) {
        entities[existingIndex] = entity;
      } else {
        entities.push(entity);
      }

      setAdditionalInfoTags(entities);
      setShowPronounDropdown(null);
      setPronounSelectionContext(null);
      return;
    }

    setAdditionalInfoTags(entities);
    setShowPronounDropdown('@');
    setPronounSelectionContext({ stage: 'additionalInfo', pendingContact: contact });
  };

  // Stage 3: Handle hashtag selection for additional info
  const handleAdditionalInfoHashTagSelect = async (tag: string) => {
    const typingTag = getLastTypingTag(additionalInfo, additionalInfoCursorPos);
    if (typingTag.type !== '#') return;

    const newText = replaceTypingTag(additionalInfo, typingTag.startPos, '#', tag);
    setAdditionalInfo(newText);
    setAdditionalInfoHashSuggestions([]);
    setShowAdditionalInfoTagDropdown(null);

    const normalizedTag = tag.toLowerCase().trim();
    const cachedPronoun = entityRegistryCache[normalizedTag]?.preferred_pronouns ?? null;

    const contacts = availableContacts.map(c => ({
      id: c.id,
      name: c.full_name || c.email,
    }));
    const entities = parseTaggedEntities(newText, contacts);

    if (cachedPronoun) {
      const entity = createStructuredTaggedEntity(
        `#${tag}`,
        tag,
        'unregistered',
        undefined,
        cachedPronoun
      );

      const existingIndex = entities.findIndex(e => e.tag === entity.tag);
      if (existingIndex >= 0) {
        entities[existingIndex] = entity;
      } else {
        entities.push(entity);
      }

      setAdditionalInfoTags(entities);
      setShowPronounDropdown(null);
      setPronounSelectionContext(null);
      await saveUserHashtag(tag);
      return;
    }

    // Don't trigger prompt here - let triggerHashPronounPrompt handle it when tag is completed
    setAdditionalInfoTags(entities);
    // Check if tag is completed (has space/punctuation after it) - if so, triggerHashPronounPrompt will show prompt
    triggerHashPronounPrompt({ stage: 'additionalInfo', text: newText, entities });
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
        .maybeSingle();

      if (chatError) {
        // Handle PGRST116 (no rows) gracefully
        if (chatError.code === 'PGRST116') {
          console.log('ℹ️ Chat not found, redirecting to AI Assistant');
          setInitializing(false);
          router.push('/ai-assistant');
          return;
        }
        console.error('❌ Failed to load chat:', chatError);
        throw new Error('Chat session not found');
      }

      if (!chatData) {
        console.log('ℹ️ Chat not found, redirecting to AI Assistant');
        setInitializing(false);
        router.push('/ai-assistant');
        return;
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

        // ✅ FIX: Removed limit check when loading EXISTING chat
        // Limit check should only happen when creating NEW chat (handled at line 844)
        // This prevents "Limit Reached" notification from appearing during active chats
      } catch (contactErr) {
        console.error('❌ Contact loading error:', contactErr);
        throw new Error('Failed to load contact information');
      }

      if (chatData.context_data) {
        const ctx = chatData.context_data;
        
        // ✅ LOG context_data for debugging
        console.log('📥 Loading session context_data:', {
          hasSummaryAPerspective: !!ctx.summary_a_perspective,
          hasSummarySharedNeutral: !!ctx.summary_shared_neutral,
          summaryAPerspectivePreview: ctx.summary_a_perspective?.substring(0, 100) || 'MISSING',
          summarySharedNeutralPreview: ctx.summary_shared_neutral?.substring(0, 100) || 'MISSING',
        });
        
        if (ctx.initial_description) setInitialDescription(ctx.initial_description);
        if (ctx.qa_pairs) setQAPairs(ctx.qa_pairs);
        
        // ✅ CRITICAL: ONLY use summary_a_perspective for Stage 3 (emotional, first-person)
        // ❌ NEVER fallback to summary_a or summary - they may contain neutral summary
        // ❌ NEVER use summary_shared_neutral for Stage 3
        const summaryAPerspective = ctx.summary_a_perspective || '';
        
        // Only check for summary_a_perspective if we're in a stage where summary should exist
        const shouldHaveSummary = ctx.flowStage === 'summary';
        
        if (summaryAPerspective) {
          console.log('✅ Found summary_a_perspective for Stage 3:', summaryAPerspective.substring(0, 100));
          setSummary(summaryAPerspective);
        } else if (shouldHaveSummary) {
          // Only show error if we're in a stage where summary should exist
          console.error('❌ ERROR: summary_a_perspective missing from database context_data!');
          console.error('This session may have old data structure. Using fallback for Stage 3.');
          // Fallback: Create A-perspective fallback (emotional, first-person, talking to AI)
          const fallbackAPerspective = "I shared my thoughts about the situation with the assistant.";
          setSummary(fallbackAPerspective);
          // Store in contextDataRef
          contextDataRef.current = {
            ...contextDataRef.current,
            summary_a_perspective: fallbackAPerspective,
          };
        }
        // If we're in welcome or qa stage, it's normal to not have summary yet - no error needed
        
        // ✅ Store in contextDataRef for later use
        // ✅ CRITICAL: If neutral summary is missing, create it from A-perspective (convert to third-person)
        // NEVER store A-perspective as neutral summary directly - that causes mixing
        let summarySharedNeutral = ctx.summary_shared_neutral;
        if (!summarySharedNeutral && summaryAPerspective) {
          console.warn('⚠️ Warning: summary_shared_neutral missing from database. Creating from A-perspective.');
          // Convert A-perspective to neutral (third-person)
          summarySharedNeutral = summaryAPerspective
            .replace(/^I\s+/gi, 'User A ')
            .replace(/\bmy\b/gi, 'their')
            .replace(/\bme\b/gi, 'them')
            .replace(/\bmyself\b/gi, 'themself')
            .replace(/\bI\b/gi, 'User A')
            .replace(/\bI'm\b/gi, 'User A is')
            .replace(/\bI've\b/gi, 'User A has')
            .replace(/\bI'd\b/gi, 'User A would');
        } else if (!summarySharedNeutral && !summaryAPerspective) {
          // If both are missing, create neutral fallback
          summarySharedNeutral = "The discussion is about a situation that needs to be addressed.";
        }
        
        contextDataRef.current = {
          ...contextDataRef.current,
          summary_a_perspective: summaryAPerspective || contextDataRef.current?.summary_a_perspective || "I shared my thoughts about the situation with the assistant.",
          summary_shared_neutral: summarySharedNeutral, // ✅ Neutral for option generation
        };
        
        console.log('✅ Stored summaries in contextDataRef:', {
          summaryAPerspectiveLength: contextDataRef.current.summary_a_perspective?.length || 0,
          summarySharedNeutralLength: contextDataRef.current.summary_shared_neutral?.length || 0,
          areDifferent: contextDataRef.current.summary_a_perspective !== contextDataRef.current.summary_shared_neutral,
        });
        
        if (ctx.thoughts || ctx.thoughts_a) setThoughts(ctx.thoughts || ctx.thoughts_a || '');
        if (ctx.questionCount !== undefined) setQuestionCount(ctx.questionCount);
        if (ctx.currentQuestion) setCurrentQuestion(ctx.currentQuestion);
        if (ctx.currentQuestionType) setCurrentQuestionType(ctx.currentQuestionType);
        // ✅ CRITICAL: Don't reset flowStage if summary is currently being generated
        // This prevents jumping back to Stage 1 during summary generation
        if (!isGeneratingSummary) {
          if (ctx.flowStage) {
            // Map legacy 'description' to 'welcome' for UI compatibility
            const mappedStage = ctx.flowStage === 'description' ? 'welcome' : ctx.flowStage;
            setFlowStage(mappedStage as FlowStage);
          } else if (chatData.is_resolved) {
            setFlowStage('summary');
          } else if (summaryAPerspective) {
            setFlowStage('summary');
          } else if (ctx.qa_pairs && ctx.qa_pairs.length > 0) {
            setFlowStage('qa');
          } else if (ctx.initial_description) {
            setFlowStage('qa');
          }
        } else {
          // ✅ During summary generation, keep flowStage at 'qa' (Stage 2)
          // Don't let loadExistingChat reset it to 'welcome' or 'summary'
          console.log('🔒 Summary generation in progress - preserving flowStage at "qa"');
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
      setLoading(false); // ✅ Also clear loading state to ensure buttons are clickable
      // ✅ FIX: Add explicit check to ensure we're not stuck in loading state
      if (returnStageValue === 'ready') {
        // When returning to summary stage, ensure everything is cleared
        setTimeout(() => {
          setLoading(false);
          setInitializing(false);
        }, 100);
      }
    }
  };

  // If explicitly asked to show a particular stage on return (e.g., from contact-selection)
  useEffect(() => {
    if (returnStageValue === 'ready') {
      setFlowStage('summary');
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

    // ✅ COST OPTIMIZATION: Check if initialDescription changed when navigating from Stage 3
    const initialDescriptionChanged = originalInitialDescriptionForStage1.trim() !== initialDescription.trim();
    
    if (!initialDescriptionChanged && originalInitialDescriptionForStage1.trim() !== "" && preGeneratedQuestions.length > 0) {
      // ✅ No changes detected - restore existing questions and skip API call
      console.log('✅ No changes detected in Stage 1 - restoring existing questions (cost optimization)');
      setFlowStage("qa");
      setCurrentQuestionIndex(0);
      setCurrentQuestion(preGeneratedQuestions[0]);
      setQuestionCount(1);
      setCurrentAnswerSaved(false);
      setCurrentAnswerSavedText('');
      
      // Clear the tracking since we're using existing questions
      setOriginalInitialDescriptionForStage1("");
      
      const shouldResetSession =
        !contextDataRef.current?.session_started_at || qaPairs.length === 0;
      const sessionStartedAt = shouldResetSession
        ? new Date().toISOString()
        : contextDataRef.current?.session_started_at;

      const contextPatch: Record<string, any> = {
        chat_title: normalizedTitle,
        initial_description: initialDescription,
        taggedEntities,
        flowStage: 'qa',
      };

      if (shouldResetSession && sessionStartedAt) {
        contextPatch.session_started_at = sessionStartedAt;
      }

      await updateChatRecord(
        {
          session_name: normalizedTitle,
        },
        contextPatch
      );
      return; // ✅ Skip API call - cost optimization
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
      
      // Clear tracking after generating new questions
      setOriginalInitialDescriptionForStage1("");
    } finally {
      setLoading(false);
    }

    const shouldResetSession =
      !contextDataRef.current?.session_started_at || qaPairs.length === 0;
    const sessionStartedAt = shouldResetSession
      ? new Date().toISOString()
      : contextDataRef.current?.session_started_at;

    const contextPatch: Record<string, any> = {
      chat_title: normalizedTitle,
      initial_description: initialDescription,
      taggedEntities,
      flowStage: 'welcome',
    };

    if (shouldResetSession && sessionStartedAt) {
      contextPatch.session_started_at = sessionStartedAt;
    }

    await updateChatRecord(
      {
        session_name: normalizedTitle,
      },
      contextPatch
    );
  };

  // ✅ NEW: Generate all 5 questions at once with strong validation
  const generateAllQuestions = async () => {
    try {
      setLoading(true);
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

📌 CRITICAL INSTRUCTIONS:
- Generate EXACTLY 5 questions that explore DIFFERENT aspects of the issue
- Each question must be COMPLETELY different from the others - not just name variations or slight rewordings
- Questions should explore different dimensions:
  * Question 1: Emotions/Feelings (how they feel about it)
  * Question 2: Facts/Details (specific information not yet mentioned)
  * Question 3: Intentions/Goals (what they want to achieve)
  * Question 4: Outcomes/Desired Results (how they want it to end)
  * Question 5: Relationships/Context (involvement of others or background)
${thirdPersonEntities.length > 0 ? `- CRITICAL: Third parties are mentioned (${thirdPersonEntities.map((e: any) => e.entity_name || e.name).join(', ')}). Include questions about their role, relationship, or involvement, but make each question explore a DIFFERENT aspect.` : ''}
- Do NOT ask about things already mentioned (who, where, when, event type, relationship, etc.)
- Each question must be a SINGLE sentence, 6-10 words, medium length
- Do NOT generate questions like "What does X say?" and "What does Y say?" - these are too similar
- Ensure questions ask about DIFFERENT topics, not just different people
- Keep tone caring and human, not robotic
- Return ONLY the 5 questions, one per line, numbered 1-5`;

      const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 300,
          system: systemPrompt,
          messages: [
            { role: "user", content: "Generate 5 completely different questions, one per line, numbered 1-5." },
          ],
        }),
      });

      const result = await response.json();
      
      if (!result?.content) {
        throw new Error("No content in response");
      }

      // Parse the response to extract questions
      const content = result.content.trim();
      const lines = content.split('\n').filter((line: string) => line.trim().length > 0);
      
      let questions: string[] = [];
      for (const line of lines) {
        // Remove numbering (1., 2., etc.) and extract question
        const cleaned = line.replace(/^\d+[\.\)]\s*/, '').trim();
        if (cleaned.endsWith('?')) {
          questions.push(cleaned);
        } else if (cleaned.length > 0) {
          // Add ? if missing
          questions.push(cleaned + '?');
        }
      }

      // Validate and filter questions
      const validQuestions: string[] = [];
      for (const q of questions) {
        const sanitized = sanitizeQuestion(q);
        const finalQ = sanitized.endsWith('?') ? sanitized : sanitized + '?';
        
        // Check word count and single question
        if (
          countWords(finalQ) <= MAX_STAGE2_QUESTION_WORDS &&
          countWords(finalQ) >= 4 && // Minimum 4 words
          isSingleQuestion(finalQ) &&
          isDistinctFromArray(finalQ, validQuestions) // Check against already accepted questions
        ) {
          validQuestions.push(finalQ);
        }
      }

      // If we don't have 5 valid questions, use fallbacks for missing ones
      while (validQuestions.length < 5) {
        const fallback = fallbackQuestions.find(
          (q) => isDistinctFromArray(q, validQuestions)
        );
        if (fallback) {
          validQuestions.push(fallback);
        } else {
          // Last resort: use a generic question
          validQuestions.push("What matters most to you here?");
          break;
        }
      }

      // Store the first 5 questions
      const finalQuestions = validQuestions.slice(0, 5);
      setPreGeneratedQuestions(finalQuestions);
      setCurrentQuestionIndex(0);
      
      // Show the first question
      if (finalQuestions.length > 0) {
        setCurrentQuestion(finalQuestions[0]);
        setCurrentQuestionType("text");
        setFlowStage("qa");
        setQuestionCount(1);
        setCurrentAnswerSaved(false);
        setCurrentAnswerSavedText('');
      }
    } catch (err) {
      console.error("Failed to generate questions:", err);
      // Fallback to old method if batch generation fails
      Alert.alert("Error", "Failed to generate questions. Please try again.");
      // Use fallback questions
      const fallbacks = fallbackQuestions.slice(0, 5);
      setPreGeneratedQuestions(fallbacks);
      setCurrentQuestionIndex(0);
      if (fallbacks.length > 0) {
        setCurrentQuestion(fallbacks[0]);
        setCurrentQuestionType("text");
        setFlowStage("qa");
        setQuestionCount(1);
      }
    } finally {
      setLoading(false);
    }
  };

  // ✅ KEEP: Old function for backward compatibility (not used in new flow)
  const generateFirstQuestion = async () => {
    // Redirect to new batch generation
    await generateAllQuestions();
  };

  const handleDeleteQAPair = (index: number) => {
    Alert.alert(
      "Delete Question",
      "Are you sure you want to delete this question and answer?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const updated = qaPairs.filter((_, i) => i !== index);
            setQAPairs(updated);
            // Update question count
            setQuestionCount(updated.length);
            // Remove from saved answers if it was saved
            const newSavedAnswers = {...savedAnswers};
            delete newSavedAnswers[index];
            // Reindex saved answers after deletion
            const reindexed: {[key: number]: string} = {};
            Object.keys(newSavedAnswers).forEach((key) => {
              const oldIndex = parseInt(key);
              if (oldIndex > index) {
                reindexed[oldIndex - 1] = newSavedAnswers[oldIndex];
              } else if (oldIndex < index) {
                reindexed[oldIndex] = newSavedAnswers[oldIndex];
              }
            });
            setSavedAnswers(reindexed);
          },
        },
      ]
    );
  };

  const handleSaveAnswer = async (index: number) => {
    const pair = qaPairs[index];
    const answer = pair.answer?.trim() || '';
    
    // Validation: empty answer
    if (!answer) {
      Alert.alert("Quick note needed", "Please enter an answer before saving.");
      return;
    }
    
    // Validation: clean up and check for irrelevant answers
    const cleaned = cleanUpAnswer(answer);
    const lettersOnly = /^[a-zA-Z]+$/;
    const hasVowel = /[aeiouAEIOU]/;
    
    if (isClearlyIrrelevant(cleaned) || (lettersOnly.test(cleaned) && !hasVowel.test(cleaned) && cleaned.length >= 3)) {
      Alert.alert(
        "Answer unclear",
        "That doesn't seem related. Try a short word or phrase."
      );
      return;
    }
    
    // Optional: Validate meaningfulness for longer answers (only if >= 20 tokens)
    const words = answer.trim().split(/\s+/).filter(Boolean);
    const tokensUsed = Math.round(words.length * (20/15));
    if (tokensUsed >= 20) {
      const isMeaningful = await validateMeaningfulness(answer);
      if (!isMeaningful) {
        Alert.alert(
          "Let's clarify 💭",
          "Your answer seems unclear. Could you rephrase it so I can better understand? ❤️"
        );
        return;
      }
    }
    
    // Mark as saved
    const updated = [...qaPairs];
    updated[index].saved = true;
    setQAPairs(updated);
    
    // Store the saved answer text to detect future changes
    setSavedAnswers({...savedAnswers, [index]: answer});
  };

  const handleSaveCurrentAnswer = async () => {
    const answer = currentQuestionType === "dropdown" ? selectedOption : currentAnswer;
    const answerText = answer?.trim() || '';
    
    // Validation: empty answer
    if (!answerText) {
      Alert.alert("Quick note needed", "Please enter an answer before saving.");
      return;
    }
    
    // Validation: clean up and check for irrelevant answers
    const cleaned = cleanUpAnswer(answerText);
    const lettersOnly = /^[a-zA-Z]+$/;
    const hasVowel = /[aeiouAEIOU]/;
    
    if (isClearlyIrrelevant(cleaned) || (lettersOnly.test(cleaned) && !hasVowel.test(cleaned) && cleaned.length >= 3)) {
      Alert.alert(
        "Answer unclear",
        "That doesn't seem related. Try a short word or phrase."
      );
      return;
    }
    
    // Optional: Validate meaningfulness for longer answers (only if >= 20 tokens)
    const words = answerText.trim().split(/\s+/).filter(Boolean);
    const tokensUsed = Math.round(words.length * (20/15));
    if (tokensUsed >= 20) {
      const isMeaningful = await validateMeaningfulness(answerText);
      if (!isMeaningful) {
        Alert.alert(
          "Let's clarify 💭",
          "Your answer seems unclear. Could you rephrase it so I can better understand? ❤️"
        );
        return;
      }
    }
    
    // Add to qaPairs with saved: true
    const newPair: QAPair = {
      question: currentQuestion,
      answer: cleaned || answerText,
      answerType: currentQuestionType,
      options: currentQuestionType === "dropdown" ? currentOptions : undefined,
      saved: true,
    };
    
    const updatedPairs = [...qaPairs, newPair];
    setQAPairs(updatedPairs);
    setQuestionCount(updatedPairs.length);
    
    // Store saved answer text
    setCurrentAnswerSaved(true);
    setCurrentAnswerSavedText(answerText);
    
    // Clear current answer
    setCurrentAnswer("");
    setSelectedOption(null);
    
    const normalizedTitle = chatTitle.trim() || contextDataRef.current.chat_title || '';
    
    // ✅ Show notice modal after saving 2nd answer (BEFORE checking pre-generated questions)
    if (updatedPairs.length === 2) {
      setShowSummaryNoticeModal(true);
      // Update database in background
      updateChatRecord(
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
      ).catch(err => console.error('Background DB update failed:', err));
      scrollToEnd();
      return; // Show modal and stop here - user can choose to generate summary or see next question
    }
    
    // ✅ FIX: Show next question IMMEDIATELY if using pre-generated questions (no lag)
    // ✅ NEW: Use pre-generated questions if available - show immediately
    if (preGeneratedQuestions.length > 0 && currentQuestionIndex < preGeneratedQuestions.length - 1) {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      setCurrentQuestion(preGeneratedQuestions[nextIndex]);
      setQuestionCount(nextIndex + 1);
      setCurrentAnswerSaved(false);
      setCurrentAnswerSavedText('');
      
      // ✅ Update database in background (non-blocking)
      updateChatRecord(
        {},
        {
          qa_pairs: updatedPairs,
          initial_description: initialDescription,
          flowStage: 'qa',
          questionCount: nextIndex + 1,
          taggedEntities,
          currentAnswer: '',
          selectedOption: null,
          currentQuestion: preGeneratedQuestions[nextIndex],
          chat_title: normalizedTitle,
        }
      ).catch(err => console.error('Background DB update failed:', err));
      
      scrollToEnd();
      return;
    }
    
    // ✅ Enforce max 5 questions total
    if (updatedPairs.length >= 5) {
      setShowGenerateSummaryButton(true);
      setCurrentQuestion("");
      // Update database in background
      updateChatRecord(
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
      ).catch(err => console.error('Background DB update failed:', err));
      scrollToEnd();
      return;
    }
    
    // If summary button already shown, do not generate more questions
    if (showGenerateSummaryButton) {
      setCurrentQuestion("");
      // Update database in background
      updateChatRecord(
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
      ).catch(err => console.error('Background DB update failed:', err));
      scrollToEnd();
      return;
    }
    
    // ✅ Fallback: Only use old method if pre-generated questions exhausted
    // Update database in background first
    updateChatRecord(
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
    ).catch(err => console.error('Background DB update failed:', err));
    
    // Generate next question (only if no pre-generated questions available)
    if (updatedPairs.length >= 2) {
      checkIfSufficientInfo(updatedPairs).catch(err => console.error('Failed to check info:', err));
    } else {
      generateNextQuestion(updatedPairs).catch(err => console.error('Failed to generate question:', err));
    }
    
    // Ensure the newest content is visible
    scrollToEnd();
  };

  const handleSaveAndExit = async () => {
    try {
      // ✅ Check if there's meaningful content to save
      // Include all possible content: title, initial description, qaPairs, summary, additionalInfo, currentAnswer
      const hasTitle = chatTitle.trim().length > 0;
      const hasInitialDescription = initialDescription.trim().length > 0;
      const hasQAPairs = qaPairs.length > 0;
      const hasSummary = summary.trim().length > 0;
      const hasAdditionalInfo = additionalInfo.trim().length > 0;
      const hasCurrentAnswer = currentAnswer.trim().length > 0;
      
      // Check contextDataRef for previously saved content
      const ctx = contextDataRef.current || {};
      const hasCtxTitle = ctx.chat_title && ctx.chat_title.trim().length > 0;
      const hasCtxInitialDescription = ctx.initial_description && ctx.initial_description.trim().length > 0;
      const hasCtxQAPairs = ctx.qa_pairs && ctx.qa_pairs.length > 0;
      const hasCtxSummary = ctx.summary && ctx.summary.trim().length > 0;
      const hasCtxAdditionalInfo = ctx.additional_info && ctx.additional_info.trim().length > 0;
      
      const hasContent = 
        hasTitle ||
        hasInitialDescription ||
        hasQAPairs ||
        hasSummary ||
        hasAdditionalInfo ||
        hasCurrentAnswer ||
        hasCtxTitle ||
        hasCtxInitialDescription ||
        hasCtxQAPairs ||
        hasCtxSummary ||
        hasCtxAdditionalInfo;
      
      console.log('💾 Save & Exit - Content check:', {
        flowStage,
        hasTitle,
        hasInitialDescription,
        hasQAPairs,
        hasSummary,
        hasAdditionalInfo,
        hasCurrentAnswer,
        hasCtxTitle,
        hasCtxInitialDescription,
        hasCtxQAPairs,
        hasCtxSummary,
        hasCtxAdditionalInfo,
        hasContent
      });
      
      // If no meaningful content, delete the chat instead of saving
      if (!hasContent && currentChatId) {
        console.log('🗑️ No meaningful content found, deleting empty session:', currentChatId);
        try {
          await supabase
            .from('chats')
            .delete()
            .eq('id', currentChatId)
            .eq('chat_type', 'ai_assistant');
          console.log('✅ Deleted empty session');
        } catch (deleteError) {
          console.error('⚠️ Failed to delete empty session:', deleteError);
        }
        router.push('/ai-assistant');
        return;
      }
      
      // If no chat exists yet and no content, don't create one
      if (!currentChatId && !hasContent) {
        console.log('⚠️ No content to save, exiting without creating session');
        router.push('/ai-assistant');
        return;
      }
      
      const normalizedTitle = chatTitle.trim() || contextDataRef.current?.chat_title || '';
      
      // Prepare context data with all current progress
      const contextPatch: Record<string, any> = {
        ...contextDataRef.current, // Preserve all existing fields
        flowStage: flowStage,
        chat_title: normalizedTitle,
        initial_description: initialDescription,
        taggedEntities: taggedEntities,
        questionCount: qaPairs.length,
        // ✅ FIX: Ensure saved sessions are visible in Sorted Assistant
        initial_pending: false, // Mark as not pending (saved session)
        session_promoted: false, // Don't mark as promoted to keep it visible
      };
      
      // Stage 1 (welcome): Save title, description, taggedEntities
      if (flowStage === 'welcome') {
        // Already included above
      }
      
      // Stage 2 (qa): Save qaPairs and current answer/question state
      if (flowStage === 'qa') {
        contextPatch.qa_pairs = qaPairs;
        // ✅ Always save currentAnswer if it exists (even if not yet saved to qaPairs)
        if (currentAnswer.trim()) {
          contextPatch.currentAnswer = currentAnswer;
        }
        if (currentQuestion) {
          contextPatch.currentQuestion = currentQuestion;
          contextPatch.currentQuestionType = currentQuestionType;
          if (currentQuestionType === 'dropdown') {
            contextPatch.currentOptions = currentOptions;
          }
        }
      }
      
      // Stage 3 (summary): Save qaPairs, summary, and thoughts
      if (flowStage === 'summary') {
        contextPatch.qa_pairs = qaPairs;
        contextPatch.summary = summary;
        // ✅ CRITICAL: Always save summary_a_perspective - use summary state if contextDataRef doesn't have it
        contextPatch.summary_a_perspective = contextDataRef.current?.summary_a_perspective || summary || '';
        contextPatch.summary_shared_neutral = contextDataRef.current?.summary_shared_neutral || '';
        contextPatch.thoughts = thoughts;
        contextPatch.thoughts_a = thoughts;
        // ✅ Always save additionalInfo if it exists (even if empty, to preserve user's edits)
        contextPatch.additional_info = additionalInfo || '';
        contextPatch.additional_info_tags = additionalInfoTags || [];
      }
      
      // ✅ REMOVED: Stage 4 (ready) save logic - Stage 3 (summary) already handles all saving
      
      // Determine last_message based on stage
      let lastMessage = '';
      if (flowStage === 'welcome') {
        lastMessage = initialDescription.trim() 
          ? (initialDescription.length > 140 ? `${initialDescription.slice(0, 137)}…` : initialDescription)
          : 'Draft started';
      } else if (flowStage === 'qa') {
        lastMessage = `In progress: ${qaPairs.length} question${qaPairs.length !== 1 ? 's' : ''} answered`;
      } else if (flowStage === 'summary') {
        lastMessage = 'Summary generated';
      }
      
      // ✅ Navigate immediately for faster UX, save in background
      // Use replace instead of push for faster navigation
      router.replace('/ai-assistant');
      
      // Update chat record with all progress (non-blocking, fire-and-forget)
      // The realtime subscription on AI assistant page will pick up the changes
      updateChatRecord(
        {
          session_name: normalizedTitle,
          last_message: lastMessage,
          last_message_at: new Date().toISOString(),
        },
        contextPatch
      ).catch((saveError) => {
        console.error('⚠️ Background save failed (non-critical):', saveError);
        // Don't show error to user since they've already navigated away
        // The realtime subscription will handle updates when save succeeds
      });
      
      // Early return to prevent error handling from blocking navigation
      return;
    } catch (error) {
      console.error('Failed to save and exit:', error);
      // Only show error if navigation hasn't happened yet
      Alert.alert('Error', 'Failed to save your progress. Please try again.');
    }
  };

  const handleAnswerSubmit = async () => {
    const answer = currentQuestionType === "dropdown" ? selectedOption : currentAnswer;
    const normalizedTitle = chatTitle.trim() || contextDataRef.current.chat_title || '';

    // If answer is already saved, just show next question
    if (currentAnswerSaved && currentQuestionType === "text" && currentAnswer.trim() === currentAnswerSavedText) {
      setCurrentAnswer("");
      setSelectedOption(null);
      setCurrentAnswerSaved(false);
      setCurrentAnswerSavedText('');
      
      // ✅ NEW: Use pre-generated questions if available
      if (preGeneratedQuestions.length > 0 && currentQuestionIndex < preGeneratedQuestions.length - 1) {
        const nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
        setCurrentQuestion(preGeneratedQuestions[nextIndex]);
        setQuestionCount(nextIndex + 1);
        setCurrentAnswerSaved(false);
        setCurrentAnswerSavedText('');
        scrollToEnd();
        return;
      }
      
      // Fallback to old method if pre-generated questions exhausted
      if (qaPairs.length >= 2) {
        await checkIfSufficientInfo(qaPairs);
      } else {
        await generateNextQuestion(qaPairs);
      }
      scrollToEnd();
      return;
    }

   if (!answer?.trim() && !isReviewMode) {
   Alert.alert("Quick note needed", "Drop a short reply so we can keep rolling.");
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
      saved: false,
    };

    const updatedPairs = [...qaPairs, newPair];
    setQAPairs(updatedPairs);
    setCurrentAnswer("");
    setSelectedOption(null);

    // keep questionCount in sync with visible progress
    setQuestionCount(updatedPairs.length);

    // ✅ FIX: Show next question IMMEDIATELY if using pre-generated questions (no lag)
    // ✅ NEW: Use pre-generated questions if available - show immediately
    if (preGeneratedQuestions.length > 0 && currentQuestionIndex < preGeneratedQuestions.length - 1) {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      setCurrentQuestion(preGeneratedQuestions[nextIndex]);
      setQuestionCount(nextIndex + 1);
      setCurrentAnswerSaved(false);
      setCurrentAnswerSavedText('');
      
      // ✅ Update database in background (non-blocking)
      updateChatRecord(
        {},
        {
          qa_pairs: updatedPairs,
          initial_description: initialDescription,
          flowStage: 'qa',
          questionCount: nextIndex + 1,
          taggedEntities,
          currentAnswer: '',
          selectedOption: null,
          currentQuestion: preGeneratedQuestions[nextIndex],
          chat_title: normalizedTitle,
        }
      ).catch(err => console.error('Background DB update failed:', err));
      
      scrollToEnd();
      return;
    }

    // ✅ Enforce max 5 questions total
    if (updatedPairs.length >= 5) {
      setShowGenerateSummaryButton(true);
      setCurrentQuestion(""); // stop showing new question
      // Update database in background
      updateChatRecord(
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
      ).catch(err => console.error('Background DB update failed:', err));
      scrollToEnd();
      return;
    }

    // If summary button already shown, do not generate more questions
    if (showGenerateSummaryButton) {
      setCurrentQuestion("");
      // Update database in background
      updateChatRecord(
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
      ).catch(err => console.error('Background DB update failed:', err));
      scrollToEnd();
      return;
    }

    // ✅ Fallback: Only use old method if pre-generated questions exhausted
    // Update database in background first
    updateChatRecord(
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
    ).catch(err => console.error('Background DB update failed:', err));

    // Generate next question (only if no pre-generated questions available)
    if (updatedPairs.length >= 2) {
      checkIfSufficientInfo(updatedPairs).catch(err => console.error('Failed to check info:', err));
    } else {
      generateNextQuestion(updatedPairs).catch(err => console.error('Failed to generate question:', err));
    }
    // Ensure the newest content is visible
    scrollToEnd();
  };


  const checkIfSufficientInfo = async (pairs: QAPair[]) => {
    if (pairs.length >= 7) {
      setIsGeneratingSummary(true);
      setCurrentQuestion("");
      await generateSummary(pairs);
      return;
    }

    // ✅ FIX: Skip AI check if using pre-generated questions (they're already validated)
    if (preGeneratedQuestions.length > 0 && currentQuestionIndex < preGeneratedQuestions.length - 1) {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      setCurrentQuestion(preGeneratedQuestions[nextIndex]);
      setQuestionCount(nextIndex + 1);
      setCurrentAnswerSaved(false);
      setCurrentAnswerSavedText('');
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
          model: "claude-3-5-haiku-20241022",
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

      // ✅ Fallback: Only generate if no pre-generated questions available
      if (preGeneratedQuestions.length === 0 || currentQuestionIndex >= preGeneratedQuestions.length - 1) {
        await generateNextQuestion(pairs);
      } else {
        // Use pre-generated questions
        const nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
        setCurrentQuestion(preGeneratedQuestions[nextIndex]);
        setQuestionCount(nextIndex + 1);
        setCurrentAnswerSaved(false);
        setCurrentAnswerSavedText('');
      }
    } catch (err) {
      console.error("Failed to check info completeness:", err);
      // ✅ Fallback: Only generate if no pre-generated questions available
      if (preGeneratedQuestions.length === 0 || currentQuestionIndex >= preGeneratedQuestions.length - 1) {
        await generateNextQuestion(pairs);
      } else {
        // Use pre-generated questions
        const nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
        setCurrentQuestion(preGeneratedQuestions[nextIndex]);
        setQuestionCount(nextIndex + 1);
        setCurrentAnswerSaved(false);
        setCurrentAnswerSavedText('');
      }
    } finally {
      setLoading(false);
    }
  };

  const MAX_STAGE2_QUESTION_WORDS = 10; // Medium length: 6-10 words for single sentence questions
  const sanitizeQuestion = (text: string) => text.replace(/\s+/g, " ").trim();
  const countWords = (text: string) =>
    text
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0).length;
  const isSingleQuestion = (text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return false;
    const questionMarks = (cleaned.match(/\?/g) || []).length;
    if (questionMarks > 1) return false;
    const sentenceTerminators = cleaned.match(/[.!]/g) || [];
    if (sentenceTerminators.length > 0) return false;
    return true;
  };
  const calculateSimilarity = (a: string, b: string) => {
    const words1 = a.toLowerCase().split(/\s+/).filter(Boolean);
    const words2 = b.toLowerCase().split(/\s+/).filter(Boolean);
    if (words1.length === 0 || words2.length === 0) return 0;
    const common = words1.filter((w) => words2.includes(w)).length;
    return common / Math.max(words1.length, words2.length);
  };
  
  // ✅ ENHANCED: Stronger similarity check that considers semantic meaning
  const calculateStrongSimilarity = (a: string, b: string): number => {
    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();
    
    // Exact match
    if (aLower === bLower) return 1.0;
    
    // Check for name variations (e.g., "Subbu" vs "Subbulakshmi")
    const namePattern = /(subbu|subbulakshmi|john|jane|etc)/gi;
    const aNames: string[] = aLower.match(namePattern) || [];
    const bNames: string[] = bLower.match(namePattern) || [];
    if (aNames.length > 0 && bNames.length > 0 && aNames.some((n: string) => bNames.includes(n))) {
      // If same name pattern but different question structure, check word overlap
      const aWords = aLower.replace(namePattern, '').split(/\s+/).filter(w => w.length > 2);
      const bWords = bLower.replace(namePattern, '').split(/\s+/).filter(w => w.length > 2);
      const commonWords = aWords.filter(w => bWords.includes(w));
      if (commonWords.length / Math.max(aWords.length, bWords.length) > 0.7) {
        return 0.9; // Very similar - likely just name variation
      }
    }
    
    // Remove common question words for better comparison
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'does', 'did', 'do', 'is', 'are', 'was', 'were', 'say', 'says', 'said'];
    const aCore = aLower.split(/\s+/).filter(w => !questionWords.includes(w) && w.length > 2);
    const bCore = bLower.split(/\s+/).filter(w => !questionWords.includes(w) && w.length > 2);
    
    if (aCore.length === 0 || bCore.length === 0) {
      // Fallback to word overlap
      return calculateSimilarity(a, b);
    }
    
    const commonCore = aCore.filter(w => bCore.includes(w));
    const similarity = commonCore.length / Math.max(aCore.length, bCore.length);
    
    // Also check if questions are asking about the same topic (e.g., both about "what X says")
    const aTopic = aCore.join(' ');
    const bTopic = bCore.join(' ');
    if (aTopic === bTopic) return 0.95; // Same topic, different wording
    
    return similarity;
  };
  
  const isDistinctQuestion = (candidate: string, history: QAPair[]) => {
    return !history.some((pair) => calculateSimilarity(candidate, pair.question) > 0.6);
  };
  
  // ✅ NEW: Check if question is distinct from an array of questions (for batch validation)
  const isDistinctFromArray = (candidate: string, questions: string[]): boolean => {
    return !questions.some((q) => calculateStrongSimilarity(candidate, q) > 0.5);
  };
  const fallbackQuestions = [
    "What felt hardest about this?",
    "How do you want this to end?",
    "What do you need them to know?",
    "What would help right now?",
    "What made this matter to you?"
  ];

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
      pairs.forEach((p: QAPair) => {
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
- Ask ONLY ONE question in a SINGLE sentence. Do NOT ask multiple questions or use compound sentences.
- Medium length: 6-10 words (one complete sentence, not too short, not too long).
- Keep it caring and human — not robotic.`;


      let generatedQuestion: string | null = null;
      let attempts = 0;

      while (attempts < 3 && !generatedQuestion) {
        attempts += 1;
        const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 80,
            system: systemPrompt,
            messages: [
              { role: "user", content: "Ask me the next question." },
            ],
          }),
        });

        const result = await response.json();
        if (!result?.content) continue;

        let candidate = sanitizeQuestion(result.content);
        if (!candidate.endsWith("?")) candidate = `${candidate}?`;

        if (
          countWords(candidate) <= MAX_STAGE2_QUESTION_WORDS &&
          isSingleQuestion(candidate) &&
          isDistinctQuestion(candidate, pairs)
        ) {
          generatedQuestion = candidate;
        }
      }

      if (!generatedQuestion) {
        const fallback = fallbackQuestions.find(
          (q) =>
            countWords(q) <= MAX_STAGE2_QUESTION_WORDS &&
            isDistinctQuestion(q, pairs)
        );
        generatedQuestion = fallback || "What matters most to you here?";
      }

      setCurrentQuestion(generatedQuestion);
      setCurrentQuestionType("text");
      setQuestionCount((prev) => prev + 1);
      // Reset saved state for new question
      setCurrentAnswerSaved(false);
      setCurrentAnswerSavedText('');

      const normalizedTitle = chatTitle.trim() || contextDataRef.current.chat_title || '';
      await updateChatRecord(
        {},
        {
          qa_pairs: pairs,
          initial_description: initialDescription,
          currentQuestion: generatedQuestion,
          currentQuestionType: 'text',
          currentAnswer: '',
          selectedOption: null,
          flowStage: 'qa',
          questionCount: questionCount + 1,
          taggedEntities,
          chat_title: normalizedTitle,
        }
      );
    } catch (err) {
      console.error("Failed to generate next question:", err);
      Alert.alert("Error", "Failed to generate next question.");
    } finally {
      setLoading(false);
    }
  };


  // ✅ Hybrid Quality Checker: Local first, AI fallback only if borderline
const validateMeaningfulness = async (text: string): Promise<boolean> => {
  if (!text || text.trim().length === 0) return false;
  
  // Calculate tokens: only validate if >= 20 tokens
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tokensUsed = Math.round(words.length * (20/15));
  if (tokensUsed < 20) return true; // Accept answers under 20 tokens without validation

  const lower = text.toLowerCase();

  // --- 1️⃣ Local quick checks (free, instant) ---
  const meaninglessPatterns =
    /(idk|don't know|whatever|nothing|blah|no idea|random|nonsense|haha|hmm+|ok|fine)/i;
  const verbs =
    /(feel|think|want|said|talk|argue|share|discuss|happened|upset|happy|angry|told|asked|problem|issue)/i;

  const emojiPattern = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;
  const emojiCount = (text.match(emojiPattern) || []).length;

  const wordCount = text.trim().split(/\s+/).length;
  const hasVerb = verbs.test(lower);
  const hasMeaning = !meaninglessPatterns.test(lower);
  const emojiRatio = emojiCount / text.length;

  // Strongly meaningful → pass immediately (no cost)
  if (wordCount > 4 && hasVerb && hasMeaning && emojiRatio < 0.3) return true;

  // Clearly junk → fail immediately (no cost)
  if (wordCount < 3 || emojiRatio > 0.5 || !hasMeaning) return false;

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

  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();
  const clampSentences = (text: string, maxSentences: number) => {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return "";
    const sentences = normalized.split(/(?<=[.!?])\s+/);
    return sentences.slice(0, maxSentences).join(" ");
  };
  const clampWordCount = (text: string, maxWords: number) => {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return "";
    const words = normalized.split(" ");
    if (words.length <= maxWords) return normalized;
    
    // Take words up to maxWords
    const truncated = words.slice(0, maxWords).join(" ");
    
    // Ensure the sentence ends properly - don't cut off mid-sentence
    // Remove trailing incomplete words/phrases that suggest incomplete sentences
    const incompleteEndings = /\s+(as|because|that|which|who|when|where|why|how|if|while|although|though|since|until|unless|before|after|during|despite|because of|due to|in order to|so that|such that)$/i;
    
    // If ends with incomplete phrase, remove it
    let cleaned = truncated.replace(incompleteEndings, "");
    
    // Ensure it ends with proper punctuation
    if (!/[.!?]$/.test(cleaned)) {
      // If it doesn't end with punctuation, find the last complete sentence
      const sentences = cleaned.match(/[^.!?]*[.!?]/g);
      if (sentences && sentences.length > 0) {
        cleaned = sentences.join(" ").trim();
      } else {
        // No sentence found, add period if it looks like a complete thought
        cleaned = cleaned.trim() + ".";
      }
    }
    
    return cleaned;
  };

  // Ensure text always ends with a complete sentence
  const ensureCompleteSentence = (text: string): string => {
    if (!text || text.trim().length === 0) return text;
    
    let cleaned = text.trim();
    
    // Remove trailing incomplete phrases
    const incompletePatterns = [
      /\s+(as|because|that|which|who|when|where|why|how|if|while|although|though|since|until|unless|before|after|during|despite)$/i,
      /\s+(and|or|but|so|yet|nor)$/i,
      /\s+(to|for|with|from|about|into|onto|upon|over|under|across|through)$/i,
      /\s+(me as|I think|I feel|she thinks|he thinks|they think|I thought|she thought|he thought)$/i, // Catch partial phrases
    ];
    
    incompletePatterns.forEach(pattern => {
      cleaned = cleaned.replace(pattern, "");
    });
    
    // Also check for incomplete clauses at sentence boundaries
    // Remove incomplete trailing clauses like "me as" or "I think she"
    const incompleteClauses = [
      /\s+me\s+as\s*$/i,
      /\s+I\s+think\s+she\s*$/i,
      /\s+I\s+think\s+he\s*$/i,
      /\s+I\s+think\s+they\s*$/i,
      /\s+I\s+feel\s+she\s*$/i,
      /\s+I\s+feel\s+he\s*$/i,
    ];
    
    incompleteClauses.forEach(pattern => {
      cleaned = cleaned.replace(pattern, "");
    });
    
    // Ensure it ends with proper punctuation
    if (!/[.!?]$/.test(cleaned)) {
      cleaned = cleaned.trim() + ".";
    }
    
    // Remove any double punctuation
    cleaned = cleaned.replace(/[.!?]{2,}/g, (match) => match.charAt(0));
    
    return cleaned.trim();
  };

  const enforceSummaryConstraints = (text: string) => {
    if (!text || text.trim().length === 0) return "";
    
    // First ensure complete sentences
    let cleaned = ensureCompleteSentence(text);
    
    // ✅ UPDATED: Increased limits - prioritize completeness (soft 50-55, hard max 70)
    const SOFT_WORD_LIMIT = 55;  // Soft target for AI
    const HARD_WORD_LIMIT = 70;  // Safety cap
    
    // Apply sentence and word limits - target 2-3 sentences for summary
    const normalized = normalizeWhitespace(cleaned);
    if (!normalized) return "";
    const sentences = normalized.match(/[^.!?]*[.!?]+/g) || [];
    const words = normalized.split(" ");
    
    // If we have 2-3 sentences and within hard limit, use them (prioritize completeness)
    if (sentences.length >= 2 && sentences.length <= 3) {
      const combined = sentences.join(" ");
      const combinedWords = combined.split(" ");
      if (combinedWords.length <= HARD_WORD_LIMIT) {
        return ensureCompleteSentence(combined);
      }
    }
    
    // If too many sentences, take first 3 complete sentences
    if (sentences.length > 3) {
      const firstThree = sentences.slice(0, 3).join(" ");
      const firstThreeWords = firstThree.split(" ");
      if (firstThreeWords.length <= HARD_WORD_LIMIT) {
        return ensureCompleteSentence(firstThree);
      }
    }
    
    // If only 1 sentence or need to trim, ensure at least 2 sentences within word limit
    let truncated = "";
    let wordCount = 0;
    const targetSentences = sentences.slice(0, 3); // Aim for 2-3 sentences
    
    for (const sentence of targetSentences) {
      const sentenceWords = sentence.trim().split(" ");
      if (wordCount + sentenceWords.length <= HARD_WORD_LIMIT) {
        truncated += (truncated ? " " : "") + sentence.trim();
        wordCount += sentenceWords.length;
      } else {
        break;
      }
    }
    
    // Ensure we have at least 2 sentences (allow up to HARD_WORD_LIMIT for completeness)
    if (sentences.length >= 2) {
      const firstTwo = sentences.slice(0, 2).join(" ");
      const firstTwoWords = firstTwo.split(" ");
      if (firstTwoWords.length <= HARD_WORD_LIMIT) {
        return ensureCompleteSentence(firstTwo);
      }
      // If slightly over hard limit, take first two sentences anyway (completeness priority)
      return ensureCompleteSentence(firstTwo);
    }
    
    // If only 1 sentence, duplicate/expand it to make 2 sentences (with variation)
    if (sentences.length === 1) {
      const singleSentence = sentences[0].trim();
      // Try to expand by adding a related sentence
      // For now, just ensure it's complete and add a second related sentence
      return ensureCompleteSentence(singleSentence);
    }
    
    // Fallback: ensure complete sentence
    return ensureCompleteSentence(normalized);
  };

  const enforceThoughtsConstraints = (text: string) => {
    if (!text || text.trim().length === 0) return "";
    
    // First ensure complete sentences
    let cleaned = ensureCompleteSentence(text);
    
    // ✅ UPDATED: Increased limits - prioritize completeness (soft 35-40, hard max 50)
    const SOFT_WORD_LIMIT = 40;  // Soft target for AI
    const HARD_WORD_LIMIT = 50;  // Safety cap
    
    // Then apply sentence and word limits
    cleaned = clampSentences(cleaned, 2);
    
    // Apply word count limit while ensuring complete sentences
    const normalized = normalizeWhitespace(cleaned);
    if (!normalized) return "";
    const words = normalized.split(" ");
    
    if (words.length <= HARD_WORD_LIMIT) {
      cleaned = ensureCompleteSentence(normalized);
    } else {
      // If over limit, find last complete sentence within limit
      let truncated = "";
      let wordCount = 0;
      
      const sentences = normalized.match(/[^.!?]*[.!?]+/g) || [];
      for (const sentence of sentences) {
        const sentenceWords = sentence.trim().split(" ");
        if (wordCount + sentenceWords.length <= HARD_WORD_LIMIT) {
          truncated += (truncated ? " " : "") + sentence.trim();
          wordCount += sentenceWords.length;
        } else {
          break;
        }
      }
      
      // If we have at least one sentence, use it
      if (truncated.trim().length > 0) {
        cleaned = ensureCompleteSentence(truncated.trim());
      } else {
        // Fallback: take first HARD_WORD_LIMIT words and ensure it ends properly
        const fallback = words.slice(0, HARD_WORD_LIMIT).join(" ");
        cleaned = ensureCompleteSentence(fallback);
      }
    }
    
    // Ensure first person
    if (!/^I\b|^I'm\b|^I'(m|ll|ve|d)\b|^I'll\b|^I've\b/i.test(cleaned)) {
      cleaned = `I ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
    }
    
    return ensureCompleteSentence(cleaned);
  };

  // Remove duplicate contact names within a text
  const deduplicateContactNames = (text: string, contactName: string): string => {
    if (!contactName || !text) return text;
    
    // Escape special regex characters
    const escapedName = contactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagPattern = new RegExp(`@${escapedName}\\b`, 'gi');
    
    // Count @tag occurrences
    const tagMatches = text.match(tagPattern);
    const tagCount = tagMatches ? tagMatches.length : 0;
    
    // If @tag appears more than once, replace subsequent occurrences
    if (tagCount > 1) {
      let firstFound = false;
      text = text.replace(tagPattern, (match) => {
        if (!firstFound) {
          firstFound = true;
          return match; // Keep first occurrence
        }
        return 'they'; // Replace subsequent occurrences
      });
    }
    
    // If we have @tag, replace plain name occurrences (not in @tag) with pronouns
    if (tagCount > 0) {
      const namePattern = new RegExp(`\\b${escapedName}\\b`, 'gi');
      text = text.replace(namePattern, (match, offset) => {
        // Check if this is part of an @tag
        if (offset > 0 && text[offset - 1] === '@') {
          return match; // Keep it, it's part of @tag
        }
        // Replace plain name with pronoun
        return 'they';
      });
    }
    
    return text;
  };

  // ✅ Clean up unwanted prefixes and formatting issues from AI output
  const cleanSummaryText = (text: string): string => {
    if (!text || typeof text !== 'string') return text || '';
    
    let cleaned = text.trim();
    
    // ✅ FIX: Remove emoji headers first (before other processing)
    cleaned = cleaned.replace(/^📌\s*Discussion Summary\s*/i, '');
    cleaned = cleaned.replace(/^💡\s*My Thoughts\s*/i, '');
    cleaned = cleaned.replace(/📌\s*Discussion Summary/g, '');
    cleaned = cleaned.replace(/💡\s*My Thoughts/g, '');
    cleaned = cleaned.replace(/📌/g, '');  // Remove any remaining 📌 emojis
    cleaned = cleaned.replace(/💡/g, '');  // Remove any remaining 💡 emojis
    
    // Remove common unwanted prefixes
    const prefixesToRemove = [
      /^Here is the summary for you::?\s*/i,
      /^Here is the discussion summary and my thoughts[^:]*::?\s*/i,
      /^Okay, here is a concise recap[^:]*::?\s*/i,
      /^Here is the summary::?\s*/i,
      /^I :\s*/i,
      /^I:\s*/,
      /^Here is\s*/i,
      /^Okay, here is\s*/i,
      /^Here's\s*/i,
      /^Here are\s*/i,
      /^Summary::?\s*/i,
      /^Discussion Summary::?\s*/i,
      /^My Thoughts::?\s*/i,
    ];
    
    prefixesToRemove.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });
    
    // Remove double colons and colon-space-colon patterns
    cleaned = cleaned.replace(/::+/g, ':');
    cleaned = cleaned.replace(/:\s*:/g, ':');
    cleaned = cleaned.replace(/:\s+$/g, ':');
    
    // Remove stray colons at the start
    cleaned = cleaned.replace(/^:\s*/, '');
    
    // Remove emoji headers if they appear in the middle (should only be at section start)
    // Keep only the first occurrence of each emoji header
    const discussionHeader = '📌 Discussion Summary';
    const thoughtsHeader = '💡 My Thoughts';
    
    // Split by headers if they exist
    if (cleaned.includes(discussionHeader) && cleaned.includes(thoughtsHeader)) {
      const parts = cleaned.split(thoughtsHeader);
      const summaryPart = parts[0]?.replace(discussionHeader, '').trim();
      const thoughtsPart = parts[1]?.trim() || '';
      
      // Clean each part separately
      let cleanSummary = summaryPart?.replace(/^:\s*/, '').replace(/::+/g, ':').trim() || '';
      let cleanThoughts = thoughtsPart?.replace(/^:\s*/, '').replace(/::+/g, ':').trim() || '';
      
      // Remove "I :" or "I:" prefixes from thoughts if present
      cleanThoughts = cleanThoughts.replace(/^I\s*:\s*/i, '').trim();
      
      // ✅ FIX: Remove emojis from individual parts before returning
      cleanSummary = cleanSummary.replace(/📌/g, '').replace(/💡/g, '').trim();
      cleanThoughts = cleanThoughts.replace(/📌/g, '').replace(/💡/g, '').trim();
      
      return `${discussionHeader}\n${cleanSummary}\n\n${thoughtsHeader}\n${cleanThoughts}`;
    }
    
    return cleaned.trim();
  };

  const generateSummary = async (pairs: QAPair[]) => {
    setLoading(true);
    setIsGeneratingSummary(true);
    // ✅ CRITICAL: Lock flowStage to 'qa' during generation to prevent jumping to Stage 1
    // This ensures we stay on Stage 2 (qa) while generating summary
    setFlowStage("qa");
    try {
      if (!currentChatId) {
        throw new Error('No chat ID available');
      }

      // ✅ COST OPTIMIZATION: Check if qaPairs changed when navigating from Stage 3
      const qaPairsChanged = !areQAPairsEqual(pairs, originalQAPairsForStage2);
      
      if (!qaPairsChanged && originalQAPairsForStage2.length > 0 && summary.trim() !== "") {
        // ✅ No changes detected - restore existing summary and skip API call
        console.log('✅ No changes detected in Stage 2 - restoring existing summary (cost optimization)');
        
        // Restore existing summary from contextDataRef or state
        const existingSummary = contextDataRef.current?.summary_a_perspective || summary || '';
        const existingThoughts = contextDataRef.current?.thoughts_a || thoughts || '';
        const existingNeutralSummary = contextDataRef.current?.summary_shared_neutral || '';
        
        setSummary(existingSummary);
        setThoughts(existingThoughts);
        
        // Update contextDataRef to ensure consistency
        contextDataRef.current = {
          ...contextDataRef.current,
          summary: existingSummary,
          summary_a: existingSummary,
          summary_a_perspective: existingSummary,
          summary_shared_neutral: existingNeutralSummary,
          thoughts_a: existingThoughts,
        };
        
        // Clear the tracking since we're using existing summary
        setOriginalQAPairsForStage2([]);
        
        setIsSummaryUnclear(false);
        setFlowStage("summary");
        setLoading(false);
        setIsGeneratingSummary(false);
        return; // ✅ Skip API call - cost optimization
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

      // Process structured context data
      const sessionStartedAtIso = contextDataRef.current?.session_started_at;
      const sessionStartedAtMs = sessionStartedAtIso
        ? Date.parse(sessionStartedAtIso)
        : NaN;
      const structuredRows = Array.isArray(structuredContextData)
        ? structuredContextData
        : [];
      const filteredStructuredContextData =
        !Number.isNaN(sessionStartedAtMs)
          ? structuredRows.filter((sc: any) => {
              const createdAtMs = sc?.created_at ? Date.parse(sc.created_at) : NaN;
              return !Number.isNaN(createdAtMs) && createdAtMs >= sessionStartedAtMs;
            })
          : structuredRows;

      // Build structured context text
      let structuredAnswersText = '';
      if (filteredStructuredContextData.length > 0) {
        structuredAnswersText = filteredStructuredContextData.map((sc: any) => 
          `${sc.question_text}: ${typeof sc.answer_value === 'object' ? JSON.stringify(sc.answer_value.value || sc.answer_value) : sc.answer_value}`
        ).join('\n');
      }

      // Build tagged_persons array for edge function
      const tagged_persons = (entitiesFromRegistry || []).map((e: any) => ({
        name: e.entity_name,
        is_user_b: e.role_in_conversation === 'User B' || (e.is_participant && e.participant_slot === 'B'),
        relationship: e.relationship_category || 'General',
        preferred_pronouns: e.preferred_pronouns || null
      }));

      // ✅ CALL THE GENERATE-SUMMARY EDGE FUNCTION
      // Get session token (fast operation)
      const { data: supabaseData } = await supabase.auth.getSession();
      const sessionToken = supabaseData?.session?.access_token;

      const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/generate-summary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          initial_description: initialDescription,
          question_responses: pairs.map((p) => ({
            question: p.question,
            answer: p.answer
          })),
          additional_context: additionalInfo || undefined,
          structured_context: structuredAnswersText || undefined,
          tagged_persons: tagged_persons,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Edge function error:', errorText);
        throw new Error('Failed to generate summary');
      }

      const result = await response.json();

      if (result.error) {
        console.error('❌ Edge function returned error:', result.error);
        throw new Error(result.error);
      }

      // ✅ DEBUG: Log the FULL raw response to see what we actually received
      console.log('🔍 FULL Edge function response (raw):', JSON.stringify(result, null, 2));
      console.log('🔍 Response keys:', Object.keys(result));
      console.log('🔍 result.summary_a_perspective:', result.summary_a_perspective);
      console.log('🔍 result.summary_shared_neutral:', result.summary_shared_neutral);
      console.log('🔍 result.context_data:', result.context_data);
      console.log('🔍 result.context_data?.summary_a_perspective:', result.context_data?.summary_a_perspective);
      console.log('🔍 result.context_data?.summary_shared_neutral:', result.context_data?.summary_shared_neutral);

      // ✅ LOG RESPONSE FOR DEBUGGING
      console.log('📥 Edge function response received:', {
        hasSummaryAPerspective: !!result.summary_a_perspective,
        hasSummarySharedNeutral: !!result.summary_shared_neutral,
        hasContextData: !!result.context_data,
        contextDataHasAPerspective: !!result.context_data?.summary_a_perspective,
        contextDataHasSharedNeutral: !!result.context_data?.summary_shared_neutral,
        summaryAPerspectivePreview: result.summary_a_perspective?.substring(0, 100) || 'MISSING',
        summarySharedNeutralPreview: result.summary_shared_neutral?.substring(0, 100) || 'MISSING',
      });

      // ✅ EXTRACT BOTH SUMMARIES FROM RESPONSE
      // CRITICAL: Only use summary_a_perspective fields - NEVER fallback to result.summary which may be neutral
      const summaryAPerspective = result.summary_a_perspective || result.context_data?.summary_a_perspective || '';
      const summarySharedNeutral = result.summary_shared_neutral || result.context_data?.summary_shared_neutral || '';
      const thoughtsA = result.context_data?.thoughts_a || result.context_data?.thoughts || '';
      const keyPoints = result.key_points || result.context_data?.key_points || [];

      // ✅ LOG EXTRACTED SUMMARIES
      console.log('📊 Extracted summaries:', {
        summaryAPerspectiveLength: summaryAPerspective.length,
        summarySharedNeutralLength: summarySharedNeutral.length,
        summaryAPerspectivePreview: summaryAPerspective.substring(0, 100) || 'EMPTY',
        summarySharedNeutralPreview: summarySharedNeutral.substring(0, 100) || 'EMPTY',
      });

      // ✅ VALIDATE BOTH SUMMARIES EXIST
      if (!summaryAPerspective) {
        console.warn('⚠️ Warning: Edge function did not return summary_a_perspective. Using fallback.');
        const fallbackSummary = "I shared my thoughts about the situation with the assistant.";
        // ✅ CRITICAL: Set summary state with A-perspective fallback (for Stage 3 UI)
        setSummary(fallbackSummary);
        setThoughts(thoughtsA || "I want to approach them calmly and clear any misunderstanding so we can stay comfortable with each other.");
        setIsSummaryUnclear(true);
        setFlowStage("summary");
        return;
      }

      // ✅ DEFENSIVE: If neutral summary is missing but A-perspective exists, create fallback
      let finalSummarySharedNeutral = summarySharedNeutral;
      if (!summarySharedNeutral) {
        console.warn('⚠️ Warning: Edge function did not return summary_shared_neutral. Creating fallback from A-perspective.');
        // Convert A-perspective to neutral (third-person) as fallback
        finalSummarySharedNeutral = summaryAPerspective
          .replace(/^I\s+/gi, 'User A ')
          .replace(/\bmy\b/gi, 'their')
          .replace(/\bme\b/gi, 'them')
          .replace(/\bmyself\b/gi, 'themself')
          .replace(/\bI\b/gi, 'User A')
          .replace(/\bI'm\b/gi, 'User A is')
          .replace(/\bI've\b/gi, 'User A has')
          .replace(/\bI'd\b/gi, 'User A would');
      }

      // ✅ CRITICAL: Set summary state with A-PERSPECTIVE ONLY (for Stage 3 UI)
      // NEVER use summary_shared_neutral for Stage 3 - that's only for chat option generation
      // summaryAPerspective is the emotional, first-person summary (User A talking to AI)
      setSummary(summaryAPerspective);
      setThoughts(thoughtsA || "I want to approach them calmly and clear any misunderstanding so we can stay comfortable with each other.");

      // ✅ STORE BOTH SUMMARIES IN contextDataRef FOR LATER USE
      // CRITICAL: Store them separately - NEVER mix them up
      // summary_a_perspective = emotional, first-person (for Stage 3 UI)
      // summary_shared_neutral = factual, third-person (for option generation)
      
      // First, merge context_data from edge function (but don't trust it completely)
      const mergedContextData = {
        ...contextDataRef.current,
        ...(result.context_data || {}),
      };
      
      // ✅ CRITICAL: Overwrite with our correctly extracted summaries to prevent mixing
      // These MUST be set AFTER the spread to ensure they take priority
      contextDataRef.current = {
        ...mergedContextData,
        // A-perspective summary (emotional, first-person) - for Stage 3 UI
        summary: summaryAPerspective, // backward compatibility
        summary_a: summaryAPerspective, // backward compatibility
        summary_a_perspective: summaryAPerspective, // ✅ A-perspective (emotional, first-person, User A talking to AI)
        // Neutral summary (factual, third-person) - for option generation
        summary_shared_neutral: finalSummarySharedNeutral, // ✅ Neutral (factual, third-person) - NEVER use A-perspective as fallback here
        thoughts_a: thoughtsA,
        key_points: keyPoints,
      };

      // ✅ LOG STORED SUMMARIES FOR DEBUGGING
      console.log('💾 Stored summaries in contextDataRef:', {
        summaryAPerspectiveLength: contextDataRef.current.summary_a_perspective?.length || 0,
        summarySharedNeutralLength: contextDataRef.current.summary_shared_neutral?.length || 0,
        summaryAPerspectivePreview: contextDataRef.current.summary_a_perspective?.substring(0, 100) || 'MISSING',
        summarySharedNeutralPreview: contextDataRef.current.summary_shared_neutral?.substring(0, 100) || 'MISSING',
        areSummariesDifferent: contextDataRef.current.summary_a_perspective !== contextDataRef.current.summary_shared_neutral,
      });

      const normalizedTitle = chatTitle.trim() || contextDataRef.current.chat_title || '';
      
      // ✅ UPDATE CHAT RECORD WITH BOTH SUMMARIES
      await updateChatRecord(
        {},
        {
          summary: summaryAPerspective, // For backward compatibility (A-perspective)
          summary_a: summaryAPerspective, // ✅ Add this for backward compatibility
          summary_a_perspective: summaryAPerspective, // ✅ A-perspective summary (emotional, first-person, User A talking to AI)
          summary_shared_neutral: finalSummarySharedNeutral, // ✅ Neutral shared summary (factual, third-person) - NEVER use A-perspective as fallback
          thoughts: thoughtsA,
          thoughts_a: thoughtsA,
          qa_pairs: pairs,
          initial_description: initialDescription,
          flowStage: 'summary',
          questionCount: pairs.length,
          taggedEntities,
          chat_title: normalizedTitle,
          key_points: keyPoints,
        }
      );

      setIsSummaryUnclear(false);  // ✅ Clear unclear flag after successful generation
      setFlowStage("summary");
      
      // Clear tracking after generating new summary
      setOriginalQAPairsForStage2([]);

      // ✅ NEW: Create contact chat and pregenerate options immediately when summary is ready
      // This ensures options are ready when user clicks "Send to contact" (no delay)
      if (contactId && currentChatId && summaryAPerspective && user?.id) {
        // Create/reuse contact chat in background (non-blocking)
        (async () => {
          try {
            // Check if contact chat already exists
            const { data: existingChat, error: existingChatError } = await supabase
              .from("chats")
              .select("id, context_data")
              .eq("user_id", user.id)
              .eq("contact_id", contactId)
              .eq("chat_type", "contact_chat")
              .eq("ai_source_chat_id", currentChatId)
              .eq("is_resolved", false)
              .order("created_at", { ascending: false })
              .maybeSingle();

            if (existingChatError) {
              console.warn("⚠️ Failed checking for existing contact chat (early creation):", existingChatError);
            }

            let contactChatId: string | undefined;

            if (existingChat?.id && existingChat.context_data?.initial_pending) {
              // Reuse existing pending chat
              contactChatId = existingChat.id;
              console.log("✅ Reusing existing contact chat for early pregeneration:", contactChatId);
              
              // Update context data with latest summaries
              const updatedContext = {
                ...(existingChat.context_data ?? {}),
                summary_a_perspective: summaryAPerspective,
                summary_shared_neutral: finalSummarySharedNeutral,
                thoughts_a: thoughtsA,
                qa_pairs: pairs,
                initial_description: initialDescription,
                taggedEntities,
                chat_title: normalizedTitle,
                initial_pending: true,
                sent_to_contact: false,
              };

              const { error: updateError } = await supabase
                .from("chats")
                .update({ context_data: updatedContext })
                .eq("id", contactChatId);
              
              if (updateError) {
                console.error("❌ Failed to update context_data for early pregeneration:", updateError);
                return; // Don't proceed if update failed
              }
              
              console.log("✅ Updated context_data for early pregeneration");
            } else {
              // Create new contact chat
              const { data: newChat, error: createError } = await supabase
                .from("chats")
                .insert({
                  user_id: user.id,
                  contact_id: contactId,
                  chat_type: "contact_chat",
                  ai_source_chat_id: currentChatId,
                  participants: [user.id, contactId],
                  is_resolved: false,
                  context_data: {
                    initial_pending: true,
                    sent_to_contact: false,
                    summary_a_perspective: summaryAPerspective,
                    summary_shared_neutral: finalSummarySharedNeutral,
                    thoughts_a: thoughtsA,
                    qa_pairs: pairs,
                    initial_description: initialDescription,
                    taggedEntities,
                    chat_title: normalizedTitle,
                  },
                })
                .select("id")
                .single();

              if (createError || !newChat?.id) {
                console.warn("⚠️ Failed to create contact chat for early pregeneration:", createError);
                return; // Don't block - user can still click "Send to contact" later
              }

              contactChatId = newChat.id;
              console.log("✅ Created contact chat for early pregeneration:", contactChatId);
            }

            // ✅ CRITICAL: Trigger pregeneration immediately and wait for completion
            // This ensures turns 0,1,2 are stored before user clicks "Send to contact"
            if (contactChatId) {
              console.log("⚡ Triggering early pregeneration for contact chat:", contactChatId);
              
              // ✅ Wait a moment for database to commit the context_data update
              await new Promise(resolve => setTimeout(resolve, 500));
              
              try {
                const { data, error } = await supabase.functions.invoke("generate-pregenerated-turns", {
                  body: { chatId: contactChatId }
                });
                
                if (error) {
                  // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
                  console.error("❌ Early pregeneration failed:", error);
                  // Silently fail - no user-facing error
                  // Retry once after a delay
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  const { data: retryData, error: retryError } = await supabase.functions.invoke("generate-pregenerated-turns", {
                    body: { chatId: contactChatId }
                  });
                  if (retryError) {
                    console.error("❌ Early pregeneration retry also failed:", retryError);
                  } else {
                    console.log("✅ Early pregeneration completed on retry:", retryData);
                  }
                } else {
                  console.log("✅ Early pregeneration completed successfully:", data);
                  // Verify turns were stored
                  if (data?.stored === 3 || data?.success === true) {
                    console.log("✅ Confirmed: 3 pregenerated turns (0,1,2) are now stored in database");
                  }
                }
              } catch (err) {
                // ✅ SILENT ERROR HANDLING: Pre-generation errors are logged but not shown to users
                console.error("❌ Early pregeneration error:", err);
                // Silently fail - no user-facing error
              }
            }
          } catch (err) {
            console.warn("⚠️ Error in early chat creation/pregeneration (non-critical):", err);
            // Don't block - user can still click "Send to contact" later
          }
        })();
      }
    } catch (err) {
      console.error("Failed to generate summary:", err);
      Alert.alert("Error", "Failed to generate summary. Please try again.");
    } finally {
      setLoading(false);
      setIsGeneratingSummary(false);
    }
  };


  const handleAddExtraInfo = () => {
    setShowEditMode(true);
    setEditedQAPairs([...qaPairs]);
    // ✅ Cost optimization: Store original values to detect changes
    setOriginalQAPairsForEdit([...qaPairs]);
    setOriginalAdditionalInfoForEdit(additionalInfo);

    setTimeout(() => {
      editScrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 300);
  };

  const handleEditAnswer = (index: number, newAnswer: string) => {
    const updated = [...editedQAPairs];
    updated[index] = { ...updated[index], answer: newAnswer };
    setEditedQAPairs(updated);
  };

  // ✅ Cost optimization: Helper function to compare QAPairs arrays
  const areQAPairsEqual = (pairs1: QAPair[], pairs2: QAPair[]): boolean => {
    if (pairs1.length !== pairs2.length) return false;
    return pairs1.every((pair1, index) => {
      const pair2 = pairs2[index];
      return (
        pair1.question === pair2.question &&
        pair1.answer?.trim() === pair2.answer?.trim() &&
        pair1.answerType === pair2.answerType
      );
    });
  };

  const handleRegenerateSummary = async () => {
    setLoading(true);
    setSummaryJustRegenerated(true);
    setShowEditMode(false);
    try {
      if (!currentChatId) {
        throw new Error('No chat ID available');
      }

      // ✅ COST OPTIMIZATION: Check if any changes were made
      const qaPairsChanged = !areQAPairsEqual(editedQAPairs, originalQAPairsForEdit);
      const additionalInfoChanged = additionalInfo.trim() !== originalAdditionalInfoForEdit.trim();
      const hasChanges = qaPairsChanged || additionalInfoChanged;

      if (!hasChanges) {
        // ✅ No changes detected - restore existing summary and skip API call
        console.log('✅ No changes detected in edit mode - restoring existing summary (cost optimization)');
        
        // Restore existing summary from contextDataRef or state
        const existingSummary = contextDataRef.current?.summary_a_perspective || summary || '';
        const existingThoughts = contextDataRef.current?.thoughts_a || thoughts || '';
        const existingNeutralSummary = contextDataRef.current?.summary_shared_neutral || '';
        
        setSummary(existingSummary);
        setThoughts(existingThoughts);
        
        // Update contextDataRef to ensure consistency
        contextDataRef.current = {
          ...contextDataRef.current,
          summary: existingSummary,
          summary_a: existingSummary,
          summary_a_perspective: existingSummary,
          summary_shared_neutral: existingNeutralSummary,
          thoughts_a: existingThoughts,
        };
        
        // Update qaPairs (in case editedQAPairs was modified but reverted)
        setQAPairs(editedQAPairs);
        
        setTimeout(() => {
          setSummaryJustRegenerated(false);
        }, 500);
        
        setLoading(false);
        return; // ✅ Skip API call - cost optimization
      }

      // ✅ Changes detected - proceed with normal regeneration
      console.log('✅ Changes detected - regenerating summary via API');

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

      const sessionStartedAtIso = contextDataRef.current?.session_started_at;
      const sessionStartedAtMs = sessionStartedAtIso
        ? Date.parse(sessionStartedAtIso)
        : NaN;
      const structuredRows = Array.isArray(structuredContextData)
        ? structuredContextData
        : [];
      const filteredStructuredContextData =
        !Number.isNaN(sessionStartedAtMs)
          ? structuredRows.filter((sc: any) => {
              const createdAtMs = sc?.created_at ? Date.parse(sc.created_at) : NaN;
              return !Number.isNaN(createdAtMs) && createdAtMs >= sessionStartedAtMs;
            })
          : structuredRows;

      // Build complete conversation history with edited Q&A pairs
      const conversationHistory = editedQAPairs.map((p, idx) => `Q${idx + 1}: ${p.question}\nA${idx + 1}: ${p.answer}`).join("\n\n");

      const additionalContext = additionalInfo.trim() ? `\n\nAdditional Information: ${additionalInfo}` : '';

      // Add structured context data to conversation history
      let structuredAnswersText = '';
      if (filteredStructuredContextData.length > 0) {
        structuredAnswersText = '\n\nAdditional Context:\n' + filteredStructuredContextData.map((sc: any) => 
          `${sc.question_text}: ${typeof sc.answer_value === 'object' ? JSON.stringify(sc.answer_value.value || sc.answer_value) : sc.answer_value}`
        ).join('\n');
      }

      const editTagRegex = /[@#][A-Za-z0-9_\-]+/g;
      const editMentionedTags = new Set<string>();
      const editRecordMention = (tag?: string | null) => {
        if (!tag) return;
        editMentionedTags.add(tag);
        editMentionedTags.add(tag.toLowerCase());
      };
      const editCollectTagsFromText = (text?: string | null) => {
        if (!text) return;
        const matches = text.match(editTagRegex);
        matches?.forEach(editRecordMention);
      };

      editCollectTagsFromText(initialDescription);
      editedQAPairs.forEach((pair) => {
        editCollectTagsFromText(pair.question);
        editCollectTagsFromText(pair.answer);
      });
      editCollectTagsFromText(additionalInfo);
      editCollectTagsFromText(additionalContext);
      editCollectTagsFromText(structuredAnswersText);

      const editIsUserAEntity = (entity: any) =>
        entity.role_in_conversation === 'User A' ||
        (entity.is_participant && entity.participant_slot === 'A');
      const editIsUserBEntity = (entity: any) =>
        entity.role_in_conversation === 'User B' ||
        (entity.is_participant && entity.participant_slot === 'B');
      const editGetEntityTag = (entity: any): string | null => {
        const fullName = entity?.entity_name;
        if (!fullName) return null;
        const isUserBEntity =
          entity.role_in_conversation === 'User B' ||
          (entity.is_participant && entity.participant_slot === 'B');
        const tagSymbol = isUserBEntity ? '@' : entity.is_registered ? '@' : '#';
        return `${tagSymbol}${fullName}`;
      };
      const editEntityMatchesCurrentInput = (entity: any) => {
        const tag = editGetEntityTag(entity);
        if (!tag) return false;
        return (
          editMentionedTags.has(tag) || editMentionedTags.has(tag.toLowerCase())
        );
      };

      const editSanitizableEntities = (entitiesFromRegistry || []).filter(
        (entity: any) => {
          if (editIsUserAEntity(entity) || editIsUserBEntity(entity)) {
            return true;
          }
          return editEntityMatchesCurrentInput(entity);
        }
      );

      const editPromptEntities = editSanitizableEntities.filter(
        (entity: any) => !editIsUserAEntity(entity)
      );
      const allTaggedEntitiesList = editPromptEntities.length
        ? editPromptEntities
            .map((entity: any) => {
              const tag = editGetEntityTag(entity);
              if (!tag) return null;
              const roleDesc = editIsUserBEntity(entity)
                ? ' (User B - the person they\'re talking to, use "you/your")'
                : ` (third party, use "${entity.preferred_pronouns || 'they/them'}")`;
              return `${tag}${roleDesc}`;
            })
            .filter(Boolean)
            .join(', ')
        : '';

      const entityContextText = allTaggedEntitiesList
        ? `\n\nTagged Participants and Pronouns:\n${allTaggedEntitiesList}`
        : '';

      // Accumulate ALL information: Stage 1 + Stage 2 (edited) + additional info + structured context + tags
      const allContextText = `Initial Description (Stage 1):\n${initialDescription}\n\nQuestion & Answer History - EDITED (Stage 2):\n${conversationHistory}${additionalContext ? `\n\nAdditional/Edited Information:\n${additionalContext}` : ''}${structuredAnswersText ? `\n\nStructured Context Data:\n${structuredAnswersText}` : ''}${entityContextText}`;

      const systemPrompt = `You are helping User A rewrite a concise recap for their AI assistant. Use EVERYTHING below—including edits—and respond as if User A is speaking to the assistant.

CRITICAL RULES
1. Perspective • Keep User A in first-person ("I…", "my…"). They are talking to the AI assistant about the contact.
2. Pronouns • Refer to User B with their @tag or third-person pronouns. Never use "you/your" for User B. Do not invent titles or relationships.
3. Tags • Reuse every @ or # tag exactly as supplied. Only reference third parties with a #tag if that tag is present in the inputs. If no # tags appear, do not invent any. Never repeat contact names more than once per section.
4. Brevity & Completeness • Aim for 2–3 complete sentences (~50-55 words for summary, ~35-40 words for thoughts).
   - CRITICAL: Use efficient word choices ("accused" not "said that I was accused", "jealous" not "being jealous about")
   - CRITICAL: ALWAYS include ALL emotional words (jealous, hurt, accused, upset, frustrated, etc.) and action words (accused, said, told, ignored, etc.)
   - If including all important words brings summary to 55-60 words, that's acceptable — completeness over brevity
   - Maximum: ~70 words for summary, ~50 words for thoughts (safety cap)
   - Never drop emotional/action words to save space — these are essential
5. Content • Capture ALL details User A told the assistant, including:
   - CRITICAL: Preserve ALL emotional words (jealous, hurt, angry, accused, upset, frustrated, etc.) - these are essential
   - CRITICAL: Preserve ALL action words (accused, said, told, ignored, etc.) - these describe what happened
   - CRITICAL: Preserve ALL key details that explain WHY User A is concerned (e.g., "jealous about accomplishments", "ignored at party", "accused of being rude")
   - NEVER drop emotional context or action words to save space - these are the core of the issue
   - If User A said "accused me of being jealous", the summary MUST include both "accused" and "jealous"
   - CRITICAL: If "Additional/Edited Information" section exists, you MUST incorporate those details into both the summary and thoughts sections. This additional context is important and should be reflected in the output.
   - Make "Thoughts" a forward-looking first-person reflection.
6. COMPLETE SENTENCES • Every sentence must be complete and end with proper punctuation (. ! ?). Never end with incomplete phrases like "as", "because", "that", "which", "but", etc. Always finish your thoughts completely. Never produce partial text like "me as" or "I think she…" without finishing.
7. POLISHED OUTPUT • Ensure every sentence is grammatically correct and makes complete sense on its own. No unfinished thoughts or cut-off sentences.
8. REQUIRED SECTIONS • ALWAYS generate BOTH sections. Never leave "My Thoughts" empty. Even with very short user input, generate meaningful content for both sections.
9. FORMATTING • NEVER add prefixes like "Here is the summary:", "I :", "Here is the discussion summary and my thoughts, as if I am User A", "Okay, here is a concise recap", "Summary:", etc. Start directly with the emoji headers (📌 or 💡).
10. NO INTRODUCTORY TEXT • Do not add any introductory sentences or explanations. Do not write as the assistant speaking. Start immediately with "📌 Discussion Summary" or "💡 My Thoughts".
11. NO DOUBLE PUNCTUATION • Never use "::" or ": :". Use single punctuation only.
12. NO NAME CHANGES • Use only names and tags that User A explicitly typed. Do not invent or change names.

Complete Context (including edits):
${allContextText}

Return exactly two sections in this exact format (start directly with emoji headers, no prefixes):
📌 Discussion Summary
<2–3 complete sentences summarizing User A's discussion with the assistant. MUST include all emotional words (jealous, hurt, accused, etc.) and action words (accused, said, told, etc.) from the original context. Example: If User A said "User B accused me of being jealous", include both "accused" and "jealous". Use efficient word choices to keep concise (~50-55 words, max 70). Must be 2–3 full sentences that tell a complete story. Must end with proper punctuation. Never repeat contact names more than once.>

💡 My Thoughts
<1–2 complete sentences describing what User A hopes, plans, or feels about the situation. This section is REQUIRED and must never be empty. Must end with proper punctuation.>

🎯 PRONOUN ACCURACY FOR THOUGHTS (CRITICAL):
- Thoughts must always be written strictly from User A's perspective
- Use 'I', 'me', 'my', 'I think', 'I feel', 'I didn't expect…' for User A
- Use 'you' or the @tag ONLY when User A refers to User B
- Use the exact #tags or names the user gave for third parties
- Do NOT invent new names, labels, or pronouns

POV CONSISTENCY:
- Do not switch into User B's perspective
- Do not describe what User B feels unless User A explicitly said it

LANGUAGE STYLE:
- Use warm, natural, everyday English (not formal and not Gen-Z slang)
- Keep it simple, human, caring, and easy to read
- Thoughts should feel like User A is quietly reflecting to themselves

✅ GOOD EXAMPLES:
- "I didn't expect that from you."
- "I think I could have explained myself better."
- "I still care about this and want things to be okay."
- "I didn't know #Dad said that."

❌ AVOID:
- Incorrect POV ('You must be upset', 'We feel…', 'They probably…')
- Formal phrases ('I acknowledge…', 'I appreciate your perspective')
- Gen-Z slang ('lowkey', 'fr', 'no cap')
- Added assumptions User A never shared

CRITICAL: 
- ALWAYS generate BOTH sections. Never leave "My Thoughts" empty.
- Start directly with emoji headers (📌 or 💡). No prefixes, no "Here is:", no "I :", no introductory text.
- Discussion Summary must be 2–3 complete sentences.
- My Thoughts must be 1–2 complete sentences.
- Never end any sentence with incomplete clauses like "as", "because", "that", "but", etc.
- Never repeat contact names more than once per section.
- Never produce partial text like "me as" or "I think she…" without finishing.
- Every sentence must be complete and polished.
- Always end with proper punctuation.
- No extra text, numbering, or bullet points.`;

      const response = await fetch(CLAUDE_EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 300,
          system: systemPrompt,
          messages: [
            { role: "user", content: "Generate the summary now." },
          ],
        }),
      });

      const result = await response.json();

      if (result?.content) {
        const userAEntity =
          editSanitizableEntities.find((entity: any) => editIsUserAEntity(entity)) ?? null;
        const userBEntity =
          editSanitizableEntities.find((entity: any) => editIsUserBEntity(entity)) ?? null;
        const escapeRegex = (value: string) =>
          value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        let rawContent = result.content;
  
  // First, protect existing tags to avoid partial replacements (same as generateSummary)
  const existingTags = new Set<string>();
  const tagProtectionMap: Record<string, string> = {};
  let protectionIndex = 0;
  
  // Extract and protect all existing @ and # tags
  rawContent = rawContent.replace(/(@[\w]+|#[\w]+)/g, (match: string): string => {
    const placeholder = `<<TAG_PROTECT_${protectionIndex}>>`;
    const legacyPlaceholder = `__TAG_PROTECT_${protectionIndex}__`;
    tagProtectionMap[placeholder] = match;
    tagProtectionMap[legacyPlaceholder] = match;
    existingTags.add(match);
    existingTags.add(match.toLowerCase());
    protectionIndex++;
    return placeholder;
  });
  
  // Post-process summary to replace ALL pronouns with tags (except "I/me/my" for User A)
  // Process entities in reverse length order to match longer names first
  const sortedEntities = [...editSanitizableEntities].sort((a: any, b: any) => 
    (b.entity_name?.length || 0) - (a.entity_name?.length || 0)
  );
  
  sortedEntities.forEach((e: any) => {
    const name = e.entity_name?.toLowerCase().trim();
    const fullName = e.entity_name;
    if (!name || !fullName) {
      return;
    }

    const tagSymbol = editIsUserBEntity(e) ? '@' : e.is_registered ? '@' : '#';
    const tag = `${tagSymbol}${fullName}`;
    const tagLower = tag.toLowerCase();
    const isUserA = e.role_in_conversation === 'User A' || (e.is_participant && e.participant_slot === 'A');
    const isUserB = e.role_in_conversation === 'User B' || (e.is_participant && e.participant_slot === 'B');
    const isMentioned = isUserA || isUserB || editMentionedTags.has(tag) || editMentionedTags.has(tagLower);

    if (!isUserA && !isUserB && !isMentioned) {
      return;
    }

    if (existingTags.has(tag) || existingTags.has(tagLower)) {
      return;
    }

    if (isUserA) {
      const patterns = [
        new RegExp(`\\bthe user\\b`, 'gi'),
        new RegExp(`\\buser a\\b`, 'gi'),
        new RegExp(`\\bthe person preparing\\b`, 'gi'),
        new RegExp(`\\bthe person writing\\b`, 'gi'),
        new RegExp(`\\b${escapeRegex(fullName)}\\b(?!\\s*(?:@|#|said|told|asked))`, 'gi'),
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
      return;
    }

    if (isUserB) {
      const escapedName = escapeRegex(fullName);
      const userBTag = `@${fullName}`;
      rawContent = rawContent.replace(new RegExp(`\\buser b\\b`, 'gi'), userBTag);
      rawContent = rawContent.replace(new RegExp(`\\bthe contact\\b`, 'gi'), userBTag);
      rawContent = rawContent.replace(new RegExp(`\\bthe recipient\\b`, 'gi'), userBTag);
      rawContent = rawContent.replace(new RegExp(`(?!__TAG_PROTECT|@|#)\\b${escapedName}\\b`, 'gi'), userBTag);
      rawContent = rawContent.replace(/\byourselves?\b/gi, userBTag);
      rawContent = rawContent.replace(/\byourself\b/gi, userBTag);
      rawContent = rawContent.replace(/\byour\b/gi, `${userBTag}'s`);
      rawContent = rawContent.replace(/\byou\b/gi, userBTag);
      return;
    }

    const escapedName = escapeRegex(fullName);
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
      rawContent = rawContent.replace(new RegExp(`\\bthey\\b(?!\\s*${escapedName})`, 'gi'), tag);
      rawContent = rawContent.replace(new RegExp(`\\bthem\\b(?!\\s*${escapedName})`, 'gi'), tag);
      rawContent = rawContent.replace(new RegExp(`\\btheir\\b(?!\\s*${escapedName})`, 'gi'), `${tag}'s`);
      rawContent = rawContent.replace(new RegExp(`\\btheirs\\b(?!\\s*${escapedName})`, 'gi'), `${tag}'s`);
      rawContent = rawContent.replace(new RegExp(`\\bthemselves\\b(?!\\s*${escapedName})`, 'gi'), tag);
    }

    rawContent = rawContent.replace(new RegExp(`(?!__TAG_PROTECT|@|#)\\b${escapedName}\\b(?!\\s*(?:__TAG_PROTECT|@|#))`, 'gi'), tag);
  });
  
  // Restore protected tags
  rawContent = rawContent.replace(/<<TAG_PROTECT_\d+>>|__TAG_PROTECT_\d+__/g, (placeholder: string) => {
    return tagProtectionMap[placeholder] ?? placeholder;
  });
  
  const editUserBTagLower = userBEntity?.entity_name
    ? `@${userBEntity.entity_name.toLowerCase()}`
    : null;
  rawContent = rawContent.replace(/(@[A-Za-z0-9_\-]+|#[A-Za-z0-9_\-]+)/g, (tag: string) => {
    const lower = tag.toLowerCase();
    if (
      editMentionedTags.has(tag) ||
      editMentionedTags.has(lower) ||
      (editUserBTagLower && lower === editUserBTagLower)
    ) {
      return tag;
    }
    return 'someone';
  });

  if (userAEntity?.entity_name) {
    const escapedUserA = escapeRegex(userAEntity.entity_name);
    rawContent = rawContent.replace(new RegExp(`@${escapedUserA}'s`, 'gi'), 'my');
    rawContent = rawContent.replace(new RegExp(`@${escapedUserA}`, 'gi'), 'I');
  }

  if (userBEntity?.entity_name) {
    const escapedUserB = escapeRegex(userBEntity.entity_name);
    rawContent = rawContent.replace(new RegExp(`\\byour\\b`, 'gi'), `@${userBEntity.entity_name}'s`);
    rawContent = rawContent.replace(new RegExp(`\\byou\\b`, 'gi'), `@${userBEntity.entity_name}`);
  }
  
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


  // Extract and clean summary text
  let summaryTextRaw = rawContent
    .split("💡 My Thoughts")[0]
    .replace("📌 Discussion Summary", "")
    .replace(/^📌\s*/, '')  // ✅ FIX: Remove emoji if at start
    .trim();

  // Clean up unwanted prefixes and formatting
  summaryTextRaw = cleanSummaryText(summaryTextRaw)
    .replace("📌 Discussion Summary", "")
    .replace(/^📌\s*/, '')  // ✅ FIX: Remove emoji if at start
    .replace(/📌/g, '')  // ✅ FIX: Remove any remaining emojis
    .replace(/^:\s*/, '')
    .replace(/::+/g, ':')
    .trim();

  let thoughtsTextRaw = rawContent.split("💡 My Thoughts")[1]?.trim() || "";
  let thoughtsTextRawCleaned = cleanSummaryText(thoughtsTextRaw)
    .replace("💡 My Thoughts", "")
    .replace(/^💡\s*/, '')  // ✅ FIX: Remove emoji if at start
    .replace(/💡/g, '')  // ✅ FIX: Remove any remaining emojis
    .replace(/^:\s*/, '')
    .replace(/::+/g, ':')
    .replace(/^I\s*:\s*/i, '')
    .trim();

  let summaryText = enforceSummaryConstraints(summaryTextRaw);
  let thoughtsText = enforceThoughtsConstraints(thoughtsTextRawCleaned);
  
  // Apply contact name deduplication
  if (userBEntity?.entity_name) {
    summaryText = deduplicateContactNames(summaryText, userBEntity.entity_name);
    thoughtsText = deduplicateContactNames(thoughtsText, userBEntity.entity_name);
  }
  
  // 🚫 NEVER allow empty thoughts - generate fallback if empty
  if (!thoughtsText || thoughtsText.trim().length === 0) {
    // Generate meaningful fallback based on summary
    const userBName = userBEntity?.entity_name || "them";
    const userBTag = userBEntity ? `@${userBName}` : "them";
    thoughtsText = `I want to approach ${userBTag} calmly and clear any misunderstanding so we can stay comfortable with each other.`;
  }
  
  // Ensure summary is never empty
  if (!summaryText || summaryText.trim().length === 0) {
    summaryText = "I shared my thoughts about the situation with the assistant.";
  }

  if (isUnclear && !hasAggregateClarity()) {
    setSummary(summaryText || "I shared my thoughts about the situation with the assistant.");
    setThoughts(
      thoughtsText || "I want to approach them calmly and clear any misunderstanding so we can stay comfortable with each other."
    );
    setIsSummaryUnclear(true);
    setFlowStage("summary");
    return;
  } else {
    setIsSummaryUnclear(false);
  }

  // ✅ CRITICAL: Set summary state with A-PERSPECTIVE ONLY (for Stage 3 UI)
  // summaryText from handleRegenerateSummary is already A-perspective (emotional, first-person)
  setSummary(summaryText);
  setThoughts(thoughtsText);

        // ✅ STORE A-PERSPECTIVE IN contextDataRef (summaryText is already A-perspective)
        // Note: handleRegenerateSummary should ideally use edge function for both summaries
        // For now, we use summaryText as A-perspective and create fallback neutral
        const fallbackNeutral = summaryText
          .replace(/^I\s+/gi, 'User A ')
          .replace(/\bmy\b/gi, 'their')
          .replace(/\bme\b/gi, 'them')
          .replace(/\bmyself\b/gi, 'themself')
          .replace(/\bI\b/gi, 'User A')
          .replace(/\bI'm\b/gi, 'User A is')
          .replace(/\bI've\b/gi, 'User A has')
          .replace(/\bI'd\b/gi, 'User A would');
        
        contextDataRef.current = {
          ...contextDataRef.current,
          summary: summaryText, // backward compatibility
          summary_a: summaryText, // backward compatibility
          summary_a_perspective: summaryText, // A-perspective (emotional, first-person)
          summary_shared_neutral: contextDataRef.current?.summary_shared_neutral || fallbackNeutral, // Keep existing or create fallback
        };

        setQAPairs(editedQAPairs);

        setTimeout(() => {
          setSummaryJustRegenerated(false);
        }, 500);

        await updateChatRecord(
          {},
          {
            summary: summaryText, // A-perspective (backward compatibility)
            summary_a_perspective: summaryText, // ✅ A-perspective summary (emotional, first-person)
            summary_shared_neutral: contextDataRef.current?.summary_shared_neutral || fallbackNeutral, // ✅ Neutral shared summary
            thoughts: thoughtsText,
            thoughts_a: thoughtsText,
            qa_pairs: editedQAPairs,
            initial_description: initialDescription,
            initial_description_tags: taggedEntities,
            additional_info: additionalInfo,
            additional_info_tags: additionalInfoTags,
            flowStage: 'summary',
            questionCount: editedQAPairs.length,
            taggedEntities: [...taggedEntities, ...additionalInfoTags],
          }
        );
        
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
    // Directly call handleReadyToChat instead of moving to Stage 4
    handleReadyToChat();
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
    // ✅ REMOVED: isReadyStage check since we're removing Stage 4
    if (!user || !currentChatId || !contactIdValue || initializing) {
      console.log('⚠️ Cannot send to contact yet - data still loading:', {
        hasUser: !!user,
        hasChatId: !!currentChatId,
        hasContactId: !!contactIdValue,
        isInitializing: initializing
      });
      return;
    }

    setLoading(true);
    scrollToEnd();
    try {
      const { data: contactData } = await supabase
        .from("contacts")
        .select("category")
        .eq("user_id", user.id)
        .eq("contact_id", contactIdValue)
        .maybeSingle();

      const contactCategory = contactData?.category || "General";
      const contactName = contact?.full_name || contact?.email || "Contact";

      // ✅ FIX: Get User A's name (the sender) instead of contact name (User B)
      const userADisplayName = 
        (user?.user_metadata as any)?.full_name ||
        user?.email?.split("@")[0] ||
        "Someone";

      // ✅ REMOVED: Limit check from handleReadyToChat
      // Reason: Limit check already happens in contact-selection.tsx when creating NEW chat
      // handleReadyToChat is for continuing/navigating to existing chat, not creating new one
      // Once chat exists and is active, no limit check should run
      // This prevents unwanted "Take a pause" notification during active chats

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
        full_text: `${userADisplayName} wants to chat`,
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
              ? `${userADisplayName} wants to talk about **${parsed.issue}** ${parsed.timeline}`
              : `${userADisplayName} wants to talk about **${parsed.issue}**`,
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
          sent_to_contact: false, // ✅ Explicitly keep as false - will be set to true when first message is sent
          chat_title: normalizedTitle,
        }
      );

      // Always create a fresh contact chat for a clean session (no history reuse)
      let contactChatId: string | undefined;
      let reusedContactChat = false;

      if (currentChatId && contactIdValue) {
        const { data: existingChat, error: existingChatError } = await supabase
          .from("chats")
          .select("id, context_data")
          .eq("user_id", user.id)
          .eq("contact_id", contactIdValue)
          .eq("chat_type", "contact_chat")
          .eq("ai_source_chat_id", currentChatId)
          .eq("is_resolved", false)
          .order("created_at", { ascending: false })
          .maybeSingle();

        if (existingChatError) {
          console.warn("⚠️ Failed checking for existing contact chat:", existingChatError);
        }

        // ✅ REUSE existing chat if it exists (from early creation or previous attempt)
        if (existingChat?.id && existingChat.context_data?.initial_pending) {
          contactChatId = existingChat.id;
          reusedContactChat = true;
          console.log("✅ Reusing existing contact chat (may have pregenerated turns from early creation):", contactChatId);
          
          // ✅ Get both summaries from contextDataRef (set by generateSummary)
          const summaryAPerspective = contextDataRef.current?.summary_a_perspective || summary;
          // ✅ CRITICAL: Never use 'summary' state as fallback for summarySharedNeutral
          // 'summary' state should ALWAYS be A-perspective (emotional, first-person)
          // If neutral summary is missing, create it from A-perspective (convert to third-person)
          let summarySharedNeutral = contextDataRef.current?.summary_shared_neutral || existingChat.context_data?.summary_shared_neutral;
          if (!summarySharedNeutral && summaryAPerspective) {
            // Convert A-perspective to neutral (third-person)
            summarySharedNeutral = summaryAPerspective
              .replace(/^I\s+/gi, 'User A ')
              .replace(/\bmy\b/gi, 'their')
              .replace(/\bme\b/gi, 'them')
              .replace(/\bmyself\b/gi, 'themself')
              .replace(/\bI\b/gi, 'User A')
              .replace(/\bI'm\b/gi, 'User A is')
              .replace(/\bI've\b/gi, 'User A has')
              .replace(/\bI'd\b/gi, 'User A would');
          }
          const updatedContext = {
            ...(existingChat.context_data ?? {}),
            summary_a: summaryAPerspective,  // backward compatibility
            summary_a_perspective: summaryAPerspective,  // A-perspective summary (emotional, first-person)
            summary_shared_neutral: summarySharedNeutral,  // ✅ Neutral shared summary (factual, third-person)
            thoughts_a: thoughts,
            hint_to_contact: hintToContact,
            contact_category: contactCategory,
            initial_pending: true,
            chat_title: normalizedTitle,
          };

          await supabase
            .from("chats")
            .update({
              title: normalizedTitle,
              ai_confidence_level: "high",
              conversation_phase: "opening",
              turn_count_a: 0,
              turn_count_b: 0,
              resolution_detected: false,
              context_data: updatedContext,
              last_message: null,
              last_message_at: new Date().toISOString(),
            })
            .eq("id", contactChatId);
        }
      }

      if (!contactChatId) {
        // ✅ Get both summaries from contextDataRef (set by generateSummary)
        const summaryAPerspective = contextDataRef.current?.summary_a_perspective || summary;
        // ✅ CRITICAL: Never use 'summary' state as fallback for summarySharedNeutral
        // 'summary' state should ALWAYS be A-perspective (emotional, first-person)
        // If neutral summary is missing, create it from A-perspective (convert to third-person)
        let summarySharedNeutral = contextDataRef.current?.summary_shared_neutral;
        if (!summarySharedNeutral && summaryAPerspective) {
          // Convert A-perspective to neutral (third-person)
          summarySharedNeutral = summaryAPerspective
            .replace(/^I\s+/gi, 'User A ')
            .replace(/\bmy\b/gi, 'their')
            .replace(/\bme\b/gi, 'them')
            .replace(/\bmyself\b/gi, 'themself')
            .replace(/\bI\b/gi, 'User A')
            .replace(/\bI'm\b/gi, 'User A is')
            .replace(/\bI've\b/gi, 'User A has')
            .replace(/\bI'd\b/gi, 'User A would');
        }
        const { data: newChat, error: newChatError } = await supabase
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
              summary_a: summaryAPerspective,  // backward compatibility
              summary_a_perspective: summaryAPerspective,  // ✅ A-perspective summary (emotional, first-person)
              summary_shared_neutral: summarySharedNeutral,  // ✅ Neutral shared summary (factual, third-person)
              thoughts_a: thoughts,
              hint_to_contact: hintToContact,
              contact_category: contactCategory,
              initial_pending: true,
              chat_title: normalizedTitle,
            },
          })
          .select("id")
          .single();
        
        if (newChatError) {
          console.error("❌ Failed to create contact chat:", newChatError);
          throw new Error(`Failed to create contact chat: ${newChatError.message}`);
        }
        
        if (!newChat?.id) {
          console.error("❌ Contact chat created but no ID returned");
          throw new Error("Failed to create contact chat: No ID returned");
        }
        
        contactChatId = newChat.id;
      } else if (reusedContactChat) {
        // Clean up any previously generated options so we don't surface stale choices
        const { error: deleteOptionsError } = await supabase
          .from("message_options")
          .delete()
          .eq("chat_id", contactChatId);
        if (deleteOptionsError) {
          console.warn("⚠️ Failed to clear previous message options:", deleteOptionsError);
        }
      }

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
 
        if (contactChatId) {
          const { data: existingAutoNote, error: existingAutoNoteError } = await supabase
            .from('soulroom_entries')
            .select('id')
            .eq('user_id', user.id)
            .contains('tags', ['post_conversation', `chat:${contactChatId}`])
            .maybeSingle();

          if (existingAutoNoteError) {
            console.warn('⚠️ Failed to check for existing post-conversation note:', existingAutoNoteError);
          }

          const payload = {
            user_id: user.id,
            title: 'Post-conversation note',
            content: reflectionLines.join('\n\n') || 'Processing what I want to share.',
            mood: moodPrefill,
            tags,
            ai_summary: null,
            emotion_tag: null,
          };

          if (existingAutoNote?.id) {
            await supabase
              .from('soulroom_entries')
              .update({
                title: payload.title,
                content: payload.content,
                mood: payload.mood,
                tags: payload.tags,
                ai_summary: null,
                emotion_tag: null,
              })
              .eq('id', existingAutoNote.id);
          } else {
            await supabase.from('soulroom_entries').insert(payload);
          }
        }
      } catch (soulLogError) {
        console.warn('⚠️ Failed to create Soulroom auto note:', soulLogError);
      }

      // ✅ Validate contactChatId before proceeding
      if (!contactChatId) {
        console.error("❌ contactChatId is undefined, cannot proceed");
        throw new Error("Failed to create contact chat. Please try again.");
      }

      // ✅ Validate contactIdValue before proceeding
      if (!contactIdValue) {
        console.error("❌ contactIdValue is undefined, cannot proceed");
        throw new Error("Contact ID is missing. Please try again.");
      }

      await supabase
        .from("chats")
        .update({ conversation_phase: "discussion" })
        .eq("id", contactChatId);

      // ✅ CRITICAL: Wait for early pregeneration to complete before checking
      // Add a delay and retry mechanism to ensure pregenerated turns are stored
      // Early pregeneration takes 1-2 seconds, so we wait up to 3 seconds
      let pregenCheckAttempts = 0;
      const maxPregenCheckAttempts = 10; // Check up to 3 seconds (10 * 300ms)
      let existingPregens = null;

      console.log("🔍 Waiting for early pregeneration to complete before checking...");
      while (pregenCheckAttempts < maxPregenCheckAttempts) {
        const { data: checkPregens } = await supabase
          .from("pregenerated_turns")
          .select("id, turn_number, recipient_id")
          .eq("chat_id", contactChatId)
          .eq("recipient_id", user.id) // ✅ Check for User A's turns specifically (turn 0)
          .is("selected_message", null)
          .limit(1);

        if (checkPregens && checkPregens.length > 0) {
          existingPregens = checkPregens;
          console.log(`✅ Pregenerated turns found after ${pregenCheckAttempts * 300}ms - skipping generate-contextual-options`);
          break;
        }

        // Wait 300ms before retrying (early pregeneration takes 1-2 seconds)
        await new Promise(resolve => setTimeout(resolve, 300));
        pregenCheckAttempts++;
      }

      if (existingPregens && existingPregens.length > 0) {
        console.log("✅ Pregenerated turns already exist (from early creation) - skipping generate-contextual-options and pregeneration");
        console.log("✅ User A will see options immediately from pregenerated_turns table");
        // ✅ Skip generate-contextual-options entirely - pregenerated turns will be used
      } else {
        // ✅ Only call generate-contextual-options if pregenerated turns don't exist after waiting (fallback only)
        console.log("⚠️ No pregenerated turns found after waiting - using generate-contextual-options as fallback");
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

        // ✅ Only trigger pregeneration if it wasn't done early
        // ✅ FIX: Check if ANY pregenerated turns exist - if so, skip fallback pregeneration
        const { data: existingTurnsCheck } = await supabase
          .from("pregenerated_turns")
          .select("turn_number")
          .eq("chat_id", contactChatId)
          .limit(1);
        
        if (existingTurnsCheck && existingTurnsCheck.length > 0) {
          console.log("⏸️ Pregenerated turns already exist - skipping fallback pregeneration");
        } else {
          console.log("⚡ Triggering pre-generation before navigation (fallback scenario)...");
          try {
            const { data: pregenData, error: pregenError } = await supabase.functions.invoke(
              "generate-pregenerated-turns",
              {
                body: { chatId: contactChatId }
              }
            );
            if (pregenError) {
              console.warn("⚠️ Pre-generation failed before navigation (non-critical):", pregenError);
            } else {
              console.log("✅ Pre-generation triggered successfully before navigation");
              console.log("✅ Pre-generation response:", JSON.stringify(pregenData, null, 2));
            }
          } catch (err) {
            console.warn("⚠️ Error triggering pre-generation before navigation (non-critical):", err instanceof Error ? err.message : String(err));
          }
        }
      }

      router.push(
        `/contact-chat?chatId=${contactChatId}&contactId=${contactIdValue}&isOngoing=true`
      );
      
      // ✅ FIX: Reset loading after navigation starts (navigation might be interrupted by swipe back)
      // Use a timeout to reset loading if user swipes back before navigation completes
      setTimeout(() => {
        // Check if we're still on this screen (navigation might have been interrupted)
        // If fromContactChat becomes true, navigation succeeded
        // If it's still false after timeout, user might have swiped back
        // Note: We can't directly check route here, but the useEffect hooks above will handle reset
        // This is a safety net in case the useEffect doesn't catch it
        if (loading) {
          console.log('🔄 Navigation completed or interrupted - ensuring loading state is handled');
          // The useEffect hooks will handle the actual reset based on fromContactChatValue
        }
      }, 1000);
      
    } catch (err: any) {
      console.error("❌ Error in handleReadyToChat:", err);
      const errorMessage = err?.message || "Failed to start contact chat. Please try again.";
      Alert.alert("Error", errorMessage);
      setLoading(false);
    }
  };

  const renderWelcomeStage = () => (
    <View style={styles.stageContainer}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.stageScroll}
        contentContainerStyle={styles.stageContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSection}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.stageIcon}>🎬</Text>
            <OutlineText style={styles.stageTitle} outlineStyle={styles.outlineLayer}>Stage 1 – Set the Scene</OutlineText>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Chat title</Text>
          <TextInput
            style={styles.titleInput}
            value={chatTitle}
            onChangeText={setChatTitle}
            placeholder="Give this chat a short title (e.g. Weekend mix-up reset)"
            placeholderTextColor={Colors.secondary[400]}
            maxLength={25}
            autoCapitalize="sentences"
            returnKeyType="done"
          />
          <View style={styles.contactLabelRow}>
            <Text style={styles.contactLabel}>Contact</Text>
            <Text style={styles.contactValue}>
              {contact?.full_name || contact?.email || 'Unknown'}
            </Text>
          </View>
        </View>

        <View style={styles.descriptionWrapper}>
          <View style={styles.placeholderHintWrapper}>
            {!initialDescription && (
              <>
                <Text style={styles.placeholderHintLine1}>Use @ to mention contact to chat with</Text>
                <Text style={styles.placeholderHintLine2}>Use # to mention third persons/events</Text>
              </>
            )}
          </View>
          <TextInput
            style={styles.descriptionInput}
            value={initialDescription}
            onChangeText={(text) => {
              const tokensUsed = Math.round(text.trim().split(/\s+/).length * 1.5);
              if (tokensUsed <= 150) {
                handleDescriptionChange(text);
              }
            }}
            onSelectionChange={(event) => {
              setDescriptionCursorPos(event.nativeEvent.selection.start);
            }}
            placeholder=""
            placeholderTextColor={Colors.text.primary}
            multiline
            maxLength={800}
          />

          {hashTagWarning && (
            <Text style={styles.hashTagWarningText}>{hashTagWarning}</Text>
          )}

          {showPronounDropdown && (
            <View style={styles.tagDropdownContainer}>
              <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled>
                <Text style={styles.tagDropdownHeader}>Select Pronouns</Text>
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

          {showTagDropdown === '@' && contactSuggestions.length > 0 && (
            <View style={styles.tagDropdownContainer}>
              <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled>
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

          {showTagDropdown === '#' && hashSuggestions.length > 0 && (
            <View style={styles.tagDropdownContainer}>
              <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled>
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

        <View style={styles.helperSummary}>
          <Text
            style={[
              styles.tokenCounter,
              Math.max(0, 150 - Math.round(initialDescription.trim().split(/\s+/).length * 1.5)) === 0
                ? { color: Colors.error[600] }
                : { color: Colors.success[600] },
            ]}
          >
            {Math.max(0, 150 - Math.round(initialDescription.trim().split(/\s+/).length * 1.5))} tokens to play with ✨
          </Text>

          {initialDescription.trim().split(/\s+/).length > 100 && (
            <Text style={styles.helperHint}>
              {initialDescription.trim().split(/\s+/).length > 100
                ? "Let's keep it breezy ❤️"
                : "Short & sweet keeps the vibe 💛"}
            </Text>
          )}
        </View>
      </ScrollView>

      <View style={styles.stageFooter}>
        <View style={styles.buttonColumn}>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfButton]}
              onPress={handleSaveAndExit}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>Save & Exit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfButton]}
              onPress={() => router.push('/(tabs)/chats')}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>

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
    </View>
  );


  const renderQAStage = () => (
    <View style={styles.stageContainer}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.stageScroll}
        contentContainerStyle={styles.stageContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSection}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.stageIcon}>🎨</Text>
            <OutlineText style={styles.stageTitle} outlineStyle={styles.outlineLayer}>Stage 2 - Add the Details</OutlineText>
          </View>
        </View>

        {qaPairs.map((pair, index) => (
          <View key={index} style={styles.qaCardVertical}>
            <View style={styles.questionSection}>
              <View style={styles.questionHeader}>
                <View style={styles.questionHeaderLeft}>
                  <Text style={styles.questionLabel}>Q{index + 1}</Text>
                  <Text style={styles.questionText}>{pair.question}</Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeleteQAPair(index)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Trash2 size={18} color={Colors.error[600]} />
                </TouchableOpacity>
              </View>
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
          const newText = finalizedContactMention(
            pair.answer,
                            typingTag.startPos,
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
                          const normalizedTag = tag.toLowerCase().trim();
                          const cachedPronoun = entityRegistryCache[normalizedTag]?.preferred_pronouns ?? null;

                          const contacts = availableContacts.map(c => ({
                            id: c.id,
                            name: c.full_name || c.email,
                          }));
                          const entities = parseTaggedEntities(newText, contacts);

                          if (cachedPronoun) {
                            const entity = createStructuredTaggedEntity(
                              `#${tag}`,
                              tag,
                              'unregistered',
                              undefined,
                              cachedPronoun
                            );

                            const existingIndex = entities.findIndex(e => e.tag === entity.tag);
                            if (existingIndex >= 0) {
                              entities[existingIndex] = entity;
                            } else {
                              entities.push(entity);
                            }

                            setTaggedEntities(entities);
                            setShowPronounDropdown(null);
                            setPronounSelectionContext(null);
                            void saveUserHashtag(tag);
                          } else {
                            // Don't trigger prompt here - let triggerHashPronounPrompt handle it when tag is completed
                            setTaggedEntities(entities);
                            // Check if tag is completed (has space/punctuation after it) - if so, triggerHashPronounPrompt will show prompt
                            triggerHashPronounPrompt({ stage: 'editAnswer', text: newText, entities, index });
                          }

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
                placeholderTextColor={Colors.text.primary}
              />

              <View style={styles.answerActions}>
                <View style={{ flex: 1 }}>
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
                
                {/* Save/Check Button */}
                {pair.answer?.trim() ? (
                  pair.saved ? (
                    <View style={styles.savedIndicator}>
                      <Check size={20} color={Colors.success[600]} />
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.saveButton}
                      onPress={() => handleSaveAnswer(index)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={styles.saveButtonText}>Save</Text>
                    </TouchableOpacity>
                  )
                ) : null}
              </View>

            </View>
          </View>
        ))}

        {isGeneratingSummary ? (
          <View style={styles.generatingContainer}>
            <Text style={styles.generatingText}>Piecing things together…</Text>
            <ActivityIndicator size="small" color={Colors.primary[600]} style={styles.generatingLoader} />
          </View>
        ) : currentQuestion ? (
          <View style={styles.qaCardVertical}>
            <View style={styles.questionSection}>
              <View style={styles.questionHeaderLeft}>
                <Text style={styles.questionLabel}>Q{qaPairs.length + 1}</Text>
                <Text style={styles.questionText}>{currentQuestion}</Text>
              </View>
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
    const words = text.trim().split(/\s+/);
    const tokensUsed = Math.round(words.length * (20/15));
    if (tokensUsed > 20) {
      const maxWords = Math.floor(20 / (20/15));
      handleCurrentAnswerChange(words.slice(0, maxWords).join(' '), false);
    } else {
      handleCurrentAnswerChange(text, false);
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

                  <View style={styles.answerActions}>
                    <View style={{ flex: 1 }}>
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
                    </View>
                    
                    {/* Save/Check Button for Current Answer */}
                    {currentAnswer?.trim() ? (
                      currentAnswerSaved ? (
                        <View style={styles.savedIndicator}>
                          <Check size={20} color={Colors.success[600]} />
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.saveButton}
                          onPress={() => handleSaveCurrentAnswer()}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Text style={styles.saveButtonText}>Save</Text>
                        </TouchableOpacity>
                      )
                    ) : null}
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

      <View style={styles.stageFooter}>
        <View style={styles.buttonColumn}>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfButton]}
              onPress={handleSaveAndExit}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>Save & Exit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfButton]}
              onPress={() => router.push('/(tabs)/chats')}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfButton]}
              onPress={() => {
                // ✅ Track original values when navigating from Stage 3 to Stage 1
                setOriginalInitialDescriptionForStage1(initialDescription);
                setOriginalQAPairsForStage2(qaPairs);
                setFlowStage("welcome");
              }}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>Stage 1</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, styles.halfButton]}
              onPress={() => {
                // Show the notice as soon as the SECOND answer is being submitted.
                // At this point, qaPairs contains answers already saved.
                // When the user is on Q2, qaPairs.length === 1 before submitting the current answer.
                // So trigger the notice when length >= 1 (i.e., about to become 2).
                if (qaPairs.length >= 1) {
                  setShowSummaryNoticeModal(true);
                } else {
                  handleAnswerSubmit();
                }
              }}
              disabled={loading || isGeneratingSummary}
            >
              <Text style={styles.secondaryButtonText}>Next prompt</Text>
            </TouchableOpacity>
          </View>

          {/* Generate Summary button – disabled until at least 2 questions */}
          <TouchableOpacity
            style={[
              styles.fullWidthButton,
              styles.primaryButton,
              (loading || qaPairs.length < 2 || isGeneratingSummary) && styles.primaryButtonDisabled,
            ]}
            onPress={async () => {
              if (qaPairs.length < 2) {
                Alert.alert(
                  "Need one more beat 💬",
                  "Add at least two answers before I spin up your recap."
                );
                return;
              }
              setIsGeneratingSummary(true);
              setCurrentQuestion("");
              scrollToEnd();
              await generateSummary(qaPairs);
            }}
            disabled={loading || qaPairs.length < 2 || isGeneratingSummary}
          >
            <Text style={styles.primaryButtonText}>Generate Summary</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderSummaryStage = () => {
    // ✅ CRITICAL: ALWAYS use summary_a_perspective for Stage 3 UI (emotional, first-person, User A talking to AI)
    // This is the summary from User A's perspective talking to the AI assistant about their issue
    // NEVER use summary_shared_neutral here - that's only for chat option generation
    
    // ✅ LOG what's available before determining summary
    console.log('🎯 Stage 3 - Checking summaries:', {
      contextDataHasAPerspective: !!contextDataRef.current?.summary_a_perspective,
      contextDataHasSharedNeutral: !!contextDataRef.current?.summary_shared_neutral,
      summaryStateLength: summary?.length || 0,
      summaryStatePreview: summary?.substring(0, 100) || 'EMPTY',
      summaryAPerspectivePreview: contextDataRef.current?.summary_a_perspective?.substring(0, 100) || 'MISSING',
      summarySharedNeutralPreview: contextDataRef.current?.summary_shared_neutral?.substring(0, 100) || 'MISSING',
    });
    
    // ✅ CRITICAL: ONLY use summary_a_perspective - NO fallback chain
    // ❌ NEVER fallback to summary_a or summary - they may contain neutral summary
    // ❌ NEVER use summary_shared_neutral for Stage 3
    let summaryForDisplay = contextDataRef.current?.summary_a_perspective || '';
    
    // ✅ FALLBACK: Only use summary state if summary_a_perspective is missing
    // This should only happen if contextDataRef wasn't set properly
    if (!summaryForDisplay && summary) {
      // ✅ VALIDATE: Ensure summary state is NOT the neutral summary
      if (contextDataRef.current?.summary_shared_neutral && 
          contextDataRef.current.summary_shared_neutral === summary) {
        console.error('❌ ERROR: summary state equals summary_shared_neutral! This should NEVER happen.');
        summaryForDisplay = ''; // Force fallback
      } else {
        console.warn('⚠️ Warning: Using summary state as fallback (summary_a_perspective missing from contextDataRef)');
        summaryForDisplay = summary;
        // Update contextDataRef to ensure consistency
        contextDataRef.current = {
          ...contextDataRef.current,
          summary_a_perspective: summary,
        };
      }
    }
    
    // ✅ FINAL FALLBACK: Create A-perspective fallback if still empty
    if (!summaryForDisplay || summaryForDisplay.trim().length === 0) {
      console.error('❌ ERROR: summaryForDisplay is empty in Stage 3! Using A-perspective fallback.');
      // Fallback: Create A-perspective fallback (emotional, first-person, talking to AI)
      const fallbackAPerspective = "I shared my thoughts about the situation with the assistant.";
      summaryForDisplay = fallbackAPerspective;
      // Update contextDataRef and state
      contextDataRef.current = {
        ...contextDataRef.current,
        summary_a_perspective: fallbackAPerspective,
      };
      setSummary(fallbackAPerspective);
    }
    
    // ✅ CRITICAL FINAL CHECK: Ensure finalSummaryForDisplay is NOT the neutral summary
    let finalSummaryForDisplay = summaryForDisplay;
    if (contextDataRef.current?.summary_shared_neutral && 
        contextDataRef.current.summary_shared_neutral === finalSummaryForDisplay) {
      console.error('❌ CRITICAL ERROR: finalSummaryForDisplay equals summary_shared_neutral!');
      console.error('This means Stage 3 is about to display the neutral summary instead of A-perspective!');
      console.error('Forcing A-perspective fallback...');
      // Force A-perspective fallback
      finalSummaryForDisplay = "I shared my thoughts about the situation with the assistant.";
      // Update contextDataRef and state
      contextDataRef.current = {
        ...contextDataRef.current,
        summary_a_perspective: finalSummaryForDisplay,
      };
      setSummary(finalSummaryForDisplay);
    }
    
    // ✅ LOG FINAL SUMMARY FOR DEBUGGING
    console.log('🎯 Stage 3 final summary:', {
      finalSummaryForDisplayLength: finalSummaryForDisplay.length,
      finalSummaryForDisplayPreview: finalSummaryForDisplay.substring(0, 100),
      isAPerspective: contextDataRef.current?.summary_a_perspective === finalSummaryForDisplay,
      isNeutral: contextDataRef.current?.summary_shared_neutral === finalSummaryForDisplay,
      contextDataHasAPerspective: !!contextDataRef.current?.summary_a_perspective,
      contextDataHasSharedNeutral: !!contextDataRef.current?.summary_shared_neutral,
    });

    const quickTipContent = isSummaryUnclear ? (
      <View style={styles.quickTipBox}>
        <Text style={styles.quickTipTitle}>Let's tighten a couple things</Text>
        <Text style={styles.quickTipText}>
          A few bits still feel fuzzy—tweak these spots:
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
        <Text style={styles.quickTipHint}>Polish the pieces above, then tap Regenerate Summary.</Text>
      </View>
    ) : null;
  
    const summaryCardContent = (
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>📌 Discussion Summary</Text>
        {/* ✅ CRITICAL: This is ALWAYS summary_a_perspective (emotional, first-person, User A talking to AI) */}
        <Text style={styles.summaryTextWithSpacing}>{finalSummaryForDisplay}</Text>
  
        <Text style={styles.summaryLabel}>💡 My Thoughts</Text>
        <Text style={styles.summaryText}>{thoughts}</Text>
      </View>
    );
  
    const unclearActions = (
      <>
        <Text style={styles.warningText}>
          ⚠️ I need a clearer purpose before we jump to Launch Time.
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
                <Text style={styles.secondaryButtonText}>Revisit answers</Text>
              </TouchableOpacity>
            ) : null;
          })()}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/ai-assistant')}
          >
            <Text style={styles.secondaryButtonText}>Save for later</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  
    const editModeActions = (
      <View style={styles.buttonColumn}>
        <TouchableOpacity
          style={[styles.fullWidthButton, styles.secondaryButton]}
          onPress={handleSaveAndExit}
          disabled={loading}
        >
          <Text style={styles.secondaryButtonText}>Save & Exit</Text>
        </TouchableOpacity>
  
        <TouchableOpacity
          style={[styles.fullWidthButton, styles.secondaryButton]}
          onPress={() => {
            Alert.alert(
              "Cancel without saving?",
              "Your changes will be lost.",
              [
                {
                  text: "Stay",
                  style: "cancel"
                },
                {
                  text: "Cancel",
                  style: "destructive",
                  onPress: () => {
                    router.push('/(tabs)/chats');
                  }
                }
              ]
            );
          }}
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
    );
  
    const editModeContent = (
      <View style={styles.editModeContainer}>
        <ScrollView
          ref={editScrollViewRef}
          style={styles.editScrollView}
          contentContainerStyle={styles.editScrollViewContent}
        >
          {editedQAPairs.map((pair, index) => (
            <View key={index} style={styles.editQACard}>
              <View style={styles.questionSection}>
                <View style={styles.questionHeaderLeft}>
                  <Text style={styles.questionLabel}>Q{index + 1}</Text>
                  <Text style={styles.editQuestionText}>{pair.question}</Text>
                </View>
              </View>
  
              {editModeAnswerIndex === index && editModeContactSuggestions.length > 0 && (
                <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled>
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
                          const newText = finalizedContactMention(
                            pair.answer,
                            typingTag.startPos,
                            contact.full_name || contact.email
                          );
                          const updated = [...editedQAPairs];
                          updated[index].answer = newText;
                          setEditedQAPairs(updated);
                          setEditModeContactSuggestions([]);
                          setShowPronounDropdown('@');
                          setPronounSelectionContext({ stage: 'editAnswer', pendingContact: contact, index });
                          setEditModeAnswerIndex(null);
                        }
                      }}
                    >
                      <View style={[styles.tagIndicator, { backgroundColor: Colors.primary[100] }] }>
                        <AtSign size={12} color={Colors.primary[600]} />
                      </View>
                      <Text style={styles.tagName}>{contact.full_name || contact.email}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
  
              {editModeAnswerIndex === index && editModeHashSuggestions.length > 0 && (
                <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled>
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
  
              <View style={styles.answerSection}>
                <TextInput
                  style={styles.editAnswerInput}
                  value={pair.answer}
                  onChangeText={(text) => handleEditAnswerWithTags(index, text)}
                  onSelectionChange={(event) => {
                    setEditModeCursorPos({...editModeCursorPos, [index]: event.nativeEvent.selection.start });
                  }}
                  multiline
                  placeholder="Use @ or # to tag someone."
                  placeholderTextColor={Colors.text.primary}
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
  
          <View style={styles.additionalInfoSection}>
            <Text style={styles.additionalInfoLabel}>
              Add more info
            </Text>
  
            {showPronounDropdown && pronounSelectionContext?.stage === 'additionalInfo' && (
              <View style={styles.tagDropdownContainer}>
                <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled>
                  <Text style={styles.tagDropdownHeader}>Select Pronouns</Text>
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
  
            {showAdditionalInfoTagDropdown === '@' && additionalInfoContactSuggestions.length > 0 && (
              <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled>
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
  
            {showAdditionalInfoTagDropdown === '#' && additionalInfoHashSuggestions.length > 0 && (
              <ScrollView style={styles.tagDropdownScroll} nestedScrollEnabled>
                <Text style={styles.tagDropdownHeader}>
                  <Hash size={12} color={Colors.warning[600]} /> People/Groups (not in app)
                </Text>
                {additionalInfoHashSuggestions.map((tag, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.tagItem}
                    onPress={() => handleAdditionalInfoHashTagSelect(tag)}
                  >
                    <View style={[styles.tagIndicator, { backgroundColor: Colors.warning[100] }] }>
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
                const words = text.trim().split(/\s+/);
                const tokensUsed = Math.round(words.length * (20/15));
                if (tokensUsed > 20) {
                  const maxWords = Math.floor(20 / (20/15));
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
        <View style={styles.stageFooter}>
          {editModeActions}
        </View>
      </View>
    );
  
    const defaultActions = (
      <View style={styles.buttonColumn}>
        {/* Primary action - Send to contact */}
        <TouchableOpacity
          style={[
            styles.fullWidthButton,
            styles.primaryButton,
            (loading || initializing) && styles.primaryButtonDisabled,
          ]}
          onPress={handleReadyToChat}
          disabled={loading || initializing || !currentChatId}
        >
          {loading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.primaryButtonText}>Sending...</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>Send to contact</Text>
          )}
        </TouchableOpacity>

        {/* Secondary actions - grouped in rows */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.secondaryButton, styles.halfButton]}
            onPress={handleAddExtraInfo}
            disabled={loading || initializing}
          >
            <Plus size={16} color={Colors.primary[600]} />
            <Text style={styles.secondaryButtonText}>Add context</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, styles.halfButton]}
            onPress={() => {
              // ✅ Track original values when navigating from Stage 3 to Stage 1
              setOriginalInitialDescriptionForStage1(initialDescription);
              setOriginalQAPairsForStage2(qaPairs);
              setFlowStage("welcome");
            }}
            disabled={loading || initializing}
          >
            <Text style={styles.secondaryButtonText}>Stage 1</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.secondaryButton, styles.halfButton]}
            onPress={handleSaveAndExit}
            disabled={loading || initializing}
          >
            <Text style={styles.secondaryButtonText}>Save & Exit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, styles.halfButton]}
            onPress={() => router.push('/(tabs)/chats')}
            disabled={loading || initializing}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  
    return (
      <View style={styles.stageContainer}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.stageScroll}
          contentContainerStyle={styles.stageContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerSection}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.stageIcon}>🧩</Text>
              <OutlineText style={styles.stageTitle} outlineStyle={styles.outlineLayer}>Stage 3 - Your Recap</OutlineText>
            </View>
          </View>

          {quickTipContent}
          {summaryCardContent}
  
          {showEditMode && editModeContent}
        </ScrollView>

        {!showEditMode && (
          <View style={styles.stageFooter}>
            {isSummaryUnclear ? unclearActions : defaultActions}
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      <KeyboardSafeView style={styles.container} contentStyle={styles.content} edges={['top', 'left', 'right']}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scrollContent, { paddingTop: Spacing.md }]}
        >
          {flowStage === "welcome" && renderWelcomeStage()}
          {flowStage === "qa" && renderQAStage()}
          {flowStage === "summary" && renderSummaryStage()}
        </ScrollView>
      </KeyboardSafeView>

      {/* Beautiful Summary Notice Modal */}
      <Modal
        visible={showSummaryNoticeModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSummaryNoticeModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSummaryNoticeModal(false)}
        >
          <TouchableOpacity
            style={styles.modalContent}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <Sparkles size={20} color={Colors.primary[600]} />
              <Text style={styles.modalTitle}>Feeling good? ✨</Text>
            </View>
            
            <Text style={styles.modalMessage}>
              If you feel good, click Generate Summary.
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary]}
                onPress={async () => {
                  setShowSummaryNoticeModal(false);
                  if (qaPairs.length < 2) {
                    Alert.alert(
                      "Need one more beat 💬",
                      "Add at least two answers before I spin up your recap."
                    );
                    return;
                  }
                  setIsGeneratingSummary(true);
                  setCurrentQuestion("");
                  scrollToEnd();
                  await generateSummary(qaPairs);
                }}
              >
                <Sparkles size={16} color="#fff" />
                <Text style={styles.modalButtonPrimaryText}>Generate Summary</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={async () => {
                  setShowSummaryNoticeModal(false);
                  await handleAnswerSubmit();
                }}
              >
                <Text style={styles.modalButtonSecondaryText}>See another prompt</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setShowSummaryNoticeModal(false)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
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
  stageScroll: {
    flex: 1,
  },
  stageContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  stageFooter: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.background,
  },
  stageHeaderInset: {
    paddingHorizontal: Spacing.lg,
  },
  stageBodyInset: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  headerSection: {
    alignItems: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  stageIcon: {
    fontSize: 24,
  },
  stageTitle: {
    fontSize: Typography.fontSize.xl,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.primary[500], // Bright yellow (#FFEB3B)
    textAlign: "center",
    letterSpacing: 0.3,
  },
  outlineLayer: {
    color: "#013a63", // Dark blue outline
    position: 'absolute',
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
  borderWidth: 2,
  borderColor: Colors.primary[400],
  borderRadius: BorderRadius.lg,
  padding: Spacing.md,
  fontSize: Typography.fontSize.xs,
  fontWeight: Typography.fontWeight.normal,
  backgroundColor: Colors.secondary[50],
  minHeight: 140,
  textAlignVertical: "top",
  marginTop: Spacing.xs,
  color: Colors.text.primary,
  ...Shadows.small,
},
  hashTagWarningText: {
    color: Colors.error[600],
    fontSize: Typography.fontSize.xs,
    marginTop: Spacing.xs,
    marginLeft: Spacing.sm,
    fontWeight: Typography.fontWeight.medium,
  },
  descriptionWrapper: {
    position: "relative",
    width: "100%",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  helperSummary: {
    alignItems: "flex-end",
    gap: Spacing.xs,
  },
  helperHint: {
    fontSize: Typography.fontSize.xs,
    color: Colors.primary[600],
    fontStyle: "italic",
    fontWeight: Typography.fontWeight.medium,
  },
  placeholderHintWrapper: {
    position: "absolute",
    top: Spacing.md,
    left: Spacing.md,
    zIndex: 1,
    pointerEvents: "none",
  },
  placeholderHintLine1: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.primary,
    fontWeight: Typography.fontWeight.normal,
    marginBottom: 2,
  },
  placeholderHintLine2: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.primary,
    fontWeight: Typography.fontWeight.normal,
  },
  qaPairsContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  qaPairsContainer: {
    flex: 1,
    marginBottom: Spacing.lg,
  },
  qaCardVertical: {
  backgroundColor: Colors.secondary[50],
  borderRadius: BorderRadius.lg,
  padding: Spacing.sm,
  marginBottom: Spacing.sm,
  borderWidth: 2,
  borderColor: Colors.primary[400],
  ...Shadows.small,
},
  questionSection: {
    marginBottom: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: Colors.secondary[300],
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  questionHeaderLeft: {
    flex: 1,
    marginRight: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  deleteButton: {
    padding: Spacing.xs,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.error[50],
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 32,
    minHeight: 32,
  },
  answerSection: {
    paddingTop: 0,
  },
  questionLabel: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary, // ✅ Changed from orange/yellow to dark color matching app
    marginBottom: 0, // ✅ Removed bottom margin to keep on same level
    textTransform: 'uppercase',
  },
 questionText: {
  fontSize: Typography.fontSize.sm,
  color: Colors.text.primary,
  fontWeight: Typography.fontWeight.normal,
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
  borderWidth: 2,
  borderColor: Colors.primary[400],
  borderRadius: BorderRadius.lg,
  padding: Spacing.md,
  fontSize: Typography.fontSize.sm,
  fontWeight: Typography.fontWeight.normal,
  backgroundColor: Colors.secondary[50],
  minHeight: 70,
  textAlignVertical: "top",
  color: Colors.text.primary,
  ...Shadows.small,
},
  answerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  saveButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary[500],
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 60,
    marginLeft: Spacing.sm,
  },
  saveButtonText: {
    color: Colors.secondary[700], // ✅ Changed from white to dark blue for better visibility
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
  },
  savedIndicator: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.success[50],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.success[600],
    marginLeft: Spacing.sm,
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
    backgroundColor: Colors.secondary[50],
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderWidth: 2,
    borderColor: Colors.primary[400],
    ...Shadows.small,
  },
summaryLabel: {
  fontSize: Typography.fontSize.base,
  fontWeight: Typography.fontWeight.semibold,
  color: Colors.text.primary,
  marginTop: Spacing.sm,
  marginBottom: Spacing.xs,
},
summaryTextWithSpacing: {
  fontSize: Typography.fontSize.sm,
  color: Colors.text.secondary,
  lineHeight: 20,
  marginBottom: Spacing.md,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xs,
    marginVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  generatingText: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.semibold,
    color: '#d87070', // Brighter but mild/dull red
  },
  generatingLoader: {
    marginLeft: Spacing.xs,
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
    gap: Spacing.sm,
    backgroundColor: Colors.secondary[600],
    borderWidth: 3,
    borderColor: Colors.primary[400],
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
    ...Shadows.small,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    letterSpacing: 0.3,
  },
  secondaryButton: {
     flex: 1,
     flexDirection: 'row',
     alignItems: "center",
     justifyContent: "center",
     gap: Spacing.xs,
     backgroundColor: Colors.secondary[50],
     borderWidth: 2,
     borderColor: Colors.secondary[300],
     paddingVertical: Spacing.md,
     paddingHorizontal: Spacing.lg,
     borderRadius: BorderRadius.lg,
     ...Shadows.small,
   },
   secondaryButtonText: {
     color: Colors.secondary[700],
     fontSize: Typography.fontSize.sm,
     fontWeight: Typography.fontWeight.bold,
     letterSpacing: 0.2,
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
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  editModeContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  editModeTitle: {
    fontSize: Typography.fontSize.lg,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  editScrollView: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  editScrollViewContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  editQACard: {
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  editQuestionText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.primary,
    fontWeight: Typography.fontWeight.normal,
    lineHeight: 20,
    marginBottom: Spacing.xs,
  },
  editAnswerInput: {
    borderWidth: 2,
    borderColor: Colors.primary[400],
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.normal,
    backgroundColor: Colors.secondary[50],
    minHeight: 70,
    textAlignVertical: "top",
    color: Colors.text.primary,
    ...Shadows.small,
  },
  additionalInfoSection: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  additionalInfoLabel: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.secondary[700],
    marginBottom: Spacing.xs,
    letterSpacing: 0.2,
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
    borderWidth: 2,
    borderColor: Colors.primary[400],
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.normal,
    backgroundColor: Colors.secondary[50],
    minHeight: 70,
    textAlignVertical: "top",
    color: Colors.text.primary,
    ...Shadows.small,
  },

  buttonColumn: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: Spacing.xs,
  },

fullWidthButton: {
  width: "100%",
},

  qaButtonSection: {
    gap: Spacing.md,
  },

halfButton: {
  flex: 1,
},

  tokenCounter: {
  fontSize: Typography.fontSize.xs,
  textAlign: "right",
  marginRight: 6,
  color: Colors.secondary[500],
  fontWeight: Typography.fontWeight.normal,
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
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    ...Shadows.small,
  },
  returnBannerText: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
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
    marginBottom: Spacing.sm,
  },
  inputLabel: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.secondary[700],
    marginBottom: Spacing.xs,
    letterSpacing: 0.2,
  },
  contactLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.secondary[100],
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    borderColor: Colors.primary[400],
    ...Shadows.small,
  },
  contactLabel: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.secondary[700],
    letterSpacing: 0.2,
  },
  contactValue: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.secondary[600],
  },
  titleInput: {
    borderWidth: 2,
    borderColor: Colors.primary[400],
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.normal,
    backgroundColor: Colors.secondary[50],
    minHeight: 44,
    textAlignVertical: "top",
    marginBottom: Spacing.xs,
    color: Colors.text.primary,
    ...Shadows.small,
  },
  inputHelper: {
    fontSize: Typography.fontSize.xs,
    color: Colors.text.tertiary,
    marginBottom: Spacing.xs,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 400,
    borderWidth: 2,
    borderColor: Colors.primary[400],
    ...Shadows.medium,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  modalTitle: {
    fontSize: Typography.fontSize.base,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.primary[700],
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  modalMessage: {
    fontSize: Typography.fontSize.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
    lineHeight: Typography.lineHeight.normal * Typography.fontSize.sm,
  },
  modalButtons: {
    gap: Spacing.sm,
  },
  modalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    gap: Spacing.xs,
  },
  modalButtonPrimary: {
    backgroundColor: Colors.secondary[600],
    borderWidth: 2,
    borderColor: Colors.primary[400],
    ...Shadows.small,
  },
  modalButtonPrimaryText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.bold,
    color: Colors.text.inverse,
    letterSpacing: 0.2,
  },
  modalButtonSecondary: {
    backgroundColor: Colors.secondary[50],
    borderWidth: 2,
    borderColor: Colors.secondary[300],
  },
  modalButtonSecondaryText: {
    fontSize: Typography.fontSize.sm,
    fontWeight: Typography.fontWeight.semibold,
    color: Colors.secondary[600],
    letterSpacing: 0.1,
  },
  modalButtonCancel: {
    backgroundColor: 'transparent',
  },
  modalButtonCancelText: {
    fontSize: Typography.fontSize.xs,
    fontWeight: Typography.fontWeight.medium,
    color: Colors.text.tertiary,
  },

});

export default AIChatScreen;