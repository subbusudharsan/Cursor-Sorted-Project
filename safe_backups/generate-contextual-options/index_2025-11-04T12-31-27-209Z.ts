import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const generatingFor = isRecipientUserA ? 'User A' : 'User B';

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

    // Build context from structured data
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
      registeredContacts.forEach((contact) => {
        tagContext += `- @${contact.entity_name || contact.name}: ${contact.preferred_pronouns || 'you/your'}\n`;
      });
    }
    if (unregisteredEntities.length > 0) {
      tagContext += `\n\nUNREGISTERED ENTITIES (use # prefix, being DISCUSSED):\n`;
      unregisteredEntities.forEach((entity) => {
        tagContext += `- #${entity.entity_name || entity.name}: ${entity.preferred_pronouns || 'they/them'}\n`;
      });
    }

    // Build entity context for pronoun mapping
    let entityContext = '';
    if (entities && entities.length > 0) {
      entityContext += `\n\nENTITY REGISTRY (for pronoun mapping):\n`;
      entities.forEach((entity) => {
        const tag = entity.is_registered ? `@${entity.entity_name}` : `#${entity.entity_name}`;
        const role = entity.role_in_conversation || entity.entity_type;
        const pronouns = entity.preferred_pronouns || 'they/them';
        entityContext += `- ${tag}: ${pronouns} (${role})\n`;
      });
    }

    console.log('🔍 Generating options with context:', {
      chatId,
      recipientId,
      isRecipientUserA,
      isRecipientUserB,
      isVeryFirstMessage,
      shouldUseHint,
      conversationHistoryLength: conversationHistory.length,
    });

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

CRITICAL PRONOUN RULES - USER A AND USER B TALK TO EACH OTHER:
- Use "you" when the person is talking TO the recipient about THEIR actions ("you said that", "you ignored me", "you made me feel")
- Use "she/he/they/them" or the person's name when talking TO the recipient ABOUT third parties tagged with # ("#Sarah didn't invite me", "she treated me badly", "they excluded us")
- Use "I/me/my" when sharing your own feelings and experiences ("I felt hurt", "I didn't mean to", "I'm sorry")
- Use "we/us" when discussing the relationship or shared experiences ("we need to talk", "this is between us")
- NEVER use AI language like "I understand your perspective" - say "I get what you're saying" instead
- Remember: This is Person A speaking TO Person B (or vice versa), NOT an AI helping them

🏷️ TAG SYSTEM RULES:
- @ prefix = REGISTERED contact IN the app (conversation participant)
  Example: If generating options for User A to send to @John, use "you" because @John is the recipient
- # prefix = UNREGISTERED person/group (subject being DISCUSSED)
  Example: If User A is talking to @John ABOUT #Sarah, use "she/her" or "Sarah" for #Sarah
- When an entity is tagged with #, they are NOT in the conversation - they are being discussed
- When an entity is tagged with @, they ARE in the conversation - address them with "you"

${entityContext}

${pronounToneContext}

Your task is to generate ${isVeryFirstMessage ? '5' : '3'} options of what the person would ACTUALLY say:
1. COMPLETE SENTENCES with natural punctuation
2. DIRECTLY responding to what was just said
3. Natural human speech patterns (contractions, casual language when appropriate)
4. Emotionally authentic (not robotic or therapeutic)
5. Contextually relevant (uses details from the conversation)
6. Appropriate for the relationship type (family/friend/coworker)
${shouldUseHint ? `7. SUBTLY reflect the person's private feelings without exposing them` : ''}

${isVeryFirstMessage ? `
🌱 VERY FIRST MESSAGE - CONTEXT-AWARE OPENING:

Timing Context: ${conversationTimingContext}

${conversationTimingContext === 'recent_argument' ? `
⚡ RECENT ARGUMENT - Skip pleasantries, go straight to resolution:
Generate 5 DIFFERENT approaches (under ${wordLimit} words each):
1. Direct and urgent: "we need to talk about what just happened"
2. Calm and conciliatory: "can we talk about earlier?"
3. Acknowledging impact: "that didn't go well, can we figure this out?"
4. Questioning: "hey can we figure out what happened?"
5. Acknowledging difficulty: "that didn't go well, can we talk?"
DO NOT use casual greetings - they want resolution NOW.
` : conversationTimingContext === 'long_gap' ? `
🕰 LONG GAP - Warm reconnection first, then gentle purpose:
Generate 5 DIFFERENT reconnection styles (under ${wordLimit} words each):
1. Warm and nostalgic: "hey! it's been a while, how have you been?"
2. Caring and thoughtful: "hi! been thinking about you, how are things?"
3. Friendly and casual: "hey stranger! how's life treating you?"
4. Gentle with purpose: "hey, miss chatting with you - can we talk?"
5. Warm check-in: "hi! hope you're doing well, wanted to reach out"
Balance warmth with genuine interest - reconnection comes first.
` : conversationTimingContext === 'same_day' ? `
⏱ SAME DAY - Friendly but purposeful:
Generate 5 DIFFERENT check-in approaches (under ${wordLimit} words each):
1. Casual and direct: "hey, how's your day? got a minute?"
2. Warm with purpose: "hi! hope you're good, wanted to bring something up"
3. Simple check-in: "hey, how are you? something on my mind"
4. Friendly opening: "hey there, how's everything? need to chat about something"
5. Straightforward: "hi, can we talk about something that's been bothering me?"
` : `
💬 NORMAL TIMING - Gentle opening with wellness check:
Generate 5 DIFFERENT greeting styles (under ${wordLimit} words each):
1. Simple and warm: "hey, how are you?"
2. Caring tone: "hi, hope you're doing well - can we chat?"
3. Friendly check-in: "hey there, how's everything going with you?"
4. Direct but warm: "hi, how have you been? wanted to talk"
5. Gentle approach: "hey, got a sec? something I'd like to discuss"
`}

CRITICAL: Generate 5 TRULY DISTINCT options that vary in:
- Directness (subtle vs straightforward)
- Formality (casual vs respectful)
- Warmth (friendly vs neutral)
- Purpose clarity (hinting vs explicit)

Match the formality to the relationship type and timing context. Make each option feel distinct.
` : ''}
${isRecipientUserA ? `
🟢 GENERATING FOR USER A (Initiator):
- User A is trying to communicate their perspective and feelings
- Keep User A's voice authentic to their original concern
` : ''}
${isRecipientUserB ? `
🟢 GENERATING FOR USER B (Responder):
- User B is responding to User A's concern: "${originalIssueSummary || summary}"
- User B's options should respond thoughtfully to what User A shared
- User B has their own feelings and perspective to share
${shouldUseHint ? `- User B's hint: "${hintFromB}" (use subtly, don't expose directly)` : ''}
- Help User B respond with empathy while being authentic
` : ''}
- Don't let issues switch or merge - keep each person's perspective clear

Context:
- Contact category: ${contactCategory || 'General'}
- Original issue (User A): ${originalIssueSummary || summary || 'Not specified'}

Recent conversation:
${formattedHistory || 'This is the start of the conversation'}

Latest message to respond to: "${currentMessage}"

Recipient's context:
- Summary: ${summary || recipientSummary || 'No summary provided'}
- Thoughts: ${thoughts || thoughtsB || 'No thoughts provided'}

${shouldUseHint ? `
💡 USER B'S PRIVATE HINT (USE SUBTLY - DO NOT EXPOSE DIRECTLY):
"${hintFromB}"

CRITICAL HINT INTEGRATION RULES:
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
🙂 GRADUAL CLOSURE PROGRESSION:
Conversation shows resolution signals. Apply GRADUAL closure approach:

📊 Current closure readiness: ${(hasGratitude && hasForgiveness) || (hasGratitude && hasUnderstanding) ? 'HIGH (0.8+)' : 'MODERATE (0.6-0.8)'}
📈 Conversation progress: Turn ${conversationHistory.length} - We've discussed: "${formattedHistory.slice(-200)}"

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
- "hey, how are you?"
- "hi, hope you're doing well"
- "hey there, how's everything?"
- "hi, how have you been?"
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
2. Respond to: "${currentMessage}" - USE WORDS/PHRASES from their message to show you heard them
3. Sound like natural speech for a ${contactCategory} relationship
4. Use contractions and casual language where appropriate ("you're" not "you are", "I'm" not "I am")
5. Match the emotional tone of the conversation
6. Use context-appropriate pronouns (you/she/he/they based on subject)
7. INCORPORATE specific details from the conversation context to make responses feel personal and relatable
${shouldUseHint ? `8. Subtly reflect their private feelings without exposing the hint directly
9. Maintain consistency with hint perspective across all turns` : ''}

CRITICAL - MAKE IT RELATABLE:
- Use actual words from their message when possible
- Reference specific events or feelings mentioned
- Show you're listening, not just responding generically
- Make it feel like a real conversation, not a therapy session

TONE GUIDELINES:
- Friend: casual, use "dude", "bro", "man" if natural, informal language
- Family: warm but respectful, appropriate familiarity
- Coworker: professional but friendly, no overly casual slang
- General: balanced, friendly but not too informal

STRICT RULES:
- MAXIMUM ${wordLimit} WORDS per option (hard limit, no exceptions except single emojis)
- Each option MUST be a COMPLETE, MEANINGFUL sentence that makes sense on its own
- NEVER generate incomplete sentences or truncate mid-thought
- Target 8-12 words for most options while keeping complete meaning
- Use natural contractions ("you're" not "you are", "didn't" not "did not")
- Remove filler words ("like", "just", "really") but keep emotional words if they add meaning
- NO AI/counselor language ("I acknowledge", "Let's work together", "I understand your perspective")
- Sound like REAL human speech with natural warmth
- NO scheduling outside the app
- Be RESPECTFUL, KIND, and POLITE even when addressing difficult topics
- Focus on RESOLVING and UNDERSTANDING, not blaming or attacking
- ${isVeryFirstMessage ? 'Generate 5 DISTINCT options' : 'Generate 3 DISTINCT options'}
- Each option must have DIFFERENT tone, approach, or directness level

🎯 EXAMPLES OF GOOD BREVITY (meaningful and complete, all under ${wordLimit} words):
- "hey, can we talk about what happened yesterday?" (8 words)
- "I felt hurt when you didn't invite me" (8 words)
- "she said something that really bothered me" (7 words)
- "want to clear this up between us?" (7 words)
- "I need to talk about something that's been bothering me" (10 words)

TONE REQUIREMENTS:
- Show empathy and care even when being direct
- Acknowledge feelings without dismissing them
- Speak from a place of wanting to fix things, not win an argument
- Use gentle language: "I felt" instead of "you made me feel", "can we talk about" instead of "you need to explain"

${naturalClosureDetected ? `
🙂 CLOSURE READY: Consider including ${isVeryFirstMessage ? 'TWO' : 'ONE'} emoji (🙂, 🤝, ❤️, 👍) as option(s) if it feels natural.
REMEMBER: Build on conversation progress, don't restart the issue.
` : ''}

Format as JSON:
{
  "options": [${isVeryFirstMessage ? '"Option 1", "Option 2", "Option 3", "Option 4", "Option 5"' : '"Exact words they\'d say 1", "Exact words they\'d say 2", "Exact words they\'d say 3"'}]${shouldUseHint ? `,
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
    const expectedCount = isVeryFirstMessage ? 5 : 3;
    if (options.length < expectedCount) {
      throw new Error(`Insufficient options generated: expected ${expectedCount}, got ${options.length}`);
    }

    // ✅ ENFORCE WORD LIMIT: Validate and reject if exceeds (don't truncate - keep meaningful)
    const countWords = (text: string): number => {
      if (!text || typeof text !== 'string') return 0;
      // Don't count single emojis
      if (/^[\p{Emoji}]$/u.test(text.trim())) return 0;
      return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    };

    // Filter out options that exceed word limit - don't truncate, reject to ensure meaningful options
    const validOptions = options.filter(opt => {
      if (!opt || typeof opt !== 'string') {
        console.warn(`⚠️ Invalid option (not a string):`, opt);
        return false;
      }
      const wordCount = countWords(opt);
      if (wordCount > wordLimit) {
        console.warn(`⚠️ Option exceeds ${wordLimit} words (${wordCount}) and will be rejected: "${opt.substring(0, 50)}..."`);
        return false;
      }
      return true;
    });

    // If we lost too many options, use what we have (minimum 2 required for meaningful conversation)
    if (validOptions.length < 2) {
      console.warn(`⚠️ Only ${validOptions.length} valid options after word limit check. Regenerating with stricter enforcement.`);
      throw new Error(`Too many options exceeded ${wordLimit}-word limit. Only ${validOptions.length} valid options. Regenerating with stricter word limit enforcement.`);
    }

    // Use available valid options (minimum 2, up to expected count)
    options = validOptions.slice(0, Math.min(expectedCount, validOptions.length));
    console.log(`✅ Word count validation passed: ${options.length} options under ${wordLimit} words (expected ${expectedCount})`);

    // Fetch recent options for deduplication
    const { data: recentOptions } = await supabase
      .from('message_options')
      .select('options, created_at')
      .eq('chat_id', chatId)
      .eq('recipient_id', recipientId)
      .order('created_at', { ascending: false })
      .limit(3);

    // Deduplicate against recent options
    const previousOptions = recentOptions?.flatMap(r => r.options || []) || [];
    const isSimilar = (str1: string, str2: string): boolean => {
      const words1 = str1.toLowerCase().split(/\s+/);
      const words2 = str2.toLowerCase().split(/\s+/);
      const commonWords = words1.filter(w => words2.includes(w)).length;
      const totalWords = Math.max(words1.length, words2.length);
      return totalWords > 0 ? commonWords / totalWords > 0.7 : false;
    };

    const finalOptions = options.filter(opt => {
      return !previousOptions.some(recent => isSimilar(opt, recent));
    });

    // Ensure we still have minimum required options
    if (finalOptions.length < 3) {
      console.warn("⚠️ Not enough unique options after deduplication, using originals");
      options = optionsData.options || [];
    } else {
      options = finalOptions;
    }

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
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert options:", insertError);
      throw new Error(`Failed to save options: ${insertError.message}`);
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
