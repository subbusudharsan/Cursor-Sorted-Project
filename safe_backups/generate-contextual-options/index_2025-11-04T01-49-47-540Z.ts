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

    // Always generate 3 options (changed from 5 for first message)
    // User requested both users should always see 3 options
    const isVeryFirstMessage = false; // Force 3 options always

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
    
    // Extract thoughts for both users
    const thoughtsA = originalIssue?.thoughts || thoughts || chatData?.context_data?.thoughts_a || chatData?.context_data?.thoughts || '';

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

// 🧠 Enhanced Pronoun-Tone Mapping with @ and # tag handling
const pronounToneContext = generatingFor === 'User A'
  ? `
🗣️ PRONOUN & PERSPECTIVE RULES (User A → User B):
- User A (@self) → use "I / me / my / mine / myself"
- User B (@contact) → use "you / your / yours / yourself"
- ❗ NEVER mention User B's real name - always use "you/your"
- Third-party entities (#tagged) → use their names from entity_registry AND pronouns (he/him/his/himself, she/her/hers/herself, or they/them/theirs/themselves)
- Keep ALL @ and # tags intact in generated options
- When referring to #tagged entities, use: "#Name" or their pronouns based on entity_registry
`
  : `
🗣️ PRONOUN & PERSPECTIVE RULES (User B → User A):
- User B (@self) → use "I / me / my / mine / myself"
- User A (@contact) → use "you / your / yours / yourself"
- ❗ NEVER mention User A's real name - always use "you/your"
- Third-party entities (#tagged) → use their names from entity_registry AND pronouns (he/him/his/himself, she/her/hers/herself, or they/them/theirs/themselves)
- Keep ALL @ and # tags intact in generated options
- When referring to #tagged entities, use: "#Name" or their pronouns based on entity_registry
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

    // Check for natural closure signals in recent messages AND thoughts
    const recentMessages = conversationHistory.slice(-4).map(m => m.content.toLowerCase()).join(' ');
    const thoughtsText = (thoughts || thoughtsB || '').toLowerCase();
    const allClosureText = `${recentMessages} ${thoughtsText}`;
    
    const hasGratitude = /thank|grateful|appreciate/.test(allClosureText);
    const hasForgiveness = /sorry|forgive|understand|my bad/.test(allClosureText);
    const hasUnderstanding = /makes sense|get it|see your point|clear now|resolved|settled/.test(allClosureText);
    const hasRelief = /glad|good talk|feel better|relieved|peace/.test(allClosureText);
    
    // Closure detected if multiple positive signals OR strong closure language in thoughts
    const naturalClosureDetected = 
      (hasGratitude && hasForgiveness) || 
      (hasGratitude && hasUnderstanding) || 
      (hasForgiveness && hasUnderstanding) ||
      (hasRelief && (hasGratitude || hasForgiveness)) ||
      /closure|resolved|settled|we're good|all good|no hard feelings/i.test(thoughtsText);

    const formattedHistory = conversationHistory.map((msg) => `${msg.sender_id === recipientId ? 'You' : 'Contact'}: ${msg.content}`).join('\n');

    
    // ✅ DON'T sanitize - keep all @ and # tags intact for proper pronoun handling
    // The prompts will handle perspective correctly based on who is speaking
    console.log(`🧭 Generating options for ${isRecipientUserA ? 'User A' : 'User B'} → ${isRecipientUserA ? 'User B' : 'User A'}`);

    
    const systemPrompt = `You are writing what one person would DIRECTLY SAY to another person. You are NOT an AI mediator or counselor - you are generating the exact words User A or User B would speak TO each other in a real conversation.

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

CRITICAL PRONOUN RULES - ABSOLUTELY NO CONFUSION:
${generatingFor === 'User A' ? `
🎯 YOU ARE GENERATING OPTIONS FOR USER A TO SAY TO USER B:
- SPEAKER: User A → ALWAYS use "I / me / my / mine / myself" when User A talks about themselves
  Example: "I felt hurt", "I didn't mean to", "I'm sorry"
- RECEIVER: User B → ALWAYS use "you / your / yours / yourself" when User A addresses User B
  Example: "you said that", "you didn't invite me", "your actions hurt me"
- NEVER use User B's name or "@UserB" when addressing them - ALWAYS use "you/your"
- Third parties (#tagged) → Use their names with # prefix (e.g., "#Sarah") OR their pronouns from entity_registry
  Example: "#Sarah didn't invite me" or "she didn't invite me" (if context is clear)
` : `
🎯 YOU ARE GENERATING OPTIONS FOR USER B TO SAY TO USER A:
- SPEAKER: User B → ALWAYS use "I / me / my / mine / myself" when User B talks about themselves
  Example: "I felt hurt", "I didn't mean to", "I'm sorry"
- RECEIVER: User A → ALWAYS use "you / your / yours / yourself" when User B addresses User A
  Example: "you said that", "you didn't ask me", "your words hurt me"
- NEVER use User A's name or "@UserA" when addressing them - ALWAYS use "you/your"
- Third parties (#tagged) → Use their names with # prefix (e.g., "#Sarah") OR their pronouns from entity_registry
  Example: "#Sarah made me feel excluded" or "she made me feel excluded" (if context is clear)
`}
- Use "we/us" when discussing the relationship or shared experiences ("we need to talk", "this is between us")
- NEVER use AI language like "I understand your perspective" - say "I get what you're saying" instead
- Remember: This is ${generatingFor} speaking DIRECTLY TO ${generatingFor === 'User A' ? 'User B' : 'User A'}, NOT an AI helping them
- CRITICAL: The speaker always uses "I" for themselves and "you" for the person they're talking to

🏷️ TAG SYSTEM RULES (CRITICAL - KEEP TAGS INTACT):
- @ prefix = REGISTERED contact IN the conversation (User A or User B)
  - When User A talks TO User B: User B is "@contact" → use "you/your"
  - When User B talks TO User A: User A is "@contact" → use "you/your"
  - NEVER use the recipient's name - always use "you/your"
- # prefix = UNREGISTERED person/group/event (being DISCUSSED, not in conversation)
  - MUST keep # prefix in generated options: "#Sarah", "#Team", "#Party"
  - Use pronouns from entity_registry: he/him/his, she/her/hers, they/them/theirs
  - Example: "#Sarah didn't invite me" or "she didn't invite me" (if context is clear)
- ALWAYS preserve @ and # tags in generated options - they are essential for entity linking

${entityContext}
${actionContext}
${structuredContext}
${tagContext}

NOTE:
The recipient (${userB?.entity_name || 'User B'}) is the person this message is being sent TO.
Do NOT say their name in the generated text — always use "you" or "your" when referring to them.
If the recipient’s name (${userB?.entity_name || 'User B'}) appears in any sentence, replace it with "you". Never use "she/he/her/him" when referring to the recipient.



⚠️ PRONOUN USAGE RULES:
- Use entity names when possible for clarity
- When using pronouns, match them exactly to the Entity Registry
- "you" = the person receiving this message
- Never use pronouns without clear referents in the Entity Registry
- If multiple entities share pronouns, use names instead

Your task is to generate exactly 3 options of what the person would ACTUALLY say:
1. COMPLETE SENTENCES with natural punctuation
2. DIRECTLY responding to what was just said
3. Sound like a real human talking to someone they know
4. Match the relationship type (casual with friends, respectful with family, professional with coworkers)
5. Use contractions, natural speech patterns, and appropriate informality
6. Choose pronouns based on WHO/WHAT is being discussed (you vs she/he/they)
${shouldUseHint ? `7. SUBTLY reflect the person's private feelings without exposing them` : ''}

🌱 FIRST MESSAGE - CONTEXT-AWARE OPENING:

Timing Context: ${conversationTimingContext}

${conversationTimingContext === 'recent_argument' ? `
⚡ RECENT ARGUMENT - Skip pleasantries, go straight to resolution:
Generate 3 DIFFERENT approaches (under 15 words each):
1. Direct and urgent: "we need to talk about what just happened"
2. Calm and conciliatory: "can we talk about earlier?"
3. Honest and open: "I want to clear this up with you"
4. Questioning: "hey can we figure out what happened?"
5. Acknowledging difficulty: "that didn't go well, can we talk?"
DO NOT use casual greetings - they want resolution NOW.
` : conversationTimingContext === 'long_gap' ? `
🕰 LONG GAP - Warm reconnection first, then gentle purpose:
Generate 5 DIFFERENT reconnection styles (under 15 words each):
1. Warm and nostalgic: "hey! it's been a while, how have you been?"
2. Caring and thoughtful: "hi! been thinking about you, how are things?"
3. Friendly and casual: "hey stranger! how's life treating you?"
4. Gentle with purpose: "hey, miss chatting with you - can we talk?"
5. Warm check-in: "hi! hope you're doing well, wanted to reach out"
Balance warmth with genuine interest - reconnection comes first.
` : conversationTimingContext === 'same_day' ? `
⏱ SAME DAY - Friendly but purposeful:
Generate 5 DIFFERENT check-in approaches (under 15 words each):
1. Casual and direct: "hey, how's your day? got a minute?"
2. Warm with purpose: "hi! hope you're good, wanted to bring something up"
3. Simple check-in: "hey, how are you? something on my mind"
4. Friendly opening: "hey there, how's everything? need to chat about something"
5. Straightforward: "hi, can we talk about something that's been bothering me?"
` : `
💬 NORMAL TIMING - Gentle opening with wellness check:
Generate 5 DIFFERENT greeting styles (under 15 words each):
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

CRITICAL: Generate 3 TRULY DISTINCT options that vary in:
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

CRITICAL: MAINTAIN PERSPECTIVE
${isRecipientUserA ? `
🔵 GENERATING FOR USER A (Original Issue Owner):
- User A initiated with their concern: "${originalIssueSummary || summary}"
- User A's options should express THEIR feelings about THEIR issue
- User A is trying to communicate their perspective and feelings
- Keep User A's voice authentic to their original concern
- User A is speaking TO User B → use "you/your" for User B
- Keep @ and # tags intact in options
` : ''}
${isRecipientUserB ? `
🟢 GENERATING FOR USER B (Responder - RESPONDING TO USER A):
- User B is RESPONDING to User A's latest message: "${currentMessage}"
- User B's options should respond directly to what User A just said, not repeat User A's original issue
- User B has their own feelings and perspective to share
${shouldUseHint ? `- User B's hint: "${hintFromB}" (use subtly, don't expose directly)` : ''}
- Help User B respond with empathy while being authentic
- User B is speaking TO User A → use "you/your" for User A
- Keep @ and # tags intact in options
- CRITICAL: These are RESPONSE options, not continuation of User A's issue
` : ''}
- Don't let issues switch or merge - keep each person's perspective clear

COMPLETE CONTEXT (ALL INPUTS - USE FOR PRONOUN HANDLING):
- Contact category: ${contactCategory || 'General'}
- Original issue (User A) with @# tags: ${originalIssueSummary || summary || 'Not specified'}
- User A's thoughts: ${thoughtsA || thoughts || 'No thoughts provided'}
- User B's thoughts: ${thoughtsB || 'No thoughts provided'}

Recent conversation (${conversationHistory.length} turns):
${formattedHistory || 'This is the start of the conversation'}

Latest message to respond to: "${currentMessage}"

Recipient's context (${generatingFor}):
- Summary (with @# tags preserved): ${summary || recipientSummary || 'No summary provided'}
  ⚠️ IMPORTANT: This summary contains @ and # tags that indicate who is who. Use these tags to determine correct pronouns.
- Thoughts: ${thoughts || thoughtsB || 'No thoughts provided'}
  ⚠️ IMPORTANT: Check thoughts for closure signals (gratitude, forgiveness, understanding, relief, closure language)

Entity Registry (for pronoun mapping - use this for all turns):
${entities && entities.length > 0 ? entities.map(e => {
  const tag = e.is_registered ? `@${e.entity_name}` : `#${e.entity_name}`;
  const role = e.role_in_conversation || e.entity_type;
  const pronouns = e.preferred_pronouns || 'they/them';
  return `- ${tag}: ${pronouns} (${role}) - Use these pronouns when referring to ${e.entity_name}`;
}).join('\n') : 'No entities registered'}

${taggedEntities && taggedEntities.length > 0 ? `
Additional Tagged Entities from Summary:
${taggedEntities.map((t: any) => {
  const tag = t.tag || (t.type === 'registered' ? `@${t.name || t.entity_name}` : `#${t.name || t.entity_name}`);
  const pronouns = t.pronouns || t.preferred_pronouns || 'they/them';
  return `- ${tag}: ${pronouns}`;
}).slice(0, 10).join('\n')}
` : ''}

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

USER B SPEAKING TO USER A - PRONOUN GUIDANCE:
When generating options for User B, they are speaking TO User A directly:
- If hint is about User A's actions, User B says "you" TO User A (e.g., "you left without telling me", "you didn't ask how I felt")
- If hint is about third parties, User B tells User A ABOUT them using "she/he/they" (e.g., "she made me feel excluded", "they put me in a tough spot")
- If hint is about User B's feelings, User B shares with "I/me" (e.g., "I felt really hurt when that happened", "I needed space")
- User B talks about "us/we" when discussing the relationship (e.g., "we need to work this out", "I don't want this between us")

CRITICAL: User B is having a real conversation WITH User A, not talking ABOUT User A to someone else. The hint context persists throughout the ENTIRE conversation.
` : ''}

${naturalClosureDetected ? `
🙂 CLOSURE DETECTED - NATURAL CONVERSATION ENDING:
Conversation shows resolution signals. Apply GRADUAL closure approach:

📊 Current closure readiness: ${(hasGratitude && hasForgiveness) || (hasGratitude && hasUnderstanding) ? 'HIGH (0.8+)' : 'MODERATE (0.6-0.8)'}
📈 Conversation progress: Turn ${conversationHistory.length}
💭 Thoughts input indicates: ${thoughtsText ? 'Closure signals detected in thoughts' : 'No thoughts provided'}

${(hasGratitude && hasForgiveness) || (hasGratitude && hasUnderstanding) || /closure|resolved|settled/i.test(thoughtsText) ? `
✅ HIGH CLOSURE - Mix text with smiley options:
- 1 option: Brief closure text under 15 words ("glad we talked", "thanks for understanding", "this helps")
- 2 options: Single warm emoji ONLY (🙂, 🤝, ❤️, 👍, 😊)

CRITICAL: When both users send smiley-only messages (no text, just emoji), the chat is automatically closed.
Generate options that allow natural closure without restarting the issue.
Each option must be either complete text under 15 words OR a single emoji.
` : `
⏳ MODERATE CLOSURE - Mix text with smiley options:
- 1 option: Brief text acknowledging progress under 15 words ("glad we talked", "thanks for understanding", "this helps")
- 2 options: Mix of brief text + emoji (e.g., "thanks! 🙂" or "glad we talked 🤝") OR single emoji (🙂, 🤝, ❤️, 👍)

CRITICAL: Build on what's been discussed. Don't restart the issue. Acknowledge the progress toward resolution.
Generate at least ONE smiley-only option (single emoji) to signal closure readiness.
When both users send smiley-only messages, the chat closes automatically.
`}
` : ''}`;

    const userPrompt = `Generate exactly 3 options that sound like what this person would ACTUALLY SAY in this conversation.

🌱 WARMUP PHASE - CASUAL GREETINGS ONLY (if first message):
This is the FIRST message. Generate 3 different casual greetings appropriate for a ${contactCategory} relationship and ${conversationTimingContext} timing.

DO NOT mention any issues or problems yet. Just natural, friendly greetings like:
- "hey! how's it going?"
- "hey, how are you?"
- "what's up? how you been?"
- "hi there, long time no talk"
- "hey, got a sec?"

Match the formality to the relationship type and timing context. Make each option feel distinct.
` : ''}

${!isVeryFirstMessage && conversationHistory.length <= 2 ? `
🔄 TRANSITION PHASE - BRINGING UP THE ISSUE:
After the warmup, User A should now naturally introduce their concern. Generate options that:
- USE SPECIFIC WORDS from the issue context: ${originalIssueSummary || summary}
- Reference what actually happened in their own words
- Examples: If issue is "she ignored me at party" → "can we talk about the party? I felt ignored"
- Examples: If issue is "you didn't respond to my texts" → "hey, I noticed you didn't reply to my messages"
- Sound like how someone would naturally bring up something that bothered them
- Stay direct, human, and conversational - not formal or therapeutic
` : ''}

Each option must:
1. Be EXACTLY what the person would say (direct quote, not description)
2. ${!isVeryFirstMessage ? `Respond directly to: "${currentMessage}" - USE WORDS/PHRASES from their message to show you heard them` : 'Be a natural opening greeting'}
3. Sound like natural speech for a ${contactCategory} relationship
4. Use contractions and casual language where appropriate ("you're" not "you are", "I'm" not "I am")
5. Match the emotional tone of the conversation
6. ${generatingFor === 'User A' ? 'Use "I/me/my" for User A, "you/your" for User B' : 'Use "I/me/my" for User B, "you/your" for User A'}
7. For third parties (#tagged): Keep # tags visible (e.g., "#Sarah") and use pronouns from entity_registry
8. INCORPORATE specific details from the conversation context to make responses feel personal and relatable
9. Keep ALL @ and # tags intact in the generated text
${shouldUseHint ? `10. Subtly reflect their private feelings without exposing the hint directly
11. Maintain consistency with hint perspective across all turns` : ''}
${isRecipientUserB ? `12. CRITICAL: These are RESPONSE options for User B to reply to User A's message - NOT continuation of User A's original issue` : ''}

CRITICAL - MAKE IT RELATABLE:
- If they mentioned a specific event ("the party", "last week"), reference it
- If they used emotional words ("hurt", "upset", "confused"), acknowledge those feelings
- If they mentioned specific actions ("you ignored me", "you left early"), address those directly
- Mirror their language naturally to show you're truly listening and engaging

${naturalClosureDetected ? `
🙂 CLOSURE READY: Consider including ONE emoji (🙂, 🤝, ❤️, 👍) as an option if it feels natural.
REMEMBER: Build on conversation progress, don't restart the issue.
` : ''}

RELATIONSHIP-SPECIFIC TONE:
- Friend: casual, use "dude", "bro", "man" if natural, informal language
- Family: warm but respectful, appropriate familiarity
- Coworker: professional but friendly, no overly casual slang
- General: balanced, friendly but not too informal

STRICT WORD LIMIT RULES (CRITICAL - NO EXCEPTIONS):
- - MAXIMUM ${wordLimit} WORDS per option (hard limit, no exceptions except single emojis)
- Each option MUST be a COMPLETE, MEANINGFUL sentence that makes sense on its own
- NEVER generate incomplete sentences or truncate mid-thought
- If you cannot express a complete thought in 15 words, use fewer words and make it simpler
- Target 8-12 words for most options while keeping COMPLETE meaning
- Use natural contractions ("you're" not "you are", "didn't" not "did not") to save words
- Remove filler words ("like", "just", "really") but keep emotional words if they add meaning
- Example: "I felt hurt when you didn't invite me" (8 words) ✅
- Example: "yeah I get what you're saying, that makes sense" (8 words) ✅
- Example: "I'm sorry, I didn't realize it bothered you that much" (9 words) ✅
- BAD: "I appreciate you checking in. To be honest, I've been feeling a bit bothered about..." (18 words - TOO LONG) ❌
- GOOD: "I appreciate you checking in. I've been feeling bothered" (8 words) ✅

OTHER RULES:
- NO AI/counselor language ("I acknowledge", "Let's work together", "I understand your perspective")
- Sound like REAL human speech with natural warmth
- NO scheduling outside the app
- Use lowercase for casual relationships if natural
- Be RESPECTFUL, KIND, and POLITE even when addressing difficult topics
- Focus on RESOLVING and UNDERSTANDING, not blaming or attacking
- Generate 3 DISTINCT options
- Each option must have DIFFERENT tone, approach, or directness level
- Keep ALL @ and # tags intact - never remove or replace them

🎯 EXAMPLES OF GOOD BREVITY (meaningful and complete, all under 15 words):
- "hey, can we talk about what happened yesterday?" (8 words)
- "I felt hurt when you didn't invite me" (8 words)
- "#Sarah said something that really bothered me" (7 words - # tag preserved)
- "want to clear this up between us?" (7 words)
- "I need to talk about something that's been bothering me" (10 words)
- "yeah I get what you're saying, that makes sense" (8 words)
- "I'm sorry, I didn't realize it bothered you that much" (9 words)

TONE REQUIREMENTS:
- Show empathy and care even when being direct
- Acknowledge feelings without dismissing them
- Speak from a place of wanting to fix things, not win an argument
- Use gentle language: "I felt" instead of "you made me feel", "can we talk about" instead of "you need to explain"

Format as JSON:
{
  "options": ["Exact words they'd say 1", "Exact words they'd say 2", "Exact words they'd say 3"]${shouldUseHint ? `,
  "reasoning": "How hint shaped these responses"` : ''}
}`;

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
    const expectedCount = 3; // Always generate 3 options for both users
    
    // Accept at least 2 options (minimum viable)
    if (options.length < 2) {
      throw new Error(`Insufficient options generated: expected at least 2, got ${options.length}`);
    }
    
    // Log if we got fewer than expected but proceed
    if (options.length < expectedCount) {
      console.warn(`⚠️ Got ${options.length} options (expected ${expectedCount}), proceeding with available options`);
    }

    // ✅ ENFORCE 15-WORD LIMIT: Validate and reject if exceeds (don't truncate)
    const countWords = (text: string): number => {
      // Don't count single emojis
      if (/^[\p{Emoji}]$/u.test(text.trim())) return 0;
      return text.trim().split(/\s+/).length;
    };

    // Filter out options that exceed 15 words - don't truncate, just reject and regenerate if needed
    const validOptions = options.filter(opt => {
      const wordCount = countWords(opt);
      if (wordCount > wordLimit) {
  console.warn(`⚠️ Option exceeds ${wordLimit} words`);
  return false;
}

      return true;
    });

    // If we lost too many options, use what we have (minimum 2 required)
    if (validOptions.length < 2) {
      console.warn(`⚠️ Only ${validOptions.length} valid options after word limit check. Regenerating with stricter enforcement.`);
      throw new Error(`Too many options exceeded 15-word limit. Only ${validOptions.length} valid options. Regenerating with stricter word limit enforcement.`);
    }

    // Use available valid options (minimum 2, up to expected count)
    options = validOptions.slice(0, Math.min(expectedCount, validOptions.length));
    console.log(`✅ Word count validation passed: ${options.length} options under 15 words (expected ${expectedCount})`);

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

    // Ensure we still have minimum required options (at least 2)
    if (options.length < 2) {
      console.warn("⚠️ Not enough unique options after deduplication, using originals");
      options = optionsData.options || [];
      // Filter again for word limit
      options = options.filter(opt => countWords(opt) <= 15);
      if (options.length < 2) {
        throw new Error(`Insufficient valid options after deduplication and word limit check: ${options.length}`);
      }
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails = error instanceof Error ? error.toString() : JSON.stringify(error);
    return new Response(JSON.stringify({
      error: errorMessage || "Failed to generate options",
      details: errorDetails
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
