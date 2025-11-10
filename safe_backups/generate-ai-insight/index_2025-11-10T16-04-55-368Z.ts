// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase environment variables.");
}

if (!CLAUDE_API_KEY) {
  console.warn("⚠️ CLAUDE_API_KEY missing. AI insight generation will return a fallback insight.");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type InsightRequest = {
  userId: string;
};

type ReflectionSummary = {
  title: string | null;
  content: string;
  mood: string | null;
  created_at: string;
};

type ChatSummary = {
  title: string | null;
  last_message: string | null;
  last_message_at: string | null;
  chat_type: string;
};

const fetchFromSupabase = async (path: string, options?: RequestInit) => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...options?.headers,
      },
    });
  
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase request failed: ${response.status} ${text}`);
    }
  
    // ✅ Handle empty 201/204 responses safely
    const text = await response.text();
    if (!text) return {}; // no content returned
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  

const buildPrompt = (reflections: ReflectionSummary[], chats: ChatSummary[]) => {
  const reflectionSnippets = reflections
    .map((reflection) => {
      const date = new Date(reflection.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      return `- (${date}) Mood: ${reflection.mood ?? "unspecified"} | ${reflection.title ?? "Untitled"} → ${reflection.content.slice(0, 200)}`;
    })
    .join("\n");

  const chatSnippets = chats
    .map((chat) => {
      const label = chat.chat_type === "ai_assistant" ? "AI prep" : "Contact chat";
      const timestamp = chat.last_message_at
        ? new Date(chat.last_message_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "recently";
      return `- (${label} · ${timestamp}) ${chat.title ?? "Conversation"} → ${chat.last_message?.slice(0, 160) ?? "No recent message"}`;
    })
    .join("\n");

  return `
You are an empathetic reflection coach who writes a single weekly insight for the user.

Use the recent reflections and conversations below to identify one meaningful pattern that can help the user communicate with more care. Celebrate progress and offer one gentle nudge. Keep it specific to their patterns.

### Reflections
${reflectionSnippets || "- (No reflections recorded this week)"}

### Conversations
${chatSnippets || "- (No conversations logged this week)"}

Respond with a JSON object with the following structure:
{
  "headline": "Short phrase capturing the theme",
  "insight": "2-3 sentences: celebrate + gentle recommendation"
}

Tone: warm, encouraging, grounded. Do not use numbered lists. Avoid generic advice.
  `.trim();
};

const callClaude = async (prompt: string) => {
  if (!CLAUDE_API_KEY) {
    return {
      headline: "Keep listening inward",
      insight:
        "I’m still syncing with your week. In the meantime, keep trusting the tone that feels calm and honest—your reflections are already guiding you.",
    };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 300,
      temperature: 0.3,
      system: "You generate one thoughtful weekly insight for a journaling companion app.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Claude request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.content?.[0]?.text ?? "";
  try {
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
      return {
        headline: parsed.headline ?? "Keep reflecting",
        insight: parsed.insight ?? content,
      };
    }
  } catch (_error) {
    // Fall through to default
  }
  return {
    headline: "Keep reflecting",
    insight: content || "Take a moment to breathe and notice what tone feels kindest to you today.",
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as InsightRequest;
    if (!body?.userId) {
      return new Response(JSON.stringify({ error: "userId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reflections = (await fetchFromSupabase(
      `soulroom_entries?user_id=eq.${body.userId}&select=title,content,mood,created_at&order=created_at.desc&limit=12`,
    )) as ReflectionSummary[];

    const chats = (await fetchFromSupabase(
      `chats?user_id=eq.${body.userId}&select=title,last_message,last_message_at,chat_type&order=last_message_at.desc&limit=12`,
    )) as ChatSummary[];

    const prompt = buildPrompt(reflections, chats);
    const insight = await callClaude(prompt);

    await fetchFromSupabase("soul_ai_insights", {
        method: "POST",
        body: JSON.stringify({
          user_id: body.userId,
          headline: insight.headline ?? "Keep reflecting",
          insight: insight.insight ?? "Take a moment to breathe and notice what tone feels kindest to you today.",
          reflections_count: reflections?.length ?? 0,
          chats_count: chats?.length ?? 0,
          metadata: {
            reflections_sampled: reflections?.map((r) => r.created_at) ?? [],
            chats_sampled: chats?.map((c) => c.last_message_at) ?? [],
          },
        }),
      });
      

    return new Response(
      JSON.stringify({
        headline: insight.headline,
        insight: insight.insight,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("AI insight generation failed:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to generate AI insight",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

