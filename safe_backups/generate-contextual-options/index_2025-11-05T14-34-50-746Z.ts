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

// ✅ 1️⃣ PERSPECTIVE CLEANUP - Replace @ tags with "you/your" based on speaker's perspective
// CRITICAL INSIGHT: @ always refers to the LISTENER (the person being spoken TO)
// - Summary is written from User A's perspective initially
// - @ in summary = User B (the person User A is talking TO)
// - When generating options:
//   * For User A speaking TO User B: @ = User B's name → "you/your"
//   * For User B speaking TO User A: @ = User A's name → "you/your" (but summary has @UserB, so we need to swap!)

const userAName = userA?.entity_name || '';
const userBName = userB?.entity_name || '';

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

// Helper function to clean text by replacing @ tags with "you/your" based on speaker
const cleanPerspective = (text: string | undefined): string => {
  if (!text || typeof text !== 'string') return text || '';

  let cleaned = text;

  // ✅ CRITICAL FIX: @ always means "the other person in the conversation"
  // The summary is from User A's perspective, so @ = User B's name
  // But when generating options, we need perspective-aware replacement:

  if (isRecipientUserA) {
    // Generating for User A → @ refers to User B (the listener)
    // Replace @UserB with "you/your"
    if (userBName) {
      const escapedName = userBName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Replace possessive forms FIRST
      cleaned = cleaned.replace(new RegExp(`@${escapedName}'s\\b`, 'gi'), "your");
      cleaned = cleaned.replace(new RegExp(`@${escapedName}'\\b`, 'gi'), "your");

      // Then replace base form
      cleaned = cleaned.replace(new RegExp(`@${escapedName}\\b`, 'gi'), 'you');

      console.log(`   ✅ User A speaking TO User B: Replaced @${userBName} with "you/your"`);
    }
  } else {
    // Generating for User B → @ in summary refers to User B (from User A's perspective)
    // But User B is now the speaker, so they need to address User A as "you"
    // SOLUTION: Replace @UserB references with context about User A
    // The summary says "you (@UserB) did X" → User B should say "I did X"
    // The summary says "I felt hurt by @UserB" → User B should say "you felt hurt by me" or "I understand you felt hurt"

    // ✅ Strategy: Replace @ tags pointing to User B with "I/me/my" (User B speaking about themselves)
    //             Replace @ tags pointing to User A with "you/your" (User B addressing User A)

    if (userBName) {
      const escapedBName = userBName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // When @UserB appears in summary, User B should refer to themselves as "I/me/my"
      // But this is complex - let's keep it simple: replace @UserB with "I" for now
      cleaned = cleaned.replace(new RegExp(`@${escapedBName}'s\\b`, 'gi'), "my");
      cleaned = cleaned.replace(new RegExp(`@${escapedBName}\\b`, 'gi'), "I");

      console.log(`   ✅ User B perspective: Replaced @${userBName} with "I/me/my" (User B speaking about self)`);
    }

    if (userAName) {
      const escapedAName = userAName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // When @UserA appears, User B should address them as "you/your"
      cleaned = cleaned.replace(new RegExp(`@${escapedAName}'s\\b`, 'gi'), "your");
      cleaned = cleaned.replace(new RegExp(`@${escapedAName}\\b`, 'gi'), "you");

      console.log(`   ✅ User B speaking TO User A: Replaced @${userAName} with "you/your"`);
    }
  }

  return cleaned;
};

// ✅ Clean all text fields that might contain @<listener> references - SINGLE PASS ONLY
const cleanSummary = cleanPerspective(summary);
const cleanThoughts = cleanPerspective(thoughts);
const cleanOriginalIssueSummary = cleanPerspective(originalIssueSummary);
const cleanRecipientSummary = cleanPerspective(recipientSummary);
const cleanSummaryB = cleanPerspective(summaryB);
const cleanThoughtsB = cleanPerspective(thoughtsB);
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

// ✅ Define perspective clearly (who’s speaking to whom)
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
- ❗ NEVER mention the listener’s real name when writing messages.
- When referring to third parties, use their preferred pronouns or names from the Entity Registry.
`
  : `
🗣️ PRONOUN-TONE RULES (User B → User A):
- Speaker = "I / me / my / mine / myself"
- Listener = "you / your / yours / yourself"
- ❗ NEVER mention the listener’s real name when writing messages.
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
    if (structuredAnswers && structuredAnswers.length > 0) {
      structuredContext += '\n\n📊 STRUCTURED INFORMATION:\n';
      structuredAnswers.forEach((answer) => {
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
  tagContext += `- The recipient (${recipientEntity.entity_name}) is the person this message is being sent TO.\n`;
  tagContext += `- Never say their name or refer to them as "she/he" — always use "you/your".\n`;
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

    // Check for natural closure signals in recent messages
    const recentMessages = safeConversationHistory.slice(-4).map(m => {
      if (typeof m === 'object' && m.content) {
        return String(m.content).toLowerCase();
      }
      return String(m).toLowerCase();
    }).join(' ');
    const hasGratitude = /thank|grateful|appreciate/.test(recentMessages);
    const hasForgiveness = /sorry|forgive|understand|my bad/.test(recentMessages);
    const hasUnderstanding = /makes sense|get it|see your point|clear now/.test(recentMessages);
    const naturalClosureDetected = (hasGratitude && hasForgiveness) || (hasGratitude && hasUnderstanding) || (hasForgiveness && hasUnderstanding);

// Format conversation history (already cleaned via cleanConversationHistory above)
const formattedHistory = cleanConversationHistory.map((msg) => {
  const senderId = typeof msg === 'object' ? msg.sender_id : null;
  const content = typeof msg === 'object' ? msg.content : String(msg);
  return `${senderId === recipientId ? 'You' : 'Contact'}: ${content}`;
}).join('\n');



    // ✅ Perspective cleanup complete (lines 189-250)
    // All @ tags replaced with "you/your", # tags preserved for third parties
    // Claude receives fully cleaned text - no @ tags should be visible

    const systemPrompt = `${perspectiveLine} ${thirdPartyLine} You are writing what one person would DIRECTLY SAY to another person. You are NOT an AI mediator or counselor - you are generating the exact words User A or User B would speak TO each other in a real conversation.

  


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

- # prefix = UNREGISTERED person/group (subject being DISCUSSED, NOT in conversation)
  * # tags MAY still appear in the cleaned text as reference markers
  * When you see #Name, use the person's name naturally (without the #) or their pronouns
  * Example: "#Sarah didn't invite me" → write as "Sarah didn't invite me" or "she didn't invite me"
  * Third parties are being discussed BY the two people in the conversation
  * Use their pronouns from entity_registry (he/him, she/her, they/them)

KEY INSIGHT: By the time you see the text, @ has become "you" and # remains as a hint to use third-party references

${entityContext}
${actionContext}
${structuredContext}
${tagContext}

⚠️ CRITICAL RECIPIENT RULE:
The recipient (${isRecipientUserA ? userAName : userBName}) is the person receiving these message options.
- They will use these options to speak TO the other person
- ${isRecipientUserA ? `User A speaks TO User B` : `User B speaks TO User A`}
- The OTHER person (listener) = ALWAYS "you/your" (never use their real name)
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

STAY WITHIN THE APP:
- NEVER suggest "let's chat later", "let's meet up", "let's talk tomorrow", "call me", "text me"
- NEVER suggest scheduling or coordinating outside this conversation
- Focus on resolving feelings and understanding HERE and NOW
- Keep all communication within this conversation

CRITICAL: MAINTAIN PERSPECTIVE - EACH USER HAS DIFFERENT OPTIONS
${isRecipientUserA ? `
🔵 GENERATING FOR USER A (Original Issue Owner - Speaking TO User B):
- User A initiated with their concern: "${cleanOriginalIssueSummary || cleanSummary}"
- User A's options should express THEIR feelings about THEIR issue
- User A is trying to communicate their perspective and feelings TO User B
- Keep User A's voice authentic to their original concern
- User A speaks about themselves with "I/me/my" and addresses User B with "you/your"
- When mentioning third parties from summary, use their names naturally or pronouns from entity_registry
- Example: "I felt hurt when you ignored me. Sarah told me about the party." (User A speaking - using name without #)
` : ''}
${isRecipientUserB ? `
🟢 GENERATING FOR USER B (Responder - Speaking TO User A):
- ✅ CRITICAL: User B is RESPONDING to User A's LATEST MESSAGE: "${cleanCurrentMessage}"
- User B is NOT continuing User A's original issue - they are RESPONDING to what User A just said
- User B's options should be DIRECT RESPONSES to: "${cleanCurrentMessage}"
- User B has their own feelings and perspective to share with User A
${shouldUseHint ? `- User B's hint: "${hintFromB}" (use subtly, don't expose directly)` : ''}
- Help User B respond with empathy while being authentic
- User B speaks about themselves with "I/me/my" and addresses User A with "you/your"
- When mentioning third parties from summary, use their names naturally or pronouns from entity_registry
- Example: "I understand you felt hurt. I didn't mean to ignore you. Sarah might have misunderstood." (User B responding - using name without #)
- ❗ NEVER generate options that sound like User A's original issue - these are User B's RESPONSES
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
- Summary (cleaned): ${cleanSummary || cleanRecipientSummary || 'No summary provided'}

  ⚠️ IMPORTANT: The summary has been cleaned for perspective:
  - @ tags have been replaced with "you/your" (the listener you're speaking TO)
  - # tags remain for third parties being discussed (use pronouns from entity_registry or their names)
  - The listener is always addressed as "you/your", never by name
- Thoughts (cleaned): ${cleanThoughts || cleanThoughtsB || 'No thoughts provided'}


${shouldUseHint ? `
🔐 USER B'S PRIVATE PERSPECTIVE (Core context that shapes ALL responses):
"${hintFromB}"

⭐ CRITICAL: This hint is User B's TRUE perspective and MUST influence every option generated.

This hint reveals:
- What User B is truly feeling about the situation
- Context User A might not be aware of
- User B's valid perspective and needs
- The subject matter and who/what is being discussed (determines pronouns)
- Opportunities to bridge the understanding gap

Generate options that:
1. Help User B express THEIR perspective fairly based on this context
2. Show that User B has legitimate feelings and reasons too
3. Allow User B to communicate authentically without exposing the hint directly
4. Balance both sides - this isn't just about User A's issue
5. Use the hint's emotional context and subject matter to shape tone, content, and pronouns naturally
6. Maintain consistency with the hint's perspective across ALL conversation turns, not just the first response

USER B SPEAKING TO USER A - PRONOUN GUIDANCE (STRICTLY ENFORCE):
When generating options for User B, they are speaking TO User A directly:
- User B (speaker) = ALWAYS use "I / me / my / mine / myself" when User B talks about themselves
- User A (listener) = ALWAYS use "you / your / yours / yourself" when User B addresses User A
- ❗ NEVER use User A's real name - always use "you/your" when addressing them
- If hint is about User A's actions, User B says "you" TO User A (e.g., "you left without telling me", "you didn't ask how I felt")
- If hint is about third parties, User B tells User A ABOUT them using their names naturally OR pronouns from entity_registry (e.g., "Sarah made me feel excluded", "she mentioned it to me" - no # prefix in actual messages)
- If hint is about User B's feelings, User B shares with "I/me" (e.g., "I felt really hurt when that happened", "I needed space")
- User B talks about "us/we" when discussing the relationship (e.g., "we need to work this out", "I don't want this between us")
- The summary has been cleaned: @ tags replaced with "you/your", # tags remain for third parties

CRITICAL:
- User B is having a real conversation WITH User A, not talking ABOUT User A to someone else
- User B is RESPONDING to User A's latest message: "${cleanCurrentMessage}"
- User B's options should NOT repeat User A's original issue - they should RESPOND to what User A just said
- The hint context persists throughout the ENTIRE conversation
` : ''}

${naturalClosureDetected ? `
🙂 GRADUAL CLOSURE PROGRESSION:
Conversation shows resolution signals. Apply GRADUAL closure approach:

📊 Current closure readiness: ${(hasGratitude && hasForgiveness) || (hasGratitude && hasUnderstanding) ? 'HIGH (0.8+)' : 'MODERATE (0.6-0.8)'}
📈 Conversation progress: Turn ${safeConversationHistory.length} - We've discussed: "${formattedHistory.slice(-200)}"

${(hasGratitude && hasForgiveness) || (hasGratitude && hasUnderstanding) ? `
✅ HIGH CLOSURE - Generate smiley-only options:
- 🙂 (peaceful closure)
- 🤝 (mutual agreement)
- ❤️ (warm feelings)
- 👍 (acknowledgment)
- 😊 (happy closure)

Generate ALL ${isVeryFirstMessage ? '5' : '3'} options as SINGLE EMOJI responses. Time for natural conclusion.
` : `
⏳ MODERATE CLOSURE - Mix text with smiley options:
- ${isVeryFirstMessage ? '3' : '2'} options: Brief text responses acknowledging progress made ("glad we talked", "thanks for understanding", "this helps")
- ${isVeryFirstMessage ? '2' : '1'} option: Single warm emoji (🙂, 🤝, ❤️, 👍)

CRITICAL: Build on what's been discussed. Don't restart the issue. Acknowledge the progress toward resolution.
`}
` : ''}`;

    const userPrompt = `Generate exactly ${isVeryFirstMessage ? '5' : '3'} options that sound like what this person would ACTUALLY SAY in this conversation.

${isVeryFirstMessage ? `
🌱 WARMUP PHASE - CASUAL GREETINGS ONLY:
This is the VERY FIRST message. Generate 5 different casual greetings appropriate for a ${contactCategory} relationship and ${conversationTimingContext} timing.

DO NOT mention any issues or problems yet. Just natural, friendly greetings like:
- "hey! how's it going?"
- "hey, how are you?"
- "what's up? how you been?"
- "hi there, long time no talk"
- "hey, got a sec?"

Match the formality to the relationship type and timing context. Make each option feel distinct.
` : ''}

${!isVeryFirstMessage && safeConversationHistory.length <= 2 ? `
- USE SPECIFIC WORDS from the issue context: ${cleanOriginalIssueSummary || cleanSummary}
- Reference what actually happened in their own words
- Examples: If issue is "she ignored me at party" → "can we talk about the party? I felt ignored"
- Examples: If issue is "you didn't respond to my texts" → "hey, I noticed you didn't reply to my messages"
- Sound like how someone would naturally bring up something that bothered them
- Stay direct, human, and conversational - not formal or therapeutic
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
${shouldUseHint ? `9. Subtly reflect their private feelings without exposing the hint directly
10. Maintain consistency with hint perspective across all turns` : ''}

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
🙂 CLOSURE READY: Consider including ${isVeryFirstMessage ? 'TWO' : 'ONE'} emoji (🙂, 🤝, ❤️, 👍) as option(s) if it feels natural.
REMEMBER: Build on conversation progress, don't restart the issue.
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
const atTagsInMessage = (cleanCurrentMessage.match(/@\w+/g) || []).length;
const atTagsInHistory = cleanConversationHistory.reduce((count, msg) => {
  const content = typeof msg === 'object' ? msg.content : String(msg);
  return count + (content.match(/@\w+/g) || []).length;
}, 0);

console.log("🔍 @ TAG CHECK (should all be 0):", {
  summary: atTagsInSummary,
  thoughts: atTagsInThoughts,
  currentMessage: atTagsInMessage,
  conversationHistory: atTagsInHistory,
  TOTAL: atTagsInSummary + atTagsInThoughts + atTagsInMessage + atTagsInHistory
});

if (atTagsInSummary + atTagsInThoughts + atTagsInMessage + atTagsInHistory > 0) {
  console.warn("⚠️ WARNING: @ tags still present in cleaned data!");
}
console.log("🧹 ============ END CLEANED DATA CHECK ============");

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1500,
        messages: [
          {
            role: "user",
           content: `${systemPrompt}\n\n${userPrompt}`

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

    let options = optionsData.options || [];
    const expectedCount = isVeryFirstMessage ? 5 : 3;
    
    // ✅ Accept what we have - be lenient to ensure options are always delivered
    if (!options || options.length === 0) {
      throw new Error(`No options generated: received empty array`);
    }

    // ✅ ENFORCE WORD LIMIT: Validate and reject if exceeds (NO CROPPING - but be lenient)
    const countWords = (text: string): number => {
      if (!text || typeof text !== 'string') return 0;
      // Don't count single emojis
      if (/^[\p{Emoji}]$/u.test(text.trim())) return 0;
      return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    };

    // ✅ LENIENT WORD LIMIT: Accept options up to 20 words (more flexible for meaningful options)
    // Target 10-14 words, but allow up to 20 words to ensure we always have options
    const validOptions = options.filter(opt => {
      if (!opt || typeof opt !== 'string') {
        console.warn(`⚠️ Invalid option (not a string):`, opt);
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

    // ✅ VERY LENIENT: Accept ANY valid options (even just 1) to ensure User B always sees options
    if (validOptions.length < 1) {
      // ✅ LAST RESORT: If ALL options exceed word limit, use the SHORTEST ones anyway (better than nothing)
      console.warn(`⚠️ All ${options.length} options exceeded word limit. Using shortest options as fallback.`);
      const sortedByLength = options
        .filter(opt => opt && typeof opt === 'string')
        .map(opt => ({ opt, wordCount: countWords(opt) }))
        .sort((a, b) => a.wordCount - b.wordCount)
        .slice(0, Math.min(expectedCount, options.length));
      
      if (sortedByLength.length > 0) {
        workingOptions = sortedByLength.map(item => item.opt);
        console.log(`⚠️ Using ${workingOptions.length} shortest options as fallback (${sortedByLength.map(i => i.wordCount).join(', ')} words each)`);
      } else {
        // Only throw if we truly have NO options
        throw new Error(`No valid options after word limit check: all ${options.length} options exceeded 20-word limit and no fallback available`);
      }
    } else {
      // Use available valid options (up to expected count, but accept any amount)
      workingOptions = validOptions.slice(0, Math.min(expectedCount, validOptions.length));
      console.log(`✅ Word count validation passed: ${workingOptions.length} options under 20 words (expected ${expectedCount}, accepting what we have)`);
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

      workingOptions = workingOptions.filter(opt => {
        const isTooSimilar = recentTexts.some(recent =>
          calculateSimilarity(String(opt), String(recent)) > 0.7
        );
        return !isTooSimilar;
      });

      console.log(`🔍 After deduplication: ${workingOptions.length} unique options`);
    }

    // ✅ VERY LENIENT: Accept ANY options after deduplication (even duplicates, better than nothing)
    if (workingOptions.length < 1) {
      console.warn("⚠️ No unique options after deduplication, using valid options (may have duplicates)");
      // Use validOptions if available (they're already validated)
      if (validOptions.length > 0) {
        workingOptions = validOptions.slice(0, Math.min(expectedCount, validOptions.length));
      } else if (options.length > 0) {
        // Last resort: use original options even if they exceed word limit
        console.warn("⚠️ Using original options as last resort (may exceed word limit)");
        workingOptions = options.slice(0, Math.min(expectedCount, options.length));
      }
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

    // Capitalize first letter of each option
    const capitalizeFirstLetter = (str: string): string => {
      if (!str || str.length === 0) return str;
      // Don't capitalize if it's just an emoji
      if (/^[\p{Emoji}]$/u.test(str.trim())) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    // ✅ Use available options (up to expected count, but accept what we have)
    const finalOptions = options.slice(0, Math.min(expectedCount, options.length)).map(opt => capitalizeFirstLetter(opt));
    
    // ✅ Final validation: Ensure we have at least 1 option before saving (use ANYTHING if needed)
    let finalOptionsToUse = finalOptions;
    if (!finalOptionsToUse || finalOptionsToUse.length === 0) {
      // Last resort: use original options
      if (options && options.length > 0) {
        console.warn("⚠️ Using original options as absolute fallback for finalOptions");
        finalOptionsToUse = options.slice(0, 3).map(opt => capitalizeFirstLetter(String(opt)));
      } else if (optionsData.options && optionsData.options.length > 0) {
        console.warn("⚠️ Using optionsData.options as last resort");
        finalOptionsToUse = optionsData.options.slice(0, 3).map(opt => capitalizeFirstLetter(String(opt)));
      } else {
        // Generate a simple fallback option
        console.warn("⚠️ Generating simple fallback option");
        finalOptionsToUse = ["Can we talk about this?", "I'd like to discuss this with you.", "Let's chat about what happened."];
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

    // ✅ Ensure we have valid options array
    const normalizedOptions = Array.isArray(finalOptionsToUse) && finalOptionsToUse.length > 0 
      ? finalOptionsToUse 
      : ["Can we talk about this?"];
    
    console.log("   Final normalized options:", normalizedOptions);


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
