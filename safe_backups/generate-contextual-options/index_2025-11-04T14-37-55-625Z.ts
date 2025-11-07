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
    const { chatId, recipientId, currentUserId, currentMessage, summary, thoughts, originalIssueSummary, recipientSummary, hint_from_b, originalIssue, hintFromB, hintToContact, summaryB, thoughtsB, conversationHistory, isInitial, contactCategory, conversationPhase, resolutionDetected, lastMessageTimestamp, taggedEntities } = await req.json();

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

    // Detect if this is the very first message from User A
    const isVeryFirstMessage = conversationHistory.length === 0;

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
    const { data: chatData } = await supabase
      .from('chats')
      .select('user_id, contact_id, context_data')
      .eq('id', chatId)
      .single();

    const isRecipientUserA = recipientId === chatData?.user_id;
    const isRecipientUserB = recipientId === chatData?.contact_id;
    const shouldUseHint = isRecipientUserB && hintFromB;

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

// Determine who the AI is generating options for
const generatingFor = isRecipientUserA ? 'User A' : 'User B';

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
      tagContext += `\n\nREGISTERED CONTACTS (use @ prefix, these are IN the conversation):\n`;
      tagContext += registeredContacts.map(t => `- ${t.tag} (role: ${t.role}) - address them with "you/your"`).join('\n');
    }
    if (unregisteredEntities.length > 0) {
      tagContext += `\n\nUNREGISTERED ENTITIES (use # prefix, these are being DISCUSSED):\n`;
      tagContext += unregisteredEntities.map(t => {
  const cleanTag = t.tag.replace('#', '').toLowerCase();
  const pronouns =
    t.pronouns ||
    pronounMap[cleanTag] ||
    'they/them';
  const categoryInfo = t.category ? ` (${t.category})` : '';
  return `- ${t.tag}${categoryInfo} - being discussed - use pronouns: ${pronouns}`;
}).join('\n');

      tagContext += '\n\nIMPORTANT: When talking ABOUT # tagged entities, use their specified pronouns consistently. Default to they/them if uncertain.';
    }
// 🧩 Ensure recipient contact name is never mentioned directly
const recipientEntity =
  entities?.find(e => e.user_id === recipientId) ||
  entities?.find(e => e.role_in_conversation === (isRecipientUserA ? 'User A' : 'User B'));

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
    console.log('  conversationHistory.length:', conversationHistory.length);

    // Check for natural closure signals in recent messages
    const recentMessages = conversationHistory.slice(-4).map(m => m.content.toLowerCase()).join(' ');
    const hasGratitude = /thank|grateful|appreciate/.test(recentMessages);
    const hasForgiveness = /sorry|forgive|understand|my bad/.test(recentMessages);
    const hasUnderstanding = /makes sense|get it|see your point|clear now/.test(recentMessages);
    const naturalClosureDetected = (hasGratitude && hasForgiveness) || (hasGratitude && hasUnderstanding) || (hasForgiveness && hasUnderstanding);

    const formattedHistory = conversationHistory.map((msg) => `${msg.sender_id === recipientId ? 'You' : 'Contact'}: ${msg.content}`).join('\n');

    
    // 🧹 PERSPECTIVE SANITIZATION – prevent AI mediator voice
try {
  const generatingFor = isRecipientUserA ? 'User A' : 'User B';
  const listenerRole = isRecipientUserA ? 'User A' : 'User B';
  const recipientEntity =
    entities?.find(e => e.role_in_conversation === listenerRole) ||
    entities?.find(e => e.user_id === recipientId);

  // Clean out recipient names so Claude never sees them as 3rd-person
  const name = recipientEntity?.entity_name?.trim();
  if (name) {
    const nameRegex = new RegExp(`\\b${name}\\b`, "gi");
    const atTagRegex = new RegExp(`@${name}`, "gi");

    const fields = [
      "summary",
      "thoughts",
      "originalIssueSummary",
      "recipientSummary",
      "summaryB",
      "thoughtsB",
    ];

    fields.forEach(fieldName => {
      if (typeof eval(fieldName) === "string") {
        eval(`${fieldName} = ${fieldName}
          .replace(nameRegex, 'you')
          .replace(atTagRegex, 'you')
          .replace(/\bshe\b|\bher\b|\bhe\b|\bhim\b/gi, 'you')`);
      }
    });
  }

  // 🧭 Perspective reminder for logs
  console.log(`🧭 Perspective sanitized for ${generatingFor} → ${listenerRole}`);
} catch (err) {
  console.warn("⚠️ Perspective sanitization skipped:", err.message);
}

    
    const systemPrompt = `
You generate short, natural, emotionally aware messages that one person would directly say to another in a real conversation.

🎯 GOAL:
Write as if this is a human-to-human text between two people who know each other (User A ↔ User B).  
Never sound like an assistant, coach, or mediator.

⚡ STYLE:
- Real, direct speech — not summaries or advice.  
- Tone depends on relationship (${contactCategory || 'General'}).  
  - Friends → casual, warm  
  - Family → caring, respectful  
  - Work → polite, professional  
- Use contractions (“I’m”, “you’re”, “don’t”).  
- Be empathetic, polite, and human.

💬 PRONOUN RULES:
- “I/me/my” = speaker’s voice.  
- “you/your” = recipient (never use their name).  
- “she/he/they” = # tagged third parties.  
- Always use pronouns from Entity Registry.

🧠 CONTEXT:
- Base on current message: "${currentMessage}"
- Use ${conversationTimingContext} timing context (recent argument, same day, long gap, or normal).  
- Reflect ${isRecipientUserA ? 'User A' : 'User B'}’s role naturally.  
- Include emotion only if relevant to the message.

✅ YOUR JOB:
Generate ${isVeryFirstMessage ? '5' : '3'} possible replies that:
1. Sound human and meaningful (no cropping).
2. Fit the tone of this relationship.
3. Stay polite, friendly, and emotionally intelligent.
4. Express understanding or perspective clearly without sounding robotic.
5. Use correct pronouns, never real names.

Keep everything within this conversation — no external scheduling or follow-ups.
${entityContext}
${tagContext}
`;


    const userPrompt = `
Generate exactly ${isVeryFirstMessage ? '5' : '3'} direct message options this person would ACTUALLY send.

🎯 INTENTION:
Keep it natural, human, and emotionally aware. Write like two real people texting each other — friendly, polite, and empathetic.  
No robotic or counselor tone.

⚡ RULES:
- ${isVeryFirstMessage ? 'First message → 5 distinct greetings under 15 words.' : 'Otherwise → 3 response options under 15 words.'}
- Each must be complete and meaningful — never cropped mid-thought.
- Use natural contractions ("I’m", "you’re", "don’t").
- Sound warm, kind, and conversational.
- Avoid AI phrases ("I understand your perspective", "Let’s find common ground").
- Respectful even in conflict. Focus on feelings, not blame.
- No scheduling outside the chat (“talk later”, “call me”, etc.).
- Use correct pronouns from context (I/you/we, # for third person).

📏 WORD LIMIT:
Keep each option within ~15 words.  
If meaning needs 1–2 extra words, finish naturally instead of cutting off.

💬 GOOD EXAMPLES:
- "Hey, can we talk about what happened yesterday?"  
- "I felt hurt when you didn’t reply."  
- "I miss how we used to talk."  

Tone must fit ${contactCategory} relationship (friend, family, coworker, general).

Return JSON only:
{
  "options": [${isVeryFirstMessage ? '"Option 1", "Option 2", "Option 3", "Option 4", "Option 5"' : '"Option 1", "Option 2", "Option 3"'}]
}
`;


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
    if (options.length < expectedCount) {
      throw new Error(`Insufficient options generated: expected ${expectedCount}, got ${options.length}`);
    }

    // ✅ ENFORCE 15-WORD LIMIT: Validate and truncate if necessary
    const countWords = (text: string): number => {
      // Don't count single emojis
      if (/^[\p{Emoji}]$/u.test(text.trim())) return 0;
      return text.trim().split(/\s+/).length;
    };

    const truncateToWordLimit = (text: string, maxWords: number): string => {
      if (countWords(text) <= maxWords) return text;
      const words = text.trim().split(/\s+/);
      return words.slice(0, maxWords).join(' ') + '...';
    };

    options = options.map(opt => {
      const wordCount = countWords(opt);
      if (wordCount > 15) {
        console.warn(`⚠️ Option exceeds 15 words (${wordCount}): "${opt}"`);
        return truncateToWordLimit(opt, 15);
      }
      return opt;
    });

    console.log('✅ Word count validation passed, all options under 15 words');

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
      const recentTexts = recentOptions.flatMap(r => r.options).map(o => o.toLowerCase());

      const calculateSimilarity = (str1: string, str2: string) => {
        const words1 = str1.toLowerCase().split(/\s+/);
        const words2 = str2.toLowerCase().split(/\s+/);
        const commonWords = words1.filter(w => words2.includes(w)).length;
        const totalWords = Math.max(words1.length, words2.length);
        return totalWords > 0 ? commonWords / totalWords : 0;
      };

      options = options.filter(opt => {
        const isTooSimilar = recentTexts.some(recent =>
          calculateSimilarity(opt, recent) > 0.7
        );
        return !isTooSimilar;
      });

      console.log(`🔍 After deduplication: ${options.length} unique options`);
    }

    // Ensure we still have minimum required options
    if (options.length < 3) {
      console.warn("⚠️ Not enough unique options after deduplication, using originals");
      options = optionsData.options || [];
    }

    // Capitalize first letter of each option
    const capitalizeFirstLetter = (str: string): string => {
      if (!str || str.length === 0) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    const finalOptions = options.slice(0, expectedCount).map(opt => capitalizeFirstLetter(opt));
    console.log("✅ Generated options:", finalOptions);
    console.log("🔐 Inserting with service role key for chat:", chatId, "recipient:", recipientId);


    const normalizedOptions = finalOptions; // Using finalOptions directly


    // Use Supabase client with service role for insert
    // ✅ CRITICAL FIX: Use recipientId (the person who should receive options), not currentUserId (sender)
    const { data: insertData, error: insertError } = await supabase
      .from('message_options')
      .insert({
        chat_id: chatId,
        recipient_id: recipientId, // ✅ Fixed: recipientId is who should receive the options
        options: normalizedOptions,
        context_data: {
          conversationStage: conversationPhase,
          turnCount: conversationHistory.length,
          hintUsed: !!hintFromB,
          hintReasoning: optionsData.reasoning || null,
          isVeryFirstMessage,
          conversationTimingContext
        }
      })
      .select();

    if (insertError) {
      console.error("Failed to insert options:", insertError);
      throw insertError;
    }

    console.log("✅ Successfully inserted options:", insertData);

    return new Response(JSON.stringify({
      success: true,
      options: finalOptions,
      chatId,
      recipientId
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in generate-contextual-options:", error);
    return new Response(JSON.stringify({
      error: error.message || "Failed to generate options",
      details: error.toString()
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});