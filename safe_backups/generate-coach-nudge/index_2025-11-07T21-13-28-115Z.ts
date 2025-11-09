import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type CoachNudgeRequest = {
  userId: string;
  force?: boolean;
};

type CoachNudgeResponse = {
  headline: string;
  message: string;
  prompts: string[];
  generated_week: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Supabase service configuration missing" }, 500);
  }

  if (!CLAUDE_API_KEY) {
    return jsonResponse({ error: "Claude API key missing" }, 500);
  }

  try {
    const { userId, force = false } = (await req.json()) as CoachNudgeRequest;

    if (!userId) {
      return jsonResponse({ error: "userId is required" }, 400);
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { weekStartIso, sevenDaysAgoIso, thirtyDaysAgoIso } = buildDates();

    if (!force) {
      const { data: cached } = await supabaseClient
        .from("soul_coach_nudges")
        .select("headline, message, prompts, generated_week")
        .eq("user_id", userId)
        .eq("generated_week", weekStartIso)
        .maybeSingle();

      if (cached) {
        return jsonResponse(cached as CoachNudgeResponse);
      }
    }

    const [entriesResult, chatsResult] = await Promise.all([
      supabaseClient
        .from("soulroom_entries")
        .select("content, ai_summary, mood, emotion_tag, tags, created_at")
        .eq("user_id", userId)
        .gte("created_at", sevenDaysAgoIso)
        .order("created_at", { ascending: false }),
      supabaseClient
        .from("chats")
        .select("id, contact_id, last_message, conversation_phase, is_resolved, context_data, updated_at")
        .eq("user_id", userId)
        .gte("updated_at", thirtyDaysAgoIso)
        .order("updated_at", { ascending: false })
        .limit(30),
    ]);

    if (entriesResult.error) throw entriesResult.error;
    if (chatsResult.error) throw chatsResult.error;

    const entries = entriesResult.data ?? [];
    const chats = chatsResult.data ?? [];

    const claudePayload = buildClaudePayload(entries, chats, weekStartIso);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(claudePayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Claude nudge error", errorText);
      return jsonResponse({ error: "Unable to generate nudge" }, 500);
    }

    const json = await response.json();
    const rawText = json?.content?.[0]?.text ?? "";
    const parsed = parseClaudeJson(rawText);

    const payload: CoachNudgeResponse = {
      headline: parsed.headline,
      message: parsed.message,
      prompts: parsed.prompts,
      generated_week: weekStartIso,
    };

    await supabaseClient.from("soul_coach_nudges").upsert({
      user_id: userId,
      headline: payload.headline,
      message: payload.message,
      prompts: payload.prompts,
      generated_week: weekStartIso,
    });

    return jsonResponse(payload);
  } catch (error) {
    console.error("generate-coach-nudge error", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

function buildDates() {
  const now = new Date();
  const weekStart = new Date(now);
  const day = weekStart.getUTCDay();
  const diffToMonday = (day + 6) % 7; // Monday = 0
  weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
  weekStart.setUTCHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

  return { weekStartIso, sevenDaysAgoIso, thirtyDaysAgoIso };
}

function buildClaudePayload(entries: any[], chats: any[], weekStartIso: string) {
  const entrySummaries = entries
    .map((entry) => {
      const created = entry.created_at;
      const mood = entry.emotion_tag || entry.mood || "unspecified";
      const tags = Array.isArray(entry.tags) ? entry.tags.filter((t: string) => t.startsWith("contact:")) : [];
      const short = (entry.ai_summary || entry.content || "").replace(/\s+/g, " ").slice(0, 180);
      return `- ${created}: mood=${mood}; contacts=${tags.join(",") || "none"}; note="${short}"`;
    })
    .join("\n");

  const chatSummaries = chats
    .map((chat) => {
      const phase = chat.conversation_phase || "unknown";
      const resolved = chat.is_resolved ? "resolved" : "open";
      const hint = chat?.context_data?.hint_to_contact?.issue || chat?.context_data?.summary_a || "";
      return `- updated ${chat.updated_at}: ${resolved} (${phase}) topic: ${hint}`;
    })
    .join("\n");

  const context = `Weekly journal data:
${entrySummaries || "(no new entries)"}

Recent conversations:
${chatSummaries || "(no recent chats)"}`;

  const instructions = `You are an emotional wellness coach. Review the user's journal reflections and AI chat trends.
Generate supportive nudges that build on genuine progress.
Return ONLY JSON with this schema:
{
  "headline": "short celebratory title",
  "message": "2-3 sentences encouraging insight, referencing trends",
  "prompts": ["gentle journaling prompt", "another gentle prompt"]
}
Keep tone warm, encouraging, never preachy. Mention helpful habits if evident. No markdown.`;

  return {
    model: "claude-3-haiku-20240307",
    max_tokens: 280,
    temperature: 0.3,
    system: instructions,
    messages: [
      {
        role: "user" as const,
        content: `${context}\n\nWeek of ${weekStartIso}`,
      },
    ],
  };
}

function parseClaudeJson(raw: string) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "Steady progress";
      const message = typeof parsed.message === "string" ? parsed.message.trim() : "Keep reflecting with kindness.";
      const prompts = Array.isArray(parsed.prompts)
        ? parsed.prompts.map((p: unknown) => (typeof p === "string" ? p.trim() : "")).filter(Boolean)
        : [];
      return { headline, message, prompts };
    }
  } catch (error) {
    console.warn("Failed to parse Claude nudge JSON", error);
  }
  return {
    headline: "Keep listening to yourself",
    message: "Your reflections this week show real care. Take a moment to honor that progress.",
    prompts: ["What helped you feel most grounded this week?"],
  };
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
