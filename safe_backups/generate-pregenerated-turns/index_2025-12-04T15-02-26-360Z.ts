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
    const { chatId } = requestBody;

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
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') || '';
    
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

    if (!GROQ_API_KEY) {
      return new Response(JSON.stringify({
        error: 'GROQ_API_KEY not configured'
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

    // Load last 8 conversation messages
    const { data: messagesData, error: messagesError } = await supabase
      .from("messages")
      .select("id, sender_id, content, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(8);

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

    // ✅ TOKEN OPTIMIZATION: Format conversation history (only last 4 messages for context)
    const MAX_RECENT_MESSAGES = 4; // Keep only last 4 messages to save tokens
    const allMessages = (messagesData || []).map((msg: { id: string; sender_id: string; content: string; created_at: string }) => ({
      sender_id: msg.sender_id,
      content: msg.content
    }));
    const conversationHistory = allMessages.slice(-MAX_RECENT_MESSAGES); // Only last 4 messages

    // Extract context_data fields
    const contextData = chatData.context_data || {};
    const summarySharedNeutral = contextData.summary_shared_neutral || contextData.summary || '';
    const thoughtsA = contextData.thoughts_a || contextData.thoughts || '';
    const thoughtsB = contextData.thoughts_b || '';
    const hintFromB = contextData.hint_from_b || '';

    console.log('📋 Context loaded:', {
      chatId,
      userAId,
      userBId,
      messageCount: conversationHistory.length,
      hasSummary: !!summarySharedNeutral,
      hasThoughtsA: !!thoughtsA,
      hasThoughtsB: !!thoughtsB,
      hasHint: !!hintFromB
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
    
    if (hasAllExpectedTurns && existingTurns && existingTurns.length >= 3) {
      console.log(`✅ Already have all 3 pregenerated turns for turn_numbers ${expectedTurnNumbers.join(', ')}, skipping generation`);
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
    
    // ✅ FIX: If we have some but not all expected turns, delete ALL turns (used and unused) from startingTurnNumber onwards
    if (existingTurns && existingTurns.length > 0 && !hasAllExpectedTurns) {
      console.log(`⚠️ Found ${existingTurns.length} partial pregenerated turns, deleting ALL (used and unused) before regenerating...`);
      // ✅ CRITICAL: Delete ALL turns (used and unused) to prevent unique constraint violations
      const { error: deletePartialError } = await supabase
        .from('pregenerated_turns')
        .delete()
        .eq('chat_id', chatId)
        .gte('turn_number', startingTurnNumber)
        .lte('turn_number', startingTurnNumber + 2); // Only delete the 3 turns we're about to regenerate
      
      if (deletePartialError) {
        console.warn('⚠️ Failed to delete partial turns (non-critical):', deletePartialError);
      } else {
        console.log('✅ Deleted partial pregenerated turns (including used ones)');
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
- Respect hint_from_b if provided.
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

hint_from_b: ${hintFromB || '(none provided)'}

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
- Continue the conversation naturally
- Respond to the previous turn
- Are supportive and consistent with the conversation
- If near closure, include 1 smiley-only option as one of the 3
` : `
Generate 3 consecutive turns: ${firstTurnRole === "A" ? "A → B → A" : "B → A → B"}.
Each turn must include 3 short options.
Keep them supportive, natural, and consistent with the conversation.
If near closure, add a smiley-only option as one of the 3.
`}`;

    // Call Groq API
    console.log('🤖 Calling Groq API for 3-turn generation...');
    
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 2000,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      })
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error("❌ Groq API error:", errorText);
      
      // ✅ FIX: Handle specific error codes with better messages
      let errorMessage = 'Groq API failed';
      if (groqResponse.status === 413) {
        errorMessage = 'Request too large. Please reduce conversation history or summary length.';
      } else if (groqResponse.status === 429) {
        errorMessage = 'Rate limit exceeded. Please try again in a moment.';
      } else if (groqResponse.status === 400) {
        errorMessage = 'Invalid request. Please check the input data.';
      }
      
      return new Response(JSON.stringify({
        error: errorMessage,
        status: groqResponse.status,
        details: errorText
      }), {
        status: groqResponse.status >= 500 ? 500 : groqResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const groqData = await groqResponse.json();
    const responseText = groqData.choices[0].message.content;

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

    // ✅ FIX 2: Delete ALL future turns (used and unused) from startingTurnNumber onwards
    // This prevents unique constraint violations when regenerating
    console.log(`🧹 Cleaning up ALL pregenerated turns from turn_number ${startingTurnNumber} to ${startingTurnNumber + 2}...`);
    const { error: deleteError } = await supabase
      .from("pregenerated_turns")
      .delete()
      .eq("chat_id", chatId)
      .gte("turn_number", startingTurnNumber)
      .lte("turn_number", startingTurnNumber + 2); // Only delete the 3 turns we're about to insert
    
    if (deleteError) {
      console.warn("⚠️ Failed to clean up pregenerated turns (non-critical):", deleteError);
      // Continue anyway - the insert might still work
    } else {
      console.log(`✅ Cleaned up ALL pregenerated turns from turn_number ${startingTurnNumber} to ${startingTurnNumber + 2}`);
    }
    
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

