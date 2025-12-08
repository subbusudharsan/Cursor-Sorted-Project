// Supabase Invite User (Real Email Sending)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    const { email } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), {
        status: 400,
        headers: corsHeaders
      });
    }

    // Create Supabase Admin client (service role)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ❤️ REAL invite email is sent here using your SMTP + template
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);

    if (error) {
      console.error("Invite error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({ error: "Unexpected server error" }), {
      status: 500,
      headers: corsHeaders
    });
  }
});
