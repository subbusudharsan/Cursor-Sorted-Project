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
    const { chatId, recipientId, currentUserId, currentMessage, summary, thoughts, wordLimit = 15, originalIssueSummary, recipientSummary, hint_from_b, originalIssue, hintFromB, hintToContact, summaryB, thoughtsB, conversationHistory, isInitial, contactCategory, conversationPhase, resolutionDetected, lastMessageTimestamp, taggedEntities } = await req.json();
    
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
      .select('user_id, contact_id, context_data')
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

    const isRecipientUserA = recipientId === chatData?.user_id;
    const isRecipientUserB = recipientId === chatData?.contact_id;
    const shouldUseHint = isRecipientUserB && hintFromB;
    
    console.log("👥 User identification:", {
      recipientId,
      chatUserA: chatData?.user_id,
      chatContactB: chatData?.contact_id,
      isRecipientUserA,
      isRecipientUserB,
      shouldUseHint
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

// 🗣️ Pronoun Tone Context Injection (User A ↔ User B mapping)
const userA = entities?.find(e => e.role_in_conversation === 'User A');
const userB = entities?.find(e => e.role_in_conversation === 'User B');

const userAName = userA?.entity_name || '';
const userBName = userB?.entity_name || '';

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

// ✅ FIX: Extract summary_a from context_data and derive recipientSummary
const contextData = chatData?.context_data || {};
const summaryA = contextData.summary_a || contextData.summary || summary || originalIssueSummary || '';
const thoughtsA = contextData.thoughts_a || contextData.thoughts || thoughts || '';
const summaryBFromContext = contextData.summary_b || summaryB || '';
const thoughtsBFromContext = contextData.thoughts_b || thoughtsB || '';
const sessionStartedAtIso = contextData.session_started_at;
const sessionStartedAtMs = sessionStartedAtIso ? Date.parse(sessionStartedAtIso) : NaN;

const filteredStructuredAnswers =
  !Number.isNaN(sessionStartedAtMs)
    ? (structuredAnswers || []).filter((answer) => {
        const createdAtMs = answer?.created_at ? Date.parse(answer.created_at) : NaN;
        return !Number.isNaN(createdAtMs) && createdAtMs >= sessionStartedAtMs;
      })
    : (structuredAnswers || []);

console.log("📋 Context data extraction:", {
  hasSummaryA: !!summaryA,
  hasThoughtsA: !!thoughtsA,
  hasSummaryB: !!summaryBFromContext,
  hasThoughtsB: !!thoughtsBFromContext,
  summaryALength: summaryA.length,
  summaryBLength: summaryBFromContext.length,
  recipientIsUserA: isRecipientUserA,
  recipientIsUserB: isRecipientUserB,
  userAName,
  userBName
});

// ✅ FIX: Derive recipientSummary based on recipient
// For User A: use summary_a (User A's original issue)
// For User B: derive from summary_a by swapping perspectives or use summary_b if available
let derivedRecipientSummary = '';
let derivedRecipientThoughts = '';

if (isRecipientUserA) {
  // User A: use their original summary
  derivedRecipientSummary = summaryA || summary || '';
  derivedRecipientThoughts = thoughtsA || thoughts || '';
  console.log("✅ For User A: Using summary_a as recipientSummary");
  } else if (isRecipientUserB) {
    // User B: use summary_b if available, otherwise derive from summary_a
    if (summaryBFromContext && summaryBFromContext.length > 0) {
      derivedRecipientSummary = summaryBFromContext;
      derivedRecipientThoughts = thoughtsBFromContext || '';
      console.log("✅ For User B: Using existing summary_b from context_data");
    } else if (summaryA && summaryA.length > 0) {
      // ✅ FIX: Derive summary_b from summary_a by swapping perspectives
      // The summary_a is written from User A's perspective where:
      // - User A uses "I/me/my" for themselves
      // - User B is referenced with @UserB or their name
      // For User B's perspective, we need to swap:
      // - @UserA or User A's name → "you" (User B addressing User A)
      // - @UserB or User B's name → "I" (User B speaking about themselves)
      // - User A's "I/me/my" → "you/your" (since User B is addressing User A)
      
      // ✅ FIX: Derive summary_b from summary_a by swapping perspectives
      // The summary_a is written from User A's perspective where:
      // - User A uses "I/me/my" for themselves
      // - User B is referenced with @UserB or their name
      // For User B's perspective, we need to swap:
      // - User A's "I/me/my" → "you/your" (User B describing what User A felt/experienced)
      // - @UserA or User A's name → "you" (User B addressing User A)
      // - @UserB or User B's name → "I" (User B speaking about themselves)
      
      let swappedSummary = summaryA;
      
      if (userAName && userBName) {
        const escapedAName = userAName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedBName = userBName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Step 1: Replace @UserB or User B's name with a placeholder first (before handling "I")
        // This prevents "I" from User B's name being confused with User A's "I"
        swappedSummary = swappedSummary.replace(new RegExp(`@${escapedBName}'s\\b`, 'gi'), 'USERB_POSSESSIVE_PLACEHOLDER');
        swappedSummary = swappedSummary.replace(new RegExp(`\\b${escapedBName}'s\\b`, 'gi'), 'USERB_POSSESSIVE_PLACEHOLDER');
        swappedSummary = swappedSummary.replace(new RegExp(`@${escapedBName}\\b`, 'gi'), 'USERB_PLACEHOLDER');
        swappedSummary = swappedSummary.replace(new RegExp(`\\b${escapedBName}\\b`, 'gi'), 'USERB_PLACEHOLDER');
        
        // Step 2: Replace @UserA or User A's name with placeholder
        swappedSummary = swappedSummary.replace(new RegExp(`@${escapedAName}'s\\b`, 'gi'), 'USERA_POSSESSIVE_PLACEHOLDER');
        swappedSummary = swappedSummary.replace(new RegExp(`\\b${escapedAName}'s\\b`, 'gi'), 'USERA_POSSESSIVE_PLACEHOLDER');
        swappedSummary = swappedSummary.replace(new RegExp(`@${escapedAName}\\b`, 'gi'), 'USERA_PLACEHOLDER');
        swappedSummary = swappedSummary.replace(new RegExp(`\\b${escapedAName}\\b`, 'gi'), 'USERA_PLACEHOLDER');
        
        // Step 3: Replace User A's first-person pronouns ("I/me/my/mine") with "you/your"
        // These refer to User A, so from User B's perspective they become "you/your"
        // Use word boundaries to avoid partial matches
        swappedSummary = swappedSummary.replace(/\bI\b/gi, (match, offset, string) => {
          // Check if it's at the start of sentence or after punctuation
          const before = offset > 0 ? string[offset - 1] : ' ';
          const isStartOfSentence = /[.!?]\s*$/.test(string.substring(0, offset));
          return isStartOfSentence || /^\s/.test(string.substring(offset - 1, offset)) ? 'You' : 'you';
        });
        swappedSummary = swappedSummary.replace(/\bme\b/gi, (match, offset, string) => {
          const before = offset > 0 ? string[offset - 1] : ' ';
          const isStartOfSentence = /[.!?]\s*$/.test(string.substring(0, offset));
          return isStartOfSentence ? 'You' : 'you';
        });
        swappedSummary = swappedSummary.replace(/\bmy\b/gi, (match, offset, string) => {
          const before = offset > 0 ? string[offset - 1] : ' ';
          const isStartOfSentence = /[.!?]\s*$/.test(string.substring(0, offset));
          return isStartOfSentence ? 'Your' : 'your';
        });
        swappedSummary = swappedSummary.replace(/\bmine\b/gi, (match, offset, string) => {
          const before = offset > 0 ? string[offset - 1] : ' ';
          const isStartOfSentence = /[.!?]\s*$/.test(string.substring(0, offset));
          return isStartOfSentence ? 'Yours' : 'yours';
        });
        
        // Step 4: Replace placeholders with actual pronouns
        // UserB → "I" (User B speaking about themselves)
        swappedSummary = swappedSummary.replace(/USERB_POSSESSIVE_PLACEHOLDER/gi, (match) => match === 'USERB_POSSESSIVE_PLACEHOLDER' ? 'my' : 'My');
        swappedSummary = swappedSummary.replace(/USERB_PLACEHOLDER/gi, (match) => match === 'USERB_PLACEHOLDER' ? 'I' : 'I');
        
        // UserA → "you" (User B addressing User A)
        swappedSummary = swappedSummary.replace(/USERA_POSSESSIVE_PLACEHOLDER/gi, (match) => match === 'USERA_POSSESSIVE_PLACEHOLDER' ? 'your' : 'Your');
        swappedSummary = swappedSummary.replace(/USERA_PLACEHOLDER/gi, (match) => match === 'USERA_PLACEHOLDER' ? 'you' : 'You');
      }
      
      derivedRecipientSummary = swappedSummary;
      derivedRecipientThoughts = thoughtsA || '';
      console.log("✅ For User B: Derived recipientSummary from summary_a with perspective swap");
      console.log("   Original (User A perspective):", summaryA.substring(0, 150));
      console.log("   Swapped (User B perspective):", swappedSummary.substring(0, 150));
    } else {
      // Fallback: use the passed summary or recipientSummary
      derivedRecipientSummary = summary || recipientSummary || '';
      derivedRecipientThoughts = thoughts || '';
      console.log("⚠️ For User B: Using fallback summary (no summary_a found)");
    }
  }

// ✅ FIX: Ensure recipientSummary is always set
const finalRecipientSummary = recipientSummary || derivedRecipientSummary || summary || '';
const finalRecipientThoughts = thoughts || derivedRecipientThoughts || '';

console.log("✅ Final recipientSummary determination:", {
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

  // ✅ NEW: Remove # symbols from third-party references but keep the name
  // #Vikram becomes Vikram, #Sarah becomes Sarah
  cleaned = cleaned.replace(/#(\w+)/g, '$1');
  console.log(`   ✅ Removed # symbols from third-party references`);

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
const cleanOriginalIssueSummary = cleanPerspective(originalIssueSummary || summaryA);
const cleanRecipientSummary = cleanPerspective(finalRecipientSummary);
const cleanRecipientThoughts = cleanPerspective(finalRecipientThoughts);
const cleanSummaryB = cleanPerspective(summaryBFromContext);
const cleanThoughtsB = cleanPerspective(thoughtsBFromContext);
const cleanCurrentMessage = cleanPerspective(currentMessage);

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

    // 🧠 Build pronoun map from entity_registry
const pronounMap = {};
if (entities && entities.length > 0) {
  entities.forEach(e => {
    if (e.entity_type === 'third_party_person' && e.preferred_pronouns) {
      pronounMap[e.entity_name.toLowerCase()] = e.preferred_pronouns;
    }
  });
}


    // Build tag context for AI with pronoun guidance
    let tagContext = '';
    if (registeredContacts.length > 0) {
      tagContext += `\n\n✅ REGISTERED CONTACTS (conversation participants - already cleaned to "you/your"):\n`;
      tagContext += registeredContacts.map(t => `- ${t.tag} (role: ${t.role}) - Has been replaced with "you/your" in the text you see`).join('\n');
      tagContext += '\n  → You will NOT see @ tags in the text - they are already "you/your"';
    }
    if (unregisteredEntities.length > 0) {
      tagContext += `\n\n📋 THIRD PARTIES (being DISCUSSED, not in conversation):\n`;
      tagContext += unregisteredEntities.map(t => {
  const cleanTag = t.tag.replace('#', '').toLowerCase();
  const name = t.tag.replace('#', ''); // Get name without # prefix
  const pronouns =
    t.pronouns ||
    pronounMap[cleanTag] ||
    'they/them';
  const categoryInfo = t.category ? ` (${t.category})` : '';
  return `- ${name}${categoryInfo} - Use name "${name}" or pronouns "${pronouns}" in messages (drop the # prefix)`;
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

    // ✅ ENHANCED: Emotionally-aware gradual closure detection
    const recentMessages = safeConversationHistory.slice(-4).map(m => {
      if (typeof m === 'object' && m.content) {
        return String(m.content).toLowerCase();
      }
      return String(m).toLowerCase();
    }).join(' ');

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

    // Detect if conversation has mutual exchange (both sides have spoken)
    const mutualExchange = safeConversationHistory.length >= 4 &&
      safeConversationHistory.some(m => typeof m === 'object' && m.sender_id === recipientId) &&
      safeConversationHistory.some(m => typeof m === 'object' && m.sender_id !== recipientId);

    // Only consider closure if conversation has meaningful exchange
    const closureEligible = safeConversationHistory.length >= 6;
    const naturalClosureDetected = closureEligible && mutualExchange && emotionalClosureScore >= 0.5;

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
      mutualExchange,
      naturalClosureDetected,
      messageCount: safeConversationHistory.length
    });

// Format conversation history (already cleaned via cleanConversationHistory above)
const formattedHistory = cleanConversationHistory.map((msg) => {
  const senderId = typeof msg === 'object' ? msg.sender_id : null;
  const content = typeof msg === 'object' ? msg.content : String(msg);
  return `${senderId === recipientId ? 'You' : 'Contact'}: ${content}`;
}).join('\n');



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

    const systemPrompt = `${perspectiveLine} ${thirdPartyLine}

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
- "hey what's up? how you been?" (friendly opening)
- "I felt really hurt when you said that" (using 'you' for direct address)
- "okay I get what you're saying, but from where I'm sitting it looked different" (acknowledging them)
- "my bad, I didn't realize it bothered you that much" (taking responsibility TO them)
- "so how do we fix this? I don't want this between us" (talking about 'us')
- "she really treated me badly at that party" (telling them ABOUT third party)
- "they excluded me from the whole thing" (sharing what others did)
- "you ignored me when I tried to talk" (addressing their specific action)
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
- Third parties (#tagged in summary) = Use their names OR their pronouns from entity_registry
  Example: "Sarah didn't invite me" or "she didn't invite me" (use names without # prefix in actual messages)
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
- Third parties (#tagged in summary) = Use their names OR their pronouns from entity_registry
  Example: "Sarah told me about it" or "she mentioned it" (use names without # prefix in actual messages)
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
1. COMPLETE SENTENCES with natural punctuation
2. DIRECTLY responding to what was just said
3. Sound like a real human talking to someone they know
4. Match the relationship type (casual with friends, respectful with family, professional with coworkers)
5. Use contractions, natural speech patterns, and appropriate informality
6. Choose pronouns based on WHO/WHAT is being discussed (you vs she/he/they)
${shouldUseHint ? `7. SUBTLY reflect the person's private feelings without exposing them` : ''}

${isVeryFirstMessage ? `
🌱 VERY FIRST MESSAGE - CONTEXT-AWARE OPENING:

Timing Context: ${conversationTimingContext}

${conversationTimingContext === 'recent_argument' ? `
⚡ RECENT ARGUMENT - Skip pleasantries, go straight to resolution:
Generate 5 DIFFERENT approaches (10-14 words each, complete and meaningful):
1. Direct and urgent: "we need to talk about what just happened"
2. Calm and conciliatory: "can we talk about earlier?"
3. Honest and open: "I want to clear this up with you"
4. Questioning: "hey can we figure out what happened?"
5. Acknowledging difficulty: "that didn't go well, can we talk?"
DO NOT use casual greetings - they want resolution NOW.
` : conversationTimingContext === 'long_gap' ? `
🕰 LONG GAP - Warm reconnection first, then gentle purpose:
Generate 5 DIFFERENT reconnection styles (10-14 words each, complete and meaningful):
1. Warm and nostalgic: "hey! it's been a while, how have you been?"
2. Caring and thoughtful: "hi! been thinking about you, how are things?"
3. Friendly and casual: "hey stranger! how's life treating you?"
4. Gentle with purpose: "hey, miss chatting with you - can we talk?"
5. Warm check-in: "hi! hope you're doing well, wanted to reach out"
Balance warmth with genuine interest - reconnection comes first.
` : conversationTimingContext === 'same_day' ? `
⏱ SAME DAY - Friendly but purposeful:
Generate 5 DIFFERENT check-in approaches (10-14 words each, complete and meaningful):
1. Casual and direct: "hey, how's your day? got a minute?"
2. Warm with purpose: "hi! hope you're good, wanted to bring something up"
3. Simple check-in: "hey, how are you? something on my mind"
4. Friendly opening: "hey there, how's everything? need to chat about something"
5. Straightforward: "hi, can we talk about something that's been bothering me?"
` : `
💬 NORMAL TIMING - Gentle opening with wellness check:
Generate 5 DIFFERENT greeting styles (10-14 words each, complete and meaningful):
1. Simple and warm: "hey, how are you?"
2. Caring tone: "hi, hope you're doing well - can we chat?"
3. Friendly check-in: "hey there, how's everything going with you?"
4. Direct but warm: "hi, how have you been? wanted to talk"
5. Gentle approach: "hey, got a sec? something I'd like to discuss"
Friendly and caring - show genuine interest before concerns.
`}

Relationship tone (${contactCategory}):
- Friends: casual, use natural slang if appropriate
- Family: warm but respectful
- Coworkers: professional but friendly
- General: balanced and respectful

CRITICAL: Generate 5 TRULY DISTINCT options that vary in:
- Directness (subtle vs straightforward)
- Formality (casual vs respectful)
- Emotional tone (worried vs calm)
- Length (short vs fuller)
- Approach (question vs statement)
` : ''}

SPEECH STYLE PRINCIPLES (use naturally, never label):
- Use how actual people talk: "I felt kinda left out" not "I experienced exclusion"
- Show understanding: "yeah I get that" not "I acknowledge your perspective"
- Admit mistakes simply: "my bad" or "you're right, I messed up" not "I apologize for my actions"
- Keep it real: "I don't want us fighting over this" not "We should resolve our conflict"
- Match their energy: warm when they're open, honest when there's tension
- Use natural fillers when appropriate: "like", "you know", "I mean"
- Let emotion show naturally: "that really hurt" not "I felt emotional distress"

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
- User A initiated with their concern: "${cleanOriginalIssueSummary || cleanSummary}"
- User A's options should express THEIR feelings about THEIR issue
- User A is trying to communicate their perspective and feelings TO User B
${shouldUseHint ? `
- ✅ CRITICAL: User B has provided their perspective: "${hintFromB}"
- User A should acknowledge and understand User B's reasons
- Options should help User A acknowledge User B's perspective and show understanding
- User A needs to recognize that User B has valid reasons for their behavior
- Help User A respond in a way that acknowledges BOTH perspectives
- Options should bridge understanding: "I understand why you felt that way" or "I see your perspective now"
- Both sides need to understand each other - not just User A's original issue
` : ''}
- Keep User A's voice authentic to their original concern
- User A speaks about themselves with "I/me/my" and addresses User B with "you/your"
- ❗ CRITICAL: When User A addresses User B, use "you/your" NOT "her/his/their"
- When mentioning third parties from summary, use their names naturally or pronouns from entity_registry
- Example: "I felt hurt when you ignored me. Sarah told me about the party." (User A speaking - using name without #)
` : ''}
${isRecipientUserB ? `
🟢 GENERATING FOR USER B (Responder - Speaking TO User A):
- ✅ CRITICAL: User B is RESPONDING to User A's LATEST MESSAGE: "${cleanCurrentMessage}"
- User B is NOT continuing User A's original issue - they are RESPONDING to what User A just said
- User B's options should be DIRECT RESPONSES to: "${cleanCurrentMessage}"
- User B has their own feelings and perspective to share with User A
${shouldUseHint ? `
- ✅ CRITICAL: User B's hint: "${hintFromB}"
- User B's hint explains WHY they behaved the way they did
- User B's options MUST STRONGLY CONVEY their reasons and perspective
- Help User B EXPLAIN their side so User A can UNDERSTAND their perspective
- Compare User B's hint with User A's original issue to bridge understanding
- Options should help User B articulate: "I felt X because Y" or "I acted that way because..."
- User B's reasons are VALID and should be clearly communicated
- Both User A and User B need to understand each other's perspectives
` : ''}
- Help User B respond with empathy while being authentic
- User B speaks about themselves with "I/me/my" and addresses User A with "you/your"
- ❗ CRITICAL: When User B addresses User A, use "you/your" NOT "her/his/their"
- When mentioning third parties from summary, use their names naturally or pronouns from entity_registry
- Example: "I understand you felt hurt. I didn't mean to ignore you. Sarah might have misunderstood." (User B responding - using name without #)
- ❗ NEVER generate options that sound like User A's original issue - these are User B's RESPONSES
- ✅ CRITICAL: Options should help BOTH sides understand each other - User A needs to acknowledge User B's reasons
` : ''}
- Don't let issues switch or merge - keep each person's perspective clear
- Options for User A ≠ Options for User B (they have different perspectives and are responding differently)

Context:
- Contact category: ${contactCategory || 'General'}
- Original issue (User A): ${cleanOriginalIssueSummary || cleanSummary || 'Not specified'}


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

Recipient's context:
- Summary (cleaned): ${cleanRecipientSummary || cleanSummary || 'No summary provided'}

  ⚠️ IMPORTANT: The summary has been cleaned for perspective:
  - @ tags have been replaced with "you/your" (the listener you're speaking TO)
  - # tags remain for third parties being discussed (use pronouns from entity_registry or their names)
  - The listener is always addressed as "you/your", never by name
- Thoughts (cleaned): ${cleanRecipientThoughts || cleanThoughts || cleanThoughtsB || 'No thoughts provided'}


${shouldUseHint ? `
🔐 USER B'S PRIVATE PERSPECTIVE (PERSISTENT CORE CONTEXT FOR ALL TURNS):
"${hintFromB}"

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

🎯 CRITICAL: COMPARE HINT WITH ORIGINAL ISSUE SUMMARY:
Original Issue (User A's perspective): "${cleanOriginalIssueSummary || cleanSummary}"
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

USER B SPEAKING TO USER A - STRICT PRONOUN GUIDANCE:
User B is having a direct conversation WITH User A (not talking ABOUT them):
- User B (speaker) = "I / me / my / mine / myself" (User B refers to themselves)
- User A (listener) = "you / your / yours / yourself" (User B addresses User A directly)
- ❌ NEVER use User A's real name in options - always "you/your"
- If hint mentions User A's actions: User B says "you did X" or "when you did X" TO User A
- If hint mentions third parties: Use their names naturally (no #) or pronouns from entity_registry ("Sarah excluded me", "she made me feel bad")
- If hint describes User B's feelings: Share with "I felt X", "I needed Y", "I was hurt when Z"
- Relationship language: "us/we" when discussing the relationship ("we need to work this out", "I don't want us to fight")
- Summary text has been cleaned: User mentions are now "I/me/my" for User A and "you/your" for User B. Any third parties that were referenced with # tags remain exactly as #Name.

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

${emotionalClosureScore >= 0.8 && safeConversationHistory.length >= 8 ? `
✨ VERY HIGH CLOSURE (Score: ${emotionalClosureScore.toFixed(2)}) - Ready for smiley-only options:
Both sides have expressed gratitude, forgiveness, and understanding. Time for gentle, warm closure.

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
` : emotionalClosureScore >= 0.5 ? `
🌱 MODERATE CLOSURE (Score: ${emotionalClosureScore.toFixed(2)}) - Gradual transition phase:
Resolution is emerging. Focus on appreciation while staying grounded in what was discussed.

Generate ${isVeryFirstMessage ? '5' : '3'} options:
- Share gratitude or relief (8-14 words) tied to something they said.
- Reinforce mutual understanding: "thanks for explaining why you felt that way".
- Reinforce continued openness: "I want us to keep being honest like this".

TONE GUIDANCE:
- Acknowledge the specific progress that was made in this conversation.
- Express gratitude naturally: "thanks for being open with me".
- Show positive forward energy while staying concrete: "feel better about us working through this".
- Match relationship tone (casual vs warm vs professional).

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

    ${isVeryFirstMessage ? `
      🌱 WARMUP PHASE - FRIENDLY HELLOS ONLY:
      - Generate 5 warm, friendly openings someone would naturally text to ${contactCategory === 'family'
          ? 'a family member'
          : contactCategory === 'friend'
          ? 'a close friend'
          : contactCategory === 'romantic'
          ? 'a partner'
          : contactCategory === 'work'
          ? 'a teammate'
          : 'someone they know'}.
      - Tones: gentle, upbeat, curious, playful — no tension or conflict.
      - Keep each message SHORT (≤ 12 words).
      - NEVER mention any issue, event, emotion, or third person.
      - NEVER use or imply any @name, real name, or #tag — only say "you", "hey", or similar.
      - Use natural texting style: lowercase fine, small emoji ok ("hey you 😊", "yo", "hi there", "hey hey", etc.).
      - All 5 options must be distinct styles (soft / playful / curious / simple / kind).
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
🔑 CORE ISSUE REQUIREMENT (User A):
- At least one option must clearly restate the main issue in your own words so they fully understand it (event + feeling + why it matters).
- Other options should still stay grounded in the same issue, reacting to their latest reply while keeping your perspective front and center.
- Balance tones: direct, reflective, compassionate — but every option should make the issue feel personal and specific.
` : ''}

${isFirstResponseForUserB ? `
🚦 FIRST RESPONSE GUARDRAILS (User B):
- You just received their opening message and have NOT heard the full story yet.
- Do NOT mention specific events, names, or accusations from summaries or private hints unless the message you are replying to said them explicitly.
- Stay curious and open. Ask what happened, invite them to share more, show you're ready to listen.
- Focus on empathy, willingness to understand, and keeping the door open for them to explain.
- Avoid guessing motives or jumping straight to apologies/confessions about details you haven't heard yet.
- It's okay to acknowledge that you sensed something was wrong, but keep it high level until they explain.
` : ''}

${shouldUseHint && !isRecipientUserA ? `
🟢 PERSISTENT HINT REQUIREMENT (User B):
- Every option must naturally weave in the key truth from your private perspective: "${hintPromptSnippet.substring(0, 160)}${hintPromptSnippet.length > 160 ? '…' : ''}"
- Show different tones (softer, direct, vulnerable) but always explain WHY you felt/acted that way, using details from that hint.
- Make it crystal clear what you needed, what hurt, or what you were trying to protect — no vague responses.
` : ''}

Each option must:
1. Be EXACTLY what the person would say (direct quote, not description)
2. Be COMPLETE and MEANINGFUL - 10-14 words, NO TRUNCATION or "..." needed
${isRecipientUserB ? `
3. ✅ CRITICAL: Respond DIRECTLY to User A's latest message: "${cleanCurrentMessage}"
   - Use words/phrases from their message to show you heard them
   - Address what User A just said, not their original issue
   - Example: If User A said "I felt hurt", respond with "I'm sorry you felt that way" or "I didn't mean to hurt you"
   - Do NOT generate options that sound like User A's original concern
` : `
3. Respond to: "${cleanCurrentMessage}" - USE WORDS/PHRASES from their message to show you heard them
`}
4. Sound like natural speech for a ${contactCategory} relationship
5. Use contractions and casual language where appropriate ("you're" not "you are", "I'm" not "I am")
6. Match the emotional tone of the conversation
7. ✅ STRICT PRONOUN RULES (summary has been cleaned for perspective):
   ${isRecipientUserA ? `
   - Speaker (User A) = "I / me / my / mine / myself"
   - Listener (User B) = "you / your / yours / yourself" (NEVER use User B's name)
   - Third parties = Use their natural names or pronouns from entity_registry (no # prefix in messages)
   ` : `
   - Speaker (User B) = "I / me / my / mine / myself"
   - Listener (User A) = "you / your / yours / yourself" (NEVER use User A's name)
   - Third parties = Use their natural names or pronouns from entity_registry (no # prefix in messages)
   `}
8. INCORPORATE specific details from the conversation context to make responses feel personal and relatable
${shouldUseHint ? `9. MANDATORY: Strongly incorporate User B's hint perspective in EVERY option - this is their core truth and authentic voice
10. CRITICAL: Maintain absolute consistency with hint's emotional context and subject matter across ALL conversation turns
11. PERSISTENT: The hint is active throughout the ENTIRE conversation - incorporate it in turn 1, turn 5, turn 10, etc.` : ''}

CRITICAL: Each option must be a FULL, COMPLETE sentence that makes sense on its own. If you cannot express the complete thought in 14 words, simplify the sentence while keeping the core meaning intact. Options will NOT be truncated - they must be complete within the word limit.

${isRecipientUserB ? `
✅ DIFFERENTIATION RULE FOR USER B:
- User B's options MUST be different from User A's options
- User B is RESPONDING, not continuing User A's issue
- User B's options should show they heard User A's message and are responding to it
- If User A said "I felt hurt", User B should respond with options like:
  ✅ "I'm sorry you felt that way, I didn't mean to hurt you"
  ✅ "I hear you, can we talk about what happened?"
  ✅ "I understand, I should have been more considerate"
  ❌ NOT: "I felt hurt when you ignored me" (this sounds like User A's issue, not User B's response)
` : ''}

CRITICAL - MAKE IT RELATABLE:
- If they mentioned a specific event ("the party", "last week"), reference it
- If they used emotional words ("hurt", "upset", "confused"), acknowledge those feelings
- If they mentioned specific actions ("you ignored me", "you left early"), address those directly
- Mirror their language naturally to show you're truly listening and engaging

${naturalClosureDetected ? `
🌈 GRADUAL CLOSURE GUIDANCE (Score: ${emotionalClosureScore.toFixed(2)}):
${emotionalClosureScore >= 0.8 ? `
✨ VERY HIGH CLOSURE: Generate ALL ${isVeryFirstMessage ? '5' : '3'} options as SINGLE EMOJIS ONLY.
Choose from: 🙂 🤝 ❤️ 💙 😊 🫂 ✨ 👍
Match to relationship (${contactCategory}) and conversation tone.
NO TEXT - just emojis.
` : emotionalClosureScore >= 0.5 ? `
🌱 MODERATE CLOSURE: Mix ${isVeryFirstMessage ? '2-3' : '1-2'} brief text acknowledgments (8-12 words) with ${isVeryFirstMessage ? '2' : '1'} single emoji.
Text should acknowledge progress and express gratitude naturally.
Build on what was discussed, show genuine appreciation.
` : `
💬 EARLY CLOSURE: NO smiley options yet. Focus on deepening understanding.
Ask clarifying questions, validate feelings, explore concerns.
Ensure both sides feel truly heard before moving to closure.
`}
` : ''}

RELATIONSHIP-SPECIFIC TONE:
- Friend: casual, use "dude", "bro", "man" if natural, informal language
- Family: warm but respectful, appropriate familiarity
- Coworker: professional but friendly, no overly casual slang
- General: balanced, friendly but not too informal

STRICT RULES - NO CROPPING ALLOWED:
- TARGET: 10-14 words per option (10 words ideal, 4-5 words extra tolerance allowed)
- MAXIMUM: 20 words per option (flexible limit - prioritize meaning over strict word count)
- Each option MUST be a COMPLETE, MEANINGFUL sentence that makes sense on its own
- NEVER generate incomplete sentences, truncated thoughts, or sentences that need "..." at the end
- If you cannot express a complete thought in 14 words, simplify the sentence while keeping the meaning
- CRITICAL: Generate options that are COMPLETE and MEANINGFUL within the word limit - they will NOT be truncated
- Use natural contractions ("you're" not "you are", "didn't" not "did not") to save words
- Remove unnecessary filler words ("like", "just", "really") but keep emotional words if they add meaning
- NO AI/counselor language ("I acknowledge", "Let's work together", "I understand your perspective")
- Sound like REAL human speech with natural warmth
- NO scheduling outside the app
- Use lowercase for casual relationships if natural
- Be RESPECTFUL, KIND, and POLITE even when addressing difficult topics
- Focus on RESOLVING and UNDERSTANDING, not blaming or attacking
- ${isVeryFirstMessage ? 'Generate 5 DISTINCT options' : 'Generate 3 DISTINCT options'}
- Each option must have DIFFERENT tone, approach, or directness level

🎯 EXAMPLES OF GOOD BREVITY (meaningful, complete, 10-14 words, NO CROPPING):
${isRecipientUserA ? `
USER A EXAMPLES (speaking TO User B):
- "hey, can we talk about what happened yesterday?" (8 words) ✅
- "I felt hurt when you didn't invite me to the party" (10 words) ✅
- "Sarah said something that really bothered me at work" (9 words) ✅ [third party - no # prefix]
- "want to clear this up between us? I miss you" (10 words) ✅
- "I need to talk about something that's been bothering me" (10 words) ✅
- "can we find a time to discuss this? I value our friendship" (12 words) ✅
- "she told me what happened, and I felt left out" (10 words) ✅ [third party pronoun]
Note: User A uses "I" for themselves, "you" for User B, and natural names/pronouns for third parties (NO # in actual messages)
` : `
USER B EXAMPLES (responding TO User A):
- "I'm sorry you felt that way, I didn't mean to hurt you" (12 words) ✅
- "I hear what you're saying, can we talk about it?" (10 words) ✅
- "I understand, I should have been more considerate" (8 words) ✅
- "I didn't realize it bothered you, I'm sorry" (9 words) ✅
- "I want to make this right between us" (8 words) ✅
- "I see your point, let's work through this together" (10 words) ✅
- "Sarah mentioned you were upset, I should have reached out" (10 words) ✅ [third party - no # prefix]
Note: User B uses "I" for themselves, "you" for User A, and natural names/pronouns for third parties (NO # in actual messages)
`}

❌ BAD EXAMPLES (too long, would be rejected):
- "I wanted to talk to you about what happened yesterday because I felt really hurt and I think we need to discuss this" (22 words - TOO LONG) ❌

TONE REQUIREMENTS:
- Show empathy and care even when being direct
- Acknowledge feelings without dismissing them
- Speak from a place of wanting to fix things, not win an argument
- Use gentle language: "I felt" instead of "you made me feel", "can we talk about" instead of "you need to explain"

Format as JSON:
{
  "options": [${isVeryFirstMessage ? '"Option 1", "Option 2", "Option 3", "Option 4", "Option 5"' : '"Exact words they\'d say 1", "Exact words they\'d say 2", "Exact words they\'d say 3"'}]${shouldUseHint ? `,
  "reasoning": "How hint shaped these responses"` : ''}
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

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        temperature: 0.7,
        system: `${systemPrompt}\n\n${compassionateSystemPrompt}`,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      })
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("Anthropic API error:", errorText);
      throw new Error(`Anthropic API failed: ${anthropicResponse.status}`);
    }

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
              "yo! how’s your day been?",
              "hey hey, what’s up?",
              "hi, hope you’re doing good 🙂",
            ]
          : contactCategory === "friend"
          ? [
              "hey you 😊 got a sec?",
              "hi there, just wanted to say hey 🙂",
              "yo! how’s your day been?",
              "hey hey, what’s up?",
              "hi, hope you’re doing good 🙂",
            ]
          : contactCategory === "romantic"
          ? [
              "hey you 😊 got a sec?",
              "hi love, just wanted to say hey 🙂",
              "yo! how’s your evening been?",
              "hey hey, what’s up?",
              "hi, hope you’re doing good 🙂",
            ]
          : contactCategory === "work"
          ? [
              "hey you 😊 got a sec?",
              "hi there, just wanted to say hey 🙂",
              "yo! how’s your day been?",
              "hey hey, what’s up?",
              "hi, hope you’re doing good 🙂",
            ]
          : [
              "hey you 😊 got a sec?",
              "hi there, just wanted to say hey 🙂",
              "yo! how’s your day been?",
              "hey hey, what’s up?",
              "hi, hope you’re doing good 🙂",
            ];

      options = friendlyTemplates.slice(0, 5);
      console.log("✅ Rewrote warm-up options (friendly only):", options);
    }

    // ✅ STRICT: Enforce minimum option count (5 for first turn, 3 for all others)
    if (!options || options.length === 0) {
      throw new Error(`No options generated: received empty array`);
    }

    // Log received option count
    console.log(`📊 Received ${options.length} options from AI, expected ${expectedCount}`);

    // ✅ ENFORCE WORD LIMIT: Validate and reject if exceeds (NO CROPPING - but be lenient)
    const countWords = (text: string): number => {
      if (!text || typeof text !== 'string') return 0;
      // Don't count single emojis
      if (/^[\p{Emoji}]$/u.test(text.trim())) return 0;
      return text.trim().split(/\s+/).filter(w => w.length > 0).length;
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

    // ✅ LENIENT WORD LIMIT + NAME LEAK VALIDATION
    // Target 10-14 words, but allow up to 20 words to ensure we always have options
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

      const wordCount = countWords(opt);
      // ✅ LENIENT: Allow up to 20 words (instead of strict 15) to ensure options are always available
      if (wordCount > 20) {
        console.warn(`⚠️ Option exceeds 20 words (${wordCount}) and will be rejected: "${opt.substring(0, 60)}..."`);
        return false;
      }
      // Log if option is ideal length or within tolerance
      if (wordCount > 15) {
        console.log(`ℹ️ Option has ${wordCount} words (above ideal 15, but within 20 limit - accepting)`);
      }
      return true;
    });

    // ✅ Store validOptions for potential fallback
    let workingOptions = validOptions;

    // ✅ ENFORCE MINIMUM: Must have at least expectedCount options (retry or generate fallbacks)
    if (validOptions.length < expectedCount) {
      console.warn(`⚠️ Only ${validOptions.length} valid options, expected ${expectedCount}. Need to add fallback options.`);

      // If we have at least 1 valid option, pad with contextual fallbacks
      if (validOptions.length >= 1) {
        console.log(`✅ Have ${validOptions.length} valid options, generating ${expectedCount - validOptions.length} contextual fallbacks...`);

        // Generate contextual fallback options based on conversation state
        const fallbackOptions: string[] = [
          "Can you help me understand your perspective?",
          "I want to understand how you're feeling about this.",
          "What was going through your mind when that happened?",
          "Can we talk about what happened?",
          "I'd like to hear your side of this."
        ];

        // Add fallbacks until we reach expectedCount
        let fallbackIndex = 0;
        while (workingOptions.length < expectedCount && fallbackIndex < fallbackOptions.length) {
          // Check if fallback is not too similar to existing options
          const fallback = fallbackOptions[fallbackIndex];
          const isSimilar = workingOptions.some(existing => {
            const similarity = existing.toLowerCase().includes(fallback.toLowerCase().substring(0, 10));
            return similarity;
          });

          if (!isSimilar) {
            workingOptions.push(fallback);
            console.log(`   Added fallback: "${fallback}"`);
          }
          fallbackIndex++;
        }

        console.log(`✅ Final count after fallbacks: ${workingOptions.length} options`);
      } else {
        // No valid options at all - use ALL shortest options as fallback
        console.warn(`⚠️ No valid options. Using shortest options from AI response as fallback.`);
        const sortedByLength = options
          .filter(opt => opt && typeof opt === 'string')
          .map(opt => ({ opt, wordCount: countWords(opt) }))
          .sort((a, b) => a.wordCount - b.wordCount)
          .slice(0, expectedCount);

        if (sortedByLength.length >= expectedCount) {
          workingOptions = sortedByLength.map(item => item.opt);
          console.log(`⚠️ Using ${workingOptions.length} shortest options (${sortedByLength.map(i => i.wordCount).join(', ')} words each)`);
        } else {
          throw new Error(`Cannot generate ${expectedCount} options: AI provided ${options.length}, only ${sortedByLength.length} usable`);
        }
      }
    } else {
      // Use exactly expectedCount valid options
      workingOptions = validOptions.slice(0, expectedCount);
      console.log(`✅ Have ${validOptions.length} valid options, using exactly ${expectedCount} as expected`);
    }

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

      // ✅ If deduplication removed too many, restore some unique validated options to meet expectedCount
      if (workingOptions.length < expectedCount && validOptions.length > 0) {
        console.warn(`⚠️ Deduplication left only ${workingOptions.length} options. Restoring unique options to reach ${expectedCount}...`);

        // Find validOptions not in workingOptions
        const additionalOptions = validOptions.filter(vo => !workingOptions.includes(vo));

        // Add back options until we reach expectedCount
        let addedCount = 0;
        for (const opt of additionalOptions) {
          if (workingOptions.length >= expectedCount) break;
          workingOptions.push(opt);
          addedCount++;
        }

        console.log(`   Restored ${addedCount} unique options to meet minimum count`);
      }
    }

    // ✅ ENFORCE: Ensure we ALWAYS have expectedCount options
    if (workingOptions.length < expectedCount) {
      console.warn(`⚠️ After deduplication, only ${workingOptions.length}/${expectedCount} options. Padding with fallbacks...`);

      const genericFallbacks = [
        "I hear what you're saying.",
        "Can we work through this together?",
        "I want to make things right between us."
      ];

      // Add generic fallbacks to reach expectedCount
      let fallbackIndex = 0;
      while (workingOptions.length < expectedCount && fallbackIndex < genericFallbacks.length) {
        if (!workingOptions.includes(genericFallbacks[fallbackIndex])) {
          workingOptions.push(genericFallbacks[fallbackIndex]);
        }
        fallbackIndex++;
      }

      console.log(`   Final count after padding: ${workingOptions.length} options`);
    }
    
    // ✅ Final safety check: Ensure we have at least 1 option (use ANYTHING if needed)
    if (!workingOptions || workingOptions.length === 0) {
      // Absolute last resort: use first option from original array
      if (options && options.length > 0) {
        console.warn("⚠️ Using first option from original array as absolute fallback");
        workingOptions = [options[0]];
      } else {
        throw new Error(`No options available after all validation steps`);
      }
    }
    
    // Set options to workingOptions for final processing
    options = workingOptions;

    // ✅ CRITICAL: Final cleanup to remove ANY remaining @ or # symbols
    const stripTagSymbols = (str: string): string => {
      if (!str || typeof str !== 'string') return str;
      // Remove @ symbols followed by word characters
      let cleaned = str.replace(/@(\w+)/g, '$1');
      // Remove # symbols followed by word characters
      cleaned = cleaned.replace(/#(\w+)/g, '$1');
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

        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'s\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('your', offset, source)
        );
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}'\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('your', offset, source)
        );
        cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (match, offset, source) =>
          applySentenceCase('you', offset, source)
        );

        if (!hasSpace) {
          cleaned = cleaned.replace(new RegExp(`@${escaped}'s\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
          cleaned = cleaned.replace(new RegExp(`@${escaped}'\\b`, 'gi'), (match, offset, source) =>
            applySentenceCase('your', offset, source)
          );
          cleaned = cleaned.replace(new RegExp(`@${escaped}\\b`, 'gi'), (match, offset, source) =>
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
      
      // Common patterns where "her/his/their" should be "your" when addressing listener
      // Pattern: "her stuff", "her things", "her comment", "her behavior", etc.
      // This is a conservative fix - only for possessive forms
      if (isRecipientUserA) {
        // User A speaking TO User B - fix references to User B
        // Pattern: "jealous of her stuff" → "jealous of your stuff"
        // But be careful - "Sarah told her" should stay as is (third party)
        // We'll use a conservative pattern that only matches possessive forms
        fixed = fixed.replace(/\bjealous of her\b/gi, 'jealous of your');
        fixed = fixed.replace(/\bof her stuff\b/gi, 'of your stuff');
        fixed = fixed.replace(/\bof her things\b/gi, 'of your things');
        fixed = fixed.replace(/\bher comment\b/gi, 'your comment');
        fixed = fixed.replace(/\bher behavior\b/gi, 'your behavior');
        fixed = fixed.replace(/\bher actions\b/gi, 'your actions');
        fixed = fixed.replace(/\bher words\b/gi, 'your words');

        fixed = fixed.replace(/\bher\s+((?:own\s+|new\s+)?)(car|cars|house|houses|home|apartment|place|stuff|things|comment|comments|behavior|actions|words|tone|attitude|approach|support|help|effort|job|promotion|success|wins|achievements|accomplishments|relationship|friendship|situation|perspective|view|plan|plans|idea|ideas|response|reaction)\b/gi,
          (match, qualifier, noun, offset, source) => {
            const qualifierWord = qualifier ? `${qualifier.trim().toLowerCase()} ` : '';
            const replacement = `your ${qualifierWord}${noun}`;
            return applySentenceCaseToPhrase(replacement.trim(), offset, source);
          });
        fixed = applyListenerPhraseFixes(fixed);
      } else if (isRecipientUserB) {
        // User B speaking TO User A - fix references to User A
        fixed = fixed.replace(/\bjealous of her\b/gi, 'jealous of your');
        fixed = fixed.replace(/\bof her stuff\b/gi, 'of your stuff');
        fixed = fixed.replace(/\bof her things\b/gi, 'of your things');
        fixed = fixed.replace(/\bher comment\b/gi, 'your comment');
        fixed = fixed.replace(/\bher behavior\b/gi, 'your behavior');
        fixed = fixed.replace(/\bher actions\b/gi, 'your actions');
        fixed = fixed.replace(/\bher words\b/gi, 'your words');
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

    const addOptionIfMissing = (raw: string | null | undefined) => {
      if (!raw || typeof raw !== 'string') return;
      const processed = processOption(raw);
      if (!processed || processed.trim().length === 0) return;
      if (!enhancedOptions.includes(processed)) {
        enhancedOptions.push(processed);
      }
    };

    let enhancedOptions = [...finalOptions];

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
          addOptionIfMissing(`I want you to understand ${fallbackHintOption}`);
        }
      }
    }

    const latestKeywords = extractKeywords(cleanCurrentMessage || '', 12);

    const addEmojiFallbacksIfNeeded = () => {
      if (!finalClosureDetected || emotionalClosureScore < 0.5) return;

      const emojiPoolHigh = ['🙂','🤝','❤️','💙','😊','🫂','✨','👍'];
      const emojiPoolModerate = ['🙂','🤝','😊','❤️'];
      const emojiPool = emotionalClosureScore >= 0.8 ? emojiPoolHigh : emojiPoolModerate;

      const hasEmojiOption = enhancedOptions.some(opt => /^[\p{Emoji}]+$/u.test(opt.trim()));
      if (!hasEmojiOption && emojiPool.length > 0) {
        const emojiChoice = emojiPool[Math.floor(Math.random() * emojiPool.length)];
        enhancedOptions.push(emojiChoice);
      }

      const hasGratitudeOption = enhancedOptions.some(opt => /thank|appreciate|glad/i.test(opt));
      if (!hasGratitudeOption) {
        const gratitudeFallback = isRecipientUserA
          ? 'Thanks for hearing me out, it means a lot.'
          : 'Thanks for being open with me, I really appreciate it.';
        addOptionIfMissing(gratitudeFallback);
      }
    };

    addEmojiFallbacksIfNeeded();

    type ScoredOption = { opt: string; score: number; index: number; hasTalk: boolean; latestMatches: number };
    const scoredOptions: ScoredOption[] = enhancedOptions.map((opt, index) => {
      const lower = opt.toLowerCase();
      let score = 0;
      let latestMatches = 0;

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
        latestMatches
      };
    });

    scoredOptions.sort((a, b) => {
      if (b.score === a.score) return a.index - b.index;
      return b.score - a.score;
    });

    const selected: string[] = [];
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

      const fallbackLatestRaw = primaryFocus
        ? `I really appreciate what you shared about ${primaryFocus}. Could we talk it through together?`
        : `I appreciate what you just shared. Could we talk it through together?`;

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
    const normalizedOptions = Array.isArray(finalOptionsToUse) && finalOptionsToUse.length > 0
      ? finalOptionsToUse.map((opt: string) => 
          capitalizeFirstLetter(fixPronounMistakes(removeListenerName(stripTagSymbols(String(opt)))))
        )
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
    
    console.log("   Final normalized options:", normalizedOptions);


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
        recipient_id: recipientId, // ✅ Fixed: recipientId is who should receive the options
        options: normalizedOptions,
        context_data: {
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
