
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
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const { chatId, recipientId, currentUserId, currentMessage, summary, thoughts, originalIssueSummary, recipientSummary, hint_from_b, originalIssue, hintFromB, hintToContact, summaryB, thoughtsB, conversationHistory, isInitial, contactCategory, conversationPhase, resolutionDetected } = await req.json();
    const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY");
    if (!CLAUDE_API_KEY) {
      throw new Error("CLAUDE_API_KEY not configured");
    }
    // Detect if this is the very first message from User A
    const isVeryFirstMessage = conversationHistory.length === 0;

    // Detect if User B just provided their hint
    const isRecipientUserB = recipientId !== (conversationHistory[0]?.sender_id || currentUserId);
    const shouldUseHint = isRecipientUserB && hintFromB;

    // Check for natural closure signals in recent messages
    const recentMessages = conversationHistory.slice(-4).map(m => m.content.toLowerCase()).join(' ');
    const hasGratitude = /thank|grateful|appreciate/.test(recentMessages);
    const hasForgiveness = /sorry|forgive|understand|my bad/.test(recentMessages);
    const hasUnderstanding = /makes sense|get it|see your point|clear now/.test(recentMessages);
    const naturalClosureDetected = (hasGratitude && hasForgiveness) || (hasGratitude && hasUnderstanding) || (hasForgiveness && hasUnderstanding);

    const formattedHistory = conversationHistory.map((msg)=>`${msg.sender_id === recipientId ? 'You' : 'Contact'}: ${msg.content}`).join('\n');
    const systemPrompt = `You are an expert conversation facilitator helping users communicate effectively about interpersonal issues. You are not an AI assistant — you're writing real human messages between two people.

Your task is to generate 3 complete, meaningful response options that:
1. Are COMPLETE SENTENCES with proper punctuation and capitalization
2. Address the specific message just received
3. Progress the conversation naturally toward understanding and resolution
4. Feel authentic and human, not robotic or staged
5. Are distinct in approach (validating, questioning, or proposing)
${shouldUseHint ? `6. SUBTLY incorporate insights from the recipient's private perspective to promote fair resolution` : ''}

${isVeryFirstMessage ? `
🌱 VERY FIRST MESSAGE - START WARM AND NATURAL:
This is the very first message User A will send. Include at least ONE casual, warm greeting option like:
- "Hey, how are you?"
- "Hey, how's it going?"
- "What's up?"
- "Hey, how have you been?"

Mix this with options that gently ease into the topic. Don't dive straight into heavy issues. Be human and natural.
` : ''}

COMMUNICATION PRINCIPLES (use silently, never label):
- Express feelings without blame ("I felt left out" not "you excluded me")
- Show you understand their perspective
- Acknowledge small mistakes kindly when appropriate
- Keep tone steady and warm, not defensive
- Look for middle ground when views differ
- Allow space for both perspectives to exist
- Aim for gentle progress or emotional resolution
- Offer small acknowledgments or next steps (not decisions)
- Let the conversation flow naturally based on what feels right, not artificial stages

STAY WITHIN THE APP:
- NEVER suggest "let's chat later", "let's meet up", "let's talk tomorrow", "call me", "text me"
- NEVER suggest scheduling or coordinating outside this conversation
- Focus on resolving feelings and understanding HERE and NOW
- Keep all communication within this conversation

CRITICAL: MAINTAIN PERSPECTIVE
- User A is the one who initiated with their original issue/concern
- User B is responding to User A's concern
- User A's options should relate to THEIR original issue and feelings
- User B's options should respond to what User A shared, while considering their own feelings
${shouldUseHint ? `- User B's hint reveals their private perspective - use it ONLY for User B's options, NEVER for User A` : ''}
- Don't let issues switch or merge - keep each person's perspective clear

Context:
- Contact category: ${contactCategory || 'General'}
- Original issue: ${originalIssueSummary || summary || 'Not specified'}

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
    const userPrompt = `Generate exactly 3 complete, meaningful response options for the recipient to choose from.

${isVeryFirstMessage ? `
REMEMBER: This is the VERY FIRST message. Include at least ONE warm, casual greeting option. Make it feel like a natural human conversation start.
` : ''}

Each option should:
1. Be a COMPLETE SENTENCE (not a fragment)
2. Directly respond to: "${currentMessage}"
3. Feel natural and human - like something you'd actually say to a friend or family member
4. Help move the conversation forward in a genuine way
${shouldUseHint ? `5. Reflect understanding of the recipient's private perspective without revealing it
6. Balance both sides' needs for fair resolution` : ''}

${naturalClosureDetected ? `
🙂 The conversation feels like it's reaching a peaceful resolution. Consider including ONE emoji option (��, 🤝, ❤️, or 👍) if it feels natural.
` : ''}

TONE GUIDANCE:
- Read the conversation flow and match the emotional energy
- If someone is opening up, be warm and empathetic
- If there's tension, stay honest but respectful
- If understanding is building, acknowledge and appreciate it
- If closure is near, allow peaceful completion
- Let the conversation breathe - don't force stages or phases

RULES:
- Each option should be 8-15 words maximum
- NO scheduling language (no "let's meet", "call me", "talk later")
- Keep it real and conversational
- 1 emoji max per option, only if it feels natural
- Stay focused on THIS conversation - resolve things HERE

Format as JSON:
{
  "options": ["Complete sentence 1.", "Complete sentence 2.", "Complete sentence 3."]${shouldUseHint ? `,
  "reasoning": "Brief explanation of how the hint influenced these options to promote fair resolution"` : ''}
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
    } catch  {
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
    const { data: insertData, error: insertError } = await Deno.env.get("SUPABASE_URL") ? await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/message_options`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        "Prefer": "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
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
    }).then((r)=>({
        data: null,
        error: r.ok ? null : new Error(`Insert failed: ${r.status}`)
      })) : {
      data: null,
      error: new Error("Supabase not configured")
    };
    if (insertError) {
      console.error("Failed to insert options:", insertError);
      throw insertError;
    }
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
