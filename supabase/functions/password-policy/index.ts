import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const POLICY_MESSAGE = "Weak password. Please follow password policy.";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase environment variables for password policy function.");
}

type PolicyRequest = {
  password: string;
  action_type: "signup" | "password_change";
  user_id: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: PolicyRequest = await req.json();
    const password = body?.password ?? "";
    const actionType = body?.action_type;
    const userId = (body?.user_id ?? "").trim();

    if (!password || !actionType || !userId) {
      return new Response(JSON.stringify({ error: "password, action_type, and user_id are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (actionType !== "signup" && actionType !== "password_change") {
      return new Response(JSON.stringify({ error: "Invalid action_type." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isValid = PASSWORD_REGEX.test(password);
    const status = isValid ? "success" : "failed";
    const reason = isValid ? null : POLICY_MESSAGE;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Supabase env vars not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
      },
    });

    const { error: insertError } = await supabase
      .from("password_activity_log")
      .insert({
        user_id: userId,
        action_type: actionType,
        status,
        reason,
      });

    if (insertError) {
      console.error("Failed to insert password activity log:", insertError);
      return new Response(JSON.stringify({ error: "Unable to record password activity." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isValid) {
      return new Response(JSON.stringify({ error: POLICY_MESSAGE }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Password policy function error:", error);
    return new Response(JSON.stringify({ error: "Unexpected error validating password." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

