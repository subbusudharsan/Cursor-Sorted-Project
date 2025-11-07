/*
  # Agentic AI Orchestrator - Conversation Intelligence Brain

  1. Purpose
    - Acts as the intelligent coordinator for all conversation AI operations
    - Plans multi-turn conversation trajectories (3-5 turns ahead)
    - Detects and assigns emotion intents from 16-stage framework
    - Coordinates between option generation, validation, and closure detection
    - Learns from patterns and adapts to relationship dynamics

  2. Orchestration Flow
    - Analyze current conversation state (emotion, hints, turn count)
    - Predict optimal trajectory for next 3-5 turns
    - Assign emotion intent and emotional layer for current turn
    - Coordinate with worker functions (generator, validator, analyzer)
    - Track decisions and update orchestration state
    - Detect closure readiness and trigger smiley-only options

  3. Security
    - JWT verification enabled
    - Uses Supabase service role for database operations
    - Logs all decisions for audit and learning
*/ import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
// 16-stage emotion intent framework from image
// Replace your current const EMOTION_INTENTS = [ ...16 labels... ]
// With this flexible version:
const EMOTION_INTENT_SETS = {
  Family: [
    "gentle opening",
    "hesitant acknowledgment",
    "forgiveness",
    "gratitude",
    "vulnerable explanation",
    "emotional closure (initiator’s peace)",
    "mutual closure (receiver’s peace)"
  ],
  Friend: [
    "guarded curiosity",
    "recognition",
    "soft vulnerability",
    "light humor bridge",
    "gentle honesty",
    "reassurance",
    "gratitude",
    "closure"
  ],
  Work: [
    "initiates calmly",
    "seeks understanding",
    "ownership",
    "assertive boundary",
    "moving forward",
    "professional closure"
  ],
  General: [
    "gentle opening",
    "recognition",
    "reflection",
    "peace statement"
  ]
};
const EMOTIONAL_LAYERS = {
  warm_empathic: "💖 gentle, caring, understanding tone",
  direct_balanced: "💬 clear but kind tone",
  vulnerable_healing: "🌧 open-hearted, emotional tone",
  tense_honest: "🔥 raw but respectful tone",
  reflective_growth: "🌿 calm, self-aware tone"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    console.log("🧠 ORCHESTRATOR: Starting agentic orchestration...");
    const startTime = Date.now();
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY");
    if (!CLAUDE_API_KEY) {
      throw new Error("CLAUDE_API_KEY not configured");
    }
    const request = await req.json();
    const { chatId, recipientId, currentUserId, currentMessage = "", conversationHistory = [], summary = "", thoughts = "", summaryB = "", thoughtsB = "", hintFromB = "", contactCategory = "General", isInitial = false } = request;
    // Determine if this is the initial outreach turn
    const turnCount = conversationHistory.length;
    const initialPhase = turnCount === 0 || isInitial === true;
    console.log("🟢 Phase check:", {
      turnCount,
      initialPhase
    });
    console.log("📊 ORCHESTRATION INPUT:", {
      chatId,
      recipientId,
      turnCount: conversationHistory.length,
      hasHint: !!hintFromB,
      category: contactCategory,
      isInitial
    });
    // ========================================
    // STEP 1: Fetch or Create Orchestration State
    // ========================================
    let orchestrationState = null;
    const turnNumber = conversationHistory.length;
    const { data: existingOrch } = await fetch(`${SUPABASE_URL}/rest/v1/conversation_orchestration?chat_id=eq.${chatId}&order=turn_number.desc&limit=1`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    }).then((r)=>r.json());
    orchestrationState = existingOrch?.[0] || null;
    console.log("🔍 Previous orchestration state:", {
      found: !!orchestrationState,
      previousPhase: orchestrationState?.current_phase,
      previousIntent: orchestrationState?.current_emotion_intent
    });
    // ========================================
    // 🧠 STEP 1.5: Lightweight Pre-Analysis with analyze-conversation-state
    // ========================================
    try {
      console.log("🔎 PRE-ANALYSIS: Calling analyze-conversation-state...");
      const preAnalysisResponse = await fetch(`${SUPABASE_URL}/functions/v1/analyze-conversation-state`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          message: currentMessage || "",
          turnCount: conversationHistory.length,
          hasHint: !!hintFromB,
          contactCategory
        })
      });
      const preData = await preAnalysisResponse.json();
      if (preData?.analysis) {
        console.log("✅ PRE-ANALYSIS RESULTS:", preData.analysis);
        // Store pre-analysis data for orchestrator use
        var preSentiment = preData.analysis.sentiment;
        var preEmotionIntent = preData.analysis.suggestedEmotionIntent;
        var preLayer = preData.analysis.suggestedEmotionalLayer;
      }
    } catch (err) {
      console.error("⚠️ PRE-ANALYSIS ERROR:", err);
    }
    const openingHint = initialPhase ? "This seems to be the very first message after reflection — respond with warm, simple, re-connection tone (e.g., 'Hey, how are you?', 'I felt hurt at the party...')." : "Continue naturally from prior emotional context.";
    // ========================================
    // STEP 2: Analyze Current Conversation State
    // ========================================
    const analysisPrompt = `You are an emotional intelligence expert analyzing a conversation turn.
Use this pre-analysis context as hints (not final truth):

Pre-analysis insights:
- Sentiment: ${preSentiment || "unknown"}
- Suggested Intent: ${preEmotionIntent || "none"}
- Suggested Layer: ${preLayer || "neutral"}

Conversation Context:
- Phase: ${initialPhase ? "initial" : "ongoing"}
- Guidance: ${openingHint}
- Turn: ${turnNumber}
- Category: ${contactCategory}
- Current message: "${currentMessage}"
- Summary (User A): ${summary || "N/A"}
- Thoughts (User A): ${thoughts || "N/A"}
- Summary (User B): ${summaryB || "N/A"}
- Thoughts (User B): ${thoughtsB || "N/A"}
- Hint from B: "${hintFromB || "N/A"}"
- Previous emotion intent: ${orchestrationState?.current_emotion_intent || "none"}

Recent conversation (last 5 messages):
${conversationHistory.slice(-5).map((m)=>`${m.sender_type}: ${m.content}`).join("\n")}

Based on this context, analyze:
1. Current emotional state (positive/neutral/negative/mixed)
2. Detected emotion intent from these options: ${EMOTION_INTENT_SETS[contactCategory]?.join(", ") || EMOTION_INTENT_SETS.General.join(", ")}
3. Appropriate emotional layer: warm_empathic, direct_balanced, vulnerable_healing, tense_honest, or reflective_growth
4. Closure readiness (0.0 to 1.0) - Look for gratitude, forgiveness, mutual understanding
5. Next 3 optimal emotion intents for progression

Respond ONLY with valid JSON:
{
  "sentiment": "positive|neutral|negative|mixed",
  "emotionIntent": "one of the 16 intents",
  "emotionalLayer": "one of the 5 layers",
  "closureReadiness": 0.0 to 1.0,
  "plannedTrajectory": ["intent1", "intent2", "intent3"],
  "reasoning": "brief explanation"
}`;
    console.log("🤖 Calling Claude for conversation analysis...");
    const analysisResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 512,
        temperature: 0.3,
        system: "You are an emotional intelligence expert. Analyze conversations and respond only with valid JSON.",
        messages: [
          {
            role: "user",
            content: analysisPrompt
          }
        ]
      })
    });
    if (!analysisResponse.ok) {
      throw new Error(`Claude analysis failed: ${analysisResponse.status}`);
    }
    const analysisResult = await analysisResponse.json();
    const analysisText = analysisResult.content[0].text.trim();
    // Extract JSON from response
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from Claude response");
    }
    const analysis = JSON.parse(jsonMatch[0]);
    console.log("✅ Conversation analysis completed:", {
      sentiment: analysis.sentiment,
      emotionIntent: analysis.emotionIntent,
      closureReadiness: analysis.closureReadiness
    });
    // ========================================
    // 🧘 STEP 2.5: Periodic Closure Evaluation
    // ========================================
    if (turnNumber % 3 === 0 && conversationHistory.length >= 6) {
      console.log("🔄 Triggering evaluate-closure-readiness for deeper check...");
      try {
        const closureResponse = await fetch(`${SUPABASE_URL}/functions/v1/evaluate-closure-readiness`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({
            chatId,
            turnCount: turnNumber,
            recentMessages: conversationHistory.slice(-6).map((m)=>m.content),
            recipientId
          })
        });
        const closureData = await closureResponse.json();
        console.log("🌈 Closure readiness check:", closureData);
        if (closureData.shouldTriggerClosure && closureData.closureReadiness >= 0.85) {
          console.log("✅ Closure detected — updating chat state...");
          // Mark chat resolved
          await fetch(`${SUPABASE_URL}/rest/v1/chats?id=eq.${chatId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              Prefer: "return=minimal"
            },
            body: JSON.stringify({
              is_resolved: true,
              closure_type: closureData.closureType,
              closure_readiness: closureData.closureReadiness
            })
          });
          // Set flag for downstream functions
          analysis.closureReadiness = closureData.closureReadiness;
          analysis.shouldGenerateSmiley = true;
        } else {
          analysis.shouldGenerateSmiley = false;
        }
      } catch (err) {
        console.error("⚠️ Closure readiness evaluator error:", err);
      }
    }
    // 👀 NEW: detect if the peer just sent a smiley → force closure
    const lastMsg = conversationHistory.slice(-1)[0];
    const peerSentSmiley = lastMsg && /🙂|😊|❤️|🤝/.test(lastMsg.content);
    if (peerSentSmiley) {
      console.log("🤝 Peer sent smiley — forcing closure readiness");
      analysis.closureReadiness = 1.0;
    }
    // ========================================
    // STEP 3: Determine Orchestration Instructions
    // ========================================
    // closure readiness can trigger anytime after sufficient emotional flow
    const shouldGenerateSmiley = peerSentSmiley || analysis.closureReadiness >= 0.85 && turnNumber >= 6;
    const orchestrationInstructions = {
      tone: analysis.emotionalLayer === "warm_empathic" ? "warm, gentle, supportive" : analysis.emotionalLayer === "direct_balanced" ? "clear, honest, composed" : analysis.emotionalLayer === "vulnerable_healing" ? "soft, emotional, sincere" : analysis.emotionalLayer === "tense_honest" ? "authentic, slightly strained" : "peaceful, mature, introspective",
      focusAreas: [
        hintFromB ? "integrate hint naturally" : "explore feelings",
        "maintain original issue context",
        "show emotional progression"
      ],
      avoidTopics: [
        "unrelated small talk",
        "aggressive language",
        "dismissive responses"
      ],
      hintIntegrationStrategy: hintFromB ? "Weave the hint sensitively without directly quoting it" : "N/A"
    };
    // ========================================
    // STEP 4: Log Agent Decision
    // ========================================
    await fetch(`${SUPABASE_URL}/rest/v1/agent_decisions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        chat_id: chatId,
        turn_number: turnNumber,
        decision_type: "orchestration",
        agent_name: "orchestrator",
        input_data: {
          turnNumber,
          currentMessage: currentMessage?.substring(0, 100),
          hasHint: !!hintFromB
        },
        reasoning_steps: [
          `Analyzed turn ${turnNumber} with ${contactCategory} relationship`,
          `Detected emotion intent: ${analysis.emotionIntent}`,
          `Closure readiness: ${analysis.closureReadiness}`,
          `Planned trajectory: ${analysis.plannedTrajectory.join(" → ")}`
        ],
        decision_output: {
          emotionIntent: analysis.emotionIntent,
          emotionalLayer: EMOTIONAL_LAYERS[analysis.emotionalLayer],
          shouldGenerateSmiley
        },
        confidence_score: analysis.closureReadiness,
        execution_time_ms: Date.now() - startTime,
        success: true
      })
    });
    // ========================================
    // STEP 5: Update Orchestration State
    // ========================================
    // Determine initiator (first message sender)
    const initiatorId = conversationHistory.length > 0 ? conversationHistory[0].sender_id : currentUserId;
    const orchestrationData = {
      chat_id: chatId,
      user_id: currentUserId,
      current_phase: shouldGenerateSmiley ? "closure" : analysis.closureReadiness < 0.3 ? "opening" : analysis.closureReadiness < 0.7 ? "discussion" : "resolution",
      current_emotion_intent: analysis.emotionIntent,
      current_emotional_layer: EMOTIONAL_LAYERS[analysis.emotionalLayer],
      turn_number: turnNumber,
      planned_trajectory: analysis.plannedTrajectory,
      reasoning: analysis.reasoning,
      confidence_score: analysis.closureReadiness,
      detected_sentiment: analysis.sentiment,
      hint_integration_status: hintFromB ? "detected" : "none",
      relationship_context: {
        category: contactCategory
      },
      closure_readiness_score: analysis.closureReadiness,
      closure_detected: shouldGenerateSmiley,
      closure_type: shouldGenerateSmiley ? currentUserId === initiatorId ? "initiator_peace" : "mutual_peace" : null
    };
    await fetch(`${SUPABASE_URL}/rest/v1/conversation_orchestration`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify(orchestrationData)
    });
    // ========================================
    // STEP 6: Record Emotion Intent History
    // ========================================
    await fetch(`${SUPABASE_URL}/rest/v1/emotion_intent_history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        chat_id: chatId,
        turn_number: turnNumber,
        speaker_id: recipientId,
        emotion_intent: analysis.emotionIntent,
        emotional_layer: EMOTIONAL_LAYERS[analysis.emotionalLayer],
        message_content: currentMessage?.substring(0, 500),
        intent_confidence: analysis.closureReadiness,
        transition_from: orchestrationState?.current_emotion_intent || "initial",
        transition_quality: "smooth",
        hint_present: !!hintFromB,
        hint_text: hintFromB?.substring(0, 200)
      })
    });
    const executionTime = Date.now() - startTime;
    console.log("✅ ORCHESTRATION COMPLETE:", {
      emotionIntent: analysis.emotionIntent,
      closureReadiness: analysis.closureReadiness,
      shouldGenerateSmiley,
      executionTime: `${executionTime}ms`
    });
    const result = {
      success: true,
      emotionIntent: analysis.emotionIntent,
      emotionalLayer: EMOTIONAL_LAYERS[analysis.emotionalLayer],
      plannedTrajectory: analysis.plannedTrajectory,
      orchestrationInstructions,
      closureReadiness: analysis.closureReadiness,
      shouldGenerateSmiley,
      reasoning: analysis.reasoning,
      isInitial: initialPhase // ✅ added
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ ORCHESTRATOR ERROR:", error);
    return new Response(JSON.stringify({
      error: "Orchestration failed",
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
