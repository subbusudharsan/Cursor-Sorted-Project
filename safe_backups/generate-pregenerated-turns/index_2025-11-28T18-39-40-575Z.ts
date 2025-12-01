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

    // Build system prompt
    const systemPrompt = `You are SORTED — an emotionally-intelligent assistant guiding two people (User A and User B) through a supportive, respectful conversation.

Your job: using the inputs below, generate exactly 3 conversational turns (A → B → A).  
Each turn contains 3 short message options—supportive, natural, human-like.

RULES:
- No names or leaks (replace names with 'you', 'I', 'they' correctly).
- Each message must be short (1–2 lines max).
- Tone: calm, kind, emotionally aware.
- Never judge either person.
- No emojis unless user uses them.
- Maintain continuity across all 3 turns.
- Respect hint_from_b if provided.
- If closure is detected, include 1 smiley-only option as one of the 3.
- Do NOT generate branching beyond A→B→A.
- Do NOT generate more than 3 turns.
- Output MUST follow this format:

{
  "turns": [
    { "role": "A", "options": ["...", "...", "..."], "finalClosureDetected": false },
    { "role": "B", "options": ["...", "...", "..."], "finalClosureDetected": false },
    { "role": "A", "options": ["...", "...", "..."], "finalClosureDetected": false }
  ]
}`;

    // Build user prompt
    const userPrompt = `Use this conversation context:

summary_shared_neutral: ${summarySharedNeutral || '(none provided)'}

thoughts_a: ${thoughtsA || '(none provided)'}

thoughts_b: ${thoughtsB || '(none provided)'}

hint_from_b: ${hintFromB || '(none provided)'}

conversation_history: ${JSON.stringify(conversationHistory, null, 2)}

Generate 3 consecutive turns: A → B → A.
Each turn must include 3 short options.
Keep them supportive, natural, and consistent with the conversation.
If near closure, add a smiley-only option as one of the 3.`;

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

    // Robust JSON extraction function
    function extractJSON(text: string): string | null {
      // Try markdown code block first (```json ... ```)
      const block = text.match(/```json\s*([\s\S]*?)```/);
      if (block) {
        return block[1].trim();
      }
      
      // Try markdown code block without language tag (``` ... ```)
      const blockNoLang = text.match(/```\s*([\s\S]*?)```/);
      if (blockNoLang) {
        const content = blockNoLang[1].trim();
        // Check if it looks like JSON
        if (content.startsWith('{') && content.includes('"turns"')) {
          return content;
        }
      }
      
      // Try loose JSON object match
      const loose = text.match(/\{[\s\S]*\}/);
      if (loose) {
        return loose[0];
      }
      
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

    // Insert rows into pregenerated_turns table
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

      // Prepare context_data snapshot
      const turnContextData = {
        finalClosureDetected: turn.finalClosureDetected || false,
        generatedAt: new Date().toISOString(),
        turnIndex: i
      };

      inserts.push({
        chat_id: chatId,
        turn_number: i,
        recipient_id: recipientId,
        role: role,
        options: turn.options,
        selected_message: null,
        used_at: null,
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

    // Insert all turns
    const { error: insertError } = await supabase
      .from("pregenerated_turns")
      .insert(inserts);

    if (insertError) {
      console.error("❌ Failed to insert pre-generated turns:", insertError);
      return new Response(JSON.stringify({
        error: 'Failed to store pre-generated turns',
        details: insertError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    console.log('✅ Successfully generated and stored 3 pre-generated turns');

    return new Response(JSON.stringify({
      success: true,
      stored: 3
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

