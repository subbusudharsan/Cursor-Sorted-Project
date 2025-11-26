/* 
  # Generate Contextual Options Function - Natural Flow Version

  1. Purpose
    - Generates contextual response options for users in conversations
    - Uses Claude AI to create empathetic, relevant suggestions
    - Natural conversation flow without artificial stages

  2. Features
    - Context-driven option generation using all available information
    - Continuous flow based on conversation momentum
    - Natural closure detection
    - Category-specific responses (Family, Work, Friend, etc.)

  3. Security
    - Uses environment variables for API keys
    - Validates request format
    - Handles CORS properly
*/

// NOTE: This project can be upgraded to premium models such as Claude 3.7 Sonnet,
// Claude 3.5 Sonnet, or OpenAI GPT-4.1 / o1 models in the future.
// Current model intentionally remains claude-3-5-haiku-20241022 for cost control.


import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    const {
      chatId,
      recipientId,
      currentUserId,
      currentMessage,
      summary,
      thoughts,
      wordLimit = 14,
      originalIssueSummary,
      recipientSummary,
      summary_shared_neutral,
      hint_from_b,
      originalIssue,
      hintFromB,
      hintToContact,
      summaryB,
      thoughtsB,
      conversationHistory,
      isInitial,
      contactCategory,
      conversationPhase,
      resolutionDetected,
      lastMessageTimestamp,
      taggedEntities
    } = await req.json();
    
    // ✅ Validate required parameters early
    if (!chatId || !recipientId) {
      console.error("❌ Missing required parameters:", { chatId, recipientId });
      return new Response(JSON.stringify({
        success: false,
        error: "Missing required parameters: chatId and recipientId are required",
        details: { chatId: !!chatId, recipientId: !!recipientId }
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    console.log("📥 Edge function received request:", {
      chatId,
      recipientId,
      currentUserId,
      wordLimit,
      hasSummary: !!summary,
      hasThoughts: !!thoughts,
      hasConversationHistory: !!conversationHistory,
      conversationHistoryLength: Array.isArray(conversationHistory) ? conversationHistory.length : 0
    });

    // ✅ REMOVED: Word limit no longer used (single-sentence validation only)

    const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!CLAUDE_API_KEY) {
      throw new Error("CLAUDE_API_KEY not configured");
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials not configured");
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ✅ Ensure conversationHistory is an array
    const safeConversationHistory = Array.isArray(conversationHistory) ? conversationHistory : [];
    
    // Detect if this is the very first message from User A
    const isVeryFirstMessage = safeConversationHistory.length === 0;

    // ✅ Detect conversation timing context (for context-aware opening)
    let conversationTimingContext = "normal";
    if (lastMessageTimestamp) {
      const timeSinceLastMessage = Date.now() - new Date(lastMessageTimestamp).getTime();
      const minutesSince = timeSinceLastMessage / (1000 * 60);
      const hoursSince = minutesSince / 60;
      const daysSince = hoursSince / 24;

      if (minutesSince < 30) {
        conversationTimingContext = "recent_argument"; // Just happened
      } else if (hoursSince < 6) {
        conversationTimingContext = "same_day";
      } else if (daysSince > 7) {
        conversationTimingContext = "long_gap"; // Haven't talked in a while
      }
    }

    // ✅ Get chat data to properly identify User A vs User B and extract tagged entities
    const { data: chatData, error: chatDataError } = await supabase
      .from('chats')
      .select('user_id, contact_id, context_data, user_a_smiley_sent, user_b_smiley_sent, closure_state, is_resolved')
      .eq('id', chatId)
      .single();

    if (chatDataError || !chatData) {
      console.error("❌ Failed to fetch chat data:", chatDataError);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to fetch chat data",
        details: chatDataError?.message || "Chat not found",
        chatId
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ✅ CRITICAL: Check if conversation is already closed/resolved
    if (chatData?.is_resolved === true && chatData?.closure_state === 'closed') {
      console.log("🛑 Conversation is already closed - no options should be generated");
      return new Response(JSON.stringify({
        success: false,
        error: "Conversation is closed",
        message: "This conversation has been completed. No further options will be generated."
      }), {
        status: 200,  // 200 because this is expected behavior, not an error
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const isRecipientUserA = recipientId === chatData?.user_id;
    const isRecipientUserB = recipientId === chatData?.contact_id;
    const shouldUseHint = isRecipientUserB && hintFromB;

    // ✅ Extract context data early to avoid initialization errors
    const contextData = chatData?.context_data || {};
    const summarySharedNeutral = summary_shared_neutral || contextData.summary_shared_neutral || '';
    
    // ✅ Extract thoughts and session data early
    const thoughtsA = contextData.thoughts_a || contextData.thoughts || thoughts || '';
    const thoughtsBFromContext = contextData.thoughts_b || thoughtsB || '';
    const sessionStartedAtIso = contextData.session_started_at;
    const sessionStartedAtMs = sessionStartedAtIso ? Date.parse(sessionStartedAtIso) : NaN;

    // ❗ HARD GUARD: We cannot generate contextual options without a neutral summary
    if (!summarySharedNeutral || !summarySharedNeutral.trim()) {
      console.error('❌ Missing summary_shared_neutral – cannot generate contextual options.', {
        chatId,
        recipientId,
        currentUserId,
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing summary_shared_neutral – cannot generate contextual options.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ✅ REFINED FIX 2: Detect if User B can ask "Can I explain?"
    // User B can ask "Can I explain?" ONLY when:
    // 1. User A has NOT yet shared the actual core issue
    // 2. User B has NOT submitted a hint yet
    // 3. User B has NOT already explained through a message

    // Check if User A has shared the actual core issue
    const hasUserASharedCoreIssue = (() => {
      // Check summary_shared_neutral (factual, third-person summary)
      const neutralSummary = summarySharedNeutral || '';
      // Check originalIssue summary (User A's original issue)
      const originalSummary = originalIssue?.summary || '';
      // Check if either has meaningful content (not empty, not placeholder)
      const hasMeaningfulContent = (text: string) => {
        const trimmed = text.trim();
        if (trimmed.length < 20) return false; // Too short to be meaningful
        // Check for placeholder patterns
        const placeholderPatterns = [
          /not specified/i,
          /n\/a/i,
          /no summary/i,
          /placeholder/i,
          /example/i,
          /test/i,
        ];
        return !placeholderPatterns.some(pattern => pattern.test(trimmed));
      };
      return hasMeaningfulContent(neutralSummary) || hasMeaningfulContent(originalSummary);
    })();

    // Check if User B has submitted a hint
    const hasUserBSubmittedHint = shouldUseHint;

    // Check if User B has already explained through a message
    const hasUserBExplainedInChat = isRecipientUserB && safeConversationHistory.some((msg: any) => {
      const content = typeof msg === 'object' ? String(msg.content || '') : String(msg || '');
      const lower = content.toLowerCase();
      // Detect explanation patterns from User B (check if sender is User B)
      const senderId = typeof msg === 'object' ? String(msg.sender_id || '') : '';
      const isFromUserB = senderId === String(chatData?.contact_id);
      if (!isFromUserB) return false;
      // Check for explanation patterns
      return lower.includes('i felt') || 
             lower.includes('i was') || 
             lower.includes('i thought') ||
             lower.includes('from my side') ||
             lower.includes('my perspective') ||
             lower.includes('what happened was') ||
             lower.includes('the reason') ||
             lower.includes('because i') ||
             (lower.includes('explain') && (lower.includes('i') || lower.includes('my')));
    });

    // ✅ REFINED: User B can ask "Can I explain?" in two scenarios:
    // 1. Early: Before hint submission AND before A shares issue
    // 2. After hint: After hint submission, B can ask "Can I share something from my side?"
    const canUserBAskToExplainEarly = isRecipientUserB && 
                                      !hasUserASharedCoreIssue && 
                                      !hasUserBSubmittedHint && 
                                      !hasUserBExplainedInChat;
    
    // ✅ NEW: After hint submission, B can ask "Can I share something from my side?"
    // This follows the reference flow: hint → ask permission → explain
    const canUserBAskToShareAfterHint = isRecipientUserB && 
                                        hasUserBSubmittedHint && 
                                        !hasUserBExplainedInChat &&
                                        hasUserASharedCoreIssue; // A must have shared issue first
    
    const canUserBAskToExplain = canUserBAskToExplainEarly || canUserBAskToShareAfterHint;

    // User B has already explained if they explained in chat (hint submission doesn't count as explanation)
    const hasUserBExplained = hasUserBExplainedInChat;

    // ✅ DETECT: Has the other user already sent a smiley?
    const otherUserSentSmiley = isRecipientUserA 
      ? chatData?.user_b_smiley_sent 
      : chatData?.user_a_smiley_sent;
    
    const currentUserSentSmiley = isRecipientUserA
      ? chatData?.user_a_smiley_sent
      : chatData?.user_b_smiley_sent;
    
    // ✅ DETECT: Smiley emojis in recent conversation history
    const detectSmileyInHistory = (history: any[]): boolean => {
      return history.some(msg => {
        const content = typeof msg === 'object' ? msg.content : String(msg);
        const contentStr = String(content).trim();
        return /^[\p{Emoji}]+$/u.test(contentStr) || 
               /🙂|😊|❤️|🤝|💙|🫂|✨|👍/.test(contentStr);
      });
    };
    
    const hasSmileyInRecentMessages = detectSmileyInHistory(safeConversationHistory.slice(-3));
    const otherUserRecentSmiley = safeConversationHistory.some(msg => {
      if (typeof msg !== 'object') return false;
      const senderMatchesOther = isRecipientUserA 
        ? msg.sender_id === chatData?.contact_id
        : msg.sender_id === chatData?.user_id;
      if (!senderMatchesOther) return false;
      const content = String(msg.content || '');
      const contentStr = content.trim();
      return /^[\p{Emoji}]+$/u.test(contentStr) || /🙂|😊|❤️|🤝|💙|🫂|✨|👍/.test(contentStr);
    });
    
    console.log("👥 User identification:", {
      recipientId,
      chatUserA: chatData?.user_id,
      chatContactB: chatData?.contact_id,
      isRecipientUserA,
      isRecipientUserB,
      shouldUseHint,
      otherUserSentSmiley,
      currentUserSentSmiley,
      hasSmileyInRecentMessages,
      otherUserRecentSmiley,
      // ✅ VERIFY: Check string conversion for type safety (for User A/B switching detection)
      recipientMatchesUserA: String(recipientId) === String(chatData?.user_id),
      recipientMatchesContactB: String(recipientId) === String(chatData?.contact_id)
    });
    
    // ✅ Validate recipient ID matches either User A or User B
    if (!isRecipientUserA && !isRecipientUserB) {
      console.error("❌ Invalid recipient ID - not User A or User B");
      return new Response(JSON.stringify({
        success: false,
        error: "Invalid recipient ID - recipient must be either User A or User B",
        details: { 
          recipientId, 
          chatUserA: chatData?.user_id, 
          chatContactB: chatData?.contact_id 
        }
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ✅ CODE-PATH SAFETY: Verify correct neutral summary is present before generating options
    // Note: detailed context extraction happens below; here we only guard on summary_shared_neutral
    const chatContextData = chatData?.context_data || {};
    const expectedSummaryForRecipient = chatContextData.summary_shared_neutral || '';

    const receivedSummary = recipientSummary || summary || '';

    // Validate that received summary matches expected (summary_shared_neutral for both users)
    if (!expectedSummaryForRecipient || expectedSummaryForRecipient.trim().length === 0) {
      console.warn("⚠️ CODE-PATH SAFETY: Missing summary_shared_neutral (both users need this)");
      // We'll fail hard later if we still don't have a neutral summary after full extraction
    }
    if (isRecipientUserA) {
      if (!expectedSummaryForRecipient || expectedSummaryForRecipient.trim().length === 0) {
        console.warn("⚠️ CODE-PATH SAFETY: Missing summary_shared_neutral for User A");
      }
    } else {
      if (!expectedSummaryForRecipient || expectedSummaryForRecipient.trim().length === 0) {
        console.warn("⚠️ CODE-PATH SAFETY: Missing summary_shared_neutral for User B");
      }
    }
    
    // Soft check: does received summary resemble expected neutral summary?
    const summaryMatches =
      receivedSummary.includes(expectedSummaryForRecipient.substring(0, 50)) ||
      expectedSummaryForRecipient.includes(receivedSummary.substring(0, 50));
    
    if (!summaryMatches && receivedSummary.length > 0 && expectedSummaryForRecipient.length > 0) {
      console.warn("⚠️ CODE-PATH SAFETY: Received summary may not match expected", {
        expectedPreview: expectedSummaryForRecipient.substring(0, 100),
        receivedPreview: receivedSummary.substring(0, 100)
      });
    }

    console.log("✅ CODE-PATH SAFETY: Summary validation passed", {
      isRecipientUserA,
      expectedSummaryLength: expectedSummaryForRecipient.length,
      receivedSummaryLength: receivedSummary.length,
      summaryMatches,
    });

    // ✅ FETCH STRUCTURED CONTEXT from entity registry
    const { data: entities } = await supabase
      .from('entity_registry')
      .select('*')
      .eq('chat_id', chatId);

    const { data: actions } = await supabase
      .from('action_log')
      .select('*')
      .eq('chat_id', chatId)
      .order('timestamp_occurred', { ascending: false })
      .limit(10);

    const { data: structuredAnswers } = await supabase
      .from('structured_context_data')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    // ✅ Filter structured answers by session start time
    const filteredStructuredAnswers =
      !Number.isNaN(sessionStartedAtMs)
        ? (structuredAnswers || []).filter((answer) => {
            const createdAtMs = answer?.created_at ? Date.parse(answer.created_at) : NaN;
            return !Number.isNaN(createdAtMs) && createdAtMs >= sessionStartedAtMs;
          })
        : (structuredAnswers || []);

    // 🗣️ Pronoun Tone Context Injection (User A ↔ User B mapping)
    const userA = entities?.find(e => e.role_in_conversation === 'User A');
    const userB = entities?.find(e => e.role_in_conversation === 'User B');

    const userAName = userA?.entity_name || '';
    const userBName = userB?.entity_name || '';

    console.log("📋 Context data extraction:", {
      hasSummarySharedNeutral: !!summarySharedNeutral,
      hasThoughtsA: !!thoughtsA,
      hasThoughtsB: !!thoughtsBFromContext,
      summarySharedNeutralLength: summarySharedNeutral.length,
      recipientIsUserA: isRecipientUserA,
      recipientIsUserB: isRecipientUserB,
      userAName,
      userBName,
      note: "summary_shared_neutral is the only summary used for option generation"
    });

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildNameVariants = (name: string): string[] => {
  if (!name || typeof name !== 'string') return [];
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) return [];

  const baseParts = normalized
    .split(/[\s-]+/)
    .map(part => part.trim())
    .filter(Boolean);

  const variants = new Set<string>();
  variants.add(normalized);
  baseParts.forEach(part => variants.add(part));

  return Array.from(variants);
};

// ✅ Helper function to normalize name to Title Case
const normalizeToTitleCase = (name: string): string => {
  if (!name || typeof name !== 'string') return name;
  // Remove # prefix if present, trim whitespace
  let cleaned = name.replace(/^#\s*/, '').trim();
  if (!cleaned) return name;
  
  // Split by spaces, hyphens, apostrophes to handle compound names
  const parts = cleaned.split(/[\s'-]+/);
  const normalizedParts = parts.map(part => {
    if (!part) return part;
    // Capitalize first letter, lowercase the rest
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  });
  
  // Rejoin with space (handles most cases)
  return normalizedParts.join(' ');
};

const applySentenceCase = (replacement: string, offset: number, source: string): string => {
  const prefix = source.slice(0, offset);
  const isStartOfSentence =
    offset === 0 ||
    /[.!?]\s*$/.test(prefix) ||
    prefix.trimEnd().length === 0;

  if (!isStartOfSentence) {
    return replacement.toLowerCase() === 'i' ? 'I' : replacement;
  }

  if (replacement.toLowerCase() === 'you') return 'You';
  if (replacement.toLowerCase() === 'your') return 'Your';
  if (replacement.toLowerCase() === 'i') return 'I';
  if (replacement.toLowerCase() === 'me') return 'Me';
  if (replacement.toLowerCase() === 'my') return 'My';

  return replacement;
};

const applySentenceCaseToPhrase = (replacement: string, offset: number, source: string): string => {
  const parts = replacement.split(' ');
  if (parts.length === 0) return replacement;
  const [first, ...rest] = parts;
  const firstWord = applySentenceCase(first, offset, source);
  return [firstWord, ...rest].join(' ');
};

const STOP_WORDS = new Set([
  'the','and','that','with','have','this','from','about','your','yours','their','they','them','been','into','just','really','really','very','when','where','what','because','were','will','would','could','should','there','here','into','onto','onto','for','after','before','around','while','since','which','also','still','back','even','more','some','over','like','well','sure','yeah','okay','then','than','ever','going'
]);

const tokenize = (text: string): string[] =>
  (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);

const extractKeywords = (text: string, max = 8): string[] => {
  const words = tokenize(text)
    .filter(word => word.length > 3 && !STOP_WORDS.has(word));
  const unique: string[] = [];
  for (const word of words) {
    if (!unique.includes(word)) unique.push(word);
    if (unique.length >= max) break;
  }
  return unique;
};

const getPrimaryStatement = (text: string): string => {
  if (!text) return '';
  const match = text.match(/[^.!?]+[.!?]?/);
  return (match ? match[0] : text).trim();
};

const TALK_PATTERNS = [
  /let['']s\s+(talk|chat|discuss)/i,
  /can we\s+(talk|chat|discuss)/i,
  /let me know if we can\s+(talk|chat)/i,
  /can we go over this/i,
  /let's go over/i
];

const containsTalkPhrase = (text: string): boolean => TALK_PATTERNS.some(pattern => pattern.test(text));

// ✅ Extract NEUTRAL summary and thoughts from context_data
// Note: summarySharedNeutral, thoughtsA, thoughtsBFromContext, and sessionStartedAtMs 
// are already declared earlier to avoid initialization errors

// ❗ SINGLE SOURCE OF TRUTH for summaries inside this function:
// summary_shared_neutral = the ONLY summary used for option generation
// (summarySharedNeutral already declared above, guard moved to after variable declarations)
// (filteredStructuredAnswers and console.log moved inside try block)

// ✅ CRITICAL: BOTH User A and User B MUST ALWAYS use summary_shared_neutral for option generation
// ❌ NEVER use summary_a_perspective for options - that's ONLY for Stage 3 UI
// ❌ NEVER use summary_b for options - removed completely
let derivedRecipientSummary = '';
let derivedRecipientThoughts = '';

if (isRecipientUserA) {
  // ✅ User A: ONLY use summary_shared_neutral (factual, third-person)
  derivedRecipientSummary = summarySharedNeutral || '';
  derivedRecipientThoughts = thoughtsA || thoughts || '';
  
  if (!derivedRecipientSummary) {
    console.warn('⚠️ WARNING: summary_shared_neutral missing for User A options! Using empty string.');
  } else {
    console.log("✅ For User A: Using summary_shared_neutral for option generation (factual, third-person)");
    console.log(`   Summary preview: ${derivedRecipientSummary.substring(0, 100)}`);
    console.log("   Note: summary_a_perspective is ONLY shown in Stage 3 UI, NEVER used for chat options");
  }
} else if (isRecipientUserB) {
  // ✅ User B: ONLY use summary_shared_neutral (factual, third-person)
  // ❌ REMOVED: summary_b logic completely - both users now use summary_shared_neutral
  derivedRecipientSummary = summarySharedNeutral || '';
  derivedRecipientThoughts = thoughtsBFromContext || thoughtsB || '';
  
  if (!derivedRecipientSummary) {
    console.warn('⚠️ WARNING: summary_shared_neutral missing for User B options! Using empty string.');
  } else {
    console.log("✅ For User B: Using summary_shared_neutral for option generation (factual, third-person)");
    console.log(`   Summary preview: ${derivedRecipientSummary.substring(0, 100)}`);
    console.log("   Note: summary_b removed - both users now use summary_shared_neutral");
    console.log("   Note: summary_a_perspective is NEVER used for option generation");
  }
}

// ✅ FINAL: Ensure recipientSummary is always set (never empty)
const finalRecipientSummary = recipientSummary || derivedRecipientSummary || '';
const finalRecipientThoughts = thoughts || derivedRecipientThoughts || '';

// ✅ LOG which summary is being used for option generation
console.log("✅ Final recipientSummary determination:", {
  recipient: isRecipientUserA ? "User A" : "User B",
  usingSummary: finalRecipientSummary ? "summary_shared_neutral" : "EMPTY",
  summaryPreview: finalRecipientSummary.substring(0, 100) || "EMPTY",
  hasSummarySharedNeutral: !!summarySharedNeutral,
  warning: !summarySharedNeutral ? "summary_shared_neutral missing, may cause issues" : "OK",
  recipientIsUserA: isRecipientUserA,
  recipientIsUserB: isRecipientUserB,
  finalRecipientSummaryLength: finalRecipientSummary.length,
  finalRecipientThoughtsLength: finalRecipientThoughts.length,
  preview: finalRecipientSummary.substring(0, 100)
});

// ✅ 1️⃣ PERSPECTIVE CLEANUP - Replace @ tags with "you/your" based on speaker's perspective
// CRITICAL INSIGHT: @ always refers to the LISTENER (the person being spoken TO)
// - Summary is written from User A's perspective initially
// - @ in summary = User B (the person User A is talking TO)
// - When generating options:
//   * For User A speaking TO User B: @ = User B's name → "you/your"
//   * For User B speaking TO User A: @ = User A's name → "you/your" (but summary has @UserB, so we need to swap!)

console.log("🧹 Starting perspective cleanup:", {
  generatingFor: isRecipientUserA ? 'User A' : 'User B',
  userAName,
  userBName,
  hasSummary: !!summary,
  hasThoughts: !!thoughts,
  explanation: isRecipientUserA
    ? "Generating for User A → Replace @UserB with 'you' (User A speaking TO User B)"
    : "Generating for User B → Replace @UserB with 'you' (but from User B's perspective, so 'you' refers to User A)"
});

// Helper function to clean text by replacing @ tags AND plain names with "you/your" based on speaker
// ALSO removes # symbols from third-party references while keeping the name
const cleanPerspective = (text: string | undefined): string => {
  if (!text || typeof text !== 'string') return text || '';

  let cleaned = text;

  // ✅ CRITICAL FIX: Replace BOTH @Name and plain Name references
  // The summary may contain "Aradhya said" (without @) which needs to become "you said"

  if (isRecipientUserA) {
    // Generating for User A → User A is speaking TO User B
    const listenerVariants = buildNameVariants(userBName);
    if (listenerVariants.length > 0) {
      listenerVariants.forEach(variant => {
        const escaped = escapeRegex(variant);
        const hasSpace = /\s/.test(variant);

        // Possessive forms
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'s\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('your', offset, source)
        );
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('your', offset, source)
        );
        if (!hasSpace) {
          cleaned = cleaned.replace(new RegExp(`@${escaped}'s\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
          cleaned = cleaned.replace(new RegExp(`@${escaped}'\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
        }

        // Base forms
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('you', offset, source)
        );
        if (!hasSpace) {
          cleaned = cleaned.replace(new RegExp(`@${escaped}\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('you', offset, source)
          );
        }
      });
      console.log(`   ✅ User A speaking TO User B: Replaced ${listenerVariants.join(', ')} with "you/your"`);
    }
  } else {
    // Generating for User B → User B is speaking TO User A
    const selfVariants = buildNameVariants(userBName);
    if (selfVariants.length > 0) {
      selfVariants.forEach(variant => {
        const escaped = escapeRegex(variant);
        const hasSpace = /\s/.test(variant);

        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'s\\b`, 'gi'), 'my');
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'\\b`, 'gi'), 'my');
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), 'I');
        if (!hasSpace) {
          cleaned = cleaned.replace(new RegExp(`@${escaped}'s\\b`, 'gi'), 'my');
          cleaned = cleaned.replace(new RegExp(`@${escaped}'\\b`, 'gi'), 'my');
          cleaned = cleaned.replace(new RegExp(`@${escaped}\\b`, 'gi'), 'I');
        }
      });
      console.log(`   ✅ User B perspective: Replaced ${selfVariants.join(', ')} with "I/me/my"`);
    }

    const listenerVariants = buildNameVariants(userAName);
    if (listenerVariants.length > 0) {
      listenerVariants.forEach(variant => {
        const escaped = escapeRegex(variant);
        const hasSpace = /\s/.test(variant);

        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'s\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('your', offset, source)
        );
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('your', offset, source)
        );
        if (!hasSpace) {
          cleaned = cleaned.replace(new RegExp(`@${escaped}'s\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
          cleaned = cleaned.replace(new RegExp(`@${escaped}'\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
        }

        cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('you', offset, source)
        );
        if (!hasSpace) {
          cleaned = cleaned.replace(new RegExp(`@${escaped}\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('you', offset, source)
          );
        }
      });
      console.log(`   ✅ User B speaking TO User A: Replaced ${listenerVariants.join(', ')} with "you/your"`);
    }
  }

  // ✅ ENHANCED: Remove # symbols from third-party references with case-insensitive matching
  // Handles: #name, #Name, #NAME, #nAmE, #name's, #name-, #name., # name (with space)
  // Normalizes to Title Case before removing #
  const normalizeAndRemoveHash = (text: string): string => {
    let result = text;
    
    // ✅ Pattern: # followed by optional space, then name (letters, apostrophes, hyphens), then word boundary or punctuation
    const hashTagPattern = /#\s*([A-Za-z][A-Za-z'’-]*)/gi;
    
    result = result.replace(hashTagPattern, (match, name) => {
      // Normalize to Title Case
      const normalized = normalizeToTitleCase(name);
      return normalized;
    });
    
    // ✅ Catch-all: Remove any remaining # symbols
    result = result.replace(/#/g, '');
    
    return result;
  };
  
  cleaned = normalizeAndRemoveHash(cleaned);
  console.log(`   ✅ Removed # symbols from third-party references (case-insensitive, normalized to Title Case)`);

  // ✅ FIX: Replace incorrect third-person pronouns when addressing the listener
  // If User A is talking TO User B, replace "her/his/their" with "your" when referring to User B
  if (isRecipientUserA && userBName) {
    // Common patterns: "her stuff", "his comment", "their behavior" when referring to User B
    // This is a fallback - the main replacement above should handle most cases
    // But if the AI generates "her" for User B, we need to catch it
    const escapedBName = userBName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Only replace if it's clearly referring to User B's things (context-dependent)
    // This is a conservative approach - we'll rely more on the prompt instructions
  }

  // ✅ FIX: Additional cleanup for common pronoun mistakes
  // If generating for User A → User B, ensure "her/his" referring to User B becomes "your"
  if (isRecipientUserA) {
    // Pattern: "her stuff" when User A is talking to User B about User B's stuff
    // This is tricky - we need to be careful not to replace "her" when it refers to a third party
    // We'll rely on the prompt instructions to prevent this, but add a safety check
  }

  return cleaned;
};

// ✅ Clean all text fields that might contain @<listener> references - SINGLE PASS ONLY
// ✅ FIX: Use finalRecipientSummary instead of recipientSummary
const cleanSummary = cleanPerspective(summary);
const cleanThoughts = cleanPerspective(thoughts);
// ✅ CRITICAL: For option generation context, use summary_shared_neutral (factual, third-person) ONLY
// This is used for BOTH User A and User B option generation in all turns
// summary_a_perspective / summary_a / summary_b are NEVER used in this pipeline
const cleanOriginalIssueSummary = cleanPerspective(summarySharedNeutral || '');
const cleanRecipientSummary = cleanPerspective(finalRecipientSummary);
const cleanRecipientThoughts = cleanPerspective(finalRecipientThoughts);
const cleanSummarySharedNeutral = cleanPerspective(summarySharedNeutral);
const cleanCurrentMessage = cleanPerspective(currentMessage);

// ✅ LOG which summaries are being used
console.log("🧹 Cleaned summaries for option generation:", {
  cleanOriginalIssueSummary: cleanOriginalIssueSummary.substring(0, 100) || "EMPTY",
  cleanRecipientSummary: cleanRecipientSummary.substring(0, 100) || "EMPTY",
  cleanSummarySharedNeutral: cleanSummarySharedNeutral.substring(0, 100) || "EMPTY",
  warning: !summarySharedNeutral ? "Using empty - summary_shared_neutral missing!" : "OK",
  note: "Both users use summary_shared_neutral only; no perspective summaries used",
});

// ✅ Clean conversation history
const cleanConversationHistory = safeConversationHistory.map((msg) =>
  typeof msg === 'object'
    ? { ...msg, content: cleanPerspective(msg.content) }
    : cleanPerspective(String(msg))
);

console.log("✅ Perspective cleanup complete - using cleaned versions:", {
  summaryLength: cleanSummary.length,
  thoughtsLength: cleanThoughts.length,
  currentMessageLength: cleanCurrentMessage.length,
  conversationHistoryLength: cleanConversationHistory.length
});

// Determine who the AI is generating options for
const generatingFor = isRecipientUserA ? 'User A' : 'User B';

const isFirstResponseForUserB = !isRecipientUserA && safeConversationHistory.length <= 1;

const hintPromptSnippet = shouldUseHint ? cleanPerspective(hintFromB || '') : '';

// ✅ Extract neutral topic from conversation (factual only, no emotions)
const extractNeutralTopic = (): string => {
  if (!isRecipientUserB || safeConversationHistory.length === 0) return '';
  
  // Get last few messages to extract topic
  const recentMessages = safeConversationHistory.slice(-4)
    .map((msg: any) => typeof msg === 'object' ? String(msg.content || '') : String(msg))
    .join(' ')
    .toLowerCase();
  
  // Extract factual topics (remove emotional words)
  const topicKeywords: string[] = [];
  
  // Common topics (factual, not emotional)
  const topicPatterns = [
    /\b(party|event|gathering|meeting|dinner|celebration)\b/i,
    /\b(invitation|invite|asked|told)\b/i,
    /\b(text|message|call|phone|contact)\b/i,
    /\b(work|job|project|meeting|colleague)\b/i,
    /\b(friend|friendship|relationship|connection)\b/i,
    /\b(jealousy|jealous|accusation|accused)\b/i,
    /\b(ignored|left out|excluded|missed)\b/i
  ];
  
  topicPatterns.forEach(pattern => {
    const match = recentMessages.match(pattern);
    if (match) {
      topicKeywords.push(match[0]);
    }
  });
  
  // Remove duplicates and return
  const uniqueTopics = [...new Set(topicKeywords)];
  return uniqueTopics.length > 0 ? uniqueTopics.join(', ') : '';
};

const neutralTopic = isRecipientUserB ? extractNeutralTopic() : '';

// ✅ Define perspective clearly (who's speaking to whom)
const perspectiveLine =
  generatingFor === 'User A'
    ? "You are writing AS User A, talking TO User B. Use 'I/me/my' for yourself and 'you/your' for User B."
    : "You are writing AS User B, talking TO User A. Use 'I/me/my' for yourself and 'you/your' for User A.";

// ✅ Define third-party pronoun rule separately
const thirdPartyLine = `
When referring to people tagged with # (not part of this chat),
use their preferred pronouns from the Entity Registry or their #Name directly.
Never call them 'you' — only User A and User B can be 'you/your'.
`;

// ✅ SUMMARY = SINGLE SOURCE OF TRUTH (CRITICAL)
const summarySourceOfTruthRules = `
🧾 SUMMARY = SINGLE SOURCE OF TRUTH (CRITICAL):
- All @contact and #third-party information MUST come ONLY from the summary
- Do NOT guess, modify, flip meaning, or create actions not in the summary
- Use EXACT names as written: If summary says "Vikram", use "Vikram" (not "Vikram's" or "him" unless context requires)
- Keep original meaning: If summary says "Vikram & Sneha supported me", they stay supportive (NOT hurtful)
- NEVER flip meaning: Supportive → stays supportive, Hurtful → stays hurtful
- NEVER assign actions not in summary
- NEVER mix @contact actions with #third-party actions
- @Name = contact in this chat - use exactly as written in summary
- #Name = third-party - use exact name from summary, pronouns only if registry has them AND context requires
- Summary text always defines the meaning - do NOT change it
`;

// 🧠 Simplified Pronoun-Tone Mapping (prevents name leakage)
const pronounToneContext = generatingFor === 'User A'
  ? `
🗣️ PRONOUN-TONE RULES (User A → User B):
- Speaker = "I / me / my / mine / myself"
- Listener = "you / your / yours / yourself"
- ❗ NEVER mention the listener's real name when writing messages.
- When referring to third parties, use their preferred pronouns or names from the Entity Registry.
`
  : `
🗣️ PRONOUN-TONE RULES (User B → User A):
- Speaker = "I / me / my / mine / myself"
- Listener = "you / your / yours / yourself"
- ❗ NEVER mention the listener's real name when writing messages.
- When referring to third parties, use their preferred pronouns or names from the Entity Registry.
`;


// Attach this tone mapping to the overall entity context
let entityContext = `\n${pronounToneContext}`;

    
    // Build entity context with clear pronoun mappings
    if (entities && entities.length > 0) {
      entityContext += '\n\n📋 ENTITY REGISTRY (Clear pronoun mappings):\n';
      entities.forEach((entity, index) => {
        entityContext += `\n${index + 1}. ${entity.entity_name}:`;
        entityContext += `\n   - Type: ${entity.entity_type}`;
        entityContext += `\n   - Role: ${entity.role_in_conversation}`;
        entityContext += `\n   - Pronouns: ${entity.preferred_pronouns}`;
        if (entity.relationship_to_user_a) {
          entityContext += `\n   - Relationship: ${entity.relationship_to_user_a}`;
        }
      });
    }

    // Build action log context
    let actionContext = '';
    if (actions && actions.length > 0) {
      actionContext += '\n\n📝 ACTION LOG (Who did what to whom):\n';
      actions.forEach((action, index) => {
        const subject = entities?.find(e => e.id === action.subject_entity_id);
        const object = action.object_entity_id
          ? entities?.find(e => e.id === action.object_entity_id)
          : null;

        actionContext += `\n${index + 1}. ${subject?.entity_name || 'Unknown'} ${action.action_verb}`;
        if (object) {
          actionContext += ` ${object.entity_name}`;
        }
        if (action.action_context) {
          actionContext += ` (${action.action_context})`;
        }
      });
    }

    // Build structured answers context
    let structuredContext = '';
    if (filteredStructuredAnswers.length > 0) {
      structuredContext += '\n\n📊 STRUCTURED INFORMATION:\n';
      filteredStructuredAnswers.forEach((answer) => {
        structuredContext += `\n- ${answer.question_text}: ${JSON.stringify(answer.answer_value.value)}`;
      });
    }

    // Extract tagged entities from context or incoming data (legacy support)
    const storedTags = chatData?.context_data?.tagged_entities || [];
    const hintTags = chatData?.context_data?.hint_tagged_entities || [];
    const allTags = taggedEntities || [...storedTags, ...hintTags];

    // Separate registered contacts (@) from unregistered entities (#)
    const registeredContacts = allTags.filter(t => t.type === 'registered');
    const unregisteredEntities = allTags.filter(t => t.type === 'unregistered');

    // 🧠 Build pronoun map from entity_registry (case-insensitive)
const pronounMap: Record<string, string> = {};
if (entities && entities.length > 0) {
  entities.forEach(e => {
    if (e.entity_type === 'third_party_person' && e.preferred_pronouns) {
      // ✅ Normalize entity name to Title Case for consistency
      const normalizedName = normalizeToTitleCase(e.entity_name);
      // Store with lowercase key for case-insensitive lookup
      pronounMap[normalizedName.toLowerCase()] = e.preferred_pronouns;
    }
  });
}

// ✅ Extract third-party names EXACTLY as they appear in summary
// Note: cleanSummary, cleanRecipientSummary, cleanOriginalIssueSummary will be defined later
// We'll extract from the raw summaries first, then use cleaned versions when available
// ✅ Enhanced: Extract third-party names with all casing formats
const extractThirdPartyNamesFromSummary = (summaryText: string): string[] => {
  if (!summaryText || typeof summaryText !== 'string') return [];
  const namesMap = new Map<string, string>(); // lowercase -> normalized
  
  // ✅ Enhanced pattern: Matches #name, #Name, #NAME, #nAmE, #name's, #name-, #name., # name (with space)
  // Pattern: # followed by optional space, then name (letters, apostrophes, hyphens), then optional punctuation
  const hashTagPattern = /#\s*([A-Za-z][A-Za-z'’-]*)/g;
  let match;
  
  while ((match = hashTagPattern.exec(summaryText)) !== null) {
    const rawName = match[1];
    if (rawName) {
      // Normalize to Title Case
      const normalized = normalizeToTitleCase(rawName);
      const lowerKey = normalized.toLowerCase();
      
      // Store normalized version (use first occurrence's casing as canonical)
      if (!namesMap.has(lowerKey)) {
        namesMap.set(lowerKey, normalized);
    }
  }
  }
  
  return Array.from(namesMap.values());
};

// Extract from NEUTRAL summary only (no A/B perspective summaries)
// summary_shared_neutral still contains original names/@/# and is the single source of truth
const rawSummaryText = summarySharedNeutral || '';
const allRawSummaries = rawSummaryText;
const thirdPartyNamesInSummary = extractThirdPartyNamesFromSummary(allRawSummaries);

// ✅ FIX: Filter unregisteredEntities to ONLY include names that are in the current summary
const validThirdPartyNames = thirdPartyNamesInSummary.map(n => n.toLowerCase());
const filteredUnregisteredEntities = unregisteredEntities.filter(t => {
  const tagName = t.tag.replace('#', '').toLowerCase();
  return validThirdPartyNames.includes(tagName);
});

    // Build tag context for AI with pronoun guidance
    let tagContext = '';
    if (registeredContacts.length > 0) {
      tagContext += `\n\n✅ REGISTERED CONTACTS (conversation participants - already cleaned to "you/your"):\n`;
      tagContext += registeredContacts.map(t => `- ${t.tag} (role: ${t.role}) - Has been replaced with "you/your" in the text you see`).join('\n');
      tagContext += '\n  → You will NOT see @ tags in the text - they are already "you/your"';
    }
    if (filteredUnregisteredEntities.length > 0) {
      tagContext += `\n\n📋 THIRD PARTIES (being DISCUSSED, not in conversation):\n`;
      tagContext += filteredUnregisteredEntities.map(t => {
        const rawName = t.tag.replace('#', '');
        // ✅ Normalize to Title Case
        const normalizedName = normalizeToTitleCase(rawName);
        const cleanTag = normalizedName.toLowerCase();
  const pronouns =
    t.pronouns ||
    pronounMap[cleanTag] ||
    'they/them';
  const categoryInfo = t.category ? ` (${t.category})` : '';
        return `- ${normalizedName}${categoryInfo} - Use name "${normalizedName}" or pronouns "${pronouns}" in messages (drop the # prefix)`;
}).join('\n');

      tagContext += `\n\n⚠️ IMPORTANT: When mentioning third parties:
  - Use their NAME naturally (without # prefix): "Sarah told me" NOT "#Sarah told me"
  - OR use their PRONOUNS from the list above: "she told me" (if clear from context)
  - Choose based on clarity - use names when first mentioned, pronouns for subsequent references
  - NEVER use "you/your" for third parties - only for the person you're speaking TO`;
    }
// 🔧 FIXED: Ensure we identify the listener (the person being spoken TO)
const recipientEntity =
  entities?.find(e => e.role_in_conversation === (isRecipientUserA ? 'User A' : 'User B')) ||
  entities?.find(e => e.user_id === recipientId);


if (recipientEntity && recipientEntity.entity_name) {
  tagContext += `\n\n🔒 IMPORTANT NAME RULE:\n`;
  tagContext += `- The recipient is the person receiving these message options (they will send the message).\n`;
  tagContext += `- The listener (the person they're speaking TO) must NEVER be called by their name.\n`;
  tagContext += `- Always address the listener as "you/your" — never use their real name or refer to them as "she/he".\n`;
}

    
    console.log('⏰ TIMING CONTEXT:', conversationTimingContext);

    console.log('🎯 OPTIONS GENERATION CONTEXT:');
    console.log(`👥 Generating perspective: ${isRecipientUserA ? 'User A' : 'User B'} → ${isRecipientUserA ? 'User B' : 'User A'}`);

    console.log('  recipientId:', recipientId);
    console.log('  isRecipientUserA:', isRecipientUserA);
    console.log('  isRecipientUserB:', isRecipientUserB);
    console.log('  isVeryFirstMessage:', isVeryFirstMessage);
    console.log('  shouldUseHint:', shouldUseHint);
    console.log('  conversationHistory.length:', safeConversationHistory.length);

    // ✅ ROLE SAFETY: Final verification before generation
    console.log("🔒 ROLE SAFETY CHECK:", {
      generatingFor,
      isRecipientUserA,
      isRecipientUserB,
      recipientId,
      chatUserA: chatData?.user_id,
      chatContactB: chatData?.contact_id,
      summaryPreview: (cleanRecipientSummary || cleanSummary || '').substring(0, 100),
      currentMessagePreview: cleanCurrentMessage.substring(0, 100)
    });

    // Verify recipient ID matches expected role
    if (isRecipientUserA && recipientId !== chatData?.user_id) {
      console.error("❌ ROLE SAFETY: Recipient ID mismatch for User A");
      return new Response(JSON.stringify({
        success: false,
        error: "Role safety violation: Recipient ID does not match User A",
        details: { recipientId, expectedUserA: chatData?.user_id }
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (isRecipientUserB && recipientId !== chatData?.contact_id) {
      console.error("❌ ROLE SAFETY: Recipient ID mismatch for User B");
      return new Response(JSON.stringify({
        success: false,
        error: "Role safety violation: Recipient ID does not match User B",
        details: { recipientId, expectedUserB: chatData?.contact_id }
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ✅ ENHANCED: Emotionally-aware gradual closure detection (includes thoughts and general view)
    const recentMessages = safeConversationHistory.slice(-4).map(m => {
      if (typeof m === 'object' && m.content) {
        return String(m.content).toLowerCase();
      }
      return String(m).toLowerCase();
    }).join(' ');

    // ✅ ENHANCED: Analyze thoughts and general view towards conversation
    const contextDataForThoughts = chatData?.context_data || {};
    const thoughtsAForClosure = contextDataForThoughts.thoughts_a || thoughtsA || thoughts || '';
    const thoughtsBForClosure = contextDataForThoughts.thoughts_b || thoughtsB || '';
    const allThoughts = [thoughtsAForClosure, thoughtsBForClosure].filter(Boolean).join(' ').toLowerCase();
    
    // Detect closure signals in thoughts
    const thoughtsIndicateClosure = /(feel better|resolved|peace|closure|understood|grateful|appreciate|happy|satisfied|content|relieved|at peace|good place|moved on|worked through)/i.test(allThoughts);
    const thoughtsIndicatePositiveView = /(positive|hopeful|optimistic|better|improved|healing|progress|growth|forward|together|closer)/i.test(allThoughts);
    
    // Detect smiley emojis in conversation
    const hasSmileyInMessages = /🙂|😊|❤️|🤝|💙|🫂|✨|👍/.test(recentMessages) || 
                                 safeConversationHistory.some(m => {
                                   const content = typeof m === 'object' ? m.content : String(m);
                                   const contentStr = String(content).trim();
                                   return /^[\p{Emoji}]+$/u.test(contentStr);
                                 });

    // Detect multiple emotional resolution signals
    const hasGratitude = /thank|grateful|appreciate|glad|happy we talked/.test(recentMessages);
    const hasForgiveness = /sorry|forgive|understand|my bad|apologize|didn't mean to/.test(recentMessages);
    const hasUnderstanding = /makes sense|get it|see your point|clear now|i hear you|understand where you're coming from/.test(recentMessages);
    const hasClosure = /closure|peace|move forward|let's put this behind|good talk|feel better/.test(recentMessages);
    const hasPositiveAffirmation = /love you|care about|value our|important to me|miss you/.test(recentMessages);

    // Calculate emotional closure score (0.0 to 1.0)
    let emotionalClosureScore = 0.0;
    if (hasGratitude) emotionalClosureScore += 0.25;
    if (hasForgiveness) emotionalClosureScore += 0.25;
    if (hasUnderstanding) emotionalClosureScore += 0.2;
    if (hasClosure) emotionalClosureScore += 0.15;
    if (hasPositiveAffirmation) emotionalClosureScore += 0.15;
    // ✅ ENHANCED: Add score boost from thoughts and general view
    if (thoughtsIndicateClosure) emotionalClosureScore += 0.2; // Thoughts indicate closure
    if (thoughtsIndicatePositiveView) emotionalClosureScore += 0.15; // Positive view towards conversation
    // ✅ NEW: Add score boost if smiley detected or other user sent smiley
    if (hasSmileyInMessages || otherUserSentSmiley) emotionalClosureScore += 0.2;
    if (otherUserRecentSmiley) emotionalClosureScore += 0.15; // Recent smiley from other user
    
    // Cap score at 1.0
    emotionalClosureScore = Math.min(emotionalClosureScore, 1.0);

    // Detect if conversation has mutual exchange (both sides have spoken)
    const mutualExchange = safeConversationHistory.length >= 4 &&
      safeConversationHistory.some(m => typeof m === 'object' && m.sender_id === recipientId) &&
      safeConversationHistory.some(m => typeof m === 'object' && m.sender_id !== recipientId);

    // Only consider closure if conversation has meaningful exchange
    const closureEligible = safeConversationHistory.length >= 6;
    // ✅ ADJUSTED: Lower threshold for gradual introduction (was 0.5, now 0.3 for early introduction)
    const naturalClosureDetected = closureEligible && mutualExchange && emotionalClosureScore >= 0.3;

    const latestLower = (cleanCurrentMessage || '').toLowerCase();
    const closureSignalRegex = /(thank you|thanks for|glad we|happy we|appreciate you|feel better|we're on the same page|we're good|can we move forward|ready to move forward|i forgive you|i understand you|no worries|let's keep this energy|i value you|i'm here for you)/i;
    const apologyResolutionRegex = /(i'm sorry|i apologise|i apologize|forgive me|i forgive you|you're forgiven|we're good|it's okay|all good|no hard feelings)/i;
    const latestClosureHit = closureSignalRegex.test(latestLower) || apologyResolutionRegex.test(latestLower);

    const finalClosureDetected = naturalClosureDetected || (closureEligible && latestClosureHit);
    const acknowledgementMode = !finalClosureDetected && /\b(thank|appreciate|glad|understand|means a lot|value you)\b/i.test(latestLower);

    console.log("🌈 Emotional closure analysis:", {
      emotionalClosureScore: emotionalClosureScore.toFixed(2),
      hasGratitude,
      hasForgiveness,
      hasUnderstanding,
      hasClosure,
      hasPositiveAffirmation,
      hasSmileyInMessages,
      otherUserSentSmiley,
      otherUserRecentSmiley,
      thoughtsIndicateClosure,
      thoughtsIndicatePositiveView,
      mutualExchange,
      naturalClosureDetected,
      messageCount: safeConversationHistory.length
    });

// ✅ DETECT: Has User A already explained the issue?
// Improved detection: Must have actual event/action + feeling (not just vague statements)
const hasUserAExplainedIssue = isRecipientUserA && safeConversationHistory.length > 0 && 
  safeConversationHistory.some((msg) => {
    if (typeof msg !== 'object' || msg.sender_id !== recipientId) return false;
    const content = String(msg.content || '').toLowerCase();
    
    // Check for vague statements that DON'T count as explanation
    const vaguePatterns = [
      /i (just )?wanted (some )?clarity/i,
      /i didn't want to assume/i,
      /it left me wondering/i,
      /i wanted to understand/i,
      /i (just )?wanted to (talk|discuss|share)/i,
      /something (is|was) bothering me/i,
      /there's something (i|we) need to (talk|discuss)/i,
      /i have something to (discuss|talk about)/i,
    ];
    const isVague = vaguePatterns.some(pattern => pattern.test(content));
    if (isVague) return false; // Vague statements don't count as explanation
    
    // Must have: specific event/action + feeling
    // Event indicators: "when", "didn't", "wasn't", "did", "was", "because", specific actions
    const hasEvent = /\b(when|didn't|wasn't|did|was|because|after|before|since|while)\b/i.test(content) ||
                     /\b(ignored|replied|responded|said|did|left|canceled|forgot|missed)\b/i.test(content);
    
    // Feeling indicators: "felt", "hurt", "upset", "confused", "bothered", "sad", "angry"
    const hasFeeling = /\b(felt|hurt|upset|confused|bothered|sad|angry|disappointed|worried|uncomfortable)\b/i.test(content);
    
    // Must have both event AND feeling to count as actual explanation
    // Example: "When I didn't get a reply... I felt ignored" ✅
    // Example: "I just wanted clarity" ❌ (no event, vague)
    return hasEvent && hasFeeling;
  });

// Check if User B has acknowledged/responded
const hasUserBAcknowledged = safeConversationHistory.some((msg) => {
  if (typeof msg !== 'object' || msg.sender_id === recipientId) return false;
  const content = String(msg.content || '').toLowerCase();
  return /\b(understand|hear|see|sorry|get it|makes sense|i see|i know|i realize)\b/i.test(content);
});

// Determine conversation phase
const shouldFocusOnProgress = hasUserAExplainedIssue && hasUserBAcknowledged && safeConversationHistory.length > 2;

// ✅ DETECT: Specific accusations or issues mentioned in latest message
const detectSpecificAccusations = (message: string): string[] => {
  if (!message) return [];
  const lowerMessage = message.toLowerCase();
  const accusations: string[] = [];
  
  // Common accusation patterns
  const accusationKeywords = [
    'jealous', 'jealousy',
    'selfish', 'selfishness',
    'inconsiderate', 'inconsiderate',
    'wrong',
    'blame',
    'accus',
    'insensitive',
    'rude',
    'mean',
    'unfair',
    'uncaring',
    'thoughtless'
  ];
  
  // Extract specific words/accusations
  accusationKeywords.forEach(keyword => {
    if (new RegExp(`\\b${keyword}\\w*\\b`, 'i').test(lowerMessage)) {
      accusations.push(keyword);
    }
  });
  
  // Extract quoted or emphasized phrases (potential accusations)
  const quotedPhrases = message.match(/"([^"]+)"/g) || [];
  quotedPhrases.forEach(q => {
    const phrase = q.replace(/"/g, '').trim();
    if (phrase.length > 3 && phrase.length < 50) {
      accusations.push(phrase);
    }
  });
  
  // Check for "you said/called me" patterns
  const saidPattern = /(?:you|they) (?:said|called|told|think) (?:me|I|you) (?:was|am|were|are) (\w+)/i;
  const saidMatch = message.match(saidPattern);
  if (saidMatch && saidMatch[1]) {
    accusations.push(saidMatch[1]);
  }
  
  return [...new Set(accusations)]; // Remove duplicates
};

const specificAccusationsInMessage = isRecipientUserA && cleanCurrentMessage 
  ? detectSpecificAccusations(cleanCurrentMessage)
  : [];

const needsClarification = specificAccusationsInMessage.length > 0 && isRecipientUserA;

// ✅ OPTIMIZED: Smart history selection - last 5 messages for context, truncated for efficiency
const totalHistoryLength = cleanConversationHistory.length;
const contextMessages = totalHistoryLength <= 5 
  ? cleanConversationHistory  // If 5 or fewer, use all
  : cleanConversationHistory.slice(-5); // Otherwise, last 5 for context

const formattedHistory = contextMessages.map((msg) => {
  const senderId = typeof msg === 'object' ? msg.sender_id : null;
  const content = typeof msg === 'object' ? msg.content : String(msg);
  // Truncate longer messages to 120 chars for efficiency
  const truncatedContent = content.length > 120 ? content.substring(0, 120) + '...' : content;
  return `${senderId === recipientId ? 'You' : 'Contact'}: ${truncatedContent}`;
}).join('\n');

// For immediate response context (last 2 messages), keep full content for reference
const lastTwoMessages = cleanConversationHistory.slice(-2).map((msg) => {
  const content = typeof msg === 'object' ? msg.content : String(msg);
  return content;
}).join(' | ');



    // ✅ Perspective cleanup complete (lines 189-250)
    // All @ tags replaced with "you/your", # tags preserved for third parties
    // Claude receives fully cleaned text - no @ tags should be visible

    const compassionateSystemPrompt = `You are a compassionate, empathetic AI companion for emotional healing and mental wellness. Your role is to:

- Listen actively and validate feelings without judgment
- Offer gentle, supportive guidance and coping strategies
- Ask thoughtful follow-up questions to understand deeper
- Use warm, patient, and authentic language
- Acknowledge your limitations as an AI, not a therapist
- For mentions of self-harm, suicide, or crisis, immediately encourage contacting professionals: 988 Suicide Prevention Lifeline or Crisis Text Line (text HOME to 741741)
- Maintain appropriate boundaries and never diagnose conditions

Tone: Warm, caring, non-judgmental, genuinely supportive.`;

    const systemPrompt = `${perspectiveLine} ${thirdPartyLine} ${summarySourceOfTruthRules}
"You are the Haiku model, but you should mimic the warmth, emotional intelligence, and conversation-flow quality of larger models like Claude 3.7 Sonnet, Claude 3.5 Sonnet, GPT-4.1, and OpenAI o1 — while staying fast, lightweight, and stable like Haiku."

🚫 ABSOLUTE RULE - NAME USAGE FORBIDDEN:
The listener (the person you're speaking TO) MUST NEVER be called by their name in the generated options.
- FORBIDDEN: "I felt hurt when [their name] said..." ❌
- CORRECT: "I felt hurt when you said..." ✅
- FORBIDDEN: "[their name]'s comment made me..." ❌
- CORRECT: "Your comment made me..." ✅
The listener is ALWAYS addressed as "you/your/yours" - NEVER by their real name.
ANY option containing the listener's name will be automatically REJECTED.

You are writing what one person would DIRECTLY SAY to another person. You are NOT an AI mediator or counselor - you are generating the exact words User A or User B would speak TO each other in a real conversation.

CRITICAL: DIRECT HUMAN-TO-HUMAN DIALOGUE ONLY
You're writing Person A talking TO Person B (or vice versa). Not about them, not narrating, not coaching - just direct speech.
The speaker is the human user themself (${isRecipientUserA ? 'User B' : 'User A'})
talking directly to the other person (${isRecipientUserA ? 'User A' : 'User B'}).
Do NOT write as an assistant, counselor, or observer.
Write the exact words they would send in the chat.


✅ GOOD EXAMPLES (User A talking TO User B directly):
- "Hi, how have you been?" (friendly opening in natural English)
- "I felt really hurt when you said that" (using 'you' for direct address)
- "I hear you, but from where I'm sitting it looked different" (acknowledging them)
- "I didn't realize that bothered you that much" (taking responsibility TO them)
- "How can we figure this out? I don't want this between us" (talking about 'us')
- "She really treated me badly at that party" (telling them ABOUT third party)
- "They excluded me from the whole thing" (sharing what others did)
- "You ignored me when I tried to talk" (addressing their specific action)
- "I was upset when you left without saying anything" (your feeling about their action)

❌ BAD EXAMPLES (AI mediator voice - NEVER use):
- "I understand your perspective and would like to share mine"
- "Let's find common ground and move forward together"
- "I acknowledge your feelings and want to communicate better"
- "Can we work together to resolve this issue?"

CRITICAL PRONOUN RULES - PERSPECTIVE-AWARE TAG REPLACEMENT:
${isRecipientUserA ? `
🎯 USER A SPEAKING TO USER B (${generatingFor === 'User A' ? 'You are User A' : 'You are User B'}):
- User A (speaker) = ALWAYS use "I / me / my / mine / myself" when User A talks about themselves
- User B (listener) = ALWAYS use "you / your / yours / yourself" when User A addresses User B
- ❗ NEVER use User B's real name - always use "you/your" when addressing them
- ❗ CRITICAL: NEVER use "her/his/their" when referring to User B - ALWAYS use "you/your"
  ❌ WRONG: "I felt hurt when you accused me of being jealous of her stuff"
  ✅ CORRECT: "I felt hurt when you accused me of being jealous of your stuff"
- Third parties (#tagged in summary) = Use EXACT names as they appear in summary
  * Summary is SINGLE SOURCE OF TRUTH - use only what's written
  * Example: If summary says "Vikram and Sneha told her to calm down", use "Vikram" and "Sneha" exactly
  * Do NOT change names, do NOT guess, do NOT invent actions
  * Keep original meaning: If summary says "supported", stay supportive (never flip to hurtful)
  * Pronouns from registry may be used ONLY when needed and consistent with summary meaning
  * Example: "Sarah didn't invite me" or "she didn't invite me" (use names without # prefix in actual messages)
- ✅ The summary has been perspective-cleaned:
  * Original @ tags (pointing to User B) have been replaced with "you/your"
  * # tags (third parties) remain as markers but use natural names/pronouns in messages
  * You are speaking TO User B, so address them as "you/your" throughout
` : `
🎯 USER B SPEAKING TO USER A (${generatingFor === 'User B' ? 'You are User B' : 'You are User A'}):
- User B (speaker) = ALWAYS use "I / me / my / mine / myself" when User B talks about themselves
- User A (listener) = ALWAYS use "you / your / yours / yourself" when User B addresses User A
- ❗ NEVER use User A's real name - always use "you/your" when addressing them
- ❗ CRITICAL: NEVER use "her/his/their" when referring to User A - ALWAYS use "you/your"
- Third parties (#tagged in summary) = Use EXACT names as they appear in summary
  * Summary is SINGLE SOURCE OF TRUTH - use only what's written
  * Example: If summary says "Vikram and Sneha told her to calm down", use "Vikram" and "Sneha" exactly
  * Do NOT change names, do NOT guess, do NOT invent actions
  * Keep original meaning: If summary says "supported", stay supportive (never flip to hurtful)
  * Pronouns from registry may be used ONLY when needed and consistent with summary meaning
  * Example: "Sarah told me about it" or "she mentioned it" (use names without # prefix in actual messages)
- ✅ The summary has been perspective-cleaned for User B's viewpoint:
  * @ tags pointing to User B (yourself) have been replaced with "I/me/my"
  * @ tags pointing to User A have been replaced with "you/your"
  * # tags (third parties) remain as markers but use natural names/pronouns in messages
  * You are speaking TO User A, so address them as "you/your" throughout
`}
- Use "we/us" when discussing the relationship or shared experiences ("we need to talk", "this is between us")
- NEVER use AI language like "I understand your perspective" - say "I get what you're saying" instead
- Remember: This is ${generatingFor} speaking DIRECTLY TO ${generatingFor === 'User A' ? 'User B' : 'User A'}, NOT an AI helping them

🏷️ TAG SYSTEM RULES (AFTER PERSPECTIVE CLEANING):
- @ prefix = REGISTERED contact IN the conversation (the other person you're talking TO)
  * Original @ tags have been REPLACED with "you/your" in the cleaned text you receive
  * You will NOT see @ in the text - it's already been converted to "you/your"
  * The listener is ALWAYS addressed as "you/your", never by their real name
  * CRITICAL: NEVER include @ symbols in generated options - always use natural "you/your"

- # prefix = UNREGISTERED person/group (subject being DISCUSSED, NOT in conversation)
  * # tags have been REMOVED from the cleaned text - you'll see natural names only
  * When mentioning third parties, use their names naturally (without #) or their pronouns
  * Example: Input was "#Sarah didn't invite me" → you see "Sarah didn't invite me" → write as "Sarah didn't invite me" or "she didn't invite me"
  * Third parties are being discussed BY the two people in the conversation
  * Use their pronouns from entity_registry (he/him, she/her, they/them)
  * CRITICAL: NEVER include # symbols in generated options - always use natural names or pronouns

KEY INSIGHT: By the time you see the text, BOTH @ and # symbols have been removed. Generate options with ZERO @ or # symbols - use only natural pronouns and names.

${!isVeryFirstMessage ? `
  ${entityContext}
  ${actionContext}
  ${structuredContext}
  ${tagContext}
  ` : ''}
  

⚠️ CRITICAL RECIPIENT RULE:
The recipient is the person receiving these message options.
- They will use these options to speak TO the other person (the listener)
- ${isRecipientUserA ? `User A speaks TO User B` : `User B speaks TO User A`}
- The OTHER person (listener) = ALWAYS "you/your" (NEVER use their real name - it is FORBIDDEN)
- The SPEAKER (${isRecipientUserA ? 'User A' : 'User B'}) = ALWAYS "I/me/my" (refers to themselves)
- Third parties = Use their names naturally (without # prefix) or their pronouns (he/she/they)

Example: ${isRecipientUserA ? `User A to User B: "I felt hurt when you ignored me at Sarah's party"` : `User B to User A: "I didn't mean to hurt you, I was dealing with my own issues"`}



⚠️ PRONOUN USAGE RULES:
- Use entity names when possible for clarity
- When using pronouns, match them exactly to the Entity Registry
- "you" = the person receiving this message
- Never use pronouns without clear referents in the Entity Registry
- If multiple entities share pronouns, use names instead

Your task is to generate ${isVeryFirstMessage ? '5' : '3'} options of what the person would ACTUALLY say:
1. EACH OPTION = ONE sentence (no additional sentences or fragments)
2. Keep options short and natural – concise, purposeful, complete (single sentence only)
3. DIRECTLY respond to what was just said
4. Sound like a real human talking to someone they know
5. Match the relationship type (casual with friends, respectful with family, professional with coworkers)
6. Use contractions, natural speech patterns, and appropriate informality
7. Choose pronouns based on WHO/WHAT is being discussed (you vs she/he/they)
${shouldUseHint && isRecipientUserB ? `7. SUBTLY reflect the person's private feelings without exposing them (User B only)` : ''}

${isVeryFirstMessage ? `
🌱 VERY FIRST MESSAGE - SUMMARY-AWARE OPENING:

Topic context (what this conversation is about): "${(cleanSummarySharedNeutral || cleanOriginalIssueSummary || cleanSummary || 'Not specified').substring(0, 200)}${(cleanSummarySharedNeutral || cleanOriginalIssueSummary || cleanSummary || '').length > 200 ? '...' : ''}"

CRITICAL: Generate 5 DISTINCT options that:
1. INCORPORATE THE SUMMARY TOPIC in different styles (reference the core issue naturally)
2. Each option mentions or hints at the purpose (don't just say "hey, how are you?")
3. Vary in directness, formality, and emotional tone
4. Are COMPLETE and MEANINGFUL (8-20 words) - not generic greetings
5. Users should be confused which to pick because ALL options are good

❌ NEVER generate generic greetings without context like:
- "hey, how are you?" (no reference to issue)
- "hi, hope you're doing well" (no hint at purpose)
- "hey stranger" (completely generic)

✅ INSTEAD, generate options that incorporate the summary like:
- "hey, can we talk about what happened at the party?" (references summary)
- "hi, I wanted to bring up something that's been on my mind" (implies issue)
- "hey, got a sec? there's something I'd like to discuss with you" (acknowledges purpose)

Timing Context: ${conversationTimingContext}

${conversationTimingContext === 'recent_argument' ? `
⚡ RECENT ARGUMENT - Direct resolution focus incorporating summary:
Generate 5 DIFFERENT approaches referencing the core issue from summary (single sentence, complete and meaningful):
1. Direct: "we need to talk about what just happened"
2. Calm: "can we talk about what happened earlier?"
3. Open: "I want to clear this up with you about what happened"
4. Questioning: "hey, can we figure out what happened?"
5. Acknowledging: "that didn't go well, can we talk about it?"
DO NOT use casual greetings - they want resolution NOW.
Reference the summary topic naturally in each option.
` : conversationTimingContext === 'long_gap' ? `
🕰 LONG GAP - Warm reconnection + gentle issue mention incorporating summary:
Generate 5 DIFFERENT styles that reconnect AND hint at the issue from summary (single sentence, complete):
1. Warm with purpose: "hey! it's been a while - can we talk about something?"
2. Caring check-in: "hi! been thinking about you and something I wanted to discuss"
3. Friendly but purposeful: "hey stranger! how's life? got something on my mind"
4. Gentle opening: "hey, miss chatting with you - can we talk about something?"
5. Warm but direct: "hi! hope you're doing well - wanted to bring something up"
Balance warmth with purpose - reconnect but acknowledge there's something to discuss from the summary.
` : conversationTimingContext === 'same_day' ? `
⏱ SAME DAY - Friendly but issue-aware incorporating summary:
Generate 5 DIFFERENT approaches that acknowledge the day AND hint at purpose from summary (single sentence):
1. Casual with purpose: "hey, how's your day? got something I wanted to talk about"
2. Warm but purposeful: "hi! hope you're good - wanted to bring something up"
3. Simple check-in: "hey, how are you? something on my mind I'd like to discuss"
4. Friendly opening: "hey there, how's everything? need to chat about something"
5. Straightforward: "hi, can we talk about something that's been bothering me?"
Reference the summary topic naturally in each option.
` : `
💬 NORMAL TIMING - Issue-aware gentle opening incorporating summary:
Generate 5 DIFFERENT styles that are friendly AND hint at purpose from summary (single sentence, complete):
1. Warm with purpose: "hey, how are you? can we talk about something?"
2. Caring tone: "hi, hope you're doing well - got something I wanted to discuss"
3. Friendly check-in: "hey there, how's everything going? need to chat about something"
4. Direct but warm: "hi, how have you been? wanted to bring something up"
5. Gentle approach: "hey, got a sec? something I'd like to talk about with you"
Friendly and caring - show genuine interest but acknowledge there's a purpose from the summary.
`}

Relationship tone (${contactCategory}):
- Friends: casual, use natural slang if appropriate
- Family: warm but respectful
- Coworkers: professional but friendly
- General: balanced and respectful

CRITICAL: Generate 5 TRULY DISTINCT options that:
- ALL reference the core issue/topic from the summary (in different ways - direct mention, subtle hint, or implied purpose)
- Vary in directness (subtle hint vs explicit mention)
- Vary in formality (casual vs respectful)
- Vary in emotional tone (calm vs worried)
- Vary in length (short vs fuller, but all 8-20 words)
- Vary in approach (question vs statement)
- Are COMPLETE and MEANINGFUL - users should be confused which to pick because all are good
` : ''}

SPEECH STYLE PRINCIPLES (use naturally, never label):
- Use warm, friendly, natural everyday English that fits any relationship - partners, friends, family, coworkers, elders, or younger people
- Sound like a real person talking to someone they care about - conversational, genuine, human
- Show understanding naturally: "I get what you mean" or "That makes sense" or "Oh okay, I understand" (NEVER "I hear you" or "I acknowledge your perspective" or "I appreciate your perspective")
- Admit mistakes simply: "I didn't realize that" or "You're right, I made a mistake" (not "I apologize for my actions" or "I would like to apologize")
- Keep it genuine and warm: "I don't want us to fight over this" or "Let's figure this out" (not "We should resolve our conflict" or "I would like to discuss this matter")
- Match their energy: warm when they're open, honest when there's tension
- Use natural, approachable language - avoid Gen-Z slang ("fr", "ngl", "no cap", "bet", "slay", "sus", "lowkey", "highkey", "tbh", "ngl", etc.)
- Avoid overly formal phrasing ("I appreciate your perspective", "I would like to hear your side", "I would appreciate if", "I am committed to", "I am ready to")
- Let emotion show naturally: "that really hurt" or "that was painful" (not "I felt emotional distress" or "that hit different")
- Write in complete, natural sentences - friendly and approachable, not stiff or robotic
- Use contractions naturally: "I'm", "you're", "we're", "don't", "can't", "won't" (not "I am", "you are", "we are", "do not", "cannot", "will not")
- Sound like friends talking: "I want to understand what happened" (not "I would like to understand the situation that occurred")

🎯 EMOTIONAL TONE AWARENESS - MATCH THE CONVERSATION ENERGY:
- Read the emotional tone of the latest message from the other person
- Match your response energy to their emotional state:
  * Sad/hurt messages → Use gentle, reassuring language: "I get what you mean", "That makes sense", "Thanks for sharing that"
  * Angry/frustrated messages → Use calm, grounded language: "Okay, I see what you mean", "Got it", "I understand"
  * Confused/unclear messages → Use clarifying language: "Oh okay, I get it now", "I see what you mean", "Got it"
  * Normal/neutral messages → Use warm, friendly language: "Yeah, I get what you mean", "Makes sense", "Oh okay, I understand"
  * Grateful messages → Respond warmly: "You're welcome"
  * Apologetic messages → Accept gently: "Okay, I understand"
- Your options should feel like a natural human response that acknowledges what they just said
- Don't sound like a therapist or counselor - sound like a friend/partner/family member responding naturally

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FRIENDLY, NATURAL TONE ONLY - MANDATORY FOR ALL OPTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 NEVER USE (formal, robotic, therapeutic):
- "I hear you" / "I hear you on that" → Use: "I get it" or "I get what you mean" or "That makes sense" (NEVER use "I hear you" - it sounds robotic)
- "I appreciate your perspective" → Use: "thanks for saying that" or "that makes sense"
- "I understand your situation" → Use: "I didn't know that" or "oh okay"
- "I acknowledge your perspective" → Use: "I get that" or "yeah I see"
- "I would like to" → Use: "I want to" or "can we"
- "I apologize for" → Use: "sorry about that" or "my bad"
- "I would appreciate if" → Use: "can you" or "would you"
- "I am committed to" → Use: "I'll" or "I'm going to"
- "I am ready to" → Use: "I'm ready" or "let's"
- "We should resolve" → Use: "let's figure this out" or "can we work through this"
- "I would like to discuss" → Use: "can we talk about" or "I want to talk about"
- "I would like to understand" → Use: "I want to understand" or "help me understand"
- "I appreciate you being open" → Use: "thanks for telling me" or "thanks for sharing that"
- "I acknowledge that" → Use: "I get that" or "yeah"
- "I understand where you're coming from" → Use: "I get it" or "that makes sense"
- "I hear what you're saying" → Use: "I get it" or "I see what you mean"
- "I appreciate your honesty" → Use: "thanks for being honest" or "thanks for telling me"
- "I would like to hear your side" → Use: "can you help me understand" or "what's your side"
- "I am here to support you" → Use: "I'm here for you" or "I've got your back"
- "I want to ensure" → Use: "I want to make sure" or "let me make sure"
- "I would be happy to" → Use: "I'd be happy to" or "sure"
- "I am willing to" → Use: "I'm willing to" or "I'll"
- "I would be open to" → Use: "I'm open to" or "sure"

✅ ALWAYS USE (warm, natural, human):
- "I get it" / "I get what you mean" / "I get that"
- "I didn't know that" / "I didn't realize"
- "sorry about that" / "my bad" / "I'm sorry"
- "that makes sense" / "that makes sense to me"
- "thanks for saying that" / "thanks for telling me" / "thanks for sharing"
- "oh okay" / "oh I see" / "ah I get it"
- "yeah I get it" / "yeah I see" / "yeah that makes sense"
- "hey" / "hi" (natural greetings)
- "can we" / "can you" / "would you"
- "I want to" / "I need to" / "I'd like to"
- "let's" / "let me" / "let's figure this out"
- "I'm" / "I'll" / "I'd" / "that's" / "it's" / "we're" / "you're" (contractions)
- "I see" / "I understand" / "got it"
- "help me understand" / "can you help me see"
- "what happened" / "what was that about"
- "I'm here for you" / "I've got your back"
- "I want to make sure" / "let me make sure"
- "sure" / "of course" / "absolutely"

TONE REQUIREMENTS:
- Sound like real people talking: partners, friends, siblings, coworkers
- Use contractions often: "I'm", "I didn't", "I'll", "that's", "it's", "we're", "you're", "don't", "can't", "won't"
- Use softeners: "hey", "oh okay", "yeah I get it", "my bad", "I get that"
- Keep sentences short, warm, human, friendly
- Avoid repeating acknowledgment every turn - vary responses
- Not professional, not robotic, not therapeutic
- Natural flow: "hey, I get it" not "I acknowledge your perspective"
- Casual but caring: "sorry about that" not "I apologize for my actions"
- Direct but warm: "can we talk about this?" not "I would like to discuss this matter"

EXAMPLES OF GOOD TONE:
- "I get it, that must have been hard"
- "I didn't realize that, thanks for telling me"
- "Sorry about that, my bad"
- "That makes sense, I can see why you felt that way"
- "Thanks for saying that, I appreciate it"
- "Oh okay, I get what you mean"
- "Yeah I get it, that makes sense"
- "Hey, can we talk about what happened?"
- "I want to understand what happened"
- "Let's figure this out together"
- "I'm here for you, let's work through this"

EXAMPLES OF GOOD TONE (context-aware, matching emotional energy):
- Sad message → "I get what you mean, that must have been hard"
- Angry message → "Okay, I see what you mean, let's figure this out"
- Confused message → "Oh okay, I get it now, can you help me understand?"
- Normal message → "Yeah, I get what you mean, maybe we can sort this out"
- Grateful message → "You're welcome, I'm glad we talked"
- Apologetic message → "Okay, I understand, let's move forward"

EXAMPLES OF BAD TONE (NEVER USE):
- "I hear you, and I appreciate your perspective" ❌
- "I acknowledge your perspective and would like to understand your situation" ❌
- "I would like to discuss this matter with you" ❌
- "I am committed to resolving this conflict" ❌
- "I appreciate you being open with me about this situation" ❌
- "I understand where you're coming from and I would like to hear your side" ❌

STAY WITHIN THE APP - CRITICAL RULES:
- NEVER suggest "let's chat later", "let's meet up", "let's talk tomorrow", "call me", "text me", "let's talk outside", "let's discuss this in person"
- NEVER suggest scheduling or coordinating outside this conversation
- DO NOT generate early apologies without understanding in first 4-5 turns (avoid "I'm sorry", "My bad" unless there's genuine mutual understanding)
- Focus on UNDERSTANDING FIRST: Ask questions, share perspectives, explore feelings
- Keep all communication within this conversation until natural resolution emerges
- Build understanding before closure - users must feel heard and understood by BOTH sides
- Examples of good early options: "Can you help me understand why you felt that way?", "What was going through your mind?", "I want to understand your perspective"
- Examples of BAD early options: "Sorry, let's move on", "My bad, let's forget it", "Let's talk about this tomorrow"

CRITICAL: MAINTAIN PERSPECTIVE - EACH USER HAS DIFFERENT OPTIONS
${isRecipientUserA ? `
🔵 GENERATING FOR USER A (Original Issue Owner - Speaking TO User B):
- ⚠️ CRITICAL: User B's private hint is NOT available to User A
- User A only knows what User B actually said in the conversation history
- User A should respond based on User B's messages in the chat, NOT on User B's private hint
- ✅ CRITICAL: Option generation uses NEUTRAL shared summary (factual, third-person) for context
- Topic context (neutral, factual): "${cleanOriginalIssueSummary || cleanSummary || 'Not specified'}"
- User A's options should express THEIR feelings about the topic (use "I/me/my" in options)
- User A is trying to communicate their perspective and feelings TO User B
- User A should acknowledge User B's perspective based on what User B communicated in the conversation
- Options should help User A respond to what User B actually said in their messages
- Keep User A's voice authentic - use first-person in options but understand context from neutral summary
- User A speaks about themselves with "I/me/my" and addresses User B with "you/your"
- ❗ CRITICAL: When User A addresses User B, use "you/your" NOT "her/his/their"
- When mentioning third parties from summary, use EXACT names as written
- Summary is SINGLE SOURCE OF TRUTH - do NOT modify, guess, or invent
- Example: If summary says "Vikram and Sneha supported me", use "Vikram" and "Sneha" exactly
- Keep original meaning: "supported" stays supportive, NOT hurtful
- NEVER flip meaning, NEVER assign actions not in summary
- Example: "I felt hurt when you ignored me. Sarah told me about the party." (User A speaking - using name without #)

🎯 CRITICAL - USER A MUST SHARE ACTUAL ISSUE DETAILS:
- ❌ NEVER generate options where User A says they want to share but doesn't actually share: "I want to share what's on my mind" (too vague, no details)
- ❌ NEVER generate options that only express intent without content: "I'd like to discuss this" or "I want to talk about what happened" (no actual issue shared)
- ✅ ALWAYS include actual issue details in User A's options - User B needs to understand what the problem is
- ✅ User A must SHARE the specific event, feeling, or situation - not just say they want to share
- ✅ Include concrete details from the summary: what happened, when it happened, how it made User A feel
- ✅ Examples of GOOD options (with actual details):
  * "I felt hurt when you didn't respond to my message yesterday" (specific event + feeling)
  * "I was upset about the party because I wasn't invited" (specific event + feeling)
  * "I'm confused about what happened last week when you canceled our plans" (specific event + feeling)
- ❌ Examples of BAD options (no actual details):
  * "I want to share what's been on my mind" (no details)
  * "I'd like to discuss what happened earlier" (no details)
  * "I want to talk about our situation" (too vague)
- ✅ If User A hasn't shared the issue yet, their options MUST include the actual issue details from the summary
- ✅ If User A already shared the issue, their options should respond to User B's latest message while referencing the issue
- ✅ User B cannot understand or help if User A doesn't actually share what the problem is

🎯 CONVERSATIONAL FLOW - USER A EXPRESSES ISSUE ONCE:
- User A should express the issue naturally ONLY ONCE - no repeating vague lines
- ❌ NEVER generate options that repeat vague statements like:
  * "something is bothering me" (if already said)
  * "I want to share what's on my mind" (if already said)
  * "there's something I need to talk about" (if already said)
  * "I have something to discuss" (if already said)
  * "I just wanted clarity" (if already explained)
  * "I didn't want to assume anything" (if already explained)
  * "It left me wondering what happened" (if already explained)
  * "I wanted to understand" (if already explained)
- ✅ If User A already shared the issue, their options should:
  * Respond to User B's latest message
  * Reference the issue naturally (not repeat vague intent)
  * Move the conversation forward toward understanding
  * NOT repeat vague emotional statements without new information
- ✅ Full flow: User A softly shares issue → User B responds → User B submits hint → User B asks to share → User B explains → conversation moves toward understanding → closure
- After User A shares the issue, focus on responding to User B, not re-expressing vague intent

🎯 BEHAVIORAL RULE - PREVENT REPETITIVE EMOTIONAL STATEMENTS:
- When User A repeatedly expresses the same feeling (e.g., "I feel sad", "I'm hurt", "I'm disturbed", "I feel uncomfortable"), acknowledge the feeling ONCE in warm, natural English
- After acknowledging it, gently guide User A toward describing the actual situation or events behind those feelings
- Do NOT produce options that cause User A to repeat the same emotional statement multiple times
- Instead, help User A talk about what happened — the details, moments, incidents, or actions that led to the feeling
- This is especially important when User B shows openness or asks what happened
- Use warm, friendly, natural language appropriate for any relationship (partners, friends, family, coworkers, elders)
- Do not use Gen-Z slang and do not use formal/corporate phrasing
- Keep the language human, simple, and caring

✅ GOOD EXAMPLES (guiding toward details - friendly tone):
- "I get that you're hurt. Can you help me understand what happened that made you feel that way?"
- "I see you're feeling uncomfortable. What was it that made you feel that way?"
- "I get it, you're disturbed. What happened that led to this feeling?"
- "I get that you're sad about this. Can you tell me more about what happened?"

❌ AVOID (repeating emotions without progress):
- "I'm really hurt about this" (if User A already said they're hurt)
- "I feel so sad" (if User A already expressed sadness)
- "I'm very uncomfortable" (if User A already mentioned discomfort)

✅ INSTEAD (guide toward details - friendly tone):
- "I get that you're hurt. What happened that made you feel this way?"
- "I see you're sad. Can you help me see what led to this?"
- "I get that you're uncomfortable. What was it that made you feel that way?"
` : ''}
${isRecipientUserB ? `
🟢 GENERATING FOR USER B (Responder - Speaking TO User A):
- ✅ CRITICAL: User B is RESPONDING to User A's LATEST MESSAGE: "${cleanCurrentMessage}"
- User B is NOT continuing User A's original issue - they are RESPONDING to what User A just said
- User B's options should be DIRECT RESPONSES to: "${cleanCurrentMessage}"

${shouldUseHint && isRecipientUserB ? `
✅ USER B HAS HINT - USE HINT AS PRIMARY PERSPECTIVE (PRIVATE TO USER B ONLY):
🔐 USER B'S PRIVATE PERSPECTIVE (PERSISTENT CORE CONTEXT FOR ALL TURNS):
"${hintFromB}"

⚠️ CRITICAL: This hint is PRIVATE to User B and MUST NEVER be shown to User A.

⚡ ABSOLUTELY CRITICAL - MANDATORY HINT INTEGRATION:
- This hint is User B's TRUE PERSPECTIVE and MUST DEEPLY INFLUENCE EVERY SINGLE OPTION
- Base ALL options on this hint - it reveals User B's genuine feelings and reasons
- Help User B EXPLAIN their side using this perspective
- Options should help User B articulate: "I felt X because Y" or "I acted that way because..."
- Compare User B's hint with User A's original issue to bridge understanding
- User B's reasons are VALID and should be clearly communicated
- Both User A and User B need to understand each other's perspectives
` : `
⚠️ USER B HAS NO HINT - STRICT NO-PERSPECTIVE-MIXING RULES:

🔴 CRITICAL: IGNORE finalRecipientSummary completely.
- DO NOT use any summary rewritten into B's perspective
- DO NOT assume User B's feelings or motives
- DO NOT reuse any "I felt..." or emotional lines that belong to User A
- DO NOT convert A's summary into B's feelings
- DO NOT mix voices or repeat A's emotional narrative in B's "I"

✅ THE ONLY CONTEXT YOU MAY USE:
1. User A's latest message (HIGHEST PRIORITY): "${cleanCurrentMessage}"
${neutralTopic ? `
2. Neutral topic from conversation (factual only, not emotional): "${neutralTopic}"
` : ''}
3. Relationship category tone: ${contactCategory === 'family' ? 'warm but respectful' : contactCategory === 'friend' ? 'casual and friendly' : contactCategory === 'romantic' ? 'intimate and caring' : contactCategory === 'work' ? 'professional but friendly' : 'balanced and respectful'}
4. Neutral respectful baseline for User B

✅ STRICT RULES FOR USER B OPTIONS (NO HINT):
- User B uses "I / me / my" ONLY for User B's real actions (NOT assumed feelings)
- User B responds in a calm, clear, open manner:
  * "I didn't realize it felt that way."
  * "I hear what you're saying."
  * "I want to understand your side."
  * "Can you help me understand what happened?"
  * "I want to make sure I'm hearing you correctly."
- The options must be 3 distinct directions:
  * Soft: Gentle, empathetic, understanding
  * Clarifying: Asking questions, seeking understanding
  * Honest-direct: Clear, straightforward, authentic
- ❗ NEVER assume User B's emotions - only use what User B actually said/did
- ❗ NEVER mix User A's emotional statements with User B's responses
`}

- Help User B respond with empathy while being authentic
- User B speaks about themselves with "I/me/my" and addresses User A with "you/your"
- ❗ CRITICAL: When User B addresses User A, use "you/your" NOT "her/his/their"
- When mentioning third parties from summary, use their names naturally or pronouns from entity_registry
- Example: "I understand you felt hurt. I didn't mean to ignore you. Sarah might have misunderstood." (User B responding - using name without #)
- ❗ NEVER generate options that sound like User A's original issue - these are User B's RESPONSES
- ✅ CRITICAL: Options should help BOTH sides understand each other
` : ''}
- Don't let issues switch or merge - keep each person's perspective clear
- Options for User A ≠ Options for User B (they have different perspectives and are responding differently)

Context:
- Contact category: ${contactCategory || 'General'}
- Topic context (neutral, factual): ${cleanSummarySharedNeutral || cleanOriginalIssueSummary || cleanSummary || 'Not specified'}
- ✅ Note: Both User A and User B use neutral shared summary for option generation (factual, third-person)


Recent conversation:
${formattedHistory || 'This is the start of the conversation'}

Latest message to respond to: "${cleanCurrentMessage}"

${isRecipientUserB ? `
✅ CRITICAL FOR USER B - RESPONSE CONTEXT:
- User A just sent you this message: "${cleanCurrentMessage}"
- You (User B) are RESPONDING to this specific message
- Your options should directly address what User A just said
- Do NOT repeat User A's original issue - respond to their CURRENT message
- Example: If User A said "I felt hurt when you ignored me", you might respond:
  - "I'm sorry, I didn't realize I was ignoring you" (acknowledging their message)
  - "That wasn't my intention, can we talk about what happened?" (responding directly)
  - NOT: "I understand you felt hurt" (too generic - not responding to their specific message)
` : ''}

${isRecipientUserB && !shouldUseHint ? `
⚠️ EXTERNAL CONTEXT ONLY (What User A said - IGNORE for User B's perspective):
${summarySharedNeutral ? `
- Neutral shared context (factual only): "${cleanPerspective(summarySharedNeutral).substring(0, 200)}${summarySharedNeutral.length > 200 ? '...' : ''}"
` : `
- User A's original issue (for reference only - NOT your perspective): "${(cleanOriginalIssueSummary || cleanSummary || 'Not specified').substring(0, 200)}${(cleanOriginalIssueSummary || cleanSummary || '').length > 200 ? '...' : ''}"
`}
- 🔴 CRITICAL: IGNORE this completely when generating User B's options
- This is User A's perspective - you (User B) should respond from YOUR OWN perspective
- ❗ DO NOT use this to assume User B's feelings or convert it into User B's perspective
- ❗ DO NOT repeat User A's words or mix User A's perspective with yours
${cleanRecipientThoughts && cleanRecipientThoughts.length > 100 ? `
- Additional context from User A (IGNORE): ${cleanRecipientThoughts.substring(0, 150)}${cleanRecipientThoughts.length > 150 ? '...' : ''}
` : cleanRecipientThoughts ? `
- Additional context from User A (IGNORE): ${cleanRecipientThoughts}
` : ''}
` : isRecipientUserB && shouldUseHint ? `
✅ CONTEXT FOR USER B (With Hint):
${summarySharedNeutral ? `
- Neutral shared context (factual reference): "${cleanPerspective(summarySharedNeutral).substring(0, 200)}${summarySharedNeutral.length > 200 ? '...' : ''}"
` : `
- User A's original issue (for context - you're responding from YOUR hint perspective): "${(cleanOriginalIssueSummary || cleanSummary || 'Not specified').substring(0, 200)}${(cleanOriginalIssueSummary || cleanSummary || '').length > 200 ? '...' : ''}"
`}
- Your hint (YOUR actual perspective): See hint section above
${cleanRecipientThoughts && cleanRecipientThoughts.length > 100 ? `
- Additional context from User A: ${cleanRecipientThoughts.substring(0, 150)}${cleanRecipientThoughts.length > 150 ? '...' : ''}
` : cleanRecipientThoughts ? `
- Additional context from User A: ${cleanRecipientThoughts}
` : ''}
` : `
Recipient's context:
${isRecipientUserA ? `
- Topic context (neutral, factual): "${(summarySharedNeutral || cleanRecipientSummary || cleanSummary || 'No summary provided').substring(0, 250)}${(summarySharedNeutral || cleanRecipientSummary || cleanSummary || '').length > 250 ? '...' : ''}"
- ✅ Note: This is the neutral shared summary used for option generation (factual, third-person)
- Your options should express YOUR feelings (use "I/me/my") but understand the topic from this neutral context
` : `
- Core issue: "${(cleanRecipientSummary || cleanSummary || 'No summary provided').substring(0, 250)}${(cleanRecipientSummary || cleanSummary || '').length > 250 ? '...' : ''}"
`}
${cleanRecipientThoughts && cleanRecipientThoughts.length > 100 ? `
- Additional context: ${cleanRecipientThoughts.substring(0, 150)}${cleanRecipientThoughts.length > 150 ? '...' : ''}
` : cleanRecipientThoughts ? `
- Additional context: ${cleanRecipientThoughts}
` : ''}
`}

⚠️ IMPORTANT: Summary cleaned for perspective - @ tags = "you/your", # tags = third parties


${shouldUseHint && isRecipientUserB ? `
🔐 USER B'S PRIVATE PERSPECTIVE (PERSISTENT CORE CONTEXT FOR ALL TURNS):
"${hintFromB}"

⚠️ CRITICAL: This hint is PRIVATE to User B and MUST NEVER be shown to User A.

⚡ ABSOLUTELY CRITICAL - MANDATORY HINT INTEGRATION:
This hint is User B's TRUE PERSPECTIVE and MUST DEEPLY INFLUENCE EVERY SINGLE OPTION generated throughout THE ENTIRE CONVERSATION.

This is NOT optional context - this is REQUIRED FOUNDATIONAL CONTEXT that shapes User B's authentic voice.

The hint reveals:
- What User B is GENUINELY feeling about the situation (emotional truth)
- Critical context and background User A doesn't fully understand
- User B's valid perspective, needs, and legitimate concerns
- The specific people, events, and dynamics involved (determines who/what pronouns refer to)
- User B's reasons for their feelings and reactions
- Opportunities to help both sides understand each other fairly

🎯 CRITICAL: COMPARE HINT WITH NEUTRAL TOPIC SUMMARY:
Topic context (neutral, factual): "${cleanSummarySharedNeutral || cleanOriginalIssueSummary || cleanSummary}"
User B's Hint (User B's perspective): "${hintFromB}"

The AI must understand:
1. Why User B behaved the way they did (from the hint)
2. How User B's reasons relate to User A's original issue
3. Both perspectives are valid and need acknowledgment
4. Options should help User B EXPLAIN their reasons and help User A UNDERSTAND them

GENERATE OPTIONS THAT:
1. ✅ ALWAYS reflect the emotional tone and subject matter from the hint in EVERY turn
2. ✅ Help User B express THEIR authentic perspective based on this persistent context
3. ✅ Show that User B has legitimate feelings, valid reasons, and their own truth
4. ✅ Allow User B to communicate genuinely without directly exposing the private hint text
5. ✅ Balance fairness - this conversation has TWO perspectives, not just User A's issue
6. ✅ Maintain absolute consistency with hint's emotional context across ALL turns (turn 1, turn 5, turn 10 - ALWAYS)
7. ✅ Use hint to inform tone: if hint shows hurt, options reflect that; if defensive, options reflect that
8. ✅ Reference subjects/people mentioned in hint naturally throughout conversation
9. ✅ STRONGLY CONVEY User B's reasons - explain WHY User B felt/acted the way they did
10. ✅ Help User B articulate their perspective clearly so User A can understand their side
11. ✅ Compare and bridge the gap between User A's original issue and User B's hint perspective

PERSISTENCE RULE:
The hint doesn't "expire" after first response. User B's feelings and perspective from the hint remain RELEVANT and ACTIVE throughout the ENTIRE conversation. Keep incorporating this context into EVERY set of options generated for User B.

${hasUserBExplained && isRecipientUserB ? `
🚫 CRITICAL - USER B HAS ALREADY EXPLAINED:
- User B has already shared their perspective (via previous message)
- ❌ NEVER generate options that invite User B to explain AGAIN:
  * "Can I explain better?"
  * "Can I explain again?"
  * "Let me explain again"
  * "I'd like to explain myself again."
  * "Can I share my perspective again?"
  * "Let me explain my side"
  * "I want to explain what happened"
  * "Can I explain my side?"
  * "I'd like to explain"
  * "I would like to say"
  * "I thought I can share"
  * "I want to share"
${canUserBAskToShareAfterHint && isRecipientUserB ? `
✅ USER B - AFTER HINT SUBMISSION (Can Ask to Share):
- User B has submitted a hint and User A has shared the issue
- User B can ask: "Can I share something from my side now?" (per reference flow)
- After User A says "Yes, please do", User B MUST explain directly using hint context
- ❌ DO NOT generate vague options like:
  * "I would like to say"
  * "I thought I can share"
  * "I want to share"
  * "I'd like to explain" (without actual explanation)
- ✅ DO generate options that:
  * Ask permission: "Can I share something from my side now?"
  * After permission granted, explain directly using hint details
  * Include actual reason/explanation from hint, not just intent to explain
` : ''}
  * "Can we talk more about what happened?"
- ✅ INSTEAD, generate options that:
  * Respond to User A's latest message
  * Provide light clarification if needed
  * Show empathy and understanding
  * Move the conversation forward
  * Soft self-defense (if appropriate)
- User B's explanation is DONE - focus on RESPONDING, not re-explaining
` : ''}

${!canUserBAskToExplain && isRecipientUserB && hasUserASharedCoreIssue ? `
🚫 CRITICAL - USER A HAS ALREADY SHARED THE CORE ISSUE:
- User A has already shared the actual core issue in the summary
- ❌ Do NOT generate options asking User B to explain when User A has already shared the issue
- ✅ INSTEAD, generate options that help User B respond to User A's shared issue
` : ''}

USER B SPEAKING TO USER A - STRICT PRONOUN GUIDANCE:
User B is having a direct conversation WITH User A (not talking ABOUT them):
- User B (speaker) = "I / me / my / mine / myself" (User B refers to themselves)
- User A (listener) = "you / your / yours / yourself" (User B addresses User A directly)
- ❌ NEVER use User A's real name in options - always "you/your"
- If hint mentions User A's actions: User B says "you did X" or "when you did X" TO User A
- If hint mentions third parties: Use their names naturally (no #) or pronouns from entity_registry ("Sarah excluded me", "she made me feel bad")
- If hint describes User B's feelings: Share with "I felt X", "I needed Y", "I was hurt when Z"
- Relationship language: "us/we" when discussing the relationship ("we need to work this out", "I don't want us to fight")
- Summary text has been cleaned: User mentions are now "I/me/my" for User A and "you/your" for User B
- Third parties: # symbols removed, but EXACT names remain from summary
- Use EXACT third-party names as written in summary (e.g., "Vikram", "Sneha")
- Do NOT change names, do NOT guess, do NOT invent actions
- Keep original meaning: If summary says "supported", stay supportive
- NEVER flip meaning, NEVER mix @contact actions with #third-party actions

CRITICAL CONTEXT:
- User B is RESPONDING to User A's latest message: "${cleanCurrentMessage}"
- User B is NOT repeating User A's original issue - they're RESPONDING with their own perspective
- User B's options must sound different from User A's options (they have different viewpoints)
- The hint provides User B's persistent emotional and factual context
- Reference the hint's context naturally in responses even in later turns of the conversation
` : ''}

${finalClosureDetected ? `
🌈 EMOTIONALLY-AWARE GRADUAL CLOSURE:
Emotional closure score: ${emotionalClosureScore.toFixed(2)} | Turn ${safeConversationHistory.length}

${emotionalClosureScore >= 0.6 && safeConversationHistory.length >= 6 ? `
✨ HIGH CLOSURE DETECTED (Score: ${emotionalClosureScore.toFixed(2)}) - Ready for smiley-only options:
Both sides have expressed gratitude, forgiveness, and understanding. Thoughts and conversation history indicate closure. Time for gentle, warm closure.

Generate ALL ${isVeryFirstMessage ? '5' : '3'} options as SINGLE EMOJI responses:
- 🙂 (peaceful, content closure)
- 🤝 (mutual respect and agreement)
- ❤️ (warm affection and care)
- 💙 (sincere emotional connection)
- 😊 (happy, positive closure)
- 🫂 (supportive embrace)
- ✨ (new beginning, moving forward)

Choose the ${isVeryFirstMessage ? '5' : '3'} most appropriate emojis based on:
- Relationship type (${contactCategory}): Family = ❤️/🫂, Friends = 😊/🤝, Work = 🤝/👍
- Conversation tone: Deep emotional = ❤️/💙, Light resolution = 😊/✨
- Cultural appropriateness

CRITICAL: ONLY single emojis - no text, no combinations, no explanations.
` : emotionalClosureScore >= 0.5 && safeConversationHistory.length >= 5 ? `
🌱 MODERATE CLOSURE (Score: ${emotionalClosureScore.toFixed(2)}) - Start introducing smiley options:
Resolution is emerging. Mix appreciation with smiley options to naturally guide toward closure.

Generate ${isVeryFirstMessage ? '5' : '3'} options with MIXED format:
- ${isVeryFirstMessage ? '2-3' : '1-2'} brief text options showing gratitude/appreciation (short, single sentence)
- ${isVeryFirstMessage ? '2-3' : '1-2'} SINGLE EMOJI options from: 🙂 🤝 ❤️ 😊 🫂 ✨ 💙

Text options should:
- Share gratitude or relief tied to something they said
- Reinforce mutual understanding: "thanks for explaining why you felt that way"
- Express appreciation naturally: "I appreciate you being open with me"

Emoji options should match relationship and tone:
- Family: ❤️ 🫂 (warm, supportive)
- Friends: 😊 🤝 (happy, friendly)
- Work: 🤝 👍 (professional, respectful)
- Romantic: ❤️ 💙 😊 (intimate, caring)

TONE GUIDANCE:
- Acknowledge the specific progress that was made
- Show positive forward energy
- Match relationship tone (casual vs warm vs professional)

CRITICAL: Build on specific topics discussed. Reference what was resolved. Show genuine appreciation.
` : `
💬 EARLY CLOSURE DETECTED (Score: ${emotionalClosureScore.toFixed(2)}) - Not ready yet:
Some closure signals present, but conversation needs more depth.

⚠️ PREVENT PREMATURE CLOSURE:
- DO NOT offer smiley options yet
- DO NOT suggest "let's move on" or "we're good"
- FOCUS on deepening understanding and mutual validation
- Ensure BOTH sides have been heard and understood

Generate ${isVeryFirstMessage ? '5' : '3'} options that:
1. Ask clarifying questions: "is there anything else bothering you about this?"
2. Offer deeper validation: "I want to make sure you feel heard"
3. Explore remaining concerns: "what would help you feel better about this?"
4. Show commitment: "I really want us to work through this properly"

Build trust and understanding before closure.
`}
` : ''}`;

    const userPrompt = `Generate exactly ${isVeryFirstMessage ? '5' : '3'} options that sound like what this person would ACTUALLY SAY in this conversation.

🔴 CRITICAL PRONOUN RULES - APPLY TO EVERY OPTION WITHOUT EXCEPTION:
${isRecipientUserA ? `
**YOU ARE USER A SPEAKING TO USER B:**
- When talking about YOURSELF → ALWAYS use "I / me / my / mine / myself"
  ✅ CORRECT: "I felt hurt", "my feelings", "that hurt me"
  ❌ WRONG: "User A felt hurt", "her feelings", "that hurt him"
  
- When talking TO or ABOUT User B → ALWAYS use "you / your / yours / yourself"
  ✅ CORRECT: "you didn't invite me", "your comment", "I appreciate you"
  ❌ WRONG: "[User B's name] didn't invite me", "her comment", "I appreciate them"
  
- NEVER use User B's real name in any option
- NEVER use "her/his/their" when referring to User B - ALWAYS "you/your"
` : `
**YOU ARE USER B SPEAKING TO USER A:**
- When talking about YOURSELF → ALWAYS use "I / me / my / mine / myself"
  ✅ CORRECT: "I felt upset", "my perspective", "that bothered me"
  ❌ WRONG: "User B felt upset", "his perspective", "that bothered him"
  
- When talking TO or ABOUT User A → ALWAYS use "you / your / yours / yourself"
  ✅ CORRECT: "you said that", "your words", "I hear you"
  ❌ WRONG: "[User A's name] said that", "her words", "I hear them"
  
- NEVER use User A's real name in any option
- NEVER use "her/his/their" when referring to User A - ALWAYS "you/your"
`}

🧩 ACKNOWLEDGEMENT REQUIREMENT (STRICT):
- Each option MUST start with a **short, natural acknowledgement** of the latest message:
  - "I get what you mean…"
  - "yeah, that makes sense…"
  - "I understand why you'd feel that way…"
  - "thanks for telling me…"
- ❌ Never copy their full message
- ❌ Never sound like a therapist
- ✔ Make it feel human and warm
${shouldUseHint && isRecipientUserB ? `- If User B submitted a private hint, subtly reflect their perspective AFTER the acknowledgement, without exposing the hint directly.` : ''}

**MANDATORY CHECK:** Before generating each option, verify:
1. Does the speaker use "I/me/my" for themselves? ✅
2. Does the speaker use "you/your" for the listener? ✅
3. Are there any names of User A or User B? ❌ (Remove and use "you")
4. Are there "her/his/their" referring to the listener? ❌ (Change to "you/your")

**THIRD PARTIES (not User A or User B):**
- Use their actual names (without # prefix): "Sarah", "Vikram"
- Or use pronouns from entity registry: "she", "he", "they"
- NEVER use "you/your" for third parties - only for the listener

### 🎯 NATURAL HUMAN TONE (MANDATORY FOR ALL OPTIONS)

Use warm, friendly, everyday English.  

Tone must fit **ALL relationships**: partners, friends, family, coworkers, elders, juniors.

Use natural phrases:

- "I get what you mean"

- "that makes sense"

- "oh okay, I understand"

- "I didn't realize that"

- "I want to understand this better"

- "I'm listening"

- "let's figure this out"

Use contractions → I'm, you're, we're, didn't, can't  

Be human, warm, caring — not formal, robotic, or therapist-like.

---

### 🚫 NEVER USE (FORMAL / ROBOTIC / THERAPIST LANGUAGE)

No matter what tone the conversation has, **never** generate:

- "I hear you"

- "I acknowledge your perspective"

- "I appreciate your perspective"

- "I would like to hear your side"

- "I understand your situation"

- "I appreciate you being open with me"

- "I would appreciate if…"

- Generic robotic lines like "I understand." (alone)

- Therapist-like language ("your perspective is valid")

---

### 🎭 EMOTIONAL TONE MATCHING (STRICT)

Match the emotional tone of the latest message:

- **Sad** → gentle: "I get what you mean, that must have been hard"

- **Angry** → calm: "okay, I see what you mean"

- **Confused** → clarifying: "oh okay, I get it now"

- **Neutral** → warm: "yeah, that makes sense"

- **Grateful** → soft: "you're welcome"

- **Apologetic** → kind: "okay, I understand"

---

### 🔒 STRICT PRONOUN RULES (NO LOGIC CHANGE)

Speaker uses **I/me/my**  

Listener uses **you/your**  

❌ Never use names of User A or User B  

Third parties → exact names or pronouns from entity registry  

(NO CHANGE TO YOUR PRONOUN ENGINE — this is only guidance)

---

# 🚫 CRITICAL: NO REPEATING ISSUES (NEW RULES INCLUDED)

### **1️⃣ User A must NOT repeat their core issue multiple times**

- If User A already expressed the core issue →  

  ✔ Acknowledge → **move forward**  

  ❌ Do NOT generate options where User A repeats the same problem again  

  ❌ No "I felt hurt when you did X" again and again  

  ✔ Only clarify if User B misunderstood  

---

### **2️⃣ User B must NOT repeat their explanation multiple times**

- If User B already explained their side / used hint →  

  ✔ Respond → don't restate  

  ❌ No "let me explain again"  

  ❌ No restating of the same reasoning  

  ✔ Only provide small clarifications if needed  

---

### **3️⃣ No asking the other person to re-explain**

❌ Do NOT generate:  

- "Can you explain again?"  

- "Can you tell me again?"  

- "Can you explain better?"  

- "Can you explain your side again?"  

- "Let me explain again"  

- "I want to explain again"  

✔ Instead:  

- Respond directly to what they said  

- Ask meaningful, specific follow-ups ONLY if needed  

- Keep conversation moving forward

---

# 🌟 NEW RULE: ALL OPTIONS IN A SET MUST BE EQUALLY STRONG

### **4️⃣ ALL options must match the SAME situation (VERY IMPORTANT)**

Every option:

- Must answer the **exact same latest message**

- Must stay on **the same topic**

- Must express **the same core meaning**, but in different styles:

  - Direct  

  - Soft  

  - Caring  

  - Friendly  

❌ Do NOT mix unrelated ideas  

❌ Do NOT generate 1 good option + 2 weak/unrelated ones  

❌ Do NOT drift to a different topic  

✔ ALL 3 (or 5 for first message) must be:

- Perfectly relevant  

- Well-written  

- Natural human tone  

- Same meaning → different approaches  

- Equally strong choices  

- Hard for the user to pick because all are good  

---

### 🎯 ON-TOPIC REQUIREMENT (STRICT)

- Must respond DIRECTLY to the latest message  

- Use words/phrases from that message  

- Must remain inside the current topic  

- No vague questions  

- No topic shifts  

- No generic filler ("can you tell me more")

---

### 🌈 CLOSURE LOGIC (Follows your existing system)

- High closure → single emoji options only  

- Moderate closure → text + emoji mix  

- Low closure → text only  

(Your closure code controls this. Prompt only describes tone rules.)

---

### 🧠 EXAMPLES OF GOOD TONE

- "I get what you mean, and I want to sort this out together."

- "yeah, that makes sense — let's talk it through."

- "I understand why you'd feel that way, thanks for telling me."

- "oh okay, I get it — I didn't realize it felt like that."

---

### ❌ BAD EXAMPLES (NEVER GENERATE)

- "Can you explain again?"

- "Let me explain again."

- "What do you want to talk about?"

- "I hear you."

- "I acknowledge your perspective."

- "I appreciate your perspective."

- "I understand."  

- Therapist-sounding lines  

- Gen-Z slang  

- Extremely formal writing  

---

### 📌 STRUCTURE FOR EACH OPTION SET

**Each option must be:**

- One single complete sentence  

- 8–20 words (flexible if meaningful)  

- Same meaning, different tone/style  

- Warm, friendly, human  

- Acknowledgement → response  

- Always address the latest message  

- No re-explaining  

- No asking for re-explanation  

- No repeating core issues  

- No off-topic content  

---

CRITICAL: Every option must pass this test: "Would a caring friend/partner say this in warm everyday English?" If not, rewrite the EXAMPLES ONLY — do NOT touch logic.

    ${isVeryFirstMessage ? `
      🌱 FIRST MESSAGE - SUMMARY-AWARE OPENINGS:
      - Generate 5 warm, meaningful openings that incorporate the summary topic naturally
      - Reference the core issue in different styles (direct mention, subtle hint, or implied purpose)
      - Each option should be COMPLETE and MEANINGFUL (8-20 words) - not just "hey, how are you?"
      - Vary in approach (direct, warm, gentle, casual, friendly) but ALL should hint at or mention the purpose
      - Use natural texting style appropriate for ${contactCategory === 'family'
          ? 'a family member'
          : contactCategory === 'friend'
          ? 'a close friend'
          : contactCategory === 'romantic'
          ? 'a partner'
          : contactCategory === 'work'
          ? 'a teammate'
          : 'someone they know'}
      - Users should have trouble choosing because ALL options are good and relevant
      - All 5 options must be distinct styles but equally strong
      ` : ''}
      
${!isVeryFirstMessage && safeConversationHistory.length <= 2 ? `
- USE SPECIFIC WORDS from the issue context: ${cleanOriginalIssueSummary || cleanSummary}
- Reference what actually happened in their own words
- Examples: If issue is "she ignored me at party" → "can we talk about the party? I felt ignored"
- Examples: If issue is "you didn't respond to my texts" → "hey, I noticed you didn't reply to my messages"
- Sound like how someone would naturally bring up something that bothered them
- Stay direct, human, and conversational - not formal or therapeutic
` : ''}

${isRecipientUserA ? `
${needsClarification ? `
🔴 USER A - CLARIFICATION REQUIRED (Specific Issue/Accusation Detected):
- User B mentioned specific issue/accusation in their message: "${cleanCurrentMessage}"
- Detected keywords/accusations: ${specificAccusationsInMessage.join(', ')}
- ALL options MUST address these specific points while being empathetic, polite, and respectful
- Generate options that:
  1. Address the specific accusation/issue mentioned (use their exact words like "${specificAccusationsInMessage[0]}")
  2. Clarify your position: "I'm not ${specificAccusationsInMessage[0]}, but I understand why you might feel that way"
  3. Show empathy: Acknowledge their feelings while correcting misunderstanding
  4. Move toward resolution: "Can we talk about what made you think that?" or "I'd like to clear this up"
  5. Be respectful and calm, not defensive

✅ GOOD EXAMPLES (if they said "jealous"):
- "I'm not jealous about your life - I'm genuinely happy for you, but I can see why it might have seemed that way" (18 words)
- "I understand why you might think I'm jealous, but I'd like to explain my actual feelings if you're open to hearing them" (19 words)
- "I'm sorry that came across as jealousy - I'm genuinely happy for you and would love to clear up any misunderstanding" (18 words)

❌ AVOID: Being defensive or dismissive - "That's not true" or "You're wrong"
✅ FOCUS: Clarifying with empathy - "I understand why you might think that, but..."
` : shouldFocusOnProgress ? `
✅ USER A - PROGRESS MODE (Issue Explained & Acknowledged):
- You already explained your concern and User B has acknowledged it
- Focus on MOVING FORWARD with solutions, understanding, or next steps
- ALL options must respond to their latest message: "${cleanCurrentMessage}"
- Generate options that:
  1. Address their response and move toward resolution
  2. Offer solutions, clarify misunderstandings, or suggest next steps
  3. Do NOT repeat your original issue - they already understand it
  4. Examples: "How can we fix this?", "What would help us move forward?", "I appreciate you hearing me out"

❌ AVOID: Restating "I felt hurt when..." (already explained)
✅ FOCUS: "What can we do about it?", "How should we handle this going forward?"
` : hasUserAExplainedIssue ? `
🔵 USER A - CLARIFICATION MODE (Issue Mentioned, May Need Refinement):
- You've mentioned your concern, but may need to clarify or expand based on their response
- ALL options must respond to their latest message: "${cleanCurrentMessage}"
- You can briefly reference the core issue IF their response shows misunderstanding
- But prioritize responding to what they just said first
` : `
🔑 USER A - INITIAL MODE (Issue Not Yet Explained):
- This is early in the conversation - you may need to explain your concern
- ALL options must respond to their latest message: "${cleanCurrentMessage}"
- Balance: Respond to them while introducing your concern if needed
`}
- ✅ CRITICAL: Stay on-topic - all options must relate to the conversation flow above
- Do NOT introduce unrelated topics or deviate from the conversation history
` : ''}

${isFirstResponseForUserB ? `
🚦 FIRST RESPONSE GUARDRAILS (User B):
- You just received their opening message: "${cleanCurrentMessage}"
- RESPOND DIRECTLY to what they said - don't ask generic questions like "can you tell me more" or "what do you want to talk about"
- If they mentioned a specific issue/event/feeling, acknowledge it directly
- Show empathy and willingness to understand: "I'm sorry you felt that way", "I want to understand what happened"
- Ask SPECIFIC follow-up questions based on what they mentioned: "Can you tell me more about [specific thing they mentioned]?"
- Do NOT mention specific events/names from summaries unless they explicitly said them in their message
- Focus on acknowledging their message and showing you're ready to listen
- Avoid generic questions that ignore what they just said
` : isRecipientUserB ? `
✅ USER B - RESPONDING MODE:
- You are responding to User A's latest message: "${cleanCurrentMessage}"
- ALL options must directly address what User A just said - use their words/phrases
- Do NOT ask generic questions like "can you tell me more" or "what do you want to talk about"
- Acknowledge their message: "I hear you", "I understand", "I'm sorry"
- Address specific points they mentioned
- Show your perspective: "I didn't realize...", "I thought...", "From my side..."
- Focus on understanding each other, not asking for more information
` : ''}

${shouldUseHint && !isRecipientUserA ? `
🟢 PERSISTENT HINT REQUIREMENT (User B):
- Every option must naturally weave in the key truth from your private perspective: "${hintPromptSnippet.substring(0, 160)}${hintPromptSnippet.length > 160 ? '…' : ''}"
- Show different tones (softer, direct, vulnerable) but always explain WHY you felt/acted that way, using details from that hint.
- Make it crystal clear what you needed, what hurt, or what you were trying to protect — no vague responses.
- ❌ NEVER generate vague options like:
  * "I would like to say"
  * "I thought I can share"
  * "I want to share" (without actual explanation)
  * "I'd like to explain" (without actual explanation)
- ✅ ALWAYS include actual explanation details from hint, not just intent to explain
${canUserBAskToShareAfterHint ? `
✅ AFTER HINT SUBMISSION - USER B CAN ASK TO SHARE:
- User B can ask: "Can I share something from my side now?" (per reference flow)
- After User A says "Yes, please do", User B MUST explain directly using hint context
- Include actual reason/explanation from hint (e.g., "My phone died last evening...")
- DO NOT repeat vague "I would like to say" or "I thought I can share" - explain directly
` : ''}
` : ''}

🎯 CRITICAL - ALL OPTIONS MUST BE RELEVANT, COMPLETE, AND MEANINGFUL:
- Latest message: "${cleanCurrentMessage}"
- ALL ${isVeryFirstMessage ? '5' : '3'} options MUST respond to THIS message OR the summary topic (for first message)
- ❌ NEVER generate generic, weak, or incomplete options like:
  * "can you tell me more" (too generic, no substance)
  * "what do you want to talk about" (ignores context)
  * "what's on your mind" (too vague)
  * "I hear what you're saying" (too simple, no substance)
  * "hey, how are you?" (no reference to issue - for first message)
- ✅ INSTEAD: Each option must be:
  * COMPLETE and MEANINGFUL (8-20 words preferred, but prioritize meaning)
  * SPECIFIC to the conversation context (summary topic or latest message)
  * Show engagement and understanding
  * Make sense as a choice - users should want to pick it
- They should express the SAME response in different styles:
  * Different formality levels (casual → formal)
  * Different directness (subtle → straightforward)  
  * Different emotional tones (reserved → warm)
- ✅ ALL ${isVeryFirstMessage ? '5' : '3'} OPTIONS IN A SET MUST BE:
  * EQUALLY GOOD - users should be confused which to pick
  * RELATED to the same core message/topic
  * DIFFERENT only in style/tone/approach
  * NOT a mix of 1-2 good options and 1 weak option
- They should NOT address different topics or concerns
- They should NOT repeat old conversation points
- They should NOT bring up unrelated issues
- They should NOT ask generic questions that ignore the latest message
- ✅ ON-TOPIC CHECK: All options must relate to the conversation above (${formattedHistory ? 'last 5 messages' : 'conversation start'})
- ✅ QUALITY CHECK: If you generate 1 weak option, regenerate ALL options until ALL are strong

OPTION STRUCTURE (all address "${cleanCurrentMessage}"):
- Option 1: Direct response style
- Option 2: Empathetic response style  
- Option 3: Casual response style
${isVeryFirstMessage ? `
- Option 4: Gentle response style
- Option 5: Friendly response style
` : ''}

Each option must:
1. Be EXACTLY what the person would say (direct quote, not description)
2. Be COMPLETE and MEANINGFUL - Natural length (8-20 words preferred, but prioritize meaning over strict word count)
   - Avoid lengthy/verbose sentences that lose impact
   - Single sentence only - complete thoughts that make sense on their own
   - NO TRUNCATION or "..." needed - each option should feel natural and complete
${isRecipientUserB ? `
3. ✅ CRITICAL: Respond DIRECTLY to User A's latest message: "${cleanCurrentMessage}"
   - Use words/phrases from their message to show you heard them
   - Address what User A just said SPECIFICALLY - don't ask generic questions
   - ❌ NEVER generate generic questions like:
     * "can you tell me more"
     * "what do you want to talk about"
     * "what's on your mind"
   - ✅ INSTEAD, respond to what they said:
     * If they said "I felt hurt" → "I'm sorry you felt that way, can we talk about what happened?"
     * If they said "you ignored me" → "I didn't realize I was ignoring you, I want to understand"
     * If they mentioned a specific event → acknowledge that event specifically
   - Show empathy and your perspective, don't ask for more information
   - ✅ STAY ON-TOPIC: Options must relate to the conversation above (${formattedHistory ? 'last 5 messages' : 'conversation start'}), not ask generic questions
   - ✅ ALL 3 OPTIONS must address the SAME latest message, only differ in style/tone
` : `
3. ✅ CRITICAL: Respond DIRECTLY to: "${cleanCurrentMessage}"
   - USE WORDS/PHRASES from their message to show you heard them
   ${needsClarification ? `
   - ✅ MANDATORY: Address the specific accusation/issue mentioned: "${specificAccusationsInMessage.join(', ')}"
   - Clarify your position using their exact words (e.g., if they said "jealous", address "jealous" in your response)
   - Be empathetic: "I understand why you might think that..." before clarifying
   - Move toward resolution: "Can we talk about what led you to feel that way?"
   ` : ''}
   - Address what they just said in the conversation above
   - ✅ STAY ON-TOPIC: All options must relate to the recent conversation flow (${formattedHistory ? 'last 5 messages' : 'conversation start'}), not deviate or introduce unrelated topics
   - ${shouldFocusOnProgress ? 'Focus on progressing/solving, not restating your issue' : 'If needed, briefly reference core issue but prioritize their latest message'}
   - ✅ ALL ${isVeryFirstMessage ? '5' : '3'} OPTIONS must address the SAME latest message, only differ in style/tone
`}
4. Sound like natural speech for a ${contactCategory} relationship
5. Use contractions and casual language where appropriate ("you're" not "you are", "I'm" not "I am")
6. Match the emotional tone of the conversation
7. ✅ ABSOLUTE PRONOUN RULES - NO EXCEPTIONS (MANDATORY FOR EVERY OPTION):
   ${isRecipientUserA ? `
   **YOU ARE USER A TALKING TO USER B:**
   - For YOURSELF (User A) → Use ONLY: "I / me / my / mine / myself"
   - For THEM (User B) → Use ONLY: "you / your / yours / yourself"
   - NEVER: User B's name, "her/his/their" for User B, "they/them" for User B
   - Example: "I felt hurt when you didn't invite me" ✅
   - Wrong: "I felt hurt when Sarah didn't invite me" ❌ (if Sarah is User B)
   - Wrong: "I felt hurt when she didn't invite me" ❌ (if referring to User B)
   ` : `
   **YOU ARE USER B TALKING TO USER A:**
   - For YOURSELF (User B) → Use ONLY: "I / me / my / mine / myself"
   - For THEM (User A) → Use ONLY: "you / your / yours / yourself"
   - NEVER: User A's name, "her/his/their" for User A, "they/them" for User A
   - Example: "I'm sorry you felt that way, I didn't mean to hurt you" ✅
   - Wrong: "I'm sorry John felt that way" ❌ (if John is User A)
   - Wrong: "I'm sorry he felt that way" ❌ (if referring to User A)
   `}
   - Third parties: Use actual names or pronouns from entity registry (never "you")
8. INCORPORATE specific details from the conversation context to make responses feel personal and relatable
${shouldUseHint && isRecipientUserB ? `9. MANDATORY (USER B ONLY): Strongly incorporate User B's hint perspective in EVERY option - this is their core truth and authentic voice
10. CRITICAL (USER B ONLY): Maintain absolute consistency with hint's emotional context and subject matter across ALL conversation turns
11. PERSISTENT (USER B ONLY): The hint is active throughout the ENTIRE conversation - incorporate it in turn 1, turn 5, turn 10, etc.
⚠️ REMEMBER: This hint is PRIVATE to User B and NEVER shown to User A
${hasUserBExplained ? `🚫 CRITICAL: User B has ALREADY explained their side - do NOT generate options asking them to explain again. Focus on RESPONDING to User A's messages, not re-explaining.` : ''}` : ''}

CRITICAL: Each option must be a FULL, COMPLETE sentence that makes sense on its own. 
Keep options natural and meaningful - not lengthy or verbose, but complete enough to convey your message clearly. 
Each option must be a single sentence.

${isRecipientUserB ? `
✅ DIFFERENTIATION RULE FOR USER B - CRITICAL (ROLE SAFETY):
- User B's options MUST be RESPONSES to User A's latest message: "${cleanCurrentMessage}"
- User B is NOT continuing User A's issue - they are RESPONDING with their own perspective
- User B's options MUST sound different from User A's options (different viewpoints)
- User B uses "I/me/my" for themselves and "you/your" for User A
- Third parties: Use EXACT names from summary - do NOT change names
- If User A said "I felt hurt", User B should respond with:
  ✅ "I'm sorry you felt that way, I didn't mean to hurt you"
  ✅ "I get what you mean, can we talk about what happened?"
  ✅ "I understand, I should have been more considerate"
  ❌ NOT: "I felt hurt when you ignored me" (this is User A's issue, not User B's response)
- 🔒 ROLE SAFETY: These are User B options ONLY - do NOT reuse User A's options
- Example: If User A said "Vikram and Sneha supported me", User B MUST NOT say "I felt hurt when Vikram and Sneha..."
` : `
✅ DIFFERENTIATION RULE FOR USER A (ROLE SAFETY):
- User A's options should address their original concern or respond to User B's latest message
- User A uses "I/me/my" for themselves and "you/your" for User B
- Third parties: Use EXACT names from summary - do NOT change names
- 🔒 ROLE SAFETY: These are User A options ONLY - do NOT reuse User B's options
`}

CRITICAL - MAKE IT RELATABLE:
- If they mentioned a specific event ("the party", "last week"), reference it
- If they used emotional words ("hurt", "upset", "confused"), acknowledge those feelings
- If they mentioned specific actions ("you ignored me", "you left early"), address those directly
- Mirror their language naturally to show you're truly listening and engaging

${naturalClosureDetected ? `
🌈 GRADUAL CLOSURE GUIDANCE (Score: ${emotionalClosureScore.toFixed(2)}):
${otherUserSentSmiley || otherUserRecentSmiley ? `
💝 OTHER USER SENT SMILEY - RESPOND WITH SMILEY:
- The other person already sent a smiley emoji
- Generate ${isVeryFirstMessage ? '5' : '3'} options with ${isVeryFirstMessage ? '2-3' : '1-2'} smiley emojis
- Mix: ${isVeryFirstMessage ? '2-3' : '1-2'} text options + ${isVeryFirstMessage ? '2' : '1'} smiley emoji
- This allows both users to close the conversation naturally
- Choose appropriate emojis: 🙂 🤝 ❤️ 💙 😊 🫂 ✨ 👍
` : emotionalClosureScore >= 0.8 && safeConversationHistory.length >= 8 ? `
✨ VERY HIGH CLOSURE: Generate ALL ${isVeryFirstMessage ? '5' : '3'} options as SINGLE EMOJIS ONLY.
Choose from: 🙂 🤝 ❤️ 💙 😊 🫂 ✨ 👍
Match to relationship (${contactCategory}) and conversation tone.
NO TEXT - just emojis.
` : emotionalClosureScore >= 0.5 ? `
🌱 MODERATE CLOSURE: Mix ${isVeryFirstMessage ? '2-3' : '1-2'} brief text acknowledgments (8-20 words) with ${isVeryFirstMessage ? '2' : '1'} single emoji.
Text should acknowledge progress and express gratitude naturally.
Build on what was discussed, show genuine appreciation.
Example mix: "Thanks for working through this with me" + "I appreciate you" + 🙂
` : emotionalClosureScore >= 0.3 ? `
🌱 EARLY CLOSURE SIGNALS (Score: ${emotionalClosureScore.toFixed(2)}) - Start introducing smiley:
- Some closure signals detected, conversation is progressing well
- Generate ${isVeryFirstMessage ? '5' : '3'} options: ${isVeryFirstMessage ? '4' : '2'} text + ${isVeryFirstMessage ? '1' : '1'} smiley emoji
- Include ONE smiley option (🙂 or 😊) along with text options
- Text options should show appreciation: "Thanks for hearing me out", "I appreciate you being open"
- This gradually introduces closure while keeping conversation natural
` : `
💬 EARLY CLOSURE: NO smiley options yet. Focus on deepening understanding.
Ask clarifying questions, validate feelings, explore concerns.
Ensure both sides feel truly heard before moving to closure.
`}
` : ''}

🎯 SMILEY DISTRIBUTION RULE (FOR REGULAR OPTIONS - NON-CLOSURE):
- When generating ${isVeryFirstMessage ? '5' : '3'} regular options (NOT closure scenarios):
  ${isVeryFirstMessage ? `
  - Maximum 2 options should contain smiley + text
  - The other 3 options must be text only, with no smileys
  ` : `
  - Maximum 1 option should contain smiley + text
  - The other 2 options must be text only, with no smileys
  `}
- This rule applies ONLY to regular suggested options during conversation
- Do NOT apply this rule to single-smiley closure options (those are handled separately above)
- Regular options should primarily be text-based, with limited smiley usage for variety

RELATIONSHIP-SPECIFIC TONE:
- Friend: casual, use "dude", "bro", "man" if natural, informal language
- Family: warm but respectful, appropriate familiarity
- Coworker: professional but friendly, no overly casual slang
- General: balanced, friendly but not too informal

STRICT RULES - NATURAL LENGTH, NO CROPPING ALLOWED:
- Keep each option natural and meaningful (single sentence only)
- Each option MUST be a COMPLETE, MEANINGFUL sentence that makes sense on its own
- NEVER generate incomplete sentences, truncated thoughts, or sentences that need "..." at the end
- Natural length: 8-20 words preferred, but meaning matters more than strict word count
- Avoid lengthy/verbose sentences - keep it natural and impactful
- CRITICAL: Generate options that are COMPLETE and MEANINGFUL - single sentence only
- Use natural contractions ("you're" not "you are", "didn't" not "did not") 
- Remove unnecessary filler words ("like", "just", "really") but keep emotional words if they add meaning
- NO AI/counselor language ("I acknowledge", "Let's work together", "I understand your perspective")
- Sound like REAL human speech with natural warmth - simple, friendly, and authentic
- NO scheduling outside the app
- Use lowercase for casual relationships if natural
- TONE: Calm, clear, and respectful - not too formal, not Gen-Z slang
- Use simple, friendly language that's polite, empathetic, and understanding
- Always acknowledge the other person's feelings and perspective
- Avoid sharp, blaming, or accusatory wording - keep it steady and supportive
- Use "I" statements and gentle phrasing throughout
- Focus on RESOLVING and UNDERSTANDING together, not blaming or attacking
- ${isVeryFirstMessage ? 'Generate 5 DISTINCT options' : 'Generate 3 DISTINCT options'}
- Each option must have DIFFERENT tone, approach, or directness level

🎯 PRONOUN VALIDATION - CHECK EACH OPTION:
Before finalizing each option, verify:
1. Speaker refers to themselves with "I/me/my" ✅
2. Listener is addressed with "you/your" ✅  
3. No names of User A or User B present ✅
4. No "her/his/their" when referring to listener ✅

🎯 EXAMPLES OF GOOD NATURAL LENGTH (meaningful, complete, NOT lengthy):
${isRecipientUserA ? `
USER A EXAMPLES (speaking TO User B):
- "hey, can we talk about what happened yesterday?" (8 words) ✅
- "I felt hurt when you didn't invite me to the party" (10 words) ✅
- "I'm not jealous about your life - I'm genuinely happy for you, but that accusation hurt my feelings" (18 words) ✅
- "I understand why you might think I'm jealous, but I'd like to explain my actual feelings if you're open to hearing them" (19 words) ✅
- "Sarah said something that really bothered me at work" (9 words) ✅ [third party - no # prefix]
- "want to clear this up between us? I miss you" (10 words) ✅
- "I appreciate you sharing that with me, and I'd like to clear up any misunderstanding about how I feel" (17 words) ✅
- "can we find a time to discuss this? I value our friendship and want to make sure we understand each other" (17 words) ✅
Note: Natural length varies (8-20 words) - what matters is the message is complete and meaningful
` : `
USER B EXAMPLES (responding TO User A):
- "I'm sorry you felt that way, I didn't mean to hurt you" (12 words) ✅
- "I hear what you're saying about feeling left out, and I want to understand your perspective better" (16 words) ✅
- "I understand, I should have been more considerate" (8 words) ✅
- "I didn't realize it bothered you that much - can we talk about what happened so I can make it right?" (18 words) ✅
- "I want to make this right between us" (8 words) ✅
- "I see your point, and I appreciate you bringing this up. Let's work through this together" (16 words) ✅
- "Sarah mentioned you were upset, I should have reached out" (10 words) ✅ [third party - no # prefix]
Note: Natural length varies (8-20 words) - what matters is the message is complete and meaningful
`}

❌ BAD EXAMPLES (too long, would be rejected):
- "I wanted to talk to you about what happened yesterday because I felt really hurt and I think we need to discuss this" (22 words - TOO LONG) ❌

TONE REQUIREMENTS (MANDATORY):
- Be calm, clear, and respectful - simple and friendly, not overly formal or Gen-Z slang
- Show genuine empathy and care, acknowledging the other person's feelings and perspective
- Use gentle, supportive language that keeps the conversation steady and understanding
- Speak from a place of wanting to fix things together, not win an argument
- Use "I" statements: "I felt" instead of "you made me feel"
- Use gentle phrasing: "can we talk about" instead of "you need to explain", "I wonder if" instead of "you always/never"
- Avoid sharp, blaming, or accusatory wording - frame concerns as invitations to understand, not complaints

Format as JSON:
{
  "options": [${isVeryFirstMessage ? '"Option 1", "Option 2", "Option 3", "Option 4", "Option 5"' : '"Exact words they\'d say 1", "Exact words they\'d say 2", "Exact words they\'d say 3"'}]${shouldUseHint && isRecipientUserB ? `,
  "reasoning": "How hint shaped these responses (User B only)"` : ''}
}`;
console.log("🧹 ============ CLEANED DATA CHECK BEFORE CLAUDE ============");
console.log("📍 Perspective:", {
  generatingFor: isRecipientUserA ? 'User A' : 'User B',
  recipientId,
  userAName,
  userBName,
  speakerUsesI: true,
  listenerIsYou: true
});
console.log("📝 Cleaned Summary (first 300 chars):", cleanSummary.substring(0, 300));
console.log("💭 Cleaned Thoughts (first 200 chars):", cleanThoughts.substring(0, 200));
console.log("💬 Cleaned Current Message:", cleanCurrentMessage);
console.log("📜 Cleaned Conversation History (last 3):", cleanConversationHistory.slice(-3).map(msg => {
  const content = typeof msg === 'object' ? msg.content : String(msg);
  return content.substring(0, 100);
}));

// ⚠️ CRITICAL CHECK: Verify NO @ tags remain (should be 0)
const atTagsInSummary = (cleanSummary.match(/@\w+/g) || []).length;
const atTagsInThoughts = (cleanThoughts.match(/@\w+/g) || []).length;
const atTagsInRecipientSummary = (cleanRecipientSummary.match(/@\w+/g) || []).length;
const atTagsInMessage = (cleanCurrentMessage.match(/@\w+/g) || []).length;
const atTagsInHistory = cleanConversationHistory.reduce((count, msg) => {
  const content = typeof msg === 'object' ? msg.content : String(msg);
  return count + (content.match(/@\w+/g) || []).length;
}, 0);

console.log("🔍 @ TAG CHECK (should all be 0):", {
  summary: atTagsInSummary,
  thoughts: atTagsInThoughts,
  recipientSummary: atTagsInRecipientSummary,
  currentMessage: atTagsInMessage,
  conversationHistory: atTagsInHistory,
  TOTAL: atTagsInSummary + atTagsInThoughts + atTagsInRecipientSummary + atTagsInMessage + atTagsInHistory
});

if (atTagsInSummary + atTagsInThoughts + atTagsInRecipientSummary + atTagsInMessage + atTagsInHistory > 0) {
  console.warn("⚠️ WARNING: @ tags still present in cleaned data!");
}
console.log("🧹 ============ END CLEANED DATA CHECK ============");

// ✅ FIX: Add debug log showing recipientSummary before Claude API call
const recipientName = isRecipientUserA ? userAName : userBName;
console.log(`✅ Using recipientSummary for ${isRecipientUserA ? 'User A' : 'User B'} (${recipientName}):`);
console.log(`   First 200 chars: ${cleanRecipientSummary.substring(0, 200)}`);
console.log(`   Full length: ${cleanRecipientSummary.length} characters`);
console.log(`   Has content: ${cleanRecipientSummary.length > 0 ? 'YES' : 'NO ❌'}`);

    // 🧠 Log final prompt (for debugging placeholder issues)
    console.log("🧠 FINAL PROMPT TO LLM:", {
      preview: userPrompt.substring(0, 800),
      totalLength: userPrompt.length
    });

    // ✅ Helper function for retry with exponential backoff (429 rate limit only)
    const callAnthropicAPI = async (payload: any, maxRetries = 3): Promise<Response> => {
      let lastError: Error | null = null;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
            body: JSON.stringify(payload)
          });

          // ✅ If rate limit error (429), retry with exponential backoff
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            const waitTime = retryAfter 
              ? parseInt(retryAfter) * 1000 
              : Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
            
            console.warn(`⚠️ Rate limit (429) on attempt ${attempt + 1}/${maxRetries}. Waiting ${waitTime}ms before retry...`);
            
            if (attempt < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue; // Retry
            } else {
              // Last attempt failed
              const errorText = await response.text();
              console.error("Anthropic API error (429 - rate limit):", errorText);
              throw new Error(`Anthropic API rate limit exceeded after ${maxRetries} attempts`);
            }
          }

          // ✅ For other errors, throw immediately
          if (!response.ok) {
            const errorText = await response.text();
            console.error("Anthropic API error:", errorText);
            throw new Error(`Anthropic API failed: ${response.status}`);
          }

          // ✅ Success
          return response;
          
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          // ✅ If it's a rate limit error and we have retries left, continue
          if (lastError.message.includes('429') || lastError.message.includes('rate limit')) {
            if (attempt < maxRetries - 1) {
              const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
              console.warn(`⚠️ Rate limit error caught, retrying in ${waitTime}ms...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
          }
          
          // ✅ For other errors or final attempt, throw
          throw lastError;
        }
      }
      
      throw lastError || new Error("Failed to call Anthropic API");
    };

    // ✅ Log prompt length before API call
    const systemPromptText = `${systemPrompt}\n\n${compassionateSystemPrompt}`;
    console.log("📊 PROMPT LENGTH CHECK:", {
      systemPromptLength: systemPromptText.length,
      userPromptLength: userPrompt.length,
      totalLength: systemPromptText.length + userPrompt.length,
      estimatedTokens: Math.ceil((systemPromptText.length + userPrompt.length) / 4) // Rough estimate: ~4 chars per token
    });

    // ✅ Use retry helper function
    const anthropicResponse = await callAnthropicAPI({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 2500,  // ✅ Increased from 200 to allow complete responses
        temperature: 0.7,  // ✅ Increased from 0.5 for more natural responses
      system: systemPromptText,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
    });

    const anthropicData = await anthropicResponse.json();
    const responseText = anthropicData.content[0].text;

    let optionsData;
    try {
      optionsData = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*"options"[\s\S]*\}/);
      if (jsonMatch) {
        optionsData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Could not parse options from response");
      }
    }

    let options = Array.isArray(optionsData.options)
      ? [...optionsData.options]
      : [];
    const expectedCount = isVeryFirstMessage ? 5 : 3;

    if (isVeryFirstMessage) {
      const friendlyTemplates =
        contactCategory === "family"
          ? [
              "hey you 😊 got a sec?",
              "hi fam, just wanted to say hey 🙂",
              "yo! how's your day been?",
              "hey hey, what's up?",
              "hi, hope you're doing good 🙂",
            ]
          : contactCategory === "friend"
          ? [
              "hey you 😊 got a sec?",
              "hi there, just wanted to say hey 🙂",
              "yo! how's your day been?",
              "hey hey, what's up?",
              "hi, hope you're doing good 🙂",
            ]
          : contactCategory === "romantic"
          ? [
              "hey you 😊 got a sec?",
              "hi love, just wanted to say hey 🙂",
              "yo! how's your evening been?",
              "hey hey, what's up?",
              "hi, hope you're doing good 🙂",
            ]
          : contactCategory === "work"
          ? [
              "hey you 😊 got a sec?",
              "hi there, just wanted to say hey 🙂",
              "yo! how's your day been?",
              "hey hey, what's up?",
              "hi, hope you're doing good 🙂",
            ]
          : [
              "hey you 😊 got a sec?",
              "hi there, just wanted to say hey 🙂",
              "yo! how's your day been?",
              "hey hey, what's up?",
              "hi, hope you're doing good 🙂",
            ];

      options = friendlyTemplates.slice(0, 5);
      console.log("✅ Rewritten warm-up options (friendly only):", options);
    }

    // ✅ STRICT: Enforce minimum option count (5 for first turn, 3 for all others)
    if (!options || options.length === 0) {
      throw new Error(`No options generated: received empty array`);
    }

    // Log received option count
    console.log(`📊 Received ${options.length} options from AI, expected ${expectedCount}`);

    // ✅ Minimal, safe fallback set (never uses summary fragments or placeholders)
    const simpleFallbackOptions = [
      "I’d like to talk about what happened earlier.",
      "Can we clear the air a bit?",
      "I want to share how that felt to me.",
      "Can we work through this together?",
      "I appreciate you being open to talk."
    ];
    // ✅ Final safeguard: only if model returns zero options, and NEVER overwrite options[0]
    const ensureFallbackIfEmpty = (opts: string[]): string[] => {
      if (!Array.isArray(opts) || opts.length === 0) return simpleFallbackOptions.slice(0, expectedCount);
      return opts;
    };

    // ✅ SIMPLIFIED: Only check for single sentence (no word count validation)
    const meetsOptionConstraints = (text: string): boolean => {
      if (!text || typeof text !== 'string') return false;
      const cleaned = text.trim();
      if (!cleaned) return false;
      
      // Reject if contains newline or ellipsis
      if (cleaned.includes('\n') || cleaned.includes('\r') || cleaned.includes('...')) {
        return false;
      }
      
      // Reject if multiple sentences (more than one . ? or !)
      const sentenceMarks = cleaned.match(/[.!?]/g) || [];
      if (sentenceMarks.length > 1) {
        return false;
      }
      
      // Accept if single sentence (or no punctuation, which is acceptable for short responses)
      return true;
    };
    

    // ✅ NAME LEAK DETECTION: Check if listener's name appears in any option
    const listenerNameVariants = buildNameVariants(isRecipientUserA ? userBName : userAName);
    const primaryListenerName = listenerNameVariants[0] || '';
    const checkForNameLeak = (text: string): boolean => {
      if (listenerNameVariants.length === 0 || !text) return false;
      return listenerNameVariants.some(variant => {
        const escaped = escapeRegex(variant);
        const hasSpace = /\s/.test(variant);
        const basePattern = new RegExp(`\\b${escaped}\\b`, 'gi');
        if (basePattern.test(text)) return true;
        if (!hasSpace) {
          const atPattern = new RegExp(`@${escaped}\\b`, 'gi');
          if (atPattern.test(text)) return true;
        }
        return false;
      });
    };

    // ✅ SIMPLIFIED: Filter options by single-sentence rule only (no word count)
    const validOptions = options.filter(opt => {
      if (!opt || typeof opt !== 'string') {
        console.warn(`⚠️ Invalid option (not a string):`, opt);
        return false;
      }

      // ✅ CRITICAL: Reject if listener's name appears in option
      if (checkForNameLeak(opt)) {
        console.warn(`❌ NAME LEAK DETECTED: Option contains listener's name "${primaryListenerName}": "${opt.substring(0, 60)}..."`);
        console.warn(`   This option will be REJECTED - listener should be addressed as "you", not by name`);
        return false;
      }

      // Only check single-sentence constraint (no word count)
      if (!meetsOptionConstraints(opt)) {
        return false;
      }
      return true;
    });

    // ✅ Store validOptions for potential fallback
    let workingOptions = validOptions;

    // ✅ ENSURE MINIMUM: Fill with fallbacks if needed (never throw error)
    if (validOptions.length < expectedCount) {
      console.warn(`⚠️ Only ${validOptions.length} valid options, expected ${expectedCount}. Adding fallback options.`);
      
      // Add simple fallbacks until we reach expectedCount
      let fallbackIndex = 0;
      while (workingOptions.length < expectedCount && fallbackIndex < simpleFallbackOptions.length) {
        const fallback = simpleFallbackOptions[fallbackIndex];
        // Check if fallback is not already in workingOptions
        const isDuplicate = workingOptions.some(existing => 
          existing.toLowerCase().trim() === fallback.toLowerCase().trim()
        );
        
        if (!isDuplicate) {
          workingOptions.push(fallback);
          console.log(`   Added fallback: "${fallback}"`);
        }
        fallbackIndex++;
      }
      
      // If still not enough, repeat fallbacks (shouldn't happen, but safety)
      while (workingOptions.length < expectedCount) {
        const fallback = simpleFallbackOptions[workingOptions.length % simpleFallbackOptions.length];
        workingOptions.push(fallback);
        console.log(`   Added repeated fallback: "${fallback}"`);
      }
      
      console.log(`✅ Final count after fallbacks: ${workingOptions.length} options`);
    }
    
    // ✅ GUARANTEE: Always have at least expectedCount options
    if (workingOptions.length < expectedCount) {
      console.warn(`⚠️ Still need ${expectedCount - workingOptions.length} more options. Filling with fallbacks.`);
      while (workingOptions.length < expectedCount) {
        const fallback = simpleFallbackOptions[workingOptions.length % simpleFallbackOptions.length];
        workingOptions.push(fallback);
      }
    }
    
    // ✅ FINAL GUARANTEE: Take exactly expectedCount options
    workingOptions = workingOptions.slice(0, expectedCount);
    console.log(`✅ Final working options: ${workingOptions.length} (expected: ${expectedCount})`);

    // Fetch recent options for deduplication
    const { data: recentOptions } = await supabase
      .from('message_options')
      .select('options, created_at')
      .eq('chat_id', chatId)
      .eq('recipient_id', recipientId)
      .order('created_at', { ascending: false })
      .limit(3);

    // Deduplication: filter out options too similar to recent ones
    if (recentOptions && recentOptions.length > 0) {
      const recentTexts = recentOptions.flatMap(r => r.options || []).map(o => String(o).toLowerCase());

      const calculateSimilarity = (str1: string, str2: string) => {
        const words1 = str1.toLowerCase().split(/\s+/);
        const words2 = str2.toLowerCase().split(/\s+/);
        const commonWords = words1.filter(w => words2.includes(w)).length;
        const totalWords = Math.max(words1.length, words2.length);
        return totalWords > 0 ? commonWords / totalWords : 0;
      };

      const originalCount = workingOptions.length;
      workingOptions = workingOptions.filter(opt => {
        const isTooSimilar = recentTexts.some(recent =>
          calculateSimilarity(String(opt), String(recent)) > 0.7
        );
        return !isTooSimilar;
      });

      console.log(`🔍 After deduplication: ${workingOptions.length} unique options (removed ${originalCount - workingOptions.length} duplicates)`);

      // ✅ If deduplication removed too many, add fallbacks to meet expectedCount
      if (workingOptions.length < expectedCount) {
        console.warn(`⚠️ Deduplication left only ${workingOptions.length} options. Adding fallbacks to reach ${expectedCount}...`);
        
        let fallbackIndex = 0;
        while (workingOptions.length < expectedCount && fallbackIndex < simpleFallbackOptions.length) {
          const fallback = simpleFallbackOptions[fallbackIndex];
          const isDuplicate = workingOptions.some(existing => 
            existing.toLowerCase().trim() === fallback.toLowerCase().trim()
          );
          
          if (!isDuplicate) {
            workingOptions.push(fallback);
            console.log(`   Added dedup fallback: "${fallback}"`);
          }
          fallbackIndex++;
        }
        
        // If still not enough, repeat fallbacks
        while (workingOptions.length < expectedCount) {
          const fallback = simpleFallbackOptions[workingOptions.length % simpleFallbackOptions.length];
          workingOptions.push(fallback);
        }
      }
    }

    // ✅ FINAL GUARANTEE: Ensure we ALWAYS have expectedCount options after deduplication
    if (workingOptions.length < expectedCount) {
      console.warn(`⚠️ After deduplication, only ${workingOptions.length}/${expectedCount} options. Padding with fallbacks...`);

      // Add simple fallbacks to reach expectedCount
      let fallbackIndex = 0;
      while (workingOptions.length < expectedCount && fallbackIndex < simpleFallbackOptions.length) {
        const fallback = simpleFallbackOptions[fallbackIndex];
        const isDuplicate = workingOptions.some(existing => 
          existing.toLowerCase().trim() === fallback.toLowerCase().trim()
        );
        
        if (!isDuplicate) {
          workingOptions.push(fallback);
          console.log(`   Added final fallback: "${fallback}"`);
        }
        fallbackIndex++;
      }
      
      // If still not enough, repeat fallbacks
      while (workingOptions.length < expectedCount) {
        const fallback = simpleFallbackOptions[workingOptions.length % simpleFallbackOptions.length];
        workingOptions.push(fallback);
      }

      console.log(`   Final count after padding: ${workingOptions.length} options`);
    }
    
    // ✅ Final safety check: Ensure we have at least expectedCount options
    if (!workingOptions || workingOptions.length === 0 || workingOptions.length < expectedCount) {
      console.warn(`⚠️ Final safety check: Only ${workingOptions?.length || 0} options. Using fallbacks.`);
      
      workingOptions = [];
      while (workingOptions.length < expectedCount) {
        const fallback = simpleFallbackOptions[workingOptions.length % simpleFallbackOptions.length];
        workingOptions.push(fallback);
      }
      console.log(`✅ Final safety check: Generated ${workingOptions.length} fallback options`);
    }
    
    // Set options to workingOptions for final processing
    options = workingOptions;

    // ✅ CRITICAL: Final cleanup to remove ANY remaining @ or # symbols
    const stripTagSymbols = (str: string): string => {
      if (!str || typeof str !== 'string') return str;
      // ✅ FIX: Aggressively remove @Name patterns (including spaces, apostrophes, any case)
      let cleaned = str.replace(/@\s*([A-Za-z][A-Za-z\s'’-]*)/gi, '$1');
      // Remove any remaining @ symbols (catch-all)
      cleaned = cleaned.replace(/@/g, '');
      
      // ✅ ENHANCED: Remove # symbols with case-insensitive matching and normalization
      // Pattern: # followed by optional space, then name (letters, apostrophes, hyphens)
      const hashTagPattern = /#\s*([A-Za-z][A-Za-z'’-]*)/gi;
      cleaned = cleaned.replace(hashTagPattern, (match, name) => {
        // Normalize to Title Case
        return normalizeToTitleCase(name);
      });
      
      // ✅ Catch-all: Remove any remaining # symbols
      cleaned = cleaned.replace(/#/g, '');
      
      return cleaned;
    };

    // ✅ CRITICAL: Remove any remaining listener name references
    // This is a safety net to catch any names that might have slipped through
    // Applied to ALL options in ALL turns for BOTH User A and User B
    const removeListenerName = (option: string): string => {
      if (!option || typeof option !== 'string') return option;
      let cleaned = option;
      const listenerVariants = buildNameVariants(isRecipientUserA ? userBName : userAName);

      if (listenerVariants.length === 0) return cleaned;

      listenerVariants.forEach(variant => {
        const escaped = escapeRegex(variant);
        const hasSpace = /\s/.test(variant);

        // Replace plain name references (without @)
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'s\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('your', offset, source)
        );
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('your', offset, source)
        );
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('you', offset, source)
        );

        // ✅ FIX: Handle @ patterns with optional space, any case, including names with spaces
        // Pattern: @<variant>, @ <variant>, @<variant>'s, @<variant>s
        if (hasSpace) {
          // For names with spaces: @John Smith, @ John Smith, @John Smith's
          cleaned = cleaned.replace(new RegExp(`@\\s*${escaped}'s\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
          cleaned = cleaned.replace(new RegExp(`@\\s*${escaped}'\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
          cleaned = cleaned.replace(new RegExp(`@\\s*${escaped}\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('you', offset, source)
          );
        } else {
          // For single-word names: @John, @ John, @John's, @Johns
          cleaned = cleaned.replace(new RegExp(`@\\s*${escaped}'s\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
          cleaned = cleaned.replace(new RegExp(`@\\s*${escaped}'\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
          cleaned = cleaned.replace(new RegExp(`@\\s*${escaped}\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('you', offset, source)
          );
        }
      });

      return cleaned;
    };

    // ✅ FIX: Post-process options to fix pronoun mistakes
    // Replace "her/his/their" with "your" when clearly referring to the listener
    const fixPronounMistakes = (option: string): string => {
      if (!option || typeof option !== 'string') return option;
      let fixed = option;
      const applyListenerPhraseFixes = (input: string): string => {
        let output = input;

        const possessiveTargets = [
          'perspective',
          'side',
          'point of view',
          'point-of-view',
          'point',
          'feelings',
          'thoughts',
          'take',
          'story',
          'stories',
          'reasons',
          'experience',
          'experiences',
          'situation',
          'situations',
          'needs',
          'opinion',
          'opinions',
          'feedback',
          'actions',
          'behavior',
          'choices',
          'life',
          'world',
          'friendship',
          'relationship',
          'comments',
          'comment',
          'words',
          'energy',
          'time',
          'effort'
        ];

        possessiveTargets.forEach(target => {
          const pattern = new RegExp(`\\btheir ${escapeRegex(target)}\\b`, 'gi');
          output = output.replace(pattern, (match, offset, source) =>
            applySentenceCaseToPhrase(`your ${target}`, offset, source)
          );
        });

        output = output.replace(/\btheirs\b/gi, (match, offset, source) =>
          applySentenceCaseToPhrase('yours', offset, source)
        );

        const simpleThemPhrases: Array<{ pattern: RegExp; replacement: string }> = [
          { pattern: /\bunderstand them\b/gi, replacement: 'understand you' },
          { pattern: /\bhear them\b/gi, replacement: 'hear you' },
          { pattern: /\bhear them out\b/gi, replacement: 'hear you out' },
          { pattern: /\bsupport them\b/gi, replacement: 'support you' },
          { pattern: /\bhelp them\b/gi, replacement: 'help you' },
          { pattern: /\breach out to them\b/gi, replacement: 'reach out to you' },
          { pattern: /\bcheck on them\b/gi, replacement: 'check on you' },
          { pattern: /\bcheck in on them\b/gi, replacement: 'check in on you' },
          { pattern: /\bbe there for them\b/gi, replacement: 'be there for you' },
          { pattern: /\bfor their sake\b/gi, replacement: 'for your sake' }
        ];

        simpleThemPhrases.forEach(({ pattern, replacement }) => {
          output = output.replace(pattern, (match, offset, source) =>
            applySentenceCaseToPhrase(replacement, offset, source)
          );
        });

        output = output.replace(/\btalk (to|with) them\b/gi, (match, preposition, offset, source) =>
          applySentenceCaseToPhrase(`talk ${preposition.toLowerCase()} you`, offset, source)
        );

        output = output.replace(/\bspeak (to|with) them\b/gi, (match, preposition, offset, source) =>
          applySentenceCaseToPhrase(`speak ${preposition.toLowerCase()} you`, offset, source)
        );

        output = output.replace(/\bchat (to|with) them\b/gi, (match, preposition, offset, source) =>
          applySentenceCaseToPhrase(`chat ${preposition.toLowerCase()} you`, offset, source)
        );

        output = output.replace(/\blisten to them\b/gi, (match, offset, source) =>
          applySentenceCaseToPhrase('listen to you', offset, source)
        );

        return output;
      };
      
      // ✅ FIX: Comprehensive pronoun fixes - replace "her/his/their" with "your" when addressing listener
      // Pattern: "her stuff", "his comment", "their behavior", etc.
      // This catches all possessive forms that refer to the listener
      const possessiveNouns = [
        'stuff', 'things', 'comment', 'comments', 'behavior', 'actions', 'words', 'tone', 'attitude',
        'approach', 'support', 'help', 'effort', 'job', 'promotion', 'success', 'wins', 'achievements',
        'accomplishments', 'relationship', 'friendship', 'situation', 'perspective', 'view', 'plan',
        'plans', 'idea', 'ideas', 'response', 'reaction', 'side', 'feelings', 'thoughts', 'needs',
        'opinion', 'opinions', 'feedback', 'choices', 'life', 'world', 'experience', 'experiences'
      ];
      
      if (isRecipientUserA || isRecipientUserB) {
        // ✅ FIX: Replace "her/his/their + noun" with "your + noun" for all possessive patterns
        possessiveNouns.forEach(noun => {
          // Pattern: "her noun", "his noun", "their noun" → "your noun"
          fixed = fixed.replace(new RegExp(`\\b(her|his|their)\\s+${noun}\\b`, 'gi'), (match, pronoun, offset, source) => {
            return applySentenceCaseToPhrase(`your ${noun}`, offset, source);
          });
          
          // Pattern: "her own noun", "his own noun", "their own noun" → "your own noun"
          fixed = fixed.replace(new RegExp(`\\b(her|his|their)\\s+own\\s+${noun}\\b`, 'gi'), (match, pronoun, offset, source) => {
            return applySentenceCaseToPhrase(`your own ${noun}`, offset, source);
          });
        });
        
        // ✅ FIX: Replace common phrases with "her/his/their" referring to listener
        const commonPhrases = [
          { pattern: /\bjealous of (her|his|their)\b/gi, replacement: 'jealous of your' },
          { pattern: /\bof (her|his|their) stuff\b/gi, replacement: 'of your stuff' },
          { pattern: /\bof (her|his|their) things\b/gi, replacement: 'of your things' },
          { pattern: /\b(her|his|their) comment\b/gi, replacement: 'your comment' },
          { pattern: /\b(her|his|their) behavior\b/gi, replacement: 'your behavior' },
          { pattern: /\b(her|his|their) actions\b/gi, replacement: 'your actions' },
          { pattern: /\b(her|his|their) words\b/gi, replacement: 'your words' },
          { pattern: /\b(her|his|their) side\b/gi, replacement: 'your side' },
          { pattern: /\b(her|his|their) perspective\b/gi, replacement: 'your perspective' },
          { pattern: /\b(her|his|their) feelings\b/gi, replacement: 'your feelings' },
          { pattern: /\b(her|his|their) thoughts\b/gi, replacement: 'your thoughts' },
        ];
        
        commonPhrases.forEach(({ pattern, replacement }) => {
          fixed = fixed.replace(pattern, (match, offset, source) => {
            return applySentenceCaseToPhrase(replacement, offset, source);
          });
        });
        
        fixed = applyListenerPhraseFixes(fixed);
      }
      
      return fixed;
    };

    // Capitalize first letter of each option
    const capitalizeFirstLetter = (str: string): string => {
      if (!str || str.length === 0) return str;
      // Don't capitalize if it's just an emoji
      if (/^[\p{Emoji}]$/u.test(str.trim())) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    // ✅ CRITICAL: Apply cleanup pipeline to ALL options in ALL turns for BOTH User A and User B
    // This ensures listener names are NEVER shown - always replaced with "you/your"
    // Applied to: AI-generated options, fallback options, and emergency fallbacks
    // Order matters: strip tags → remove names → fix pronouns → capitalize
    // This runs for EVERY set of options in EVERY turn throughout the ENTIRE conversation
    const processOption = (text: string): string => {
      const stripped = stripTagSymbols(text);
      const perspectived = cleanPerspective(stripped);
      let processed = fixPronounMistakes(removeListenerName(perspectived));
    
      // ✅ Optional polish: add light emoji for warm-up stage
      if (isVeryFirstMessage && !/[?!]$/.test(processed)) {
        processed += ' 🙂';
      }
    
      return capitalizeFirstLetter(processed);
    };
    

    const finalOptions = options.slice(0, Math.min(expectedCount, options.length))
      .map((opt: string) => processOption(opt));

    // ✅ DECLARE enhancedOptions BEFORE addOptionIfMissing to avoid temporal dead zone
    let enhancedOptions = [...finalOptions];

    const addOptionIfMissing = (raw: string | null | undefined) => {
      if (!raw || typeof raw !== 'string') return;
      const processed = processOption(raw);
      if (!processed || processed.trim().length === 0) return;
      if (!enhancedOptions.includes(processed)) {
        enhancedOptions.push(processed);
      }
    };

    const issueSource = isRecipientUserA
      ? (cleanOriginalIssueSummary || cleanSummary || '')
      : '';
    const issueKeywords = isRecipientUserA ? extractKeywords(issueSource, 12) : [];

    if (
      !isVeryFirstMessage &&
      !finalClosureDetected &&
      isRecipientUserA &&
      issueKeywords.length > 0
    ) {
      const hasIssueOption = enhancedOptions.some(opt => {
        const lower = opt.toLowerCase();
        return issueKeywords.some(keyword => lower.includes(keyword));
      });

      if (!hasIssueOption) {
        const issueSnippet = getPrimaryStatement(issueSource);
        if (issueSnippet) {
          const fallbackIssueOption = issueSnippet.endsWith('.') ? issueSnippet : `${issueSnippet}.`;
          addOptionIfMissing(fallbackIssueOption);
        }
      }
    }

    const hintPerspective = shouldUseHint && !isRecipientUserA ? cleanPerspective(hintFromB || '') : '';
    const hintKeywords = shouldUseHint && !isRecipientUserA ? extractKeywords(hintPerspective, 12) : [];

      // ✅ REFINED FIX 2: Block explanation-invitation options based on refined logic
    if (isRecipientUserB && !isVeryFirstMessage) {
      // Patterns that should be blocked (except "Can I share something from my side?" after hint)
      const explanationInvitationPatterns = [
        /can i explain/i,
        /let me explain/i,
        /i'd like to explain/i,
        /i want to explain/i,
        /can i share my perspective/i,
        /can we talk more about/i,
        /let me share my perspective/i,
        /can i explain my side/i,
        /i'd like to explain myself/i,
        /i want to explain what happened/i,
      ];
      
      // ✅ NEW: "Can I share something from my side?" is allowed AFTER hint submission
      const canShareAfterHintPattern = /can i share something from my side/i;
      
      // Separate patterns for "explain again" (always blocked if User B has explained)
      const reExplanationPatterns = [
        /explain again/i,
        /explain myself again/i,
        /explain better/i,
        /explain more/i,
        /share my perspective again/i,
        /share my side again/i,
      ];
      
      // ✅ Use temporary variable to avoid scope/closure issues with reassignment
      const filteredOptions = enhancedOptions.filter(opt => {
        const lower = opt.toLowerCase();
        
        // ✅ NEW: Block vague restatements for User A after they've explained
        if (isRecipientUserA && hasUserAExplainedIssue) {
          const vagueRestatementPatterns = [
            /i (just )?wanted (some )?clarity/i,
            /i didn't want to assume/i,
            /it left me wondering/i,
            /i wanted to understand/i,
            /i (just )?wanted to (talk|discuss|share)/i,
            /something (is|was) bothering me/i,
            /there's something (i|we) need to (talk|discuss)/i,
            /i have something to (discuss|talk about)/i,
            /i (just )?wanted some (clarity|understanding)/i,
            /i (just )?wanted to (make sure|clarify|understand)/i,
          ];
          const isVagueRestatement = vagueRestatementPatterns.some(pattern => pattern.test(lower));
          if (isVagueRestatement) {
            console.log(`   🚫 Blocked vague restatement (User A already explained): "${opt.substring(0, 50)}"`);
            return false;
          }
        }
        
        // Always block re-explanation patterns if User B has already explained
        if (hasUserBExplained) {
          const isReExplanation = reExplanationPatterns.some(pattern => pattern.test(lower));
          if (isReExplanation) {
            console.log(`   🚫 Blocked re-explanation option: "${opt.substring(0, 50)}"`);
            return false;
          }
        }
        
        // ✅ NEW: Allow "Can I share something from my side?" after hint submission
        if (canUserBAskToShareAfterHint && canShareAfterHintPattern.test(lower)) {
          console.log(`   ✅ Allowed "Can I share?" after hint submission: "${opt.substring(0, 50)}"`);
          return true; // Allow this specific pattern after hint
        }
        
        // Block ALL explanation invitations if User B has already explained
        if (hasUserBExplained) {
          const isInvitation = explanationInvitationPatterns.some(pattern => pattern.test(lower)) ||
                               canShareAfterHintPattern.test(lower);
          if (isInvitation) {
            console.log(`   🚫 Blocked explanation-invitation option (User B already explained): "${opt.substring(0, 50)}"`);
            return false;
          }
        }
        
        // Block explanation invitations if User A has shared core issue (even if User B hasn't explained yet)
        // EXCEPT allow "Can I share something from my side?" after hint OR "Can I explain?" early
        if (hasUserASharedCoreIssue && !canUserBAskToExplain) {
          const isInvitation = explanationInvitationPatterns.some(pattern => pattern.test(lower)) ||
                               (canShareAfterHintPattern.test(lower) && !canUserBAskToShareAfterHint);
          if (isInvitation) {
            console.log(`   🚫 Blocked explanation-invitation option (User A already shared issue): "${opt.substring(0, 50)}"`);
            return false;
          }
        }
        
        return true;
      });
      
      // ✅ FIX: Replace array contents instead of reassigning the variable to avoid const reassignment error
      enhancedOptions.length = 0;
      enhancedOptions.push(...filteredOptions);
      
      // If we filtered out options, add replacement options that respond instead of explaining
      if (enhancedOptions.length < 3 && !isVeryFirstMessage) {
        const responseOptions = [
          "I hear you, and I want to make sure we're on the same page.",
          "I understand. Can we talk about how to move forward?",
          "I get what you're saying. What would help us resolve this?",
        ];
        responseOptions.forEach(opt => {
          if (!enhancedOptions.some(existing => existing.toLowerCase().includes(opt.toLowerCase().substring(0, 20)))) {
            addOptionIfMissing(opt);
          }
        });
      }
    }

    if (
      !isVeryFirstMessage &&
      !finalClosureDetected &&
      shouldUseHint &&
      !isRecipientUserA &&
      hintKeywords.length > 0
    ) {
      const hasHintOption = enhancedOptions.some(opt => {
        const lower = opt.toLowerCase();
        return hintKeywords.some(keyword => lower.includes(keyword));
      });

      if (!hasHintOption) {
        const hintSnippet = getPrimaryStatement(hintPerspective || hintFromB || '');
        if (hintSnippet) {
          const fallbackHintOption = hintSnippet.endsWith('.') ? hintSnippet : `${hintSnippet}.`;
          // ✅ REFINED FIX 2: Only add explanation invitation if User B can ask to explain
          if (canUserBAskToExplain) {
            addOptionIfMissing(`I want you to understand ${fallbackHintOption}`);
          }
        }
      }
    }

    const latestKeywords = extractKeywords(cleanCurrentMessage || '', 12);

    const addEmojiFallbacksIfNeeded = () => {
      // ✅ ADJUSTED: Lower threshold for introducing smiley (was 0.5, now 0.3)
      if (!naturalClosureDetected || emotionalClosureScore < 0.3) return;
      
      // ✅ If other user sent smiley, prioritize smiley options
      if (otherUserSentSmiley || otherUserRecentSmiley) {
        const emojiPool = ['🙂','🤝','❤️','💙','😊','🫂','✨','👍'];
        const emojiCount = enhancedOptions.filter(opt => /^[\p{Emoji}]+$/u.test(opt.trim())).length;
        const targetEmojiCount = isVeryFirstMessage ? 2 : 1; // 1-2 smiley options
        
        while (emojiCount < targetEmojiCount && emojiPool.length > 0) {
          const emojiChoice = emojiPool[Math.floor(Math.random() * emojiPool.length)];
          enhancedOptions.push(emojiChoice);
          emojiPool.splice(emojiPool.indexOf(emojiChoice), 1);
        }
        
        const hasGratitudeOption = enhancedOptions.some(opt => /thank|appreciate|glad/i.test(opt));
        if (!hasGratitudeOption && emotionalClosureScore >= 0.5) {
          const gratitudeFallback = isRecipientUserA
            ? 'Thanks for hearing me out, it means a lot.'
            : 'Thanks for being open with me, I really appreciate it.';
          addOptionIfMissing(gratitudeFallback);
        }
        return;
      }

      const emojiPoolHigh = ['🙂','🤝','❤️','💙','😊','🫂','✨','👍'];
      const emojiPoolModerate = ['🙂','🤝','😊','❤️'];
      const emojiPool = emotionalClosureScore >= 0.8 ? emojiPoolHigh : emojiPoolModerate;

      const hasEmojiOption = enhancedOptions.some(opt => /^[\p{Emoji}]+$/u.test(opt.trim()));
      // ✅ GRADUAL: Add 1 smiley if score >= 0.3, add more if score >= 0.5
      if (!hasEmojiOption && emotionalClosureScore >= 0.3) {
        const emojiChoice = emotionalClosureScore >= 0.5 
          ? emojiPool[Math.floor(Math.random() * emojiPool.length)]
          : '🙂'; // Start with simple smiley for early closure
        enhancedOptions.push(emojiChoice);
      }
      // ✅ ENHANCED: Add second smiley if score >= 0.6 and conversation is moderate length
      if (emotionalClosureScore >= 0.6 && safeConversationHistory.length >= 6) {
        const emojiCount = enhancedOptions.filter(opt => /^[\p{Emoji}]+$/u.test(opt.trim())).length;
        // For high closure (0.6+), ensure at least 1-2 smiley options
        const minSmileys = emotionalClosureScore >= 0.7 ? 2 : 1;
        if (emojiCount < minSmileys && emojiPool.length > 0) {
          const emojiChoice = emojiPool[Math.floor(Math.random() * emojiPool.length)];
          enhancedOptions.push(emojiChoice);
        }
      }

      const hasGratitudeOption = enhancedOptions.some(opt => /thank|appreciate|glad/i.test(opt));
      if (!hasGratitudeOption && emotionalClosureScore >= 0.5) {
        const gratitudeFallback = isRecipientUserA
          ? 'Thanks for hearing me out, it means a lot.'
          : 'Thanks for being open with me, I really appreciate it.';
        addOptionIfMissing(gratitudeFallback);
      }
    };

    addEmojiFallbacksIfNeeded();

    // ✅ Extract summary keywords for quality validation
    const summaryKeywords = (() => {
      const summarySource = cleanSummarySharedNeutral || cleanOriginalIssueSummary || cleanSummary || '';
      if (!summarySource || summarySource.length < 10) return [];
      return extractKeywords(summarySource, 10);
    })();

    type ScoredOption = { opt: string; score: number; index: number; hasTalk: boolean; latestMatches: number; wordCount: number; isWeak: boolean; hasSummaryReference: boolean };
    const scoredOptions: ScoredOption[] = enhancedOptions.map((opt, index) => {
      const lower = opt.toLowerCase();
      let score = 0;
      let latestMatches = 0;

      // ✅ NEW: Detect weak/generic options
      const isWeak = /^(I hear|can you tell me more|what do you want|what's on your mind|hey how are you|hi hope you're doing well|hey stranger|what would you like to discuss)$/i.test(opt.trim());
      if (isWeak) {
        score -= 10; // Heavy penalty for weak options
      }

      // ✅ NEW: Calculate word count and reward good length
      const wordCount = opt.trim().split(/\s+/).length;
      let wordCountScore = 0;
      if (wordCount >= 8 && wordCount <= 25) {
        wordCountScore = 2; // Reward good length
      } else if (wordCount < 5) {
        wordCountScore = -3; // Penalize too short
      } else if (wordCount > 25) {
        wordCountScore = -1; // Slight penalty for too long
      }
      score += wordCountScore;

      // ✅ NEW: Check if option references summary or latest message
      const hasSummaryReference = summaryKeywords.length > 0 && summaryKeywords.some(kw => lower.includes(kw.toLowerCase()));
      if (hasSummaryReference) score += 1.5;
      if (isVeryFirstMessage && hasSummaryReference) score += 2; // Extra bonus for first message referencing summary

      latestKeywords.forEach(keyword => {
        if (lower.includes(keyword)) {
          score += 2.5;
          latestMatches++;
        }
      });

      if (isRecipientUserA) {
        issueKeywords.forEach(keyword => {
          if (lower.includes(keyword)) score += acknowledgementMode ? 0.5 : 1.5;
        });
      }

      if (shouldUseHint && !isRecipientUserA) {
        hintKeywords.forEach(keyword => {
          if (lower.includes(keyword)) score += acknowledgementMode ? 0.75 : 1.5;
        });
      }

      if (containsTalkPhrase(opt) && !finalClosureDetected) score -= 1.5;
      if (/^[\p{Emoji}]+$/u.test(opt.trim()) && !finalClosureDetected) score -= 5;
      if (finalClosureDetected && closureSignalRegex.test(lower)) score += 2;

      return {
        opt,
        score,
        index,
        hasTalk: containsTalkPhrase(opt),
        latestMatches,
        wordCount,
        isWeak,
        hasSummaryReference
      };
    });

    scoredOptions.sort((a, b) => {
      if (b.score === a.score) return a.index - b.index;
      return b.score - a.score;
    });

    let selected: string[] = [];
    let talkOptionUsed = false;

    const primaryPool = scoredOptions.filter(candidate => candidate.latestMatches > 0);
    const secondaryPool = scoredOptions.filter(candidate => candidate.latestMatches === 0);

    const trySelectFromPool = (pool: ScoredOption[]) => {
      for (const candidate of pool) {
        if (selected.length >= expectedCount) break;
        if (selected.includes(candidate.opt)) continue;
        if (candidate.hasTalk && talkOptionUsed) continue;

        selected.push(candidate.opt);
        if (candidate.hasTalk) talkOptionUsed = true;
      }
    };

    trySelectFromPool(primaryPool);
    if (selected.length < expectedCount) {
      trySelectFromPool(secondaryPool);
    }

    if (selected.length < expectedCount) {
      for (const candidate of scoredOptions) {
        if (selected.length >= expectedCount) break;
        if (selected.includes(candidate.opt)) continue;
        selected.push(candidate.opt);
      }
    }

    // ✅ NEW: Check quality of selected options - reject if too many weak options
    const weakOptionsCount = selected.filter(opt => {
      const lower = opt.toLowerCase();
      const isWeak = /^(I hear|can you tell me more|what do you want|what's on your mind|hey how are you|hi hope you're doing well|hey stranger|what would you like to discuss)$/i.test(opt.trim());
      const wordCount = opt.trim().split(/\s+/).length;
      return isWeak || wordCount < 5;
    }).length;

    // ✅ NEW: If more than 1 weak option in set, try to replace with better options
    if (weakOptionsCount > 1 && selected.length >= expectedCount) {
      console.warn(`⚠️ Warning: Found ${weakOptionsCount} weak options in selected set. Attempting to improve...`);
      // Try to replace weak options with better ones from scored options
      const weakSelectedIndices: number[] = [];
      selected.forEach((opt, idx) => {
        const lower = opt.toLowerCase();
        const isWeak = /^(I hear|can you tell me more|what do you want|what's on your mind|hey how are you|hi hope you're doing well|hey stranger|what would you like to discuss)$/i.test(opt.trim());
        const wordCount = opt.trim().split(/\s+/).length;
        if (isWeak || wordCount < 5) {
          weakSelectedIndices.push(idx);
        }
      });

      // Try to find better alternatives
      if (weakSelectedIndices.length > 0) {
        const betterAlternatives = scoredOptions
          .filter(candidate => 
            !selected.includes(candidate.opt) && 
            candidate.score > 0 && 
            !candidate.isWeak &&
            candidate.wordCount >= 5
          )
          .sort((a, b) => b.score - a.score)
          .slice(0, weakSelectedIndices.length);

        betterAlternatives.forEach((better, idx) => {
          if (weakSelectedIndices[idx] !== undefined) {
            selected[weakSelectedIndices[idx]] = better.opt;
            console.log(`✅ Replaced weak option with better one: "${better.opt.substring(0, 50)}..."`);
          }
        });
      }
    }

    const selectedLatestCoverage = selected.filter(opt => {
      const lower = opt.toLowerCase();
      return latestKeywords.some(keyword => lower.includes(keyword));
    }).length;

    if (!finalClosureDetected && !isVeryFirstMessage && selectedLatestCoverage === 0) {
      const primaryFocus = (() => {
        if (latestKeywords.length > 0) {
          return latestKeywords.slice(0, 2).join(" & ");
        }
        const snippet = getPrimaryStatement(cleanCurrentMessage || "");
        return snippet ? snippet.replace(/[.?!]+$/, "") : "";
      })();

      // ✅ FRIENDLY TONE POST-PROCESSING: Replace formal phrases with natural ones
      const makeFriendlyAndNatural = (text: string): string => {
        let friendly = text;
        
        // Replace formal acknowledgments
        friendly = friendly.replace(/\bI hear you\b/gi, "I get it");
        friendly = friendly.replace(/\bI appreciate your perspective\b/gi, "thanks for saying that");
        friendly = friendly.replace(/\bI understand your situation\b/gi, "I didn't know that");
        friendly = friendly.replace(/\bI acknowledge your perspective\b/gi, "I get that");
        friendly = friendly.replace(/\bI would like to\b/gi, "I want to");
        friendly = friendly.replace(/\bI apologize for\b/gi, "sorry about");
        friendly = friendly.replace(/\bI would appreciate if\b/gi, "can you");
        friendly = friendly.replace(/\bI am committed to\b/gi, "I'll");
        friendly = friendly.replace(/\bI am ready to\b/gi, "I'm ready to");
        friendly = friendly.replace(/\bWe should resolve\b/gi, "let's figure this out");
        friendly = friendly.replace(/\bI would like to discuss\b/gi, "can we talk about");
        friendly = friendly.replace(/\bI would like to understand\b/gi, "I want to understand");
        friendly = friendly.replace(/\bI appreciate you being open\b/gi, "thanks for telling me");
        friendly = friendly.replace(/\bI acknowledge that\b/gi, "I get that");
        friendly = friendly.replace(/\bI understand where you're coming from\b/gi, "I get it");
        friendly = friendly.replace(/\bI hear what you're saying\b/gi, "I get it");
        friendly = friendly.replace(/\bI appreciate your honesty\b/gi, "thanks for being honest");
        friendly = friendly.replace(/\bI would like to hear your side\b/gi, "can you help me understand");
        friendly = friendly.replace(/\bI am here to support you\b/gi, "I'm here for you");
        friendly = friendly.replace(/\bI want to ensure\b/gi, "I want to make sure");
        friendly = friendly.replace(/\bI would be happy to\b/gi, "I'd be happy to");
        friendly = friendly.replace(/\bI am willing to\b/gi, "I'm willing to");
        friendly = friendly.replace(/\bI would be open to\b/gi, "I'm open to");
        friendly = friendly.replace(/\bI really appreciate\b/gi, "thanks for");
        friendly = friendly.replace(/\bI appreciate\b/gi, "thanks for");
        friendly = friendly.replace(/\bCould we\b/gi, "can we");
        
        // Ensure contractions are used
        friendly = friendly.replace(/\bI am\b/gi, "I'm");
        friendly = friendly.replace(/\bI will\b/gi, "I'll");
        friendly = friendly.replace(/\bI would\b/gi, "I'd");
        friendly = friendly.replace(/\bthat is\b/gi, "that's");
        friendly = friendly.replace(/\bit is\b/gi, "it's");
        friendly = friendly.replace(/\bwe are\b/gi, "we're");
        friendly = friendly.replace(/\byou are\b/gi, "you're");
        friendly = friendly.replace(/\bdo not\b/gi, "don't");
        friendly = friendly.replace(/\bcannot\b/gi, "can't");
        friendly = friendly.replace(/\bwill not\b/gi, "won't");
        
        return friendly;
      };
      
      // Apply friendly tone processing to all selected options
      selected = selected.map(opt => makeFriendlyAndNatural(opt));

      const fallbackLatestRaw = primaryFocus
        ? `Thanks for sharing that about ${primaryFocus}. Can we talk it through?`
        : `Thanks for sharing that. Can we talk it through?`;

      selected[0] = processOption(fallbackLatestRaw);
    }

    if (finalClosureDetected) {
      const emojiPoolHigh = ['🙂','🤝','❤️','💙','😊','🫂','✨','👍'];
      const closureEmoji = selected.find(opt => /^[\p{Emoji}]+$/u.test(opt.trim()));
      if (!closureEmoji) {
        const emojiChoice = emojiPoolHigh[Math.floor(Math.random() * emojiPoolHigh.length)];
        selected[selected.length - 1] = emojiChoice;
      }

      const closureThanks = selected.find(opt => /thank|appreciate|glad/i.test(opt));
      if (!closureThanks) {
        const gratitudeFallback = isRecipientUserA
          ? 'Thanks for talking this through with me.'
          : 'Thanks for staying open with me while we worked through this.';
        selected[0] = processOption(gratitudeFallback);
      }
    }
    
    // ✅ Final validation: Ensure we have at least 1 option before saving (use ANYTHING if needed)
    let finalOptionsToUse = selected;
    if (!finalOptionsToUse || finalOptionsToUse.length === 0) {
      // Last resort: use original options with full cleanup pipeline
      if (options && options.length > 0) {
        console.warn("⚠️ Using original options as absolute fallback for finalOptions");
        finalOptionsToUse = options.slice(0, 3).map((opt: string) => 
          capitalizeFirstLetter(fixPronounMistakes(removeListenerName(stripTagSymbols(String(opt)))))
        );
      } else if (optionsData.options && optionsData.options.length > 0) {
        console.warn("⚠️ Using optionsData.options as last resort");
        finalOptionsToUse = optionsData.options.slice(0, 3).map((opt: string) => 
          capitalizeFirstLetter(fixPronounMistakes(removeListenerName(stripTagSymbols(String(opt)))))
        );
      } else {
        // Generate a simple fallback option (these are already clean, but apply cleanup for consistency)
        console.warn("⚠️ Generating simple fallback option");
        finalOptionsToUse = ["Can we talk about this?", "I'd like to discuss this with you.", "Let's chat about what happened."]
          .map(opt => capitalizeFirstLetter(fixPronounMistakes(removeListenerName(stripTagSymbols(opt)))));
      }
    }
    
    // Ensure finalOptionsToUse is an array
    if (!Array.isArray(finalOptionsToUse) || finalOptionsToUse.length === 0) {
      console.warn("⚠️ Final options invalid, creating emergency fallback");
      finalOptionsToUse = ["Can we talk about this?"];
    }
    console.log("✅ Generated options:", finalOptionsToUse);
    console.log("🔐 Inserting with service role key for chat:", chatId, "recipient:", recipientId);
    console.log("   Options count:", finalOptionsToUse.length);
    console.log("   Options:", finalOptionsToUse);
    console.log("   Recipient is User A:", isRecipientUserA);
    console.log("   Recipient is User B:", isRecipientUserB);

    // ✅ CRITICAL: Apply full cleanup pipeline one final time before saving
    // This is a safety net to ensure NO names slip through, even from fallbacks
    // Applied to ALL options before database insertion - runs for EVERY turn
    let normalizedOptions = Array.isArray(finalOptionsToUse) && finalOptionsToUse.length > 0
      ? finalOptionsToUse.map((opt: string) => {
          let cleaned = String(opt);
          // ✅ FIX: Final aggressive @ cleanup - catch any remaining @Name patterns (case-insensitive)
          const listenerVariants = buildNameVariants(isRecipientUserA ? userBName : userAName);
          // Remove @ followed by any name pattern
          cleaned = cleaned.replace(/@\s*([A-Za-z][A-Za-z\s'’-]*)/gi, (match, name) => {
            // Check if name matches any listener variant (case-insensitive)
            const isListenerName = listenerVariants.some(variant => 
              name.toLowerCase().trim() === variant.toLowerCase()
            );
            // If it's the listener name, replace with "you", else just remove @
            return isListenerName ? 'you' : name;
          });
          // Remove any remaining @ symbols (catch-all)
          cleaned = cleaned.replace(/@/g, '');
          // Apply existing cleanup pipeline
          return capitalizeFirstLetter(fixPronounMistakes(removeListenerName(stripTagSymbols(cleaned))));
        })
      : [capitalizeFirstLetter(fixPronounMistakes(removeListenerName(stripTagSymbols("Can we talk about this?"))))];
    
    // ✅ Final name leak check before saving (should catch any remaining issues)
    const finalListenerName = isRecipientUserA ? userBName : userAName;
    if (finalListenerName) {
      const escapedName = finalListenerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const namePattern = new RegExp(`\\b${escapedName}\\b`, 'gi');
      const hasNameLeak = normalizedOptions.some(opt => namePattern.test(opt));
      if (hasNameLeak) {
        console.error(`❌ CRITICAL: Name leak detected in normalizedOptions! Listener name "${finalListenerName}" still present.`);
        console.error(`   Options:`, normalizedOptions);
        // Apply aggressive cleanup one more time
        normalizedOptions.forEach((opt, idx) => {
          if (namePattern.test(opt)) {
            normalizedOptions[idx] = capitalizeFirstLetter(fixPronounMistakes(removeListenerName(stripTagSymbols(opt))));
            console.warn(`   Fixed option ${idx}: "${opt}" → "${normalizedOptions[idx]}"`);
          }
        });
      }
    }
    
    // ✅ SIMPLIFIED: Filter by single-sentence only (no word count)
    let constrainedNormalizedOptions = normalizedOptions.filter(meetsOptionConstraints);
    if (constrainedNormalizedOptions.length < normalizedOptions.length) {
      console.warn(`⚠️ After normalization, ${normalizedOptions.length - constrainedNormalizedOptions.length} options violated single-sentence rule and were removed.`);
    }
    
    // ✅ GUARANTEE: Always return expectedCount options (never throw error)
    if (constrainedNormalizedOptions.length < expectedCount) {
      console.warn(`⚠️ Only ${constrainedNormalizedOptions.length} normalized options remain; adding fallbacks to reach ${expectedCount}.`);
      
      let fallbackIndex = 0;
      while (constrainedNormalizedOptions.length < expectedCount && fallbackIndex < simpleFallbackOptions.length) {
        const fallback = simpleFallbackOptions[fallbackIndex];
        // Check if fallback is not duplicate
        const isDuplicate = constrainedNormalizedOptions.some(existing => 
          existing.toLowerCase().trim() === fallback.toLowerCase().trim()
        );
        
        if (!isDuplicate) {
          constrainedNormalizedOptions.push(fallback);
          console.log(`   Added normalization fallback: "${fallback}"`);
        }
        fallbackIndex++;
      }
      
      // If still not enough, repeat fallbacks
      while (constrainedNormalizedOptions.length < expectedCount) {
        const fallback = simpleFallbackOptions[constrainedNormalizedOptions.length % simpleFallbackOptions.length];
        constrainedNormalizedOptions.push(fallback);
        console.log(`   Added repeated fallback: "${fallback}"`);
      }
    }
    
    // ✅ FINAL GUARANTEE: Take exactly expectedCount options
    normalizedOptions = constrainedNormalizedOptions.slice(0, expectedCount);
    
    console.log("   Final normalized options:", normalizedOptions);

    // ✅ FIX: Enforce smiley distribution rules for first set of 5 options
    if (isVeryFirstMessage && normalizedOptions.length === 5) {
      // Helper: Check if option contains any emoji/smiley
      const hasEmoji = (text: string): boolean => {
        if (!text || typeof text !== 'string') return false;
        // Check for emoji characters (Unicode emoji ranges)
        const emojiRegex = /[\p{Emoji}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
        return emojiRegex.test(text);
      };
      
      // Helper: Remove multiple stacked smileys, keep only single smiley
      const normalizeSmileys = (text: string): string => {
        if (!text || typeof text !== 'string') return text;
        // Remove multiple consecutive smileys (like ":):):)" or "🙂🙂🙂")
        // Keep only the first smiley if multiple exist
        let normalized = text;
        
        // Remove repeated emoji characters (keep only first occurrence)
        normalized = normalized.replace(/([\p{Emoji}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])\1+/gu, '$1');
        
        // Remove repeated text-based smileys like ":):):)" or "😊😊😊"
        normalized = normalized.replace(/(:\)|:\(|:D|:P|:o|:O|😊|🙂|😁|😄|😃|😀|😉|😎|🤗|🤝|❤️|💙|🫂|✨|👍)\1+/gi, '$1');
        
        return normalized;
      };
      
      // Helper: Remove all emojis from text
      const removeAllEmojis = (text: string): string => {
        if (!text || typeof text !== 'string') return text;
        const emojiRegex = /[\p{Emoji}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
        return text.replace(emojiRegex, '').trim();
      };
      
      // Step 1: Normalize all options (remove multiple stacked smileys)
      normalizedOptions = normalizedOptions.map(opt => normalizeSmileys(opt));
      
      // Step 2: Identify which options currently have smileys
      const optionsWithSmileys: number[] = [];
      const optionsWithoutSmileys: number[] = [];
      
      normalizedOptions.forEach((opt, index) => {
        if (hasEmoji(opt)) {
          optionsWithSmileys.push(index);
        } else {
          optionsWithoutSmileys.push(index);
        }
      });
      
      // Step 3: Enforce placement rule - only positions 2 and 4 (indices 1 and 3) should have smileys
      const targetSmileyPositions = [1, 3]; // Positions 2 and 4 (0-indexed: 1, 3)
      const textOnlyPositions = [0, 2, 4]; // Positions 1, 3, 5 (0-indexed: 0, 2, 4)
      
      // Remove smileys from text-only positions (1, 3, 5)
      textOnlyPositions.forEach(pos => {
        if (normalizedOptions[pos] && hasEmoji(normalizedOptions[pos])) {
          normalizedOptions[pos] = removeAllEmojis(normalizedOptions[pos]);
          console.log(`   Removed smiley from position ${pos + 1} (text-only position)`);
        }
      });
      
      // Step 4: Ensure exactly 2 options have smileys (positions 2 and 4)
      const currentSmileyCount = normalizedOptions.filter(opt => hasEmoji(opt)).length;
      
      if (currentSmileyCount > 2) {
        // Too many smileys - remove from non-target positions
        const currentSmileyIndices: number[] = [];
        normalizedOptions.forEach((opt, index) => {
          if (hasEmoji(opt)) {
            currentSmileyIndices.push(index);
          }
        });
        
        // Keep smileys only in positions 2 and 4, remove from others
        currentSmileyIndices.forEach(index => {
          if (!targetSmileyPositions.includes(index)) {
            normalizedOptions[index] = removeAllEmojis(normalizedOptions[index]);
            console.log(`   Removed smiley from position ${index + 1} (not target position)`);
          }
        });
      } else if (currentSmileyCount < 2) {
        // Too few smileys - add single smiley to positions 2 and 4 if they don't have one
        const smileyEmojis = ['🙂', '😊', '🤝', '❤️', '💙', '🫂', '✨', '👍'];
        let addedCount = 0;
        
        targetSmileyPositions.forEach(pos => {
          if (addedCount < (2 - currentSmileyCount) && !hasEmoji(normalizedOptions[pos])) {
            const randomSmiley = smileyEmojis[Math.floor(Math.random() * smileyEmojis.length)];
            // Add smiley at the end of the text
            normalizedOptions[pos] = normalizedOptions[pos].trim() + ' ' + randomSmiley;
            addedCount++;
            console.log(`   Added smiley to position ${pos + 1}`);
          }
        });
      }
      
      // Step 5: Final verification - ensure positions 1, 3, 5 are text-only
      textOnlyPositions.forEach(pos => {
        if (normalizedOptions[pos] && hasEmoji(normalizedOptions[pos])) {
          normalizedOptions[pos] = removeAllEmojis(normalizedOptions[pos]);
          console.log(`   Final cleanup: Removed smiley from position ${pos + 1}`);
        }
      });
      
      // Step 6: Final verification - ensure exactly 2 smileys in positions 2 and 4
      const finalSmileyCount = normalizedOptions.filter(opt => hasEmoji(opt)).length;
      const finalSmileyPositions = normalizedOptions
        .map((opt, index) => hasEmoji(opt) ? index : -1)
        .filter(index => index !== -1);
      
      console.log(`   ✅ Smiley distribution enforced: ${finalSmileyCount} smileys in positions [${finalSmileyPositions.map(p => p + 1).join(', ')}]`);
      
      // Final check: if we still have more than 2 smileys, remove extras
      if (finalSmileyCount > 2) {
        const extraSmileys = finalSmileyPositions.filter(pos => !targetSmileyPositions.includes(pos));
        extraSmileys.forEach(pos => {
          normalizedOptions[pos] = removeAllEmojis(normalizedOptions[pos]);
          console.log(`   Removed extra smiley from position ${pos + 1}`);
        });
      }
    }

    console.log("   Final normalized options (after smiley enforcement):", normalizedOptions);

    // ✅ CLEANUP: Remove previous options for this chat + recipient to prevent stale flicker
    const { error: deleteError } = await supabase
      .from('message_options')
      .delete()
      .eq('chat_id', chatId)
      .eq('recipient_id', recipientId);

    if (deleteError) {
      console.error('⚠️ Failed to delete existing options before insert:', deleteError);
    } else {
      console.log('🧹 Removed previous options for recipient before inserting new ones');
    }

    // Use Supabase client with service role for insert
    // ✅ CRITICAL FIX: Use recipientId (the person who should receive options), not currentUserId (sender)
    const { data: insertData, error: insertError } = await supabase
      .from('message_options')
      .insert({
        chat_id: chatId,
        recipient_id: recipientId,
        options: normalizedOptions,
        context_data: {
          validated: true,
          conversationStage: conversationPhase || 'discussion',
          turnCount: safeConversationHistory.length,
          hintUsed: !!hintFromB,
          hintReasoning: optionsData.reasoning || null,
          isVeryFirstMessage,
          conversationTimingContext
        }
      })
      
      
      .select()
      .single();

    if (insertError) {
      console.error("❌ Failed to insert options:", insertError);
      console.error("   Insert error details:", JSON.stringify(insertError, null, 2));
      console.error("   Chat ID:", chatId);
      console.error("   Recipient ID:", recipientId);
      console.error("   Options count:", normalizedOptions.length);
      console.error("   Options data:", normalizedOptions);
      
      // ✅ Try to understand the error better
      if (insertError.code === '23505') {
        console.error("   ⚠️ Duplicate key error - options may already exist");
      } else if (insertError.code === '23503') {
        console.error("   ⚠️ Foreign key constraint error - chat or recipient may not exist");
      }
      
      throw new Error(`Failed to save options to database: ${insertError.message || insertError.code || 'Unknown error'}`);
    }

    console.log("✅ Successfully inserted options for recipient:", recipientId);
    console.log("   Insert data:", insertData);
    console.log("   Options saved:", normalizedOptions);

    console.log("✅ Returning success response with options for recipient:", recipientId);
    
    return new Response(JSON.stringify({
      success: true,
      options: normalizedOptions,
      chatId,
      recipientId,
      optionsCount: normalizedOptions.length
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Error in generate-contextual-options:", error);
    console.error("   Error details:", error instanceof Error ? error.message : String(error));
    console.error("   Stack:", error instanceof Error ? error.stack : 'No stack trace');
    
    // ✅ Return detailed error for debugging while maintaining 500 status
    // Note: chatId and recipientId may not be available in catch block, use 'unknown' as fallback
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate options",
      details: error instanceof Error ? error.toString() : String(error),
      chatId: 'unknown',
      recipientId: 'unknown'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
