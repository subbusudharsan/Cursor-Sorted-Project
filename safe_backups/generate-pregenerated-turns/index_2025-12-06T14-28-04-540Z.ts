/*
  # Generate Pre-generated Turns Function

  1. Purpose
    - Generates 3 turns of dialogue (A → B → A) ahead of time
    - Stores pre-generated options in pregenerated_turns table
    - Uses single AI call to generate all 3 turns efficiently

  2. Security
    - Uses environment variables for API keys
    - Validates request format
    - Handles CORS properly

  3. Status
    - Phase 2: Full implementation with AI generation
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
    console.log('🔧 generate-pregenerated-turns called');

    const requestBody = await req.json();
    const { chatId, hintFromB: hintFromBParam } = requestBody;

    if (!chatId) {
      return new Response(JSON.stringify({
        error: 'chatId is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY') || '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({
        error: 'Supabase configuration missing'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!CLAUDE_API_KEY) {
      return new Response(JSON.stringify({
        error: 'CLAUDE_API_KEY not configured'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Load chat row and context_data
    const { data: chatData, error: chatError } = await supabase
      .from("chats")
      .select("id, user_id, contact_id, context_data")
      .eq("id", chatId)
      .single();

    if (chatError || !chatData) {
      return new Response(JSON.stringify({
        error: 'Chat not found',
        details: chatError?.message
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Identify User A and User B
    const userAId = chatData.user_id;
    const userBId = chatData.contact_id;

    if (!userAId || !userBId) {
      return new Response(JSON.stringify({
        error: 'Chat missing user_id or contact_id'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Load last 4 conversation messages (reduced from 8 to minimize token usage)
    const { data: rawMessages, error: messagesError } = await supabase
  .from("messages")
  .select("id, sender_id, content, created_at")
  .eq("chat_id", chatId)
  .order("created_at", { ascending: false }) // newest first
  .limit(4);

// reorder chronologically for history
const messagesData = (rawMessages || []).sort(
  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
);


    if (messagesError) {
      console.error('❌ Failed to load messages:', messagesError);
      return new Response(JSON.stringify({
        error: 'Failed to load conversation history',
        details: messagesError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Format conversation history
    const conversationHistory = (messagesData || []).map((msg: { id: string; sender_id: string; content: string; created_at: string }) => ({
      id: msg.id,
      sender_id: msg.sender_id,
      content: msg.content,
      created_at: msg.created_at
    }));

    // Extract context_data fields
    const contextData = chatData.context_data || {};
    const summarySharedNeutral = contextData.summary_shared_neutral || contextData.summary || '';
    const thoughtsA = contextData.thoughts_a || contextData.thoughts || '';
    const thoughtsB = contextData.thoughts_b || '';
    // ✅ CRITICAL: Use hint from request body if provided (avoids race condition), otherwise fall back to context_data
    const hintFromB = hintFromBParam || contextData.hint_from_b || '';

    console.log('📋 Context loaded:', {
      chatId,
      userAId,
      userBId,
      messageCount: conversationHistory.length,
      hasSummary: !!summarySharedNeutral,
      hasThoughtsA: !!thoughtsA,
      hasThoughtsB: !!thoughtsB,
      hasHint: !!hintFromB,
      hintSource: hintFromBParam ? 'request_body' : 'context_data'
    });

    // ✅ FIX: Determine next recipient and calculate startingTurnNumber correctly
    // Check the last message to see who should get the next turn
    const lastMessage = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1] : null;
    const lastSenderId = lastMessage ? String(lastMessage.sender_id) : null;

    // Count messages from each user
    const messagesFromA = conversationHistory.filter((m: { sender_id: string }) => String(m.sender_id) === String(userAId)).length;
    const messagesFromB = conversationHistory.filter((m: { sender_id: string }) => String(m.sender_id) === String(userBId)).length;

    // Determine who should get the FIRST turn in the batch
    // If User A sent last → next is User B → generate B→A→B
    // If User B sent last → next is User A → generate A→B→A
    // If no messages → start with User A → generate A→B→A
    let firstTurnRole: "A" | "B";
    if (!lastSenderId) {
      // No messages yet → start with User A
      firstTurnRole = "A";
    } else if (lastSenderId === String(userAId)) {
      // User A sent last → next is User B
      firstTurnRole = "B";
    } else {
      // User B sent last → next is User A
      firstTurnRole = "A";
    }

    // Calculate startingTurnNumber using the SAME formula as frontend
    // Frontend: User A = messagesSent * 2, User B = messagesSent * 2 + 1
    // This ensures perfect alignment between backend and frontend
    let startingTurnNumber = 0;
    if (firstTurnRole === "A") {
      // Next turn is User A → use User A's formula: messagesSent * 2
      startingTurnNumber = messagesFromA * 2;
    } else {
      // Next turn is User B → use User B's formula: messagesSent * 2 + 1
      startingTurnNumber = messagesFromB * 2 + 1;
    }

    console.log(`📊 Conversation state for pre-generation:`, {
      lastSenderId,
      firstTurnRole,
      messagesFromA,
      messagesFromB,
      startingTurnNumber,
      sequence: firstTurnRole === "A" ? "A→B→A" : "B→A→B"
    });

    // ✅ FIX: Idempotency check - check for ALL turns (used and unused) from starting point
    const { data: existingTurns, error: existingTurnsError } = await supabase
      .from('pregenerated_turns')
      .select('turn_number, recipient_id, used_at')
      .eq('chat_id', chatId)
      .gte('turn_number', startingTurnNumber)
      .lte('turn_number', startingTurnNumber + 2) // Only check the 3 turns we're about to generate
      .order('turn_number', { ascending: true });

    if (existingTurnsError) {
      console.warn('⚠️ Failed to check existing turns (non-critical):', existingTurnsError);
    }

    // ✅ FIX: Check for exact turn_numbers that would be generated (startingTurnNumber, startingTurnNumber+1, startingTurnNumber+2)
    const expectedTurnNumbers = [startingTurnNumber, startingTurnNumber + 1, startingTurnNumber + 2];
    const existingTurnNumbers = existingTurns?.map((t: { turn_number: number }) => t.turn_number) || [];
    const hasAllExpectedTurns = expectedTurnNumbers.every(tn => existingTurnNumbers.includes(tn));
    
    // ✅ CRITICAL: Check for gaps in the sequence (missing turn numbers like 1, 3, etc.)
    const missingTurns = expectedTurnNumbers.filter(tn => !existingTurnNumbers.includes(tn));
    const hasGaps = missingTurns.length > 0;
    
    // ✅ CRITICAL FIX: More robust idempotency check - if ALL 3 expected turns exist (even if some are used), skip regeneration
    // This prevents deletion of turns that are currently being viewed by users
    if (hasAllExpectedTurns && existingTurns && existingTurns.length >= 3) {
      console.log(`✅ Already have all 3 pregenerated turns for turn_numbers ${expectedTurnNumbers.join(', ')}, skipping generation to prevent deletion of displayed turns`);
      return new Response(JSON.stringify({
        success: true,
        stored: 0,
        message: 'Pregenerated turns already exist for this range',
        existingTurns: existingTurns.length,
        startingTurnNumber,
        existingTurnNumbers
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    
    // ✅ CRITICAL FIX: Check if the NEXT turn that will actually be used already exists
    // If it exists, skip regeneration entirely - don't delete and regenerate
    // This prevents overwriting existing turns from the initial batch (0,1,2)
    const nextTurnExists = existingTurnNumbers.includes(startingTurnNumber);
    if (nextTurnExists && !hasAllExpectedTurns && startingTurnNumber > 0) {
      console.log(`✅ Next turn (${startingTurnNumber}) already exists from previous batch - skipping regeneration to prevent overwrite`);
      return new Response(JSON.stringify({
        success: true,
        stored: 0,
        message: `Next turn ${startingTurnNumber} already exists - keeping existing turns`,
        existingTurnNumbers,
        startingTurnNumber
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ✅ Only delete and regenerate if the next turn is actually missing
    if (existingTurnNumbers.length > 0 && !hasAllExpectedTurns && !nextTurnExists) {
      console.log(`⚠️ Found ${existingTurnNumbers.length} partial turns but next turn ${startingTurnNumber} is missing, deleting and regenerating...`);
      const { error: deletePartialError } = await supabase
        .from('pregenerated_turns')
        .delete()
        .eq('chat_id', chatId)
        .gte('turn_number', startingTurnNumber)
        .lte('turn_number', startingTurnNumber + 2);
      
      if (deletePartialError) {
        console.warn('⚠️ Failed to delete partial turns (non-critical):', deletePartialError);
      } else {
        console.log(`✅ Deleted ${existingTurnNumbers.length} partial turns to regenerate complete set`);
      }
    }


    

    // ✅ FIX: Update system prompt to generate correct sequence
    const systemPrompt = `You are SORTED — an emotionally-intelligent assistant guiding two people (User A and User B) through a supportive, respectful conversation.

Your job: using the inputs below, generate exactly 3 conversational turns (${firstTurnRole === "A" ? "A → B → A" : "B → A → B"}).  
Each turn contains 3 short message options—supportive, natural, human-like.

RULES:
- No names or leaks (replace names with 'you', 'I', 'they' correctly).
- Each message must be exactly 1 sentence (1 line max).
- Tone: calm, kind, emotionally aware.
- Never judge either person.
- No emojis unless user uses them.
- Maintain continuity across all 3 turns.
${hintFromB ? `
- 🔐 CRITICAL: User B has provided a private hint that MUST deeply influence ALL User B options.
- The hint represents User B's true perspective and emotional context.
- When generating options for User B, the hint is MANDATORY foundational context.
- The hint should shape the tone, content, and authenticity of User B's voice throughout all turns.
- User B's options must reflect their genuine feelings and reasons from the hint.
` : `
- If hint_from_b is provided, respect it as User B's private perspective.
`}
- If closure is detected, include 1 smiley-only option as one of the 3.
- Do NOT generate branching beyond ${firstTurnRole === "A" ? "A→B→A" : "B→A→B"}.
- Do NOT generate more than 3 turns.
- Output MUST follow this format:

{
  "turns": [
    { "role": "${firstTurnRole}", "options": ["...", "...", "..."], "finalClosureDetected": false },
    { "role": "${firstTurnRole === "A" ? "B" : "A"}", "options": ["...", "...", "..."], "finalClosureDetected": false },
    { "role": "${firstTurnRole}", "options": ["...", "...", "..."], "finalClosureDetected": false }
  ]
}`;

    // ✅ FIX: Update user prompt to generate correct sequence
    const isFirstTurn = conversationHistory.length === 0;
    
    const userPrompt = `Use this conversation context:

summary_shared_neutral: ${summarySharedNeutral || '(none provided)'}

thoughts_a: ${thoughtsA || '(none provided)'}

thoughts_b: ${thoughtsB || '(none provided)'}

${hintFromB ? `
🔐 USER B'S PRIVATE PERSPECTIVE (PERSISTENT CORE CONTEXT FOR ALL TURNS):
"${hintFromB}"

⚠️ CRITICAL: This hint is PRIVATE to User B and MUST NEVER be shown to User A.

⚡ ABSOLUTELY CRITICAL - MANDATORY HINT INTEGRATION:
This hint is User B's TRUE PERSPECTIVE and MUST DEEPLY INFLUENCE EVERY SINGLE OPTION generated for User B throughout THE ENTIRE CONVERSATION.

This is NOT optional context - this is REQUIRED FOUNDATIONAL CONTEXT that shapes User B's authentic voice.

The hint reveals:
- What User B is GENUINELY feeling about the situation (emotional truth)
- Critical context and background User A doesn't fully understand
- User B's valid perspective, needs, and legitimate concerns
- The specific people, events, and dynamics involved
- User B's reasons for their feelings and reactions
- Opportunities to help both sides understand each other fairly

🎯 CRITICAL: COMPARE HINT WITH NEUTRAL TOPIC SUMMARY:
Topic context (neutral, factual): "${summarySharedNeutral || '(none provided)'}"
User B's Hint (User B's perspective): "${hintFromB}"

GENERATE OPTIONS FOR USER B THAT:
1. ✅ ALWAYS reflect the emotional tone and subject matter from the hint in EVERY turn
2. ✅ Help User B express THEIR authentic perspective based on this persistent context
3. ✅ Show that User B has legitimate feelings, valid reasons, and their own truth
4. ✅ Allow User B to communicate genuinely without directly exposing the private hint text
5. ✅ Balance fairness - this conversation has TWO perspectives, not just User A's issue
6. ✅ Maintain absolute consistency with hint's emotional context across ALL turns
7. ✅ Use hint to inform tone: if hint shows hurt, options reflect that; if defensive, options reflect that
8. ✅ Reference subjects/people mentioned in hint naturally throughout conversation
9. ✅ STRONGLY CONVEY User B's reasons - explain WHY User B felt/acted the way they did
10. ✅ Help User B articulate their perspective clearly so User A can understand their side

PERSISTENCE RULE:
The hint doesn't "expire" after first response. User B's feelings and perspective from the hint remain RELEVANT and ACTIVE throughout the ENTIRE conversation. Keep incorporating this context into EVERY set of options generated for User B.

When generating turns for User B (in the ${firstTurnRole === "A" ? "B → A → B" : "B → A → B"} sequence):
- If the sequence starts with User B (firstTurnRole === "B"), the FIRST turn must deeply reflect the hint
- If the sequence has User B in the middle or end, those turns must also reflect the hint
- ALL User B turns must be consistent with the hint's emotional tone and perspective
- User B's options must respond to previous messages AND incorporate hint context naturally
` : `
hint_from_b: (none provided)
`}

conversation_history: ${JSON.stringify(conversationHistory, null, 2)}

${isFirstTurn ? `
🌱 VERY FIRST TURN - NATURAL HUMAN OPENING WITH GREETING:

Generate the FIRST turn (${firstTurnRole === "A" ? "User A" : "User B"}) with 3 options that:
1. INCLUDE CASUAL CHECK-IN GREETINGS naturally:
   - "Hey, how are you? Can we talk about something?"
   - "Hi, how's it going? Got something I wanted to discuss"
   - "Hey there, how have you been? Need to chat about something"

2. THEN TRANSITION TO THE ISSUE from summary:
   - "...can we talk about what happened at the party?"
   - "...there's something I wanted to discuss"
   - "...got something on my mind"

3. VARY THE STYLE:
   - Some start with casual greeting + check-in
   - Some are more direct but still warm
   - Some are situation-aware (embarrassed, happy, after fight, etc.)

Examples for first turn:
- "Hey, how are you? Can we talk about what happened at the party?"
- "Hi, hope you're doing well. I've been wanting to bring something up"
- "Hey there, how's everything going? Got something on my mind I'd like to discuss"

Keep them natural, human-like, and include casual greetings when appropriate.

For the remaining 2 turns (${firstTurnRole === "A" ? "B → A" : "A → B"}), generate 3 short options each that:

🔥 MANDATORY TWO-PART STRUCTURE FOR EACH OPTION:
Each option MUST contain:
1. RESPONSE PART: Acknowledge/respond to the immediately previous message
   - Reference specific words, topics, or questions from the previous message
   - Show understanding: "I hear you", "That makes sense", "I understand", "I'm sorry", "I'm good" (if asked how they are)
   
2. NEW CONTENT PART: Add something new to advance the conversation
   - Share your own feeling, perspective, or information
   - Connect to the topic but add your own angle
   - Move the conversation forward with new information

✅ CORRECT EXAMPLES:
- Previous: "How are you? I am upset about office issue."
  Options:
  * "Hey, I'm good. I'm also upset about that too" (responds + adds feeling)
  * "I'm doing okay. I want to understand what happened" (responds + adds intent)
  * "I'm fine. I felt something was off too" (responds + adds perspective)

- Previous: "I felt hurt when you didn't reply."
  Options:
  * "I hear you. I didn't realize it bothered you that much" (responds + adds understanding)
  * "I understand. My phone died and I couldn't respond" (responds + adds explanation)
  * "I'm sorry. I was stressed with work and didn't think" (responds + adds context)

❌ WRONG EXAMPLES (avoid these):
- "I'm good" (only response, no new content) ❌
- "I'm also upset" (only new content, doesn't respond) ❌
- "How are you?" (ignores previous message completely) ❌

Continue the conversation naturally
Are supportive and consistent with the conversation
If near closure, include 1 smiley-only option as one of the 3
` : `
Generate 3 consecutive turns: ${firstTurnRole === "A" ? "A → B → A" : "B → A → B"}.
Each turn must include 3 short options.

🔥 MANDATORY TWO-PART STRUCTURE FOR EACH OPTION:
Each option MUST contain:
1. RESPONSE PART: Acknowledge/respond to the immediately previous message
   - Reference specific words, topics, or questions from the previous message
   - Show understanding: "I hear you", "That makes sense", "I understand", "I'm sorry"
   
2. NEW CONTENT PART: Add something new to advance the conversation
   - Share your own feeling, perspective, or information
   - Connect to the topic but add your own angle
   - Move the conversation forward with new information

✅ CORRECT STRUCTURE:
- Turn 1: User A says "How are you? I am upset about office issue."
- Turn 2 (User B): Each option should be like:
  * "Hey, I'm good. I'm also upset about that too" (responds + adds feeling)
  * "I'm doing okay. I want to understand what happened" (responds + adds intent)
  * "I'm fine. I felt something was off too" (responds + adds perspective)

- Turn 3 (User A): Each option should respond to Turn 2 AND add new content:
  * "Thanks for understanding. Can we talk about how to fix this?" (responds + adds action)
  * "I appreciate that. I think we both need to communicate better" (responds + adds insight)

❌ WRONG EXAMPLES (avoid these):
- "I'm good" (only response, no new content) ❌
- "I'm also upset" (only new content, doesn't respond) ❌
- "How are you?" (ignores previous message completely) ❌

Keep them supportive, natural, and consistent with the conversation.
If near closure, add a smiley-only option as one of the 3.

CONVERSATION CONTEXT:
${conversationHistory.length > 0 ? `
Last ${conversationHistory.length} message(s) in conversation:
${conversationHistory.map((msg: any, idx: number) => 
  `${idx + 1}. ${msg.sender_id === userAId ? 'User A' : 'User B'}: "${msg.content}"`
).join('\n')}

Use this history to understand the conversation flow and ensure your generated turns:
- Turn 1 (if starting): Begin naturally
- Turn 2: MUST respond to Turn 1 AND add new content
- Turn 3: MUST respond to Turn 2 AND add new content
` : 'This is the start of the conversation.'}
`}`;

    // Call Anthropic API
    console.log('🤖 Calling Anthropic API for 3-turn generation...');
    
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 2000,
        temperature: 0.7,
        system: systemPrompt,
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
      console.error("❌ Anthropic API error:", errorText);
      return new Response(JSON.stringify({
        error: 'Anthropic API failed',
        details: errorText
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const anthropicData = await anthropicResponse.json();
    const responseText = anthropicData.content[0].text;

    console.log("🟦 Raw response:", responseText);

    // ✅ IMPROVED: Robust JSON extraction function with better error handling
    function extractJSON(text: string): string | null {
      if (!text || typeof text !== 'string') {
        console.error("❌ extractJSON: Invalid input - text is not a string");
        return null;
      }
      
      // Try markdown code block first (```json ... ```)
      const block = text.match(/```json\s*([\s\S]*?)```/);
      if (block) {
        const extracted = block[1].trim();
        if (extracted.startsWith('{') && (extracted.includes('"turns"') || extracted.includes("'turns'"))) {
          console.log("✅ Found JSON in markdown code block (json)");
          return extracted;
        }
      }
      
      // Try markdown code block without language tag (``` ... ```)
      const blockNoLang = text.match(/```\s*([\s\S]*?)```/);
      if (blockNoLang) {
        const content = blockNoLang[1].trim();
        // Check if it looks like JSON with "turns" key
        if (content.startsWith('{') && (content.includes('"turns"') || content.includes("'turns'"))) {
          console.log("✅ Found JSON in markdown code block (no lang)");
          return content;
        }
      }
      
      // Try to find JSON object that contains "turns" key
      const jsonMatch = text.match(/\{\s*"turns"\s*:[\s\S]*\}/);
      if (jsonMatch) {
        console.log("✅ Found JSON with 'turns' key");
        return jsonMatch[0];
      }
      
      // Last resort: find any JSON object and validate it has "turns"
      const loose = text.match(/\{[\s\S]*\}/);
      if (loose) {
        const candidate = loose[0];
        // Validate it has "turns" key
        if (candidate.includes('"turns"') || candidate.includes("'turns'")) {
          console.log("✅ Found JSON object with 'turns' (loose match)");
          return candidate;
        }
      }
      
      console.error("❌ extractJSON: No valid JSON found in response");
      console.error("❌ Response preview:", text.substring(0, 500));
      return null;
    }

    // Extract and parse JSON response
    const jsonString = extractJSON(responseText);
    if (!jsonString) {
      throw new Error("No JSON found in AI response");
    }

    let turnsData;
    try {
      turnsData = JSON.parse(jsonString);
      console.log("🟧 Parsed json:", JSON.stringify(turnsData, null, 2));
    } catch (parseError) {
      console.error("❌ JSON parse error:", parseError);
      console.error("❌ JSON string that failed:", jsonString.substring(0, 500));
      throw new Error("Failed to parse extracted JSON: " + (parseError instanceof Error ? parseError.message : String(parseError)));
    }

    // Validate response structure
    if (!turnsData.turns || !Array.isArray(turnsData.turns) || turnsData.turns.length !== 3) {
      console.error("❌ Invalid response structure:", turnsData);
      return new Response(JSON.stringify({
        error: 'Invalid AI response structure',
        details: 'Expected 3 turns, got ' + (turnsData.turns?.length || 0)
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // ✅ FIX 3: Insert rows into pregenerated_turns table with correct global turn_number
    const inserts = [];
    for (let i = 0; i < 3; i++) {
      const turn = turnsData.turns[i];
      
      if (!turn.role || !turn.options || !Array.isArray(turn.options) || turn.options.length !== 3) {
        console.error(`❌ Invalid turn ${i}:`, turn);
        continue;
      }

      // Determine recipient_id based on role
      const recipientId = turn.role === "A" ? userAId : userBId;
      const role = turn.role === "A" ? "User A" : "User B";

      // ✅ FIX 3: Calculate global turn_number (startingTurnNumber + i)
      const turnNumber = startingTurnNumber + i;

      // Prepare context_data snapshot
      const turnContextData = {
        finalClosureDetected: turn.finalClosureDetected || false,
        generatedAt: new Date().toISOString(),
        turnIndex: i,
        batchStart: startingTurnNumber
      };

      inserts.push({
        chat_id: chatId,
        turn_number: turnNumber, // ✅ Use global turn_number, not loop index
        recipient_id: recipientId,
        role: role,
        options: turn.options,
        selected_message: null,
        used_at: null,
        source: null, // ✅ Set to NULL initially - will be set when user selects an option
        context_data: turnContextData
      });
    }

    if (inserts.length !== 3) {
      return new Response(JSON.stringify({
        error: 'Failed to prepare all 3 turns for insertion',
        details: `Only ${inserts.length} valid turns found`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log("🟩 Inserts:", JSON.stringify(inserts, null, 2));

    // ✅ CRITICAL FIX: Only delete turns if we're actually going to regenerate (not if idempotency check passed)
    // This prevents deletion of turns that are currently being viewed
    // Note: The deletion above (lines 256-287) only happens if there are gaps or partial turns
    // This deletion should only happen if we didn't return early from idempotency check
    
    
    
    
    // ✅ NOTE: We keep used turns in pregenerated_turns until chat closes
    // When chat closes, archive-pregenerated-turns function will archive them
    // This ensures full audit trail while keeping active table clean
    // No need to delete old used turns here - they'll be archived on closure

    // Insert all turns
    console.log("💾 Inserting 3 pre-generated turns...");
    const { data: insertedData, error: insertError } = await supabase
      .from("pregenerated_turns")
      .insert(inserts)
      .select();

    if (insertError) {
      // ✅ FIX: Handle unique constraint violation gracefully
      if (insertError.code === '23505') {
        // Unique constraint violation - turns already exist
        console.log('ℹ️ Unique constraint violation - turns may already exist, checking...');
        
        // Check if the turns actually exist
        const { data: existingCheck } = await supabase
          .from('pregenerated_turns')
          .select('turn_number')
          .eq('chat_id', chatId)
          .gte('turn_number', startingTurnNumber)
          .lte('turn_number', startingTurnNumber + 2);
        
        if (existingCheck && existingCheck.length >= 3) {
          // Turns already exist - return success (idempotent)
          console.log('✅ Turns already exist - returning success (idempotent)');
          return new Response(JSON.stringify({
            success: true,
            stored: existingCheck.length,
            message: 'Pregenerated turns already exist',
            startingTurnNumber,
            turnNumbers: existingCheck.map((t: any) => t.turn_number)
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }
      
      console.error("❌ Failed to insert pre-generated turns:", insertError);
      console.error("❌ Insert error details:", JSON.stringify(insertError, null, 2));
      console.error("❌ Attempted inserts:", JSON.stringify(inserts, null, 2));
      return new Response(JSON.stringify({
        error: 'Failed to store pre-generated turns',
        details: insertError.message,
        code: insertError.code,
        hint: insertError.hint
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    if (!insertedData || insertedData.length !== 3) {
      console.error("❌ Insert succeeded but wrong number of rows:", insertedData?.length || 0);
      return new Response(JSON.stringify({
        error: 'Failed to store all pre-generated turns',
        details: `Expected 3 rows, got ${insertedData?.length || 0}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('✅ Successfully generated and stored 3 pre-generated turns');
    console.log('✅ Inserted turn IDs:', insertedData.map((t: any) => ({ id: t.id, turn_number: t.turn_number, recipient_id: t.recipient_id })));
    console.log(`✅ Successfully generated and stored 3 pre-generated turns starting from turn_number ${startingTurnNumber}`);

    return new Response(JSON.stringify({
      success: true,
      stored: 3,
      startingTurnNumber: startingTurnNumber,
      turnNumbers: insertedData.map((t: any) => t.turn_number)
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('❌ Error in generate-pregenerated-turns:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});

