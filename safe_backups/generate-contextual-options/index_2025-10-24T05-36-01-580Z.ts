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

    // Extract tagged entities from context or incoming data
    const storedTags = chatData?.context_data?.tagged_entities || [];
    const allTags = taggedEntities || storedTags;

    // Separate registered contacts (@) from unregistered entities (#)
    const registeredContacts = allTags.filter(t => t.type === 'registered');
    const unregisteredEntities = allTags.filter(t => t.type === 'unregistered');

    // Build tag context for AI
    let tagContext = '';
    if (registeredContacts.length > 0) {
      tagContext += `\n\nREGISTERED CONTACTS (use @ prefix, these are IN the conversation):\n`;
      tagContext += registeredContacts.map(t => `- ${t.tag} (role: ${t.role})`).join('\n');
    }
    if (unregisteredEntities.length > 0) {
      tagContext += `\n\nUNREGISTERED ENTITIES (use # prefix, these are being DISCUSSED):\n`;
      tagContext += unregisteredEntities.map(t => `- ${t.tag} (being discussed, use name or pronouns)`).join('\n');
    }

    console.log('⏰ TIMING CONTEXT:', conversationTimingContext);

    console.log('🎯 OPTIONS GENERATION CONTEXT:');
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

    const systemPrompt = `You are writing what one person would DIRECTLY SAY to another person. You are NOT an AI mediator or counselor - you are generating the exact words User A or User B would speak TO each other in a real conversation.

CRITICAL: DIRECT HUMAN-TO-HUMAN DIALOGUE ONLY
You're writing Person A talking TO Person B (or vice versa). Not about them, not narrating, not coaching - just direct speech.

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
- When an entity is tagged with @, they ARE in the conversation - address them with "you"${tagContext}

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
- "we need to talk about what just happened"
- "can we talk about earlier?"
- "I want to clear this up with you"
- "hey can we figure out what happened?"
- "that didn't go well, can we talk?"
DO NOT use casual greetings like "hey how are you" - they're upset and want to resolve NOW.
` : conversationTimingContext === 'long_gap' ? `
🕰 LONG GAP - Warm reconnection with wellness check, then gentle issue mention:
- "hey! it's been a while, how have you been?"
- "hi! how are you doing? been thinking about you"
- "hey, how's everything going with you? wanted to talk"
- "hey! how have you been lately? miss chatting"
- "hey stranger, how are you? got a sec to talk?"
- "hi! hope you're doing well, how are things?"
Balance warmth with genuine interest in their wellbeing - they haven't talked in a while but reconnection comes first.
` : conversationTimingContext === 'same_day' ? `
⏱ SAME DAY - Friendly check-in with purpose:
- "hey, how's your day going? got a minute?"
- "hi, how are you doing today? can we talk?"
- "hey, hope you're good - wanted to bring something up"
- "hi, how are you? something on my mind"
- "hey, how's everything? need to chat about something"
` : `
💬 NORMAL TIMING - Gentle opening with wellness check:
- "hey, how are you?"
- "hi, how have you been?"
- "hey there, how's everything going?"
- "hi, how are you doing? got a sec?"
- "hey, hope you're well - can we chat?"
- "hi there, how's it going with you?"
Friendly and caring - show genuine interest before bringing up concerns.
`}

Relationship tone (${contactCategory}):
- Friends: casual, use natural slang if appropriate
- Family: warm but respectful
- Coworkers: professional but friendly
- General: balanced and respectful

Generate 5 distinct options that match the timing context and relationship. Each should feel different in tone or approach.
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
2. Respond to: "${currentMessage}" - USE WORDS/PHRASES from their message to show you heard them
3. Sound like natural speech for a ${contactCategory} relationship
4. Use contractions and casual language where appropriate ("you're" not "you are", "I'm" not "I am")
5. Match the emotional tone of the conversation
6. Use context-appropriate pronouns (you/she/he/they based on subject)
7. INCORPORATE specific details from the conversation context to make responses feel personal and relatable
${shouldUseHint ? `8. Subtly reflect their private feelings without exposing the hint directly
9. Maintain consistency with hint perspective across all turns` : ''}

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

STRICT RULES:
- Target 8-12 words per option while keeping complete meaning (emojis can be 1 character)
- NEVER crop sentences or lose meaning for word count - clarity over brevity
- Use natural contractions ("you're" not "you are", "didn't" not "did not")
- Remove filler words ("like", "just", "really") but keep emotional words if they add meaning
- NO AI/counselor language ("I acknowledge", "Let's work together", "I understand your perspective")
- Sound like REAL human speech with natural warmth
- NO scheduling outside the app
- Use lowercase for casual relationships if natural
- Be RESPECTFUL, KIND, and POLITE even when addressing difficult topics
- Focus on RESOLVING and UNDERSTANDING, not blaming or attacking
- ${isVeryFirstMessage ? 'Generate 5 distinct options' : 'Generate 3 distinct options'}

🎯 EXAMPLES OF GOOD BREVITY (meaningful and complete):
- "hey, can we talk about what happened yesterday?" (9 words, complete thought)
- "I felt hurt when you didn't invite me" (8 words, full meaning)
- "she said something that really bothered me" (7 words, clear subject)
- "want to clear this up between us?" (7 words, direct question)

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

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 800,
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

    const finalOptions = options.slice(0, expectedCount);
    console.log("✅ Generated options:", finalOptions);
    console.log("🔐 Inserting with service role key for chat:", chatId, "recipient:", recipientId);

    // Use Supabase client with service role for insert
    const { data: insertData, error: insertError } = await supabase
      .from('message_options')
      .insert({
        chat_id: chatId,
        recipient_id: recipientId,
        options: finalOptions,
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
