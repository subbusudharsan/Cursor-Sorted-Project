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
    const { chatId, recipientId, currentUserId, currentMessage, summary, thoughts, originalIssueSummary, recipientSummary, hint_from_b, originalIssue, hintFromB, hintToContact, summaryB, thoughtsB, conversationHistory, isInitial, contactCategory, conversationPhase, resolutionDetected } = await req.json();

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

    // ✅ Get chat data to properly identify User A vs User B
    const { data: chatData } = await supabase
      .from('chats')
      .select('user_id, contact_id')
      .eq('id', chatId)
      .single();

    const isRecipientUserA = recipientId === chatData?.user_id;
    const isRecipientUserB = recipientId === chatData?.contact_id;
    const shouldUseHint = isRecipientUserB && hintFromB;

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

✅ GOOD EXAMPLES (Direct dialogue):
- "hey what's up? how you been?"
- "I felt really hurt when that happened"
- "okay I get what you're saying, but from my side it looked different"
- "my bad, I didn't realize it bothered you that much"
- "so how do we fix this? I don't want this between us"

❌ BAD EXAMPLES (AI mediator voice - NEVER use):
- "I understand your perspective and would like to share mine"
- "Let's find common ground and move forward together"
- "I acknowledge your feelings and want to communicate better"
- "Can we work together to resolve this issue?"

Your task is to generate 3 options of what the person would ACTUALLY say:
1. COMPLETE SENTENCES with natural punctuation
2. DIRECTLY responding to what was just said
3. Sound like a real human talking to someone they know
4. Match the relationship type (casual with friends, respectful with family, professional with coworkers)
5. Use contractions, natural speech patterns, and appropriate informality
${shouldUseHint ? `6. SUBTLY reflect the person's private feelings without exposing them` : ''}

${isVeryFirstMessage ? `
🌱 VERY FIRST MESSAGE - CASUAL WARMUP:
Generate ONLY casual, warm greetings. User A is starting a conversation naturally before bringing up any issues.

Based on relationship type (${contactCategory}), generate greetings like:
- Friends: "hey what's up?", "yo how you been?", "hey! long time"
- Family: "hey mom, how are you?", "hi, got a minute?", "hey how's everything?"
- Coworkers: "hey, do you have time to chat?", "hi, how's your day?", "hey hope you're doing well"

Make it feel natural and human. NO issue discussion yet - just warmup.
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
🔐 PRIVATE PERSPECTIVE (Use to inform responses, but never reveal directly):
"${hintFromB}"

This hint tells you:
- What the recipient is truly feeling or experiencing
- Context the sender might not be aware of
- Opportunities to bridge understanding gaps
- Integrate it sensitively into responses without explicitly quoting it
- Adjust tone to reflect understanding or self-awareness of that reason

Generate options that:
1. Help User B express their needs based on this private context
2. Help User B communicate their perspective fairly
3. Move toward resolution that addresses BOTH sides fairly
4. Maintain privacy while promoting empathy and understanding
` : ''}

${naturalClosureDetected ? `
🙂 NATURAL CLOSURE DETECTED:
The conversation shows signs of mutual understanding and resolution. Consider including a warm closure emoji as ONE of the 3 options:
- 🙂 (peaceful closure)
- 🤝 (mutual agreement)
- ❤️ (warm feelings)
- 👍 (acknowledgment)

Only include if it feels natural based on the conversation flow. Don't force it.
` : ''}`;

    const userPrompt = `Generate exactly 3 options that sound like what this person would ACTUALLY SAY in this conversation.

${isVeryFirstMessage ? `
🌱 WARMUP PHASE - CASUAL GREETINGS ONLY:
This is the VERY FIRST message. Generate 3 different casual greetings appropriate for a ${contactCategory} relationship.

DO NOT mention any issues or problems yet. Just natural, friendly greetings like:
- "hey! how's it going?"
- "hey, how are you?"
- "what's up? how you been?"

Match the formality to the relationship type.
` : ''}

${!isVeryFirstMessage && conversationHistory.length <= 2 ? `
🔄 TRANSITION PHASE - BRINGING UP THE ISSUE:
After the warmup, User A should now naturally introduce their concern. Generate options that:
- Reference the actual issue: ${originalIssueSummary || summary}
- Sound like how someone would transition to a sensitive topic
- Examples: "so... I wanted to talk about something that's been bothering me", "hey, can we talk about what happened ${hintToContact?.timeline || 'recently'}?"
- Stay direct and human, not formal or therapeutic
` : ''}

Each option must:
1. Be EXACTLY what the person would say (direct quote, not description)
2. Respond to: "${currentMessage}"
3. Sound like natural speech for a ${contactCategory} relationship
4. Use contractions and casual language where appropriate ("you're" not "you are", "I'm" not "I am")
5. Match the emotional tone of the conversation
${shouldUseHint ? `6. Subtly reflect their private feelings without exposing the hint directly` : ''}

${naturalClosureDetected ? `
🙂 CLOSURE READY: Consider including ONE emoji (🙂, 🤝, ❤️, 👍) as an option if it feels natural.
` : ''}

RELATIONSHIP-SPECIFIC TONE:
- Friend: casual, use "dude", "bro", "man" if natural, informal language
- Family: warm but respectful, appropriate familiarity
- Coworker: professional but friendly, no overly casual slang
- General: balanced, friendly but not too informal

STRICT RULES:
- 8-15 words max per option
- NO AI/counselor language ("I acknowledge", "Let's work together", "I understand your perspective")
- Sound like REAL human speech
- NO scheduling outside the app
- Use lowercase for casual relationships if natural

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

    const options = optionsData.options || [];
    if (options.length < 3) {
      throw new Error("Insufficient options generated");
    }

    console.log("✅ Generated options:", options);
    console.log("🔐 Inserting with service role key for chat:", chatId, "recipient:", recipientId);

    // Use Supabase client with service role for insert
    const { data: insertData, error: insertError } = await supabase
      .from('message_options')
      .insert({
        chat_id: chatId,
        recipient_id: recipientId,
        options: options.slice(0, 3),
        context_data: {
          conversationStage: conversationPhase,
          turnCount: conversationHistory.length,
          hintUsed: !!hintFromB,
          hintReasoning: optionsData.reasoning || null
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
      options: options.slice(0, 3),
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
