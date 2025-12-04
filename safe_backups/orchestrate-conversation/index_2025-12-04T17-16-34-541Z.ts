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
*/ 

// NOTE: This orchestration service uses Groq Llama 3.1 8B Instant.
//       The system is designed to provide intelligent conversation guidance
//       and emotional intelligence analysis for natural human communication.


import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    if (!GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY not configured");
    }
    const buildServiceHeaders = (extra: Record<string, string> = {}) => {
      const headers = new Headers(extra);
      if (SUPABASE_SERVICE_ROLE_KEY) {
        headers.set("apikey", SUPABASE_SERVICE_ROLE_KEY);
        headers.set("Authorization", `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);
      }
      return headers;
    };
    const request = await req.json();
    const { chatId, recipientId, currentUserId, currentMessage = "", conversationHistory = [], summary = "", thoughts = "", summaryB = "", thoughtsB = "", hintFromB = "", contactCategory = "General", isInitial = false } = request;

    console.log("📊 ORCHESTRATION INPUT:", {
      chatId,
      recipientId,
      messageCount: conversationHistory.length,
      hasHint: !!hintFromB,
      category: contactCategory,
      isInitial
    });
    // ========================================
    // STEP 1: Fetch Previous Orchestration State (for context only)
    // ========================================
    let orchestrationState = null;
    const { data: existingOrch } = await fetch(`${SUPABASE_URL}/rest/v1/conversation_orchestration?chat_id=eq.${chatId}&order=created_at.desc&limit=1`, {
      headers: buildServiceHeaders()
    }).then((r)=>r.json());
    orchestrationState = existingOrch?.[0] || null;
    console.log("🔍 Previous orchestration state:", {
      found: !!orchestrationState,
      previousIntent: orchestrationState?.current_emotion_intent
    });
    // ========================================
    // 🧠 STEP 1.5: Lightweight Pre-Analysis with analyze-conversation-state
    // ========================================
    let preSentiment = "unknown";
    let preEmotionIntent = "none";
    let preLayer = "neutral";

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
          hasHint: !!hintFromB,
          contactCategory
        })
      });
      const preData = await preAnalysisResponse.json();
      if (preData?.analysis) {
        console.log("✅ PRE-ANALYSIS RESULTS:", preData.analysis);
        preSentiment = preData.analysis.sentiment;
        preEmotionIntent = preData.analysis.suggestedEmotionIntent;
        preLayer = preData.analysis.suggestedEmotionalLayer;
      }
    } catch (err) {
      console.error("⚠️ PRE-ANALYSIS ERROR:", err);
    }
    // ========================================
    // STEP 2: Analyze Current Conversation State (Simplified)
    // ========================================
    const analysisPrompt = `
  You are an advanced AI model with strong reasoning capabilities. Use clear, structured analysis to help guide natural, human communication.

    You are an emotional intelligence expert analyzing a conversation to help guide natural, human communication.

Pre-analysis hints (lightweight guidance)
- Sentiment: ${preSentiment}
- Suggested Intent: ${preEmotionIntent}
- Suggested Layer: ${preLayer}

Conversation Context:
- Category: ${contactCategory}
- Current message: "${currentMessage}"
- Summary (User A): ${summary || "N/A"}
- Thoughts (User A): ${thoughts || "N/A"}
- Summary (User B): ${summaryB || "N/A"}
- Thoughts (User B): ${thoughtsB || "N/A"}
- Hint from B: "${hintFromB || "N/A"}"
- Previous emotion intent: ${orchestrationState?.current_emotion_intent || "none"}

Recent conversation (last 5 messages):
${conversationHistory.slice(-5).map((m: any)=>`${m.sender_id === recipientId ? 'Recipient' : 'Other'}: ${m.content}`).join("\n")}

${hintFromB ? `
CRITICAL: User B has provided their private perspective: "${hintFromB}"
This reveals User B's true feelings and needs. Use this to:
1. Help User B express themselves fairly
2. Guide both sides toward mutual understanding
3. Balance both perspectives without revealing the private hint
` : ''}

Analyze the conversation naturally:
1. Current emotional tone (positive/neutral/negative/mixed)
2. Appropriate emotion intent that fits the moment naturally
3. Emotional layer: warm_empathic, direct_balanced, vulnerable_healing, tense_honest, or reflective_growth
4. Closure readiness (0.0 to 1.0) - Based on natural signals like gratitude, forgiveness, understanding
${hintFromB ? '5. How User B\'s hint should shape their response options' : ''}

Respond ONLY with valid JSON:
{
  "sentiment": "positive|neutral|negative|mixed",
  "emotionIntent": "natural emotion intent",
  "emotionalLayer": "one of the 5 layers",
  "closureReadiness": 0.0 to 1.0,
  "reasoning": "brief natural explanation"${hintFromB ? ',\n  "hintIntegrationGuidance": "how to use User B\'s perspective naturally"' : ''}
}`;
    console.log("🤖 Calling Groq for conversation analysis...");
    const analysisResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 200,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: "You are an emotional intelligence expert. Analyze conversations and respond only with valid JSON."
          },
          {
            role: "user",
            content: analysisPrompt
          }
        ]
      })
    });
    if (!analysisResponse.ok) {
      throw new Error(`Groq analysis failed: ${analysisResponse.status}`);
    }
    const analysisResult = await analysisResponse.json();
    const analysisText = analysisResult.choices[0].message.content.trim();
    // Extract JSON from response
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from Groq response");
    }
    const analysis = JSON.parse(jsonMatch[0]);
    console.log("✅ Conversation analysis completed:", {
      sentiment: analysis.sentiment,
      emotionIntent: analysis.emotionIntent,
      closureReadiness: analysis.closureReadiness
    });

    // ========================================
    // STEP 2.5: Natural Closure Detection
    // ========================================
    // Check if peer sent a smiley (natural closure signal)
    const lastMsg = conversationHistory.slice(-1)[0];
    const peerSentSmiley = lastMsg && /🙂|😊|❤️|🤝|👍/.test(lastMsg.content);

    if (peerSentSmiley) {
      console.log("🤝 Peer sent closure smiley - conversation naturally closing");
      analysis.closureReadiness = Math.max(analysis.closureReadiness, 0.9);
    }

    // Optionally check deeper closure signals if conversation is long enough
    if (conversationHistory.length >= 6) {
      try {
        const closureResponse = await fetch(`${SUPABASE_URL}/functions/v1/evaluate-closure-readiness`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({
            chatId,
            recentMessages: conversationHistory.slice(-6).map((m: any)=>m.content),
            recipientId
          })
        });
        const closureData = await closureResponse.json();
        console.log("🌈 Closure evaluation:", closureData);

        // Use the higher of the two closure scores
        if (closureData.closureReadiness > analysis.closureReadiness) {
          analysis.closureReadiness = closureData.closureReadiness;
        }
      } catch (err) {
        console.error("⚠️ Closure evaluation error (non-critical):", err);
      }
    }
    // ========================================
    // STEP 3: Determine Natural Orchestration Instructions
    // ========================================
    const layerKey = (analysis.emotionalLayer || "warm_empathic") as keyof typeof EMOTIONAL_LAYERS;
    const orchestrationInstructions = {
      tone: analysis.emotionalLayer === "warm_empathic" ? "warm, gentle, supportive" : analysis.emotionalLayer === "direct_balanced" ? "clear, honest, composed" : analysis.emotionalLayer === "vulnerable_healing" ? "soft, emotional, sincere" : analysis.emotionalLayer === "tense_honest" ? "authentic, slightly strained" : "peaceful, mature, introspective",
      focusAreas: [
        hintFromB ? "incorporate User B's perspective naturally" : "stay true to the conversation",
        "maintain each person's perspective",
        "allow natural emotional flow"
      ],
      avoidTopics: [
        "scheduling or external coordination",
        "aggressive or dismissive language",
        "drifting off-topic"
      ],
      hintIntegrationStrategy: hintFromB ? "Use hint to guide User B's responses naturally" : "N/A"
    };
    // ========================================
    // STEP 4: Log Agent Decision (Simplified)
    // ========================================
    await fetch(`${SUPABASE_URL}/rest/v1/agent_decisions`, {
      method: "POST",
      headers: buildServiceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({
        chat_id: chatId,
        decision_type: "orchestration",
        agent_name: "orchestrator",
        input_data: {
          messageCount: conversationHistory.length,
          currentMessage: currentMessage?.substring(0, 100),
          hasHint: !!hintFromB
        },
        reasoning_steps: [
          `Analyzed conversation with ${contactCategory} relationship`,
          `Emotion intent: ${analysis.emotionIntent}`,
          `Closure readiness: ${analysis.closureReadiness.toFixed(2)}`,
          `${hintFromB ? 'User B hint will be integrated' : 'No hint provided'}`
        ],
        decision_output: {
          emotionIntent: analysis.emotionIntent,
          emotionalLayer: EMOTIONAL_LAYERS[layerKey],
          closureApproaching: analysis.closureReadiness >= 0.7
        },
        confidence_score: analysis.closureReadiness,
        execution_time_ms: Date.now() - startTime,
        success: true
      })
    });
    // ========================================
    // STEP 5: Update Orchestration State (Simplified)
    // ========================================
    const orchestrationData = {
      chat_id: chatId,
      user_id: currentUserId,
      current_emotion_intent: analysis.emotionIntent,
      current_emotional_layer: EMOTIONAL_LAYERS[layerKey],
      reasoning: analysis.reasoning,
      confidence_score: analysis.closureReadiness,
      detected_sentiment: analysis.sentiment,
      hint_integration_status: hintFromB ? "active" : "none",
      relationship_context: {
        category: contactCategory
      },
      closure_readiness_score: analysis.closureReadiness
    };
    await fetch(`${SUPABASE_URL}/rest/v1/conversation_orchestration`, {
      method: "POST",
      headers: buildServiceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(orchestrationData)
    });
    // ========================================
    // STEP 6: Record Emotion Intent History (Simplified)
    // ========================================
    await fetch(`${SUPABASE_URL}/rest/v1/emotion_intent_history`, {
      method: "POST",
      headers: buildServiceHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({
        chat_id: chatId,
        speaker_id: recipientId,
        emotion_intent: analysis.emotionIntent,
        emotional_layer: EMOTIONAL_LAYERS[layerKey],
        message_content: currentMessage?.substring(0, 500),
        intent_confidence: analysis.closureReadiness,
        transition_from: orchestrationState?.current_emotion_intent || "initial",
        transition_quality: "natural",
        hint_present: !!hintFromB,
        hint_text: hintFromB?.substring(0, 200)
      })
    });
    const executionTime = Date.now() - startTime;
    console.log("✅ ORCHESTRATION COMPLETE:", {
      emotionIntent: analysis.emotionIntent,
      closureReadiness: analysis.closureReadiness.toFixed(2),
      executionTime: `${executionTime}ms`
    });
    const result = {
      success: true,
      emotionIntent: analysis.emotionIntent,
      emotionalLayer: EMOTIONAL_LAYERS[layerKey],
      orchestrationInstructions,
      closureReadiness: analysis.closureReadiness,
      reasoning: analysis.reasoning,
      hintIntegrationGuidance: analysis.hintIntegrationGuidance || null,
      hasUserBHint: !!hintFromB
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
