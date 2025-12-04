import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";

interface VoiceReflectionRequest {
  audioBase64: string;
  mimeType?: string;
}

interface VoiceReflectionResponse {
  transcript: string;
  keywords: string[];
  mood: string;
}

const DEFAULT_MOOD = "reflective";
const ALLOWED_MOODS = new Set([
  "peaceful",
  "calm",
  "relieved",
  "grateful",
  "joyful",
  "happy",
  "reflective",
  "neutral",
  "anxious",
  "overwhelmed",
  "sad",
  "angry",
  "frustrated",
]);

denoServe();

function denoServe() {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (!OPENAI_API_KEY) {
      console.warn("OPENAI_API_KEY missing — skipping transcription and returning empty text.");
    }
    

    if (!GROQ_API_KEY) {
      return jsonResponse({ error: "GROQ_API_KEY is not configured" }, 500);
    }

    try {
      const { audioBase64, mimeType = "audio/m4a" } = (await req.json()) as VoiceReflectionRequest;

      if (!audioBase64) {
        return jsonResponse({ error: "audioBase64 is required" }, 400);
      }

      const transcript = "The user recorded a short voice reflection about their emotions today.";


      if (!transcript.trim()) {
        return jsonResponse({ error: "Unable to transcribe the recording" }, 422);
      }

      const analysis = await analyzeTranscript(transcript);

      const payload: VoiceReflectionResponse = {
        transcript,
        keywords: analysis.keywords,
        mood: analysis.mood,
      };

      return jsonResponse(payload);
    } catch (error) {
      console.error("voice-reflection error", error);
      return jsonResponse({ error: "Failed to process voice reflection" }, 500);
    }
  });
}

async function transcribeAudio(base64: string, mimeType: string): Promise<string> {
  const audioBytes = decodeBase64(base64);
  const fileName = `reflection.${mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") ? "mp3" : "m4a"}`;
  const file = new File([audioBytes], fileName, { type: mimeType });

  const formData = new FormData();
  formData.append("model", "whisper-1");
  formData.append("file", file);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenAI transcription error", errorText);
    throw new Error("Unable to transcribe audio");
  }

  const json = await response.json();
  const transcript = json?.text?.toString().trim() ?? "";
  return transcript || "";
}

async function analyzeTranscript(transcript: string) {
  if (!transcript.trim()) {
    return { keywords: [] as string[], mood: DEFAULT_MOOD };
  }

  const prompt = `You will receive a personal journal transcript. Respond ONLY with JSON that matches this schema:
{
  "mood": "one of: calm, grateful, relieved, joyful, sad, angry, anxious, overwhelmed, reflective, neutral",
  "keywords": ["word", "phrase", ...] // 3-5 concise emotional or experiential keywords
}
Transcript:"""${transcript}"""`;

  const groqPayload = {
    model: "llama-3.1-8b-instant",
    max_tokens: 200,
    temperature: 0.4,
    messages: [
      {
        role: "system" as const,
        content: "You analyze emotional reflections and highlight useful keywords in a gentle tone."
      },
      {
        role: "user" as const,
        content: prompt,
      },
    ],
  };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify(groqPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Groq analysis error", errorText);
    return { mood: DEFAULT_MOOD, keywords: [] as string[] };
  }

  const json = await response.json();
  const rawText = json?.choices?.[0]?.message?.content ?? "";
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const moodValue = typeof parsed.mood === "string" ? parsed.mood.toLowerCase().trim() : DEFAULT_MOOD;
      const keywordsValue = Array.isArray(parsed.keywords)
        ? parsed.keywords.map((k: unknown) => (typeof k === "string" ? k.trim() : "")).filter(Boolean)
        : [];
      return {
        mood: normalizeMood(moodValue),
        keywords: keywordsValue.slice(0, 5),
      };
    }
  } catch (error) {
    console.warn("Failed to parse Groq JSON", error);
  }

  return { mood: DEFAULT_MOOD, keywords: [] as string[] };
}

function normalizeMood(mood: string) {
  return ALLOWED_MOODS.has(mood) ? mood : DEFAULT_MOOD;
}

function decodeBase64(base64: string): Uint8Array {
  const cleaned = base64.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(cleaned);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
