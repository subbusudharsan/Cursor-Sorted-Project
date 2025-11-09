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

type CoachNudgeRequest = {
  userId: string;
};

type CoachNudgePayload = {
  headline: string;
  message: string;
  prompts: string[];
  generated_week: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Supabase service credentials missing" }, 500);
    }
    if (!CLAUDE_API_KEY) {
      return jsonResponse({ error: "Claude API key missing" }, 500);
    }

    const { userId }: CoachNudgeRequest = await req.json();
    if (!userId) {
      return jsonResponse({ error: "userId is required" }, 400);
    }

    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();
    const weekStart = getWeekStart(now);

    // Check if we already generated a nudge for this week
    const { data: existingNudge, error: existingError } = await client
      .from("soul_coach_nudges")
      .select("headline, message, prompts, generated_week")
      .eq("user_id", userId)
      .eq("generated_week", weekStart.toISOString().slice(0, 10))
      .maybeSingle();

    if (existingError) {
      console.error("Failed to fetch existing nudge", existingError);
    } else if (existingNudge) {
      return jsonResponse(existingNudge);
    }

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: entries, error: entriesError } = await client
      .from("soulroom_entries")
      .select("content, ai_summary, emotion_tag, mood, tags, created_at")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: false });

    if (entriesError) {
      console.error("Unable to fetch entries for nudge", entriesError);
      return jsonResponse({ error: "Unable to gather reflections" }, 500);
    }

    const { data: chats, error: chatsError } = await client
      .from("chats")
      .select("contact_id, context_data, last_message_at, is_resolved, closure_state")
      .eq("user_id", userId)
      .gte("last_message_at", sevenDaysAgo.toISOString())
      .order("last_message_at", { ascending: false })
      .limit(12);

    if (chatsError) {
      console.error("Unable to fetch chat history for nudge", chatsError);
    }

    const narrative = composeNarrative(entries ?? [], chats ?? []);
    const claudeResult = await callClaude(narrative);

    const payload: CoachNudgePayload = {
      headline: claudeResult.headline,
      message: claudeResult.message,
      prompts: claudeResult.prompts,
      generated_week: weekStart.toISOString().slice(0, 10),
    };

    const { error: upsertError } = await client
      .from("soul_coach_nudges")
      .upsert(
        {
          user_id: userId,
          headline: payload.headline,
          message: payload.message,
          prompts: payload.prompts,
          generated_week: payload.generated_week,
        },
        { onConflict: "user_id,generated_week" },
      );

    if (upsertError) {
      console.error("Failed to store coach nudge", upsertError);
    }

    return jsonResponse(payload);
  } catch (error) {
    console.error("generate-coach-nudge error", error);
    return jsonResponse({ error: "Unable to generate coach nudge" }, 500);
  }
});

function getWeekStart(date: Date): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = result.getUTCDay(); // 0 (Sun) - 6 (Sat)
  const diff = weekday === 0 ? -6 : 1 - weekday; // Monday as start of week
  result.setUTCDate(result.getUTCDate() + diff);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function composeNarrative(entries: any[], chats: any[]) {
  if (!entries.length && !chats.length) {
    return "No reflections or chats captured this week.";
  }

  const moodCounts = new Map<string, number>();
  const contactTagCounts = new Map<string, number>();

  const entryLines = entries.slice(0, 12).map((entry: any) => {
    const moods: string[] = [];
    if (entry.mood) moods.push(entry.mood);
    if (entry.emotion_tag) moods.push(entry.emotion_tag);
    moods.forEach((mood) => {
      const key = mood.toLowerCase();
      moodCounts.set(key, (moodCounts.get(key) ?? 0) + 1);
    });

    (entry.tags || []).forEach((tag: string) => {
      if (tag.startsWith("contact:")) {
        contactTagCounts.set(tag, (contactTagCounts.get(tag) ?? 0) + 1);
      }
    });

    const summary = entry.ai_summary || entry.content?.slice(0, 200) || "";
    const createdAt = entry.created_at ? new Date(entry.created_at).toISOString().slice(0, 10) : "recently";
    return `• ${createdAt} — ${summary}`;
  });

  const chatLines = chats
    .map((chat: any) => {
      const contactTag = chat.context_data?.tags?.find?.((tag: string) => tag.startsWith("contact:"));
      if (contactTag) {
        contactTagCounts.set(contactTag, (contactTagCounts.get(contactTag) ?? 0) + 1);
      }
      const stage = chat.closure_state || (chat.is_resolved ? "resolved" : "ongoing");
      const lastMessage = chat.last_message_at ? new Date(chat.last_message_at).toISOString().slice(0, 10) : "recently";
      return `• Chat (${stage}) last updated ${lastMessage}`;
    })
    .slice(0, 6);

  const dominantMood = Array.from(moodCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "reflective";
  const frequentContactTag = Array.from(contactTagCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return [
    `Dominant mood this week: ${dominantMood}.`,
    frequentContactTag ? `Most frequent contact tag: ${frequentContactTag}.` : "",
    entryLines.length ? "Reflections:\n" + entryLines.join("\n") : "No reflections logged.",
    chatLines.length ? "Chats:\n" + chatLines.join("\n") : "No chats logged.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function callClaude(narrative: string): Promise<{ headline: string; message: string; prompts: string[] }> {
  const prompt = buildCoachPrompt(narrative);
  const payload = {
    model: "claude-3-haiku-20240307",
    max_tokens: 350,
    temperature: 0.4,
    system: "You are a compassionate emotional wellness companion who sends gentle, encouraging nudges.",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Claude coach error", text);
    return {
      headline: "Let's keep caring for you",
      message: "Take a moment to notice how you've been feeling. A short reflection can help you stay steady.",
      prompts: ["Reflect on something that helped you feel supported.", "Write about one way you took care of yourself."],
    };
  }

  const json = await response.json();
  return parseCoachResponse(json?.content?.[0]?.text ?? "");
}

function buildCoachPrompt(narrative: string) {
  return `You will receive mood highlights from the last seven days of an emotional wellness app user.
Craft a gentle, encouraging weekly nudge that:
- Opens with a short, empathetic headline (max 12 words).
- Summarizes what you're noticing in a caring sentence or two.
- Provides **exactly two** journaling prompts the user can try next. Keep prompts short (under 14 words each).

Return ONLY valid JSON in this shape:
{
  "headline": "string",
  "message": "string",
  "prompts": ["string", "string"]
}

Here is the weekly summary:
"""${narrative}"""`;
}

function parseCoachResponse(raw: string): { headline: string; message: string; prompts: string[] } {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        headline: sanitizeString(parsed.headline, "Weekly reflection moment"),
        message: sanitizeString(parsed.message, "Take a breath and jot down what shifted for you this week."),
        prompts: Array.isArray(parsed.prompts) && parsed.prompts.length
          ? parsed.prompts
              .map((prompt: unknown) => sanitizeString(prompt, "Write about one thing you appreciated today."))
              .slice(0, 2)
          : ["Write about something you appreciated today.", "Notice how you feel after journaling."],
      };
    }
  } catch (error) {
    console.warn("Failed to parse coach response", error);
  }

  return {
    headline: "Weekly reflection moment",
    message: "Take a breath and jot down what shifted for you this week.",
    prompts: ["Write about something you appreciated today.", "Notice how you feel after journaling."],
  };
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\s+/g, " ");
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
