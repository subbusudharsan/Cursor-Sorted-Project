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
    const { chatId, hintFromB: hintFromBParam, latestMessageFromA, activeTurnNumber, batchStartTurn, closureState: closureStateParam, userASmileySent: userASmileySentParam, userBSmileySent: userBSmileySentParam } = requestBody;

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
      .select("id, user_id, contact_id, context_data, closure_state, user_a_smiley_sent, user_b_smiley_sent")
      .eq("id", chatId)
      .maybeSingle(); // ✅ FIX: Use maybeSingle() instead of single() for safer error handling

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

    // ✅ FIX 2: Check for pendingHint flag - if set, refuse to regenerate
    // This prevents premature regeneration when User B submits hint during User A's turn
    // BUT allow regeneration when latestMessageFromA is provided (User A has selected their turn)
    const contextData = chatData.context_data || {};
    const pendingHint = contextData.pendingHint === true;
    
    // ✅ CRITICAL: hint_from_b is persistent state - always fetch from param OR context_data
    // If hint exists in either place, it MUST be used (trimmed and validated)
    let hintFromB = '';
    if (hintFromBParam && hintFromBParam.trim().length > 0) {
      hintFromB = hintFromBParam.trim();
    } else if (contextData.hint_from_b && typeof contextData.hint_from_b === 'string' && contextData.hint_from_b.trim().length > 0) {
      hintFromB = contextData.hint_from_b.trim();
    }
    
    // ✅ CRITICAL: Log hint source for debugging continuity
    if (hintFromB) {
      console.log('✅ Hint continuity: Using hintFromB', {
        source: hintFromBParam ? 'request_body' : 'context_data',
        length: hintFromB.length,
        preview: hintFromB.substring(0, 50) + '...'
      });
    }
    
    // ✅ Extract closure state from request body or database (similar to hintFromB)
    const closureState = closureStateParam || chatData.closure_state || 'active';
    const userASmileySent = userASmileySentParam !== undefined ? userASmileySentParam : (chatData.user_a_smiley_sent || false);
    const userBSmileySent = userBSmileySentParam !== undefined ? userBSmileySentParam : (chatData.user_b_smiley_sent || false);
    
    console.log('✅ Closure state extracted:', {
      closureState,
      userASmileySent,
      userBSmileySent,
      source: closureStateParam ? 'request_body' : 'database'
    });

    console.log('🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵');
    console.log('🚀 BACKEND: generate-pregenerated-turns called');
    console.log('🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵');
    
    // ✅ STEP 4: Logging infrastructure - payload hint received (always logs)
    console.log('📥 PAYLOAD HINT RECEIVED: Edge function received', {
      functionName: 'generate-pregenerated-turns',
      chatId,
      hintFromBParam: hintFromBParam ? hintFromBParam.substring(0, 50) + "..." : null,
      hintFromBParamLength: hintFromBParam?.length || 0,
      hintFromContext: contextData.hint_from_b ? contextData.hint_from_b.substring(0, 50) + "..." : null,
      hintFromContextLength: contextData.hint_from_b?.length || 0,
      finalHintUsed: hintFromB ? hintFromB.substring(0, 50) + "..." : null,
      finalHintLength: hintFromB.length,
      hintSource: hintFromBParam ? 'request_body' : (contextData.hint_from_b ? 'context_data' : 'none'),
      timestamp: new Date().toISOString()
    });
    
    console.log('🔍 Backend hint check:', {
      chatId,
      hasHintFromBParam: !!hintFromBParam,
      hintFromBParamLength: hintFromBParam?.length || 0,
      hasHintFromContext: !!contextData.hint_from_b,
      hintFromContextLength: contextData.hint_from_b?.length || 0,
      hintFromBLength: hintFromB.length,
      pendingHint,
      hasLatestMessageFromA: !!latestMessageFromA,
      latestMessageFromALength: latestMessageFromA?.length || 0,
      hintSource: hintFromBParam ? 'request_body' : (contextData.hint_from_b ? 'context_data' : 'none'),
      willBlock: pendingHint && !latestMessageFromA
    });

    if (pendingHint && !latestMessageFromA) {
      console.log('DEFERRED_REGEN_BLOCKED_PENDING_HINT:', {
        chatId,
        pendingHint: true,
        hasLatestMessageFromA: false,
        reason: 'User A has not selected their active turn yet'
      });
      console.log('🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑');
      console.log('⏸️ BACKEND: pendingHint flag is set - regeneration is deferred until active turn is selected');
      console.log('📊 This regeneration call is being rejected to prevent premature regeneration');
      console.log('✅ Regeneration will happen automatically after the active turn is selected');
      console.log('🔍 Blocking details:', {
        pendingHint,
        hasLatestMessageFromA: !!latestMessageFromA,
        reason: 'User A has not selected their active turn yet'
      });
      console.log('🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑');
      
      return new Response(JSON.stringify({
        success: false,
        message: 'Regeneration deferred - pendingHint flag is set',
        details: 'Regeneration will happen after the active turn is selected',
        deferred: true
      }), {
        status: 200, // 200 because this is expected behavior, not an error
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

    // ✅ RULE 1: Get last message to determine next recipient (no message count needed)
    // Load last message only to determine who should get the next turn
    const { data: lastMessageData, error: lastMessageError } = await supabase
      .from("messages")
      .select("sender_id")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMessageError && lastMessageError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('❌ Failed to load last message:', lastMessageError);
      return new Response(JSON.stringify({
        error: 'Failed to load conversation history',
        details: lastMessageError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // Get last sender to determine next recipient
    let lastSenderId = lastMessageData ? String(lastMessageData.sender_id) : null;

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

    // ✅ CRITICAL FIX: If latestMessageFromA is provided, ensure it's in conversation history
    // This handles race conditions where the message isn't yet visible in the messages table query
    if (latestMessageFromA && typeof latestMessageFromA === 'string' && latestMessageFromA.trim().length > 0) {
      // Check if the last message in history is already this message (by content and sender)
      const lastMessageInHistory = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1] : null;
      const isLastMessageAlreadyThis = lastMessageInHistory && 
        String(lastMessageInHistory.sender_id) === String(userAId) &&
        lastMessageInHistory.content.trim() === latestMessageFromA.trim();
      
      if (!isLastMessageAlreadyThis) {
        // Add User A's selected message to conversation history
        // Use a synthetic ID and current timestamp
        conversationHistory.push({
          id: `synthetic-${Date.now()}`,
          sender_id: userAId,
          content: latestMessageFromA.trim(),
          created_at: new Date().toISOString()
        });
        console.log('✅ Injected latestMessageFromA into conversation history:', {
          messagePreview: latestMessageFromA.substring(0, 50) + '...',
          conversationHistoryLength: conversationHistory.length,
          wasAlreadyInHistory: false
        });
        
        // ✅ CRITICAL FIX: Update lastSenderId after injection
        // This ensures firstTurnRole is calculated correctly when latestMessageFromA is provided
        lastSenderId = String(userAId);
        console.log('✅ Updated lastSenderId to User A after latestMessageFromA injection');
      } else {
        console.log('ℹ️ latestMessageFromA already in conversation history (no injection needed)');
      }
    }

    // Filter messages by sender for logging/debugging only
    const messagesFromA = conversationHistory.filter(m => String(m.sender_id) === String(userAId));
    const messagesFromB = conversationHistory.filter(m => String(m.sender_id) === String(userBId));

    // ✅ NEW: Detect if both sides have shared their perspectives
    // Check if User A has explained their issue (has event + feeling)
    const hasUserAExplained = messagesFromA.some((msg) => {
      const content = String(msg.content || '').toLowerCase();
      const vaguePatterns = [
        /i (just )?wanted (some )?clarity/i,
        /i didn't want to assume/i,
        /it left me wondering/i,
        /i wanted to understand/i,
        /i (just )?wanted to (talk|discuss|share)/i,
        /something (is|was) bothering me/i,
        /there's something (i|we) need to (talk|discuss)/i,
        /i have something to (discuss|talk about)/i,
      ];
      if (vaguePatterns.some(pattern => pattern.test(content))) return false;
      const hasEvent = /\b(when|didn't|wasn't|did|was|because|after|before|since|while)\b/i.test(content) ||
                       /\b(ignored|replied|responded|said|did|left|canceled|forgot|missed)\b/i.test(content);
      const hasFeeling = /\b(felt|hurt|upset|confused|bothered|sad|angry|disappointed|worried|uncomfortable)\b/i.test(content);
      return hasEvent && hasFeeling;
    });

    // Check if User B has explained their perspective
    const hasUserBExplained = messagesFromB.some((msg) => {
      const content = String(msg.content || '').toLowerCase();
      return content.includes('i felt') || 
             content.includes('i was') || 
             content.includes('i thought') ||
             content.includes('from my side') ||
             content.includes('my perspective') ||
             content.includes('what happened was') ||
             content.includes('the reason') ||
             content.includes('because i') ||
             (content.includes('explain') && (content.includes('i') || content.includes('my')));
    });

    // ✅ CRITICAL: Both sides have shared their perspectives
    const bothSidesShared = hasUserAExplained && hasUserBExplained && conversationHistory.length >= 6;
    
    // ✅ ENHANCED: Also check for mutual understanding signals (gratitude, forgiveness, understanding, closure signals)
    const recentMessagesText = conversationHistory.slice(-6).map(m => String(m.content || '').toLowerCase()).join(' ');
    const hasMutualUnderstanding = bothSidesShared && (
      /thank|grateful|appreciate|glad|happy we talked/.test(recentMessagesText) ||
      /sorry|forgive|understand|my bad|apologize/.test(recentMessagesText) ||
      /makes sense|get it|see your point|clear now|i hear you/.test(recentMessagesText) ||
      // ✅ NEW: Add closure signal patterns
      /let'?s continue|let'?s move forward|let'?s move on|we'?re good|we'?re okay|everything'?s good|everything'?s okay/i.test(recentMessagesText) ||
      /i'?m (glad|happy|relieved) (we|that)/i.test(recentMessagesText) ||
      /i (appreciate|value|respect) (you|that|your)/i.test(recentMessagesText) ||
      /i'?m committed|i'?m here|i support|i understand/i.test(recentMessagesText) ||
      /(thanks|thank you) (for|that)/i.test(recentMessagesText)
    );

    // ✅ NEW: Also detect closure readiness from recent messages even if bothSidesShared is false
    // This catches cases where closure signals appear but detection missed them
    const hasClosureSignals = conversationHistory.length >= 4 && (
      /let'?s continue|let'?s move forward|let'?s move on|we'?re good|we'?re okay|everything'?s good|everything'?s okay/i.test(recentMessagesText) ||
      /i'?m (glad|happy|relieved) (we|that)/i.test(recentMessagesText) ||
      /i (appreciate|value|respect) (you|that|your)/i.test(recentMessagesText) ||
      /i'?m committed|i'?m here|i support|i understand/i.test(recentMessagesText) ||
      /(thanks|thank you) (for|that)/i.test(recentMessagesText) ||
      /🤝|👍|😊|❤️|🫂|🙂|😂|😘|😍/.test(recentMessagesText) // Emoji signals
    );

    // ✅ CRITICAL FALLBACK: Also check recent messages for smiley to detect pending state
    // This handles race conditions where closure_state hasn't been updated yet
    const recentSmileyFromA = messagesFromA.length > 0 && 
      messagesFromA.slice(-2).some((msg) => {
        const content = String(msg.content || '').trim();
        return /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(content) && 
               !/[a-zA-Z0-9]/.test(content);
      });
    
    const recentSmileyFromB = messagesFromB.length > 0 && 
      messagesFromB.slice(-2).some((msg) => {
        const content = String(msg.content || '').trim();
        return /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f\s]+$/u.test(content) && 
               !/[a-zA-Z0-9]/.test(content);
      });
    
    // ✅ FALLBACK: If closure_state is 'active' but we detect a recent smiley, treat as pending
    let effectiveClosureState = closureState;
    if ((closureState === 'active' || !closureState) && !closureState?.startsWith('pending_')) {
      if (recentSmileyFromA && !recentSmileyFromB && !userBSmileySent) {
        effectiveClosureState = 'pending_user_b_smiley';
        console.log('🔍 FALLBACK: Detected User A smiley in recent messages, treating as pending_user_b_smiley');
      } else if (recentSmileyFromB && !recentSmileyFromA && !userASmileySent) {
        effectiveClosureState = 'pending_user_a_smiley';
        console.log('🔍 FALLBACK: Detected User B smiley in recent messages, treating as pending_user_a_smiley');
      }
    }
    
    // ✅ CRITICAL: Also check if closure_state was passed incorrectly but smiley flags are set
    if (effectiveClosureState === 'active' && (userASmileySent || userBSmileySent)) {
      if (userASmileySent && !userBSmileySent) {
        effectiveClosureState = 'pending_user_b_smiley';
        console.log('🔍 FALLBACK: userASmileySent=true but closure_state=active, treating as pending_user_b_smiley');
      } else if (userBSmileySent && !userASmileySent) {
        effectiveClosureState = 'pending_user_a_smiley';
        console.log('🔍 FALLBACK: userBSmileySent=true but closure_state=active, treating as pending_user_a_smiley');
      }
    }
    
    // Use effective closure state for all checks
    const finalClosureState = effectiveClosureState || closureState;
    
    console.log('🔍 Closure detection:', {
      hasUserAExplained,
      hasUserBExplained,
      bothSidesShared,
      hasMutualUnderstanding,
      hasClosureSignals,
      messageCount: conversationHistory.length,
      closureStateFromDB: closureState,
      effectiveClosureState,
      finalClosureState,
      recentSmileyFromA,
      recentSmileyFromB,
      userASmileySent,
      userBSmileySent
    });

    // ✅ HYBRID CONTEXT WINDOW: Update conversation progress summary if stale (best-effort, non-blocking)
    let conversationProgressSummary = contextData?.conversation_progress_summary || '';
    const currentMessageCount = conversationHistory.length;
    const lastSummaryMessageCount = contextData?.conversation_progress_message_count || 0;
    const summaryIsStale = (currentMessageCount - lastSummaryMessageCount) >= 12 || !conversationProgressSummary;

    if (summaryIsStale && currentMessageCount > 0) {
      try {
        console.log(`🔄 Updating conversation progress summary (stale: ${currentMessageCount - lastSummaryMessageCount} messages since last update)`);
        
        // Load more messages for summary generation (up to last 15 for better context)
        const { data: summaryMessagesData, error: summaryMessagesError } = await supabase
          .from("messages")
          .select("id, sender_id, content, created_at")
          .eq("chat_id", chatId)
          .order("created_at", { ascending: false })
          .limit(15);
        
        const summaryMessages = summaryMessagesError ? conversationHistory : 
          (summaryMessagesData || []).sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        
        // Use recent messages for summary (last 10 for good context while keeping tokens low)
        const messagesToSummarize = summaryMessages.slice(-10);
        
        // Build prompt for summary generation - use neutral third-person language
        const summaryPrompt = `Summarize the conversation progress in 2-3 concise sentences using NEUTRAL THIRD-PERSON language. Focus on:
- What has been discussed or resolved
- Current emotional state or progress
- Key points or understanding reached

CRITICAL: Use third-person neutral language (e.g., "User A explained...", "User B acknowledged...", "They discussed..."). 
- Use "User A" and "User B" labels consistently
- Do NOT use first-person ("I", "me", "my") 
- Do NOT use names or @ tags
- This summary will be stored and used as background context for both users

Recent conversation messages:
${messagesToSummarize.map((msg: any, idx: number) => {
          const content = typeof msg === 'object' ? msg.content : String(msg);
          const sender = typeof msg === 'object' && String(msg.sender_id) === String(userAId) ? 'User A' : 'User B';
          return `${idx + 1}. ${sender}: "${content.substring(0, 150)}${content.length > 150 ? '...' : ''}"`;
        }).join('\n')}

Generate a brief 2-3 sentence summary in NEUTRAL THIRD-PERSON language (using "User A" and "User B" labels) describing the conversation progress:`;

        // Generate new summary using Haiku (cost-efficient)
        const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY");
        if (CLAUDE_API_KEY) {
          const summaryResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": CLAUDE_API_KEY,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: "claude-3-5-haiku-20241022",
              max_tokens: 200,
              temperature: 0.3,
              messages: [{
                role: "user",
                content: summaryPrompt
              }]
            })
          });

          if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json();
            const newSummary = summaryData.content[0].text.trim();
            
            if (newSummary && newSummary.length > 20) {
              // Update context_data with new summary
              const { error: updateError } = await supabase
                .from("chats")
                .update({
                  context_data: {
                    ...contextData,
                    conversation_progress_summary: newSummary,
                    conversation_progress_message_count: currentMessageCount,
                    conversation_progress_last_updated_at: new Date().toISOString()
                  }
                })
                .eq("id", chatId);
              
              if (!updateError) {
                conversationProgressSummary = newSummary;
                // Update contextData reference for use later
                contextData.conversation_progress_summary = newSummary;
                contextData.conversation_progress_message_count = currentMessageCount;
                console.log(`✅ Conversation progress summary updated (${newSummary.length} chars)`);
              } else {
                console.warn("⚠️ Failed to update conversation_progress_summary in DB, using in-memory version:", updateError);
              }
            }
          }
        }
      } catch (error) {
        // ✅ Best-effort: Continue with existing summary (or empty) if update fails
        console.warn("⚠️ Conversation progress summary update failed, using existing summary:", error);
      }
    } else {
      console.log(`✅ Using existing conversation progress summary (${conversationProgressSummary.length} chars, ${currentMessageCount - lastSummaryMessageCount} messages since update)`);
    }

    // Extract context_data fields (contextData and hintFromB already extracted above for pendingHint check)
    const summarySharedNeutral = contextData.summary_shared_neutral || contextData.summary || '';
    const thoughtsA = contextData.thoughts_a || contextData.thoughts || '';
    const thoughtsB = contextData.thoughts_b || '';
    // ✅ CRITICAL: Use hint from request body if provided (avoids race condition), otherwise fall back to context_data
    // Note: hintFromB already extracted above for pendingHint validation

    console.log('📋 Context loaded:', {
      chatId,
      userAId,
      userBId,
      messageCount: conversationHistory.length,
      hasSummary: !!summarySharedNeutral,
      hasThoughtsA: !!thoughtsA,
      hasThoughtsB: !!thoughtsB,
      hasHint: !!hintFromB,
      hintLength: hintFromB.length,
      hintPreview: hintFromB ? `${hintFromB.substring(0, 100)}...` : null,
      hintSource: hintFromBParam ? 'request_body' : 'context_data',
      conversationHistoryLength: conversationHistory.length,
      conversationHistoryPreview: conversationHistory.slice(-3).map(m => ({
        sender: String(m.sender_id) === String(userAId) ? 'User A' : 'User B',
        content: m.content.substring(0, 50) + "..."
      }))
    });

    // ✅ ALWAYS compute startingTurnNumber FIRST (from batchStartTurn or DB max)
    // This must be done before firstTurnRole calculation
    const { data: maxTurnRow, error: maxTurnErr } = await supabase
      .from('pregenerated_turns')
      .select('turn_number')
      .eq('chat_id', chatId)
      .order('turn_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    let startingTurnNumber = 0;

    // ✅ If batchStartTurn provided (hint refresh), use it
    if (batchStartTurn !== undefined && batchStartTurn !== null) {
      startingTurnNumber = batchStartTurn;
      console.log(`🔄 Hint refresh: Starting from batch start ${startingTurnNumber}`);
    } else if (maxTurnRow && typeof maxTurnRow.turn_number === 'number') {
      startingTurnNumber = maxTurnRow.turn_number + 1;
    }

    console.log("🔥 FIXED: Computed startingTurnNumber from DB:", { startingTurnNumber });

    // ✅ ALWAYS compute firstTurnRole from batch position (structural, not conversational)
    // This guarantees stable role sequence for ALL batches, regardless of hint refresh or normal pregeneration
    // Batch 0-2 → A→B→A, Batch 3-5 → B→A→B, Batch 6-8 → A→B→A, etc.
    // Completely removes lastSenderId-based role logic for pregenerated turns
    let firstTurnRole: "A" | "B";
    const batchIndex = Math.floor(startingTurnNumber / 3);
    firstTurnRole = (batchIndex % 2 === 0) ? "A" : "B";
    console.log(`✅ Calculated firstTurnRole=${firstTurnRole} from batch position (batchIndex=${batchIndex}, startingTurnNumber=${startingTurnNumber})`);

    // ✅ RULE: When batchStartTurn is provided, still fetch existingTurns to prevent duplicates
    // Frontend deletes only unselected turns, so turns with selected_message may still exist
    // We must check for existing turns (by turn_number only) to avoid duplicate insertions
    if (batchStartTurn !== undefined && batchStartTurn !== null) {
      console.log(`🔄 FORCED REGENERATION: batchStartTurn=${batchStartTurn} provided - bypassing idempotency check but will still check for existing turns to prevent duplicates`);
      console.log(`🔄 Frontend has already deleted batch ${batchStartTurn}-${batchStartTurn + 2} (unselected turns only) - proceeding with forced regeneration`);
    } else {
      // ✅ IDEMPOTENCY CHECK: Verify the batch doesn't already exist (normal flow only)
      // Check if all 3 turns (startingTurnNumber, startingTurnNumber+1, startingTurnNumber+2) already exist
      // ✅ FIX: Check each turn with its specific recipient_id
      const firstTurnRecipientId = firstTurnRole === "A" ? userAId : userBId;
      const secondTurnRecipientId = firstTurnRole === "A" ? userBId : userAId;
      const thirdTurnRecipientId = firstTurnRole === "A" ? userAId : userBId;
      
      // Check each turn individually with its recipient_id
      const { data: turn1 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber)
        .eq('recipient_id', firstTurnRecipientId)
        .maybeSingle();
      
      const { data: turn2 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber + 1)
        .eq('recipient_id', secondTurnRecipientId)
        .maybeSingle();
      
      const { data: turn3 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber + 2)
        .eq('recipient_id', thirdTurnRecipientId)
        .maybeSingle();
      
      if (turn1 && turn2 && turn3) {
        console.log(`⏸️ Batch ${startingTurnNumber}-${startingTurnNumber + 2} already exists with correct recipient_ids - skipping generation`);
        return new Response(JSON.stringify({
          success: true,
          stored: 0,
          startingTurnNumber,
          turnNumbers: [startingTurnNumber, startingTurnNumber + 1, startingTurnNumber + 2],
          insertedTurnNumbers: [],
          message: 'Batch already exists'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    console.log(`📊 Conversation state for pre-generation:`, {
      lastSenderId,
      firstTurnRole,
      messagesFromA,
      messagesFromB,
      startingTurnNumber,
      sequence: firstTurnRole === "A" ? "A→B→A" : "B→A→B"
    });

    // ✅ Hint handling: Delete unused turns to regenerate with hint context
    // ✅ GUARDRAIL 1: If activeTurnNumber is provided, ONLY regenerate that specific active turn
    // ✅ GUARDRAIL 2: Otherwise, delete entire batch [startingTurnNumber, startingTurnNumber+1, startingTurnNumber+2]
    // ❌ REMOVED: Turn-number adjustment logic (startingTurnNumber modification)
    // startingTurnNumber is now ALWAYS max(turn_number) + 1 from DB - never modified
    const hasHint = !!hintFromBParam || !!hintFromB;
    let hintRefreshMode = false; // Track if we're in hint refresh mode (single turn)
    
    if (hasHint && activeTurnNumber !== undefined && activeTurnNumber !== null) {
      // ✅ HINT REFRESH MODE: Only regenerate the active turn
      hintRefreshMode = true;
      console.log(`🔄 HINT REFRESH MODE: Regenerating ONLY active turn ${activeTurnNumber} with hint context`);
      
      // Find the recipient_id for this turn
      const { data: activeTurnData } = await supabase
        .from("pregenerated_turns")
        .select("recipient_id")
        .eq("chat_id", chatId)
        .eq("turn_number", activeTurnNumber)
        .maybeSingle();
      
      if (activeTurnData?.recipient_id) {
        // Delete only this specific active turn
        const { error: deleteError } = await supabase
          .from("pregenerated_turns")
          .delete()
          .eq("chat_id", chatId)
          .eq("turn_number", activeTurnNumber)
          .eq("recipient_id", activeTurnData.recipient_id)
          .is("selected_message", null);
        
        if (deleteError) {
          console.warn('⚠️ Failed to delete active turn for hint refresh (non-critical):', deleteError);
        } else {
          console.log(`✅ Deleted active turn ${activeTurnNumber} for hint refresh`);
        }
        
        // ✅ CRITICAL: Override startingTurnNumber to the active turn for single-turn generation
        startingTurnNumber = activeTurnNumber;
        console.log(`✅ Overriding startingTurnNumber to ${activeTurnNumber} for hint refresh`);
      } else {
        console.warn(`⚠️ Active turn ${activeTurnNumber} not found - falling back to batch mode`);
        hintRefreshMode = false;
      }
    } else if (hasHint) {
      // ✅ NORMAL BATCH MODE: Delete entire batch when hint is provided (for normal batch refill)
      const batchStart = startingTurnNumber;
      const batchEnd = startingTurnNumber + 2;
      console.log(`DELETE_HINT_BATCH_RANGE: start=${batchStart}, end=${batchEnd}, chatId=${chatId}`);
      console.log(`🔄 Hint provided - deleting unused turns from current batch [${batchStart}, ${batchStart + 1}, ${batchEnd}]`);
      
      const batchFirstRecipientId  = firstTurnRole === "A" ? userAId : userBId;
      const batchSecondRecipientId = firstTurnRole === "A" ? userBId : userAId;
      const batchThirdRecipientId  = firstTurnRole === "A" ? userAId : userBId;

      // ✅ FIX: Delete ONLY unused turns from current batch, scoped by recipient_id
      const { error: deleteError1 } = await supabase.from("pregenerated_turns")
        .delete()
        .eq("chat_id", chatId)
        .eq("turn_number", batchStart)
        .eq("recipient_id", batchFirstRecipientId)
        .is("selected_message", null);

      const { error: deleteError2 } = await supabase.from("pregenerated_turns")
        .delete()
        .eq("chat_id", chatId)
        .eq("turn_number", batchStart + 1)
        .eq("recipient_id", batchSecondRecipientId)
        .is("selected_message", null);

      const { error: deleteError3 } = await supabase.from("pregenerated_turns")
        .delete()
        .eq("chat_id", chatId)
        .eq("turn_number", batchEnd)
        .eq("recipient_id", batchThirdRecipientId)
        .is("selected_message", null);

      if (deleteError1 || deleteError2 || deleteError3) {
        console.warn('⚠️ Failed to delete some unused turns (non-critical):', deleteError1 || deleteError2 || deleteError3);
      } else {
        console.log(`✅ Deleted unused turns from current batch [${batchStart}, ${batchStart + 1}, ${batchEnd}]`);
      }
    }

    // ❌ REMOVED: Active turn skipping logic that modified startingTurnNumber
    // startingTurnNumber is now ALWAYS max(turn_number) + 1 from DB - never modified
    // Idempotency checks below will handle existing turns correctly

    // ✅ FIX 3: Idempotency check - check for ALL turns (used and unused) from starting point
    // Include selected_message to identify turns that should be preserved
    // ✅ FIX: Add recipient_id scoping - check each turn with its specific recipient
    // ✅ GUARDRAIL: In hint refresh mode, only check the active turn (not the entire batch)
    const firstRecipientId = firstTurnRole === "A" ? userAId : userBId;
    const secondRecipientId = firstTurnRole === "A" ? userBId : userAId;
    const thirdRecipientId = firstTurnRole === "A" ? userAId : userBId;
    
    let existingTurns: any[] = [];
    let hasAllExpectedTurns = false;
    let expectedTurnNumbers: number[] = [];
    let existingTurnNumbers: number[] = [];
    
    if (hintRefreshMode) {
      // ✅ HINT REFRESH MODE: Only check the active turn
      const { data: existingActiveTurn } = await supabase
        .from('pregenerated_turns')
        .select('turn_number, recipient_id, used_at, selected_message')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber)
        .maybeSingle();
      
      if (existingActiveTurn) {
        existingTurns = [existingActiveTurn];
        existingTurnNumbers = [startingTurnNumber];
        hasAllExpectedTurns = true; // Turn exists, but we deleted it above, so we'll regenerate
      } else {
        existingTurns = [];
        existingTurnNumbers = [];
        hasAllExpectedTurns = false; // Turn doesn't exist, we'll generate it
      }
      
      expectedTurnNumbers = [startingTurnNumber]; // Only the active turn
      console.log(`✅ Hint refresh mode: Only checking active turn ${startingTurnNumber}`);
    } else if (batchStartTurn !== undefined && batchStartTurn !== null) {
      // ✅ FIX: When batchStartTurn is provided, check for existing turns by turn_number only (no recipient_id filter)
      // This prevents duplicate insertions when frontend preserved turns with selected_message
      const { data: existingTurn1 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number, recipient_id, used_at, selected_message')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber)
        .maybeSingle();
      
      const { data: existingTurn2 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number, recipient_id, used_at, selected_message')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber + 1)
        .maybeSingle();
      
      const { data: existingTurn3 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number, recipient_id, used_at, selected_message')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber + 2)
        .maybeSingle();
      
      existingTurns = [existingTurn1, existingTurn2, existingTurn3].filter(t => t !== null);
      expectedTurnNumbers = [startingTurnNumber, startingTurnNumber + 1, startingTurnNumber + 2];
      existingTurnNumbers = existingTurns?.map((t: { turn_number: number }) => t.turn_number) || [];
      hasAllExpectedTurns = false; // Always allow regeneration when batchStartTurn is provided, but existingTurns will prevent duplicates
      console.log(`✅ Batch refresh mode: Checking for existing turns ${expectedTurnNumbers.join(', ')} to prevent duplicates (found: ${existingTurnNumbers.join(', ') || 'none'})`);
    } else {
      // ✅ NORMAL BATCH MODE: Check all 3 turns
      const { data: existingTurn1 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number, recipient_id, used_at, selected_message')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber)
        .eq('recipient_id', firstRecipientId)
        .maybeSingle();
      
      const { data: existingTurn2 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number, recipient_id, used_at, selected_message')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber + 1)
        .eq('recipient_id', secondRecipientId)
        .maybeSingle();
      
      const { data: existingTurn3 } = await supabase
        .from('pregenerated_turns')
        .select('turn_number, recipient_id, used_at, selected_message')
        .eq('chat_id', chatId)
        .eq('turn_number', startingTurnNumber + 2)
        .eq('recipient_id', thirdRecipientId)
        .maybeSingle();
      
      existingTurns = [existingTurn1, existingTurn2, existingTurn3].filter(t => t !== null);
      
      // ✅ FIX: Check for exact turn_numbers that would be generated (startingTurnNumber, startingTurnNumber+1, startingTurnNumber+2)
      expectedTurnNumbers = [startingTurnNumber, startingTurnNumber + 1, startingTurnNumber + 2];
      existingTurnNumbers = existingTurns?.map((t: { turn_number: number }) => t.turn_number) || [];
      hasAllExpectedTurns = expectedTurnNumbers.every(tn => existingTurnNumbers.includes(tn));
    }
    
    // ✅ CRITICAL: Check for gaps in the sequence (missing turn numbers like 1, 3, etc.)
    const missingTurns = expectedTurnNumbers.filter(tn => !existingTurnNumbers.includes(tn));
    const hasGaps = missingTurns.length > 0;
    
    // ✅ FIX 3: Check if any expected turns have selected_message (should be preserved)
    const turnsWithSelectedMessage = existingTurns?.filter((t: { selected_message: any }) => t.selected_message !== null) || [];
    const hasUsedTurns = turnsWithSelectedMessage.length > 0;
    
    // ✅ CRITICAL FIX: More robust idempotency check - if ALL 3 expected turns exist (even if some are used), skip regeneration
    // This prevents deletion of turns that are currently being viewed by users or have been used
    // EXCEPTION 1: If hasHint is true AND NOT in hint refresh mode, ALWAYS allow regeneration (even if all turns exist) to include hint context
    // EXCEPTION 2: In hint refresh mode, we already deleted the active turn, so always regenerate it
    // Note: hasHint is already defined in the hint handling section above
    if (hasAllExpectedTurns && existingTurns && existingTurns.length >= 3 && !hasHint && !hintRefreshMode) {
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
    
    // ✅ REMOVED: Partial batch deletion logic - this conflicts with hint deletion above
    // Hint deletion already handles current batch deletion when hasHint is true
    // If no hint, idempotency check above prevents unnecessary regeneration
    // This logic was causing duplicate deletions and conflicts with hint handling


    

    // ✅ FIX: Update system prompt to generate correct sequence - STRENGTHENED to require exactly 3 turns
    const systemPrompt = `You are SORTED — an emotionally-intelligent assistant guiding two people (User A and User B) through a supportive, respectful conversation.

⚡ CRITICAL REQUIREMENT - YOU MUST GENERATE EXACTLY 3 TURNS:
Your job: using the inputs below, generate EXACTLY 3 conversational turns (${firstTurnRole === "A" ? "A → B → A" : "B → A → B"}).  
NOT 1 turn. NOT 2 turns. EXACTLY 3 TURNS.
Each turn contains EXACTLY 3 short message options—supportive, natural, human-like.

MANDATORY OUTPUT STRUCTURE:
- Turn 1: ${firstTurnRole === "A" ? "User A" : "User B"} with 3 options
- Turn 2: ${firstTurnRole === "A" ? "User B" : "User A"} with 3 options  
- Turn 3: ${firstTurnRole === "A" ? "User A" : "User B"} with 3 options

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
- Choose appropriate emoji from: 🙂 🤝 ❤️ 😊 🫂 👍 😂 😘 😍 based on relationship and tone
- Do NOT generate branching beyond ${firstTurnRole === "A" ? "A→B→A" : "B→A→B"}.
- Do NOT generate more than 3 turns.
- Do NOT generate fewer than 3 turns.

⚡ OUTPUT FORMAT - YOU MUST RETURN EXACTLY THIS STRUCTURE:

{
  "turns": [
    { "role": "${firstTurnRole}", "options": ["...", "...", "..."], "finalClosureDetected": false },
    { "role": "${firstTurnRole === "A" ? "B" : "A"}", "options": ["...", "...", "..."], "finalClosureDetected": false },
    { "role": "${firstTurnRole}", "options": ["...", "...", "..."], "finalClosureDetected": false }
  ]
}

⚡ CRITICAL: The "role" field MUST match the turn position EXACTLY:
- Turn 1 (index 0): role MUST be "${firstTurnRole}" (${firstTurnRole === "A" ? "User A" : "User B"})
- Turn 2 (index 1): role MUST be "${firstTurnRole === "A" ? "B" : "A"}" (${firstTurnRole === "A" ? "User B" : "User A"})
- Turn 3 (index 2): role MUST be "${firstTurnRole}" (${firstTurnRole === "A" ? "User A" : "User B"})

⚠️ IF YOU GET THE ROLE WRONG, THE ENTIRE RESPONSE WILL BE REJECTED AND REGENERATED.
⚠️ Double-check each turn's role matches its position in the sequence before returning.
⚠️ The role field determines which user sees these options - getting it wrong swaps options between users.

REMEMBER: EXACTLY 3 TURNS. NOT 1. NOT 2. EXACTLY 3.`;

    // ✅ FIX: Update user prompt to generate correct sequence
    const isFirstTurn = conversationHistory.length === 0;
    
    const userPrompt = `Use this conversation context:

summary_shared_neutral: ${summarySharedNeutral || '(none provided)'}

thoughts_a: ${thoughtsA || '(none provided)'}

thoughts_b: ${thoughtsB || '(none provided)'}

    // ✅ STEP 4: Logging infrastructure - prompt hint injection (always logs)
    const hintInPrompt = !!hintFromB && hintFromB.trim().length > 0;
    const hintSectionIncluded = hintInPrompt;
    console.log('📝 PROMPT HINT INJECTION: AI prompt construction', {
      functionName: 'generate-pregenerated-turns',
      chatId,
      hintInPrompt,
      hintSectionIncluded,
      hintTextInPrompt: hintInPrompt ? hintFromB.substring(0, 100) + "..." : null,
      hintConditionResult: hintInPrompt,
      timestamp: new Date().toISOString()
    });

${hintFromB ? `
🔐 USER B'S PRIVATE PERSPECTIVE (PERSISTENT CORE CONTEXT FOR ALL TURNS):
"${hintFromB}"

⚠️ CRITICAL: This hint is PRIVATE to User B and MUST NEVER be shown to User A.

⚡ ABSOLUTELY CRITICAL - MANDATORY HINT INTEGRATION:
This hint is User B's TRUE PERSPECTIVE and MUST DEEPLY INFLUENCE EVERY SINGLE OPTION generated for User B throughout THE ENTIRE CONVERSATION.

This is NOT optional context - this is REQUIRED FOUNDATIONAL CONTEXT that shapes User B's authentic voice.

🎯 MANDATORY REQUIREMENT - USE EXACT WORDS AND REASONING:
User B's options MUST incorporate the SPECIFIC words, phrases, and reasoning from the hint above:
- If the hint mentions specific people, events, or feelings, User B's options MUST reference them naturally
- User B's options should help them express the EXACT perspective and reasons stated in the hint
- Use the hint's language and tone to make User B's voice authentic and consistent
- The hint's key points, concerns, and emotional context MUST be reflected in User B's options
- Help User B communicate their perspective using similar language and reasoning as the hint, but in a polite, respectful way

EXAMPLE: If hint says "I felt hurt when they said X because Y", User B's options should help them express:
- That they felt hurt (using similar emotional language)
- What specifically hurt them (referencing X)
- Why it hurt (referencing Y)
- In a way that helps User A understand their perspective

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
1. ✅ ALWAYS incorporate the SPECIFIC words, phrases, and reasoning from the hint above
2. ✅ Help User B express THEIR authentic perspective using similar language as the hint
3. ✅ Show that User B has legitimate feelings, valid reasons, and their own truth (as stated in hint)
4. ✅ Reference the specific people, events, and concerns mentioned in the hint naturally
5. ✅ Use the hint's emotional tone and subject matter in EVERY turn
6. ✅ Help User B articulate their perspective clearly so User A can understand their side
7. ✅ Maintain absolute consistency with hint's emotional context and reasoning across ALL turns
8. ✅ Balance fairness - this conversation has TWO perspectives, not just User A's issue
9. ✅ Use hint to inform tone: if hint shows hurt, options reflect that; if defensive, options reflect that
10. ✅ STRONGLY CONVEY User B's reasons from the hint - explain WHY User B felt/acted the way they did

PERSISTENCE RULE:
The hint doesn't "expire" after first response. User B's feelings and perspective from the hint remain RELEVANT and ACTIVE throughout the ENTIRE conversation. Keep incorporating this context into EVERY set of options generated for User B.

When generating turns for User B (in the ${firstTurnRole === "A" ? "B → A → B" : "B → A → B"} sequence):
- If the sequence starts with User B (firstTurnRole === "B"), the FIRST turn must deeply reflect the hint
- If the sequence has User B in the middle or end, those turns must also reflect the hint
- ALL User B turns must be consistent with the hint's emotional tone and perspective
- User B's options must respond to previous messages AND incorporate hint context naturally
- User B's options MUST use the same words, reasoning, and emotional context from the hint

REMEMBER: The hint is User B's private truth. User B's options must help them express this truth using the EXACT words, reasoning, and emotional context from the hint, in a way that helps both users understand each other better.
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
Choose appropriate emoji from: 🙂 🤝 ❤️ 😊 🫂 👍 😂 😘 😍
Match to relationship type and conversation tone:
- Family: ❤️ 🫂 😊 😘 (warm, supportive)
- Friends: 😊 🤝 😂 😍 (happy, friendly, playful)
- Work: 🤝 👍 🙂 (professional, respectful)
- Romantic: ❤️ 😘 😍 😊 (intimate, caring, affectionate)
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
Choose appropriate emoji from: 🙂 🤝 ❤️ 😊 🫂 👍 😂 😘 😍
Match to relationship type and conversation tone:
- Family: ❤️ 🫂 😊 😘 (warm, supportive)
- Friends: 😊 🤝 😂 😍 (happy, friendly, playful)
- Work: 🤝 👍 🙂 (professional, respectful)
- Romantic: ❤️ 😘 😍 😊 (intimate, caring, affectionate)

${finalClosureState?.startsWith('pending_') ? `
🚨🚨🚨 CRITICAL CLOSURE REMINDER - READ THIS FIRST 🚨🚨🚨

⚠️ CLOSURE PENDING - ONE USER ALREADY SENT A SMILEY:
- ${finalClosureState === 'pending_user_a_smiley' ? 'User A' : 'User B'} has ALREADY sent a single smiley emoji
- The conversation is waiting for ${finalClosureState === 'pending_user_a_smiley' ? 'User A' : 'User B'} to respond with a smiley
- This is the CORE FEATURE of the app - smooth closure resolution

⚡ MANDATORY REQUIREMENT FOR ${finalClosureState === 'pending_user_a_smiley' ? 'USER A' : 'USER B'} TURNS:
- EVERY set of 3 options for ${finalClosureState === 'pending_user_a_smiley' ? 'User A' : 'User B'} MUST include exactly ONE single smiley-only option
- This applies to ALL batches generated while closure is pending
- The smiley option should be one of: 🙂 🤝 ❤️ 😊 🫂 👍 😂 😘 😍
- Choose emoji based on relationship type:
  * Family: ❤️ 🫂 😊 😘 (warm, supportive)
  * Friends: 😊 🤝 😂 😍 (happy, friendly, playful)
  * Work: 🤝 👍 🙂 (professional, respectful)
  * Romantic: ❤️ 😘 😍 😊 (intimate, caring, affectionate)
- The other 2 options should be text-based (appreciation, understanding, moving forward)
- User can choose text options if they want, but smiley option MUST be available

🎯 REMINDER: This is a REMINDER that closure is pending. Even if the conversation continues with text messages, ${finalClosureState === 'pending_user_a_smiley' ? 'User A' : 'User B'} MUST always have a smiley option available until they send one.

⚠️ DO NOT FORGET: If you generate options for ${finalClosureState === 'pending_user_a_smiley' ? 'User A' : 'User B'} and forget to include a single smiley option, the conversation will drag on unnecessarily. This is the core feature - always include it.
` : ''}

⚠️ CONVERSATION EVOLUTION - DO NOT RESTART:
- The problem/issue has already been discussed in previous messages
- Options should EVOLVE emotionally: acknowledgment → reflection → acceptance → closure
- DO NOT re-explain the problem, re-analyze the situation, or restart the discussion
- Focus on: understanding, validation, moving forward, closure signals, peace
- If the conversation shows closure signals (thanks, understanding, peace, smileys), reflect that progression
- Avoid options that loop back to problem analysis, justification, or re-explaining what happened
${finalClosureState?.startsWith('pending_') ? '- Once closure is pending, options should focus on: appreciation, mutual understanding, peace, moving forward' : ''}
${bothSidesShared ? `
🚫🚫🚫 CRITICAL: BOTH SIDES HAVE SHARED THEIR PERSPECTIVES 🚫🚫🚫
- User A has explained their issue/feelings
- User B has explained their perspective/feelings
- Both sides have been heard and understood

⚡ STOP CONTINUING THE PROBLEM DISCUSSION:
- DO NOT generate options that re-explain the problem
- DO NOT generate options that ask for more details about what happened
- DO NOT generate options that analyze or justify the situation further
- DO NOT generate options that restart the discussion

✅ INSTEAD, generate options that:
- Show appreciation: "Thanks for sharing your side", "I appreciate you explaining"
- Express understanding: "I understand where you're coming from", "That makes sense"
- Move toward closure: "I'm glad we talked about this", "Thanks for hearing me out"
- Include ONE smiley-only option as one of the 3 options (choose appropriate emoji: 🙂 🤝 ❤️ 😊 🫂 👍 😂 😘 😍)

The conversation has reached mutual understanding - guide it toward peaceful closure, NOT continued discussion.
` : ''}
- DO NOT restart the problem discussion even if users continue with text messages

CONVERSATION CONTEXT:
${conversationHistory.length > 0 ? `
${conversationProgressSummary ? `📋 Conversation Progress (background context - neutral summary):
${conversationProgressSummary}

Use this to maintain continuity with earlier parts of the conversation that aren't in the recent messages below.
⚠️ CRITICAL: This summary is in neutral third-person with "User A"/"User B" labels. When generating turns, NEVER use these labels - always use first/second person pronouns:
- Turn 1 (${firstTurnRole === "A" ? "User A" : "User B"}): Use "I/me/my" for ${firstTurnRole === "A" ? "User A" : "User B"}, "you/your" for ${firstTurnRole === "A" ? "User B" : "User A"} - NEVER say "User A" or "User B"
- Turn 2 (${firstTurnRole === "A" ? "User B" : "User A"}): Use "I/me/my" for ${firstTurnRole === "A" ? "User B" : "User A"}, "you/your" for ${firstTurnRole === "A" ? "User A" : "User B"} - NEVER say "User A" or "User B"
- Turn 3 (${firstTurnRole === "A" ? "User A" : "User B"}): Use "I/me/my" for ${firstTurnRole === "A" ? "User A" : "User B"}, "you/your" for ${firstTurnRole === "A" ? "User B" : "User A"} - NEVER say "User A" or "User B"
- Third parties use their names or pronouns (he/she/they)

` : ''}Recent messages (last ${conversationHistory.length} message(s)):
${conversationHistory.map((msg: any, idx: number) => 
  `${idx + 1}. ${msg.sender_id === userAId ? 'User A' : 'User B'}: "${msg.content}"`
).join('\n')}

Use this history to understand the conversation flow and ensure your generated turns:
- Turn 1 (if starting): Begin naturally
- Turn 2: MUST respond to Turn 1 AND add new content
- Turn 3: MUST respond to Turn 2 AND add new content
` : 'This is the start of the conversation.'}
`}`;

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

    // ✅ FIX: Call Anthropic API with retry logic to ensure we get exactly 3 turns
    console.log('🤖 Calling Anthropic API for 3-turn generation...');
    
    let turnsData: any = null;
    let responseText = '';
    const maxRetries = 2;
    let attempt = 0;
    
    while (attempt <= maxRetries && (!turnsData || !turnsData.turns || turnsData.turns.length !== 3)) {
      if (attempt > 0) {
        console.warn(`⚠️ Retry attempt ${attempt}/${maxRetries} - previous response had ${turnsData?.turns?.length || 0} turns (expected 3)`);
        // Wait a bit before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 3000, // ✅ Increased from 2000 to ensure enough space for all 3 turns
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
        if (attempt === maxRetries) {
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
        attempt++;
        continue;
      }

      const anthropicData = await anthropicResponse.json();
      responseText = anthropicData.content[0].text;

      console.log("🟦 Raw response:", responseText);

      // Extract and parse JSON response
      const jsonString = extractJSON(responseText);
      if (!jsonString) {
        if (attempt === maxRetries) {
          throw new Error("No JSON found in AI response after retries");
        }
        attempt++;
        continue;
      }

      try {
        turnsData = JSON.parse(jsonString);
        console.log("🟧 Parsed json:", JSON.stringify(turnsData, null, 2));
      } catch (parseError) {
        console.error("❌ JSON parse error:", parseError);
        console.error("❌ JSON string that failed:", jsonString.substring(0, 500));
        if (attempt === maxRetries) {
          throw new Error("Failed to parse extracted JSON: " + (parseError instanceof Error ? parseError.message : String(parseError)));
        }
        attempt++;
        continue;
      }

      // ✅ Check if we got exactly 3 turns - if not, retry
      if (turnsData.turns && Array.isArray(turnsData.turns) && turnsData.turns.length === 3) {
        // ✅ CRITICAL FIX: Validate roles match expected sequence BEFORE accepting response
        // Use firstTurnRole to determine expected sequence (matches AI prompt logic)
        // NOT turn number parity - the sequence is determined by firstTurnRole
        let hasRoleMismatch = false;
        for (let i = 0; i < 3; i++) {
          const turn = turnsData.turns[i];
          if (!turn || !turn.role) {
            hasRoleMismatch = true;
            console.error(`❌ Turn ${i} missing role field`);
            break;
          }
          
          // ✅ FIX: Use firstTurnRole to determine expected role (matches AI prompt logic)
          // The sequence is: firstTurnRole → opposite → firstTurnRole
          let expectedRole: string;
          if (i === 0) {
            // First turn in batch = firstTurnRole
            expectedRole = firstTurnRole === "A" ? "User A" : "User B";
          } else if (i === 1) {
            // Second turn in batch = opposite of firstTurnRole
            expectedRole = firstTurnRole === "A" ? "User B" : "User A";
          } else {
            // Third turn in batch = firstTurnRole again
            expectedRole = firstTurnRole === "A" ? "User A" : "User B";
          }
          
          const turnNumber = startingTurnNumber + i;
          const aiRole = turn.role === "A" ? "User A" : (turn.role === "B" ? "User B" : turn.role);
          
          if (aiRole !== expectedRole) {
            hasRoleMismatch = true;
            console.error(`❌ CRITICAL: Role mismatch at turn ${turnNumber} (index ${i}): AI said "${aiRole}" but expected "${expectedRole}"`);
            console.error(`❌ This means options were generated for wrong user - REJECTING response and retrying`);
            break;
          }
        }
        
        if (!hasRoleMismatch) {
          console.log(`✅ Successfully received exactly 3 turns with correct roles on attempt ${attempt + 1}`);
          break; // Success! Exit retry loop
        } else {
          // Role mismatch detected - retry
          if (attempt === maxRetries) {
            console.error(`❌ Role mismatch persisted after ${maxRetries + 1} attempts - this is a critical error`);
            // Return error response instead of continuing with wrong roles
            return new Response(JSON.stringify({
              error: 'Role mismatch in AI response',
              details: 'AI generated turns with incorrect roles after multiple retries. Options would be shown to wrong users.',
              startingTurnNumber,
              maxRetries: maxRetries + 1
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            console.warn(`⚠️ Role mismatch detected - retrying generation (attempt ${attempt + 1}/${maxRetries + 1})...`);
            attempt++;
            turnsData = null; // Reset to force retry
            continue;
          }
        }
      } else {
        const turnsReceived = turnsData.turns?.length || 0;
        console.warn(`⚠️ Received ${turnsReceived} turns (expected 3) - will retry if attempts remaining`);
        if (attempt === maxRetries) {
          // Last attempt failed - log warning but continue with what we have
          console.warn(`⚠️ Final attempt failed - got ${turnsReceived} turns instead of 3. Processing available turns.`);
          break;
        }
        attempt++;
      }
    }

    // ✅ FIX: Validate response structure - accept 1-3 turns (not just exactly 3)
    // After retries, process whatever we got to avoid user-facing errors
    if (!turnsData || !turnsData.turns || !Array.isArray(turnsData.turns) || turnsData.turns.length === 0) {
      console.error("❌ Invalid response structure: No turns array or empty array:", turnsData);
      return new Response(JSON.stringify({
        error: 'Invalid AI response structure',
        details: 'No turns found in response after retries'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    const turnsReceived = turnsData.turns.length;
    // ✅ CRITICAL: Validate we got exactly 3 turns (except in hint refresh mode)
    // Hint refresh mode can generate 1 turn, but normal batches must be exactly 3
    if (!hintRefreshMode && turnsReceived !== 3) {
      console.error(`❌ CRITICAL: Expected exactly 3 turns, got ${turnsReceived}`);
      return new Response(JSON.stringify({
        error: `Expected exactly 3 turns, got ${turnsReceived}`,
        success: false,
        turnsReceived
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ✅ FIX: Accept 1-3 turns in hint refresh mode, log warning if partial
    if (hintRefreshMode && turnsReceived < 1) {
      console.warn(`⚠️ Partial response in hint refresh mode: Expected at least 1 turn, got ${turnsReceived}`);
    } else if (!hintRefreshMode && turnsReceived < 3) {
      console.warn(`⚠️ Partial response after ${maxRetries + 1} attempts: Expected 3 turns, got ${turnsReceived}. Processing available turns.`);
    }

    // ✅ Helper function to check if text is emoji-only
    const isEmojiOnly = (text: string): boolean => {
      // Check if text is exactly one emoji (no other characters except whitespace)
      const trimmed = text.trim();
      // Unicode emoji regex pattern
      const emojiPattern = /^[\p{Emoji}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+$/u;
      return emojiPattern.test(trimmed) && trimmed.length > 0;
    };

    // ✅ ENHANCED: Helper function to determine if smiley should be enforced for a turn
    const shouldEnforceSmiley = (turnIndex: number, recipientId: string): boolean => {
      // Check if this turn should have a smiley option
      // ✅ IMPORTANT: pending_user_a_smiley means we're waiting for User A to send a smiley (so enforce for User A),
      // and pending_user_b_smiley means we're waiting for User B (so enforce for User B).
      const isTargetUser = finalClosureState?.startsWith('pending_')
        ? (finalClosureState === 'pending_user_a_smiley' && recipientId === userAId) ||
          (finalClosureState === 'pending_user_b_smiley' && recipientId === userBId)
        : (userASmileySent && recipientId === userBId) ||
          (userBSmileySent && recipientId === userAId);
      
      // ✅ ENHANCED: Also enforce if both sides have shared AND mutual understanding detected
      const bothSidesSharedAndUnderstood = bothSidesShared && hasMutualUnderstanding;
      
      // ✅ NEW: Also enforce if closure signals detected (even without full bothSidesShared)
      const closureSignalsDetected = hasClosureSignals && conversationHistory.length >= 4;
      
      // Also enforce if closure is detected (not active/early)
      const closureDetected = finalClosureState && 
        finalClosureState !== 'active' && 
        finalClosureState !== 'early' && 
        !finalClosureState.startsWith('pending_');
      
      // ✅ CRITICAL: Enforce smiley if ANY of these conditions are true
      const shouldEnforce = isTargetUser || closureDetected || bothSidesSharedAndUnderstood || closureSignalsDetected;
      
      if (shouldEnforce) {
        console.log(`😊 SMILEY ENFORCEMENT: Turn ${turnIndex} for ${recipientId === userAId ? 'User A' : 'User B'} - REASON:`, {
          isTargetUser,
          closureDetected,
          bothSidesSharedAndUnderstood,
          closureSignalsDetected,
          finalClosureState,
          conversationLength: conversationHistory.length
        });
      }
      
      return shouldEnforce;
    };

    // ✅ FIX: Insert rows into pregenerated_turns table with correct global turn_number
    // Only insert turns that don't already exist (to avoid gaps and preserve used turns)
    // ✅ CRITICAL: In normal mode, must insert exactly 3 turns
    // ✅ GUARDRAIL: In hint refresh mode, only insert the active turn (i=0)
    const maxTurnsToInsert = hintRefreshMode ? 1 : 3; // Always 3 in normal mode, 1 in hint refresh
    const inserts = [];
    for (let i = 0; i < maxTurnsToInsert && i < turnsReceived; i++) {
      const turn = turnsData.turns[i];
      
      if (!turn || !turn.role || !turn.options || !Array.isArray(turn.options) || turn.options.length === 0) {
        console.error(`❌ Invalid turn ${i}:`, turn);
        continue;
      }

      // ✅ FIX: Accept any number of options (not just exactly 3) - log warning if partial
      if (turn.options.length < 3) {
        console.warn(`⚠️ Turn ${i} has ${turn.options.length} options (expected 3). Processing available options.`);
      }

      // ✅ FIX 2: Calculate role and recipient_id based on firstTurnRole sequence, NOT turn_number parity
      // The sequence is determined by firstTurnRole: firstTurnRole → opposite → firstTurnRole
      // This matches the AI prompt logic and validation logic above
      const turnNumber = startingTurnNumber + i;
      let role: string;
      let recipientId: string;
      
      if (i === 0) {
        // First turn in batch = firstTurnRole
        role = firstTurnRole === "A" ? "User A" : "User B";
        recipientId = firstTurnRole === "A" ? userAId : userBId;
      } else if (i === 1) {
        // Second turn in batch = opposite of firstTurnRole
        role = firstTurnRole === "A" ? "User B" : "User A";
        recipientId = firstTurnRole === "A" ? userBId : userAId;
      } else {
        // Third turn in batch = firstTurnRole again
        role = firstTurnRole === "A" ? "User A" : "User B";
        recipientId = firstTurnRole === "A" ? userAId : userBId;
      }
      
      // ✅ VALIDATION: Role should already be validated in retry loop, but double-check here
      const aiRole = turn.role === "A" ? "User A" : (turn.role === "B" ? "User B" : turn.role);
      if (aiRole !== role) {
        // This should never happen if retry logic worked, but log error if it does
        console.error(`❌ CRITICAL: Role mismatch at turn ${turnNumber} passed retry validation - this should not happen!`);
        console.error(`❌ AI said "${aiRole}" but calculated "${role}" - using calculated role but options may be wrong`);
      }
      
      // ✅ FIX 4: Check if this turn already exists (with or without selected_message)
      // This prevents duplicate turn numbers, especially when batchStartTurn is provided and frontend preserved turns with selected_message
      const existingTurn = existingTurns?.find((t: { turn_number: number }) => t.turn_number === turnNumber);
      if (existingTurn) {
        // Turn already exists - skip insertion to preserve it (especially if it has selected_message)
        console.log(`⏸️ Turn ${turnNumber} already exists - skipping insertion to preserve existing turn`, {
          hasSelectedMessage: !!existingTurn.selected_message,
          recipientId: existingTurn.recipient_id,
          turnNumber: existingTurn.turn_number
        });
        continue;
      }

      // Prepare context_data snapshot
      const turnContextData = {
        finalClosureDetected: turn.finalClosureDetected || false,
        generatedAt: new Date().toISOString(),
        turnIndex: i,
        batchStart: startingTurnNumber,
        partialResponse: turnsReceived < 3 // Track if this was from a partial response
      };

      // ✅ POST-GENERATION ENFORCEMENT: Ensure exactly one emoji-only option when needed
      let finalOptions = [...turn.options]; // Copy options array
      if (shouldEnforceSmiley(i, recipientId)) {
        const emojiCount = finalOptions.filter(opt => isEmojiOnly(opt)).length;
        
        if (emojiCount === 0) {
          // No emoji-only option found - add one
          const emojiPool = ['🙂', '🤝', '❤️', '😊', '🫂', '👍', '😂', '😘', '😍'];
          // Choose emoji based on relationship type (you may need to extract this from context_data)
          const chosenEmoji = emojiPool[Math.floor(Math.random() * emojiPool.length)];
          // Replace the last option with emoji-only
          finalOptions[finalOptions.length - 1] = chosenEmoji;
          console.log(`✅ POST-GEN: Enforced smiley option for turn ${turnNumber} (replaced last option)`);
        } else if (emojiCount > 1) {
          // Too many emoji-only options - keep first, convert others to text
          let emojiFound = false;
          finalOptions = finalOptions.map(opt => {
            if (isEmojiOnly(opt)) {
              if (!emojiFound) {
                emojiFound = true;
                return opt; // Keep first emoji
              } else {
                // Convert additional emojis to text (add context-appropriate text)
                const textVariants = [
                  "Thanks! 😊",
                  "Appreciate it! 🙂",
                  "Got it! 👍"
                ];
                return textVariants[Math.floor(Math.random() * textVariants.length)];
              }
            }
            return opt;
          });
          console.log(`✅ POST-GEN: Reduced smiley count for turn ${turnNumber} (kept 1 emoji-only)`);
        }
        // If emojiCount === 1, we're good - no changes needed
      }

      inserts.push({
        chat_id: chatId,
        turn_number: turnNumber, // ✅ Use global turn_number, not loop index - ensures sequential storage
        recipient_id: recipientId,
        role: role,
        options: finalOptions,
        selected_message: null,
        used_at: null,
        source: null, // ✅ Set to NULL initially - will be set when user selects an option
        context_data: turnContextData
      });
    }

    // ✅ FIX 4: Allow fewer than 3 inserts if some turns already exist (prevents gaps)
    if (inserts.length === 0) {
      console.log('ℹ️ All turns already exist - no insertion needed');
      return new Response(JSON.stringify({
        success: true,
        stored: 0,
        message: 'All turns already exist - preserved existing turns',
        startingTurnNumber,
        existingTurnNumbers
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (inserts.length < 3) {
      console.log(`ℹ️ Only ${inserts.length} turns need to be inserted (${3 - inserts.length} already exist)`);
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

    // ✅ FIX 4: Insert only missing turns (ensures sequential storage without gaps)
    // ✅ CRITICAL: In normal mode, validate we're inserting exactly 3 turns (or fewer if some exist)
    if (!hintRefreshMode && inserts.length > 3) {
      console.error(`❌ CRITICAL: Attempting to insert ${inserts.length} turns, but maximum is 3`);
      return new Response(JSON.stringify({
        error: `Cannot insert more than 3 turns per batch`,
        success: false
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`💾 Inserting ${inserts.length} pre-generated turn(s) (ensuring sequential storage)...`);
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

    if (!insertedData || insertedData.length === 0) {
      console.error("❌ Insert succeeded but no rows returned:", insertedData?.length || 0);
      return new Response(JSON.stringify({
        error: 'Failed to store pre-generated turns',
        details: `Expected at least 1 row, got ${insertedData?.length || 0}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }

    // 🔧 FIX: Validate each expected turn WITH correct recipient_id
    const insertedTurnNumbers = insertedData.map((t: any) => t.turn_number);
    const [t0, t1, t2] = [
      { tn: startingTurnNumber,     rid: firstRecipientId },
      { tn: startingTurnNumber + 1, rid: secondRecipientId },
      { tn: startingTurnNumber + 2, rid: thirdRecipientId }
    ];

    const finalCheckResults = [];

    for (const t of [t0, t1, t2]) {
      const { data: row } = await supabase
        .from('pregenerated_turns')
        .select('turn_number')
        .eq('chat_id', chatId)
        .eq('turn_number', t.tn)
        .eq('recipient_id', t.rid)
        .maybeSingle();

      if (row) finalCheckResults.push(row.turn_number);
    }

    const finalTurnNumbers = finalCheckResults;
    const hasAllTurns = finalTurnNumbers.length === 3;
    
    if (!hasAllTurns) {
      const missing = [t0.tn, t1.tn, t2.tn].filter(tn => !finalTurnNumbers.includes(tn));
      console.warn(`⚠️ Gap detected in turn sequence - missing turn numbers: ${missing.join(', ')}`);
    } else {
      console.log(`✅ All turns stored sequentially: ${finalTurnNumbers.sort((a, b) => a - b).join(', ')}`);
    }

    console.log(`✅ Successfully stored ${insertedData.length} pre-generated turn(s) starting from turn_number ${startingTurnNumber}`);
    console.log('✅ Inserted turn IDs:', insertedData.map((t: any) => ({ id: t.id, turn_number: t.turn_number, recipient_id: t.recipient_id })));

    return new Response(JSON.stringify({
      success: true,
      stored: insertedData.length,
      deferred: false, // Only true when pendingHint && !latestMessageFromA (handled in early return above)
      startingTurnNumber: startingTurnNumber,
      turnNumbers: finalTurnNumbers.sort((a, b) => a - b), // Return all turns in sequence
      insertedTurnNumbers: insertedTurnNumbers
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

