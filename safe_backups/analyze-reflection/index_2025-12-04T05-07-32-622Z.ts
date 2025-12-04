import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

const EMOTION_TAGS = [
  "calm",
  "grateful",
  "relieved",
  "joyful",
  "sad",
  "angry",
  "anxious",
  "overwhelmed",
  "reflective",
  "neutral",
];

type AnalyzeRequest = {
  entryId: string;
  userId: string;
  text: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!GROQ_API_KEY) {
      return jsonResponse({ error: "Groq API key not configured" }, 500);
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Supabase service role key not configured" }, 500);
    }

    const { entryId, userId, text } = (await req.json()) as AnalyzeRequest;

    if (!entryId || !userId || !text?.trim()) {
      return jsonResponse({ error: "entryId, userId and reflection text are required" }, 400);
    }

    const prompt = buildPrompt(text.trim());

    const groqPayload = {
      model: "llama-3.1-8b-instant",
      max_tokens: 400,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "You analyze journal reflections and provide gentle, empathetic insights."
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify(groqPayload),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error("Groq API error", errorText);
      return jsonResponse({ error: "Unable to analyze reflection" }, 500);
    }

    const groqJson = await groqResponse.json();
    const rawText = groqJson?.choices?.[0]?.message?.content ?? "";

    const { summary, emotion } = parseGroqResponse(rawText, text.trim());

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: updateError } = await supabaseClient
      .from('soulroom_entries')
      .update({ ai_summary: summary, emotion_tag: emotion })
      .eq('id', entryId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('Failed to update soulroom entry:', updateError);
      return jsonResponse({ error: 'Failed to update reflection with AI summary' }, 500);
    }

    return jsonResponse({ ai_summary: summary, emotion_tag: emotion });
  } catch (error) {
    console.error('analyze-reflection error', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

function buildPrompt(text: string) {
  return `You will receive a private reflection entry. Respond ONLY with JSON matching this schema:
{
  "summary": "a gentle 2-3 sentence synthesis of their reflection. Mention themes, emotions, or patterns.",
  "emotion": "one of: calm, grateful, relieved, joyful, sad, angry, anxious, overwhelmed, reflective, neutral"
}
Reflection:"""${text}"""`;
}

function parseClaudeResponse(raw: string, fallbackText: string) {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const summary = (parsed.summary || '').toString().trim();
      const emotion = (parsed.emotion || '').toString().trim().toLowerCase();
      return {
        summary: summary || fallbackText.slice(0, 240),
        emotion: EMOTION_TAGS.includes(emotion) ? emotion : 'neutral',
      };
    }
  } catch (error) {
    console.warn('Failed to parse Claude response', error);
  }
  return { summary: fallbackText.slice(0, 240), emotion: 'neutral' };
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}
