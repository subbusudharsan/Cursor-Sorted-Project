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
  console.log('🔍 [PASSWORD-POLICY] Request received:', req.method);
  
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    console.log('❌ [PASSWORD-POLICY] Invalid method:', req.method);
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: PolicyRequest = await req.json();
    console.log('🔍 [PASSWORD-POLICY] Parsed request body:', JSON.stringify(body, null, 2));
    
    const password = body?.password ?? "";
    const actionType = body?.action_type;
    const userId = (body?.user_id ?? "").trim();

    console.log('🔍 [PASSWORD-POLICY] Extracted values:');
    console.log('  - password length:', password.length);
    console.log('  - actionType:', actionType);
    console.log('  - userId:', userId);

    if (!password || !actionType || !userId) {
      console.log('❌ [PASSWORD-POLICY] Missing required fields');
      return new Response(JSON.stringify({ error: "password, action_type, and user_id are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (actionType !== "signup" && actionType !== "password_change") {
      console.log('❌ [PASSWORD-POLICY] Invalid action_type:', actionType);
      return new Response(JSON.stringify({ error: "Invalid action_type." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isValid = PASSWORD_REGEX.test(password);
    console.log('🔍 [PASSWORD-POLICY] Password regex test result:', isValid);
    console.log('🔍 [PASSWORD-POLICY] Password regex pattern:', PASSWORD_REGEX.toString());
    
    const status = isValid ? "success" : "failed";
    const reason = isValid ? null : POLICY_MESSAGE;
    console.log('🔍 [PASSWORD-POLICY] Validation status:', status, 'reason:', reason);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.log('❌ [PASSWORD-POLICY] Missing Supabase environment variables');
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

    // Fire-and-forget insert - never block password validation
    console.log('🔍 [PASSWORD-POLICY] Attempting to insert into password_activity_log...');
    supabase
      .from("password_activity_log")
      .insert({
        user_id: userId,
        action_type: actionType,
        status,
        reason,
      })
      .then(({ error: insertError }) => {
        if (insertError) {
          console.error('❌ [PASSWORD-POLICY] Failed to insert password activity log (non-blocking):', JSON.stringify(insertError, null, 2));
          console.error('❌ [PASSWORD-POLICY] Insert error details:', insertError.message, insertError.code, insertError.details);
        } else {
          console.log('✅ [PASSWORD-POLICY] Successfully inserted password activity log');
        }
      })
      .catch((err) => {
        console.error('❌ [PASSWORD-POLICY] Unexpected error in fire-and-forget insert:', err);
      });
    // Continue execution - don't wait for insert to complete

    if (!isValid) {
      console.log('❌ [PASSWORD-POLICY] Password validation failed, returning 400');
      return new Response(JSON.stringify({ error: POLICY_MESSAGE }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log('✅ [PASSWORD-POLICY] Password validation passed, returning success');
    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("❌ [PASSWORD-POLICY] Unexpected error:", error);
    console.error("❌ [PASSWORD-POLICY] Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    console.error("❌ [PASSWORD-POLICY] Error details:", JSON.stringify(error, null, 2));
    return new Response(JSON.stringify({ error: "Unexpected error validating password." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

