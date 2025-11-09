import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") ?? "";

interface CoachNudgeRequest {
  userId: string;
  force?: boolean;
}

interface CoachNudgeResponse {
  headline: string;
  message: string;
  prompts: string[];
  generated_week: string;
  fallback?: boolean;
}

const FALLBACK_NUDGE: CoachNudgeResponse = {
  headline: "Keep showing up for yourself",
  message:
    "It looks like data is still syncing, but your habit of checking in matters. Take a slow breath and notice what felt steady this week.",
  prompts: [
    "Write down one small choice that helped you feel grounded.",
    "Who can you thank (including yourself) for support this week?",
  ],
  generated_week: new Date().toISOString().slice(0, 10),
  fallback: true,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(FALLBACK_NUDGE, 200);
  }

  if (!CLAUDE_API_KEY) {
    return jsonResponse(FALLBACK_NUDGE, 200);
  }

  try {
    const { userId, force = false } = (await req.json()) as CoachNudgeRequest;

    if (!userId) {
      return jsonResponse({ ...FALLBACK_NUDGE, message: "We need a user id to create a nudge." }, 200);
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { weekStartIso, sevenDaysAgoIso, thirtyDaysAgoIso } = buildDates();

    if (!force) {
      const { data: cached } = await supabaseClient
        .from("soul_coach_nudges")
        .select("headline, message, prompts, generated_week, fallback")
        .eq("user_id", userId)
        .eq("generated_week", weekStartIso)
        .maybeSingle();

      if (cached) {
        return jsonResponse(cached as CoachNudgeResponse, 200);
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

    const entries = entriesResult.error ? [] : entriesResult.data ?? [];
    const chats = chatsResult.error ? [] : chatsResult.data ?? [];

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
      console.warn("Claude nudge error", await response.text());
      return respondWithFallback(supabaseClient, userId, weekStartIso);
    }

    const json = await response.json();
    const rawText = json?.content?.[0]?.text ?? "";
    const parsed = parseClaudeJson(rawText);

    const payload: CoachNudgeResponse = {
      headline: parsed.headline,
      message: parsed.message,
      prompts: parsed.prompts,
      generated_week: weekStartIso,
      fallback: false,
    };

    await supabaseClient.from("soul_coach_nudges").upsert({
      user_id: userId,
      headline: payload.headline,
      message: payload.message,
      prompts: payload.prompts,
      generated_week: payload.generated_week,
      fallback: false,
    });

    return jsonResponse(payload, 200);
  } catch (error) {
    console.error("generate-coach-nudge error", error);
    try {
      const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { weekStartIso } = buildDates();
      return await respondWithFallback(supabaseClient, (await req.json())?.userId ?? "", weekStartIso);
    } catch {
      return jsonResponse(FALLBACK_NUDGE, 200);
    }
  }
});

async function respondWithFallback(client: ReturnType<typeof createClient>, userId: string, weekStartIso: string) {
  const fallback = { ...FALLBACK_NUDGE, generated_week: weekStartIso, fallback: true };
  if (userId) {
    await client.from("soul_coach_nudges").upsert({
      user_id: userId,
      headline: fallback.headline,
      message: fallback.message,
      prompts: fallback.prompts,
      generated_week: fallback.generated_week,
      fallback: true,
    });
  }
  return jsonResponse(fallback, 200);
}

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
      const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : FALLBACK_NUDGE.headline;
      const message = typeof parsed.message === "string" ? parsed.message.trim() : FALLBACK_NUDGE.message;
      const prompts = Array.isArray(parsed.prompts)
        ? parsed.prompts.map((p: unknown) => (typeof p === "string" ? p.trim() : "")).filter(Boolean)
        : FALLBACK_NUDGE.prompts;
      return { headline, message, prompts };
    }
  } catch (error) {
    console.warn("Failed to parse Claude nudge JSON", error);
  }
  return {
    headline: FALLBACK_NUDGE.headline,
    message: FALLBACK_NUDGE.message,
    prompts: FALLBACK_NUDGE.prompts,
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
