/*
  # Conversation State Analyzer - Real-time Emotion Detection

  1. Purpose
    - Provides fast emotion intent detection for real-time feedback
    - Analyzes message sentiment and emotional state
    - Suggests optimal emotional layer for current conversation phase
    - Works as a lightweight helper for orchestrator

  2. Analysis Features
    - Emotion keyword detection
    - Sentiment scoring
    - Hint presence detection
    - Turn-based progression tracking
    - Relationship-aware analysis

  3. Security
    - JWT verification enabled
    - Read-only analysis operations
*/ import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
// Emotion detection keywords
const EMOTION_KEYWORDS = {
  gratitude: [
    "thank",
    "appreciate",
    "grateful",
    "glad"
  ],
  forgiveness: [
    "sorry",
    "apologize",
    "forgive",
    "understand"
  ],
  vulnerability: [
    "hurt",
    "upset",
    "sad",
    "lonely",
    "scared"
  ],
  recognition: [
    "see",
    "realize",
    "notice",
    "get it"
  ],
  ownership: [
    "my fault",
    "i was wrong",
    "overreacted",
    "shouldn't have"
  ],
  curiosity: [
    "why",
    "what",
    "how",
    "when",
    "tell me"
  ],
  reassurance: [
    "okay",
    "fine",
    "alright",
    "it's cool"
  ]
};
function detectEmotionKeywords(message) {
  const lowercased = message.toLowerCase();
  const detected = [];
  // Detect emotional hint phrases
  const hintIndicators = [
    "felt",
    "ignored",
    "unheard",
    "unnoticed",
    "left out",
    "alone"
  ];
  const hasHintPhrase = hintIndicators.some((h)=>lowercased.includes(h));
  if (hasHintPhrase && !detected.includes("vulnerability")) {
    detected.push("vulnerability"); // Treat hint phrases as vulnerability
  }
  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)){
    for (const keyword of keywords){
      if (lowercased.includes(keyword)) {
        detected.push(emotion);
        break;
      }
    }
  }
  return detected;
}
function calculateSentimentScore(message) {
  const lowercased = message.toLowerCase();
  // Positive indicators
  const positiveWords = [
    "thank",
    "great",
    "good",
    "happy",
    "glad",
    "appreciate",
    "love"
  ];
  const positiveCount = positiveWords.filter((w)=>lowercased.includes(w)).length;
  // Negative indicators
  const negativeWords = [
    "hurt",
    "sad",
    "angry",
    "upset",
    "disappointed",
    "frustrated"
  ];
  const negativeCount = negativeWords.filter((w)=>lowercased.includes(w)).length;
  // Score from -1.0 to 1.0
  const totalWords = message.split(/\s+/).length;
  const score = (positiveCount - negativeCount) / Math.max(totalWords / 10, 1);
  return Math.max(-1.0, Math.min(1.0, score));
}
function suggestEmotionalLayer(sentimentScore, hasHint) {
  // Natural layer detection based on content, not turns
  if (hasHint && sentimentScore <= 0) {
    return "🌧 Vulnerable-Healing"; // hint indicates deeper feelings
  }
  if (sentimentScore < -0.3) {
    return "🔥 Tense-Honest"; // tension detected
  }
  if (sentimentScore > 0.5) {
    return "🌿 Reflective-Growth"; // positive resolution emerging
  }
  if (sentimentScore > 0.2) {
    return "💖 Warm-Empathic"; // warm and positive
  }
  return "💬 Direct-Balanced"; // neutral, balanced communication
}

function suggestEmotionIntent(emotionKeywords, hasHint) {
  // Natural intent detection based on emotional content
  if (emotionKeywords.includes("gratitude") && emotionKeywords.includes("forgiveness")) {
    return "mutual closure";
  }
  if (emotionKeywords.includes("gratitude")) {
    return "gratitude";
  }
  if (emotionKeywords.includes("forgiveness")) {
    return "forgiveness";
  }
  if (emotionKeywords.includes("recognition")) {
    return "recognition";
  }
  if (emotionKeywords.includes("ownership")) {
    return "ownership";
  }
  if (hasHint && emotionKeywords.includes("vulnerability")) {
    return "reveals root hurt privately";
  }
  if (emotionKeywords.includes("vulnerability")) {
    return "soft vulnerability";
  }
  if (emotionKeywords.includes("curiosity")) {
    return "seeks understanding";
  }
  if (emotionKeywords.includes("reassurance")) {
    return "reassurance";
  }
  // Default based on early vs ongoing
  return "gentle honesty";
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const { message, hasHint, contactCategory } = await req.json();
    console.log("🔍 ANALYZER: Analyzing message naturally...", {
      messageLength: message?.length,
      hasHint,
      category: contactCategory
    });
    if (!message) {
      return new Response(JSON.stringify({
        error: "Message is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // --- Natural emotion analysis ---
    const emotionKeywords = detectEmotionKeywords(message);
    const sentimentScore = calculateSentimentScore(message);
    const suggestedLayer = suggestEmotionalLayer(sentimentScore, hasHint);
    const suggestedIntent = suggestEmotionIntent(emotionKeywords, hasHint);
    // --- NEW: lightweight Claude reasoning to confirm pattern ---
    let claudeIntent = suggestedIntent;
    let claudeLayer = suggestedLayer;
    try {
      const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY");
      if (CLAUDE_API_KEY) {
        const reasoningPrompt = `
You are an emotional intelligence coach analyzing natural conversation flow.
Analyze the human tone of this message and identify its emotional intent.

Message: "${message}"
Detected keywords: ${emotionKeywords.join(", ") || "none"}
Relationship: ${contactCategory}
Hint present: ${hasHint}

Emotion intents: gentle opening, seeks understanding, vulnerability, recognition, forgiveness, gratitude, closure
Layers: 💖 warm_empathic, 💬 direct_balanced, 🌧 vulnerable_healing, 🔥 tense_honest, 🌿 reflective_growth

Answer only JSON:
{"intent": "...", "layer": "...", "reason": "..."}
`;
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": CLAUDE_API_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 150,
            temperature: 0.3,
            messages: [
              {
                role: "user",
                content: reasoningPrompt
              }
            ]
          })
        });
        if (response.ok) {
          const data = await response.json();
          const text = data.content[0].text.trim();
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            claudeIntent = parsed.intent || suggestedIntent;
            claudeLayer = parsed.layer || suggestedLayer;
            console.log("🧩 Claude refined intent:", claudeIntent, "layer:", claudeLayer);
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Claude reasoning skipped:", err);
    }
    const result = {
      success: true,
      analysis: {
        emotionKeywords,
        sentimentScore,
        sentiment: sentimentScore > 0.2 ? "positive" : sentimentScore < -0.2 ? "negative" : "neutral",
        suggestedEmotionalLayer: suggestedLayer,
        suggestedEmotionIntent: suggestedIntent,
        hasVulnerability: emotionKeywords.includes("vulnerability"),
        hasGratitude: emotionKeywords.includes("gratitude"),
        hasForgiveness: emotionKeywords.includes("forgiveness")
      }
    };
    console.log("✅ ANALYZER: Analysis complete", result.analysis);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ ANALYZER ERROR:", error);
    return new Response(JSON.stringify({
      error: "Analysis failed",
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
