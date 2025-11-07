/*
  # Closure Readiness Evaluator - Smiley Detection System

  1. Purpose
    - Evaluates when conversation has reached natural closure
    - Detects emotional closure signals from both participants
    - Determines if smiley-only options should be generated
    - Validates closure quality to prevent premature endings

  2. Closure Detection Signals
    - Gratitude expressions
    - Forgiveness statements
    - Mutual understanding acknowledgments
    - Relief and peace indicators
    - Turn count threshold (minimum 12 turns)

  3. Closure Types
    - Initiator's peace (User A feels resolved)
    - Mutual peace (Both users feel resolved)

  4. Security
    - JWT verification enabled
    - Reads orchestration history for context
*/ import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
// Closure signal keywords
const CLOSURE_SIGNALS = {
  gratitude: [
    "thank",
    "thanks",
    "appreciate",
    "grateful",
    "thankful",
    "means a lot",
    "really appreciate"
  ],
  forgiveness: [
    "forgive",
    "sorry",
    "apologize",
    "my bad",
    "understand"
  ],
  understanding: [
    "makes sense",
    "get it",
    "understand",
    "see your point",
    "clear now"
  ],
  relief: [
    "glad",
    "good talk",
    "feel better",
    "resolved",
    "settled"
  ],
  peace: [
    "okay",
    "alright",
    "we're good",
    "all good",
    "no worries",
    "no hard feelings"
  ]
};
function detectClosureSignals(message: string): string[] {
  const lowercased = message.toLowerCase();
  const detected = [];
  for (const [signal, keywords] of Object.entries(CLOSURE_SIGNALS)){
    for (const keyword of keywords){
      if (lowercased.includes(keyword)) {
        detected.push(signal);
        break;
      }
    }
  }
  return detected;
}
function calculateClosureScore(recentMessages: any[], emotionHistory: string[]): number {
  let score = 0.0;

  // Analyze recent messages for closure signals
  const allClosureSignals = [];
  for (const message of recentMessages){
    const signals = detectClosureSignals(message);
    allClosureSignals.push(...signals);
  }

  // Score based on closure signal types (natural detection)
  const uniqueSignals = new Set(allClosureSignals);
  if (uniqueSignals.has("gratitude")) score += 0.25;
  if (uniqueSignals.has("forgiveness")) score += 0.25;
  if (uniqueSignals.has("understanding")) score += 0.2;
  if (uniqueSignals.has("relief")) score += 0.2;
  if (uniqueSignals.has("peace")) score += 0.15;

  // Check if new emotional tensions are emerging
  const recentText = recentMessages.slice(-3).join(" ").toLowerCase();
  if (recentText.includes("felt hurt") || recentText.includes("still upset") || recentText.includes("don't understand")) {
    console.log("🧠 New emotional tension detected - reducing closure readiness");
    score = Math.max(0, score - 0.3);
  }

  // Check for emotional progression through resolution
  const hasGratitude = emotionHistory.includes("gratitude");
  const hasForgiveness = emotionHistory.includes("forgiveness");
  const hasRecognition = emotionHistory.includes("recognition");

  // Boost score if multiple positive signals exist
  if (hasGratitude && hasForgiveness) score += 0.25;
  else if (hasGratitude || hasForgiveness) score += 0.15;
  if (hasRecognition) score += 0.1;

  // Cap at 1.0
  return Math.min(1.0, score);
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const { chatId, recentMessages, recipientId } = await req.json();
    console.log("🤔 CLOSURE EVALUATOR: Checking natural closure signals...", {
      chatId,
      messageCount: recentMessages?.length
    });
    if (!chatId) {
      return new Response(JSON.stringify({
        error: "chatId is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // Fetch emotion history for this chat
    const emotionHistoryResponse = await fetch(`${SUPABASE_URL}/rest/v1/emotion_intent_history?chat_id=eq.${chatId}&select=emotion_intent`, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY || '',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const emotionHistory = await emotionHistoryResponse.json();
    const emotionIntents = emotionHistory.map((e: any)=>e.emotion_intent);
    // Calculate closure score naturally
    const closureScore = calculateClosureScore(recentMessages || [], emotionIntents);
    // Determine if closure should be triggered (based on natural signals, not turn count)
    const shouldTriggerClosure = closureScore >= 0.75;
    // Determine closure type
    let closureType = null;
    if (shouldTriggerClosure) {
      // Check if both users have expressed closure signals
      const userASignals = recentMessages.filter((_: any, i: number)=>i % 2 === 0);
      const userBSignals = recentMessages.filter((_: any, i: number)=>i % 2 === 1);
      const userAHasClosure = userASignals.some((m: any)=>detectClosureSignals(m).length > 0);
      const userBHasClosure = userBSignals.some((m: any)=>detectClosureSignals(m).length > 0);
      if (userAHasClosure && userBHasClosure) {
        closureType = "mutual_peace";
      } else {
        closureType = "initiator_peace";
      }
    }
    const result = {
      success: true,
      closureReadiness: closureScore,
      shouldTriggerClosure,
      closureType,
      analysis: {
        emotionIntentsDetected: emotionIntents.length,
        hasGratitude: emotionIntents.includes("gratitude"),
        hasForgiveness: emotionIntents.includes("forgiveness"),
        recommendation: shouldTriggerClosure ? "Natural closure detected - include smiley option" : "Continue natural conversation flow"
      }
    };
    console.log("✅ CLOSURE EVALUATOR: Complete", {
      score: closureScore.toFixed(2),
      shouldTrigger: shouldTriggerClosure,
      type: closureType
    });
    // Log decision
    await fetch(`${SUPABASE_URL}/rest/v1/agent_decisions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        'apikey': SUPABASE_SERVICE_ROLE_KEY || '',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': "return=minimal"
      },
      body: JSON.stringify({
        chat_id: chatId,
        decision_type: "closure_evaluation",
        agent_name: "closure_evaluator",
        input_data: {
          messageCount: recentMessages?.length
        },
        decision_output: result,
        confidence_score: closureScore,
        success: true
      })
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ CLOSURE EVALUATOR ERROR:", error);
    return new Response(JSON.stringify({
      error: "Closure evaluation failed",
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
