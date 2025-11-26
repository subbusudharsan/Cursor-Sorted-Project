/*
  # Delete User Account Edge Function

  Purpose:
    - Deletes a Supabase auth user account using admin privileges
    - Called after all user data has been deleted from database tables
    - Prevents user from signing in again after account deletion

  Security:
    - Uses service role key for admin operations only
    - No user JWT token required (allows deletion even if user is logged in)
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};

Deno.serve(async (req) => {
  console.log("🔥 delete-user-account invoked");
  console.log("📥 Request method:", req.method);
  console.log("📥 Request URL:", req.url);

  if (req.method === "OPTIONS") {
    console.log("✅ CORS preflight request handled");
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    // Parse request body
    console.log("📥 Parsing request body...");
    let requestBody;
    try {
      requestBody = await req.json();
      console.log("📥 Request body parsed:", JSON.stringify(requestBody));
    } catch (parseError) {
      console.error("❌ Failed to parse request body:", parseError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid request body"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const { userId } = requestBody;
    console.log("📥 Received userId:", userId);

    if (!userId) {
      console.error("❌ Missing userId in request");
      return new Response(
        JSON.stringify({
          success: false,
          error: "User ID is required"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Get the authenticated user from the request
    const authHeader = req.headers.get("Authorization");
    console.log("📥 Authorization header present:", !!authHeader);
    console.log("📥 Authorization header preview:", authHeader ? authHeader.substring(0, 30) + "..." : "MISSING");

    if (!authHeader) {
      console.error("❌ Missing Authorization header");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Authorization header is required"
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Load environment variables
    console.log("🔧 Loading environment variables...");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

    console.log("🔧 SUPABASE_URL present:", !!SUPABASE_URL);
    console.log("🔧 SUPABASE_SERVICE_ROLE_KEY present:", !!SUPABASE_SERVICE_ROLE_KEY);
    console.log("🔧 SUPABASE_ANON_KEY present:", !!SUPABASE_ANON_KEY);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      console.error("❌ Missing Supabase environment variables");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error"
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Extract token from Authorization header (handles "Bearer <token>" format)
    const token = authHeader.startsWith("Bearer ") 
      ? authHeader.substring(7) 
      : authHeader;
    console.log("🔐 Token extracted, length:", token.length);

    try {
      // Create client to validate the user's session
      console.log("🔐 Validating user session with anon client...");
      const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          headers: {
            Authorization: authHeader
          }
        }
      });

      // Verify the user is authenticated and matches the userId
      const { data: { user: authenticatedUser }, error: authError } = await supabaseClient.auth.getUser();

      if (authError || !authenticatedUser) {
        console.error("❌ Authentication failed:", authError);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Authentication failed"
          }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      console.log("✅ User authenticated:", authenticatedUser.id);

      // Security check: User can only delete their own account
      if (authenticatedUser.id !== userId) {
        console.error("❌ User ID mismatch - cannot delete another user's account");
        console.error("❌ Authenticated user ID:", authenticatedUser.id);
        console.error("❌ Requested user ID:", userId);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Unauthorized: You can only delete your own account"
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      console.log("✅ User ID matches authenticated user");

      // Create admin client for deleting the auth user
      console.log("🔧 Creating service role client...");
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });

      // Verify the user exists
      console.log("🔍 Verifying user exists with admin client...");
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

      if (userError || !userData?.user) {
        console.error("❌ User not found or error:", userError);
        return new Response(
          JSON.stringify({
            success: false,
            error: "User not found"
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      console.log("✅ User found:", userData.user.id);

      // Cleanup Supabase internal tables before auth user deletion
      try {
        await supabaseAdmin.from('auth.identities')
          .delete()
          .eq('user_id', userId);
      } catch (e) {
        console.warn("⚠️ Error cleaning auth.identities:", e);
      }

      try {
        await supabaseAdmin.from('auth.refresh_tokens')
          .delete()
          .eq('user_id', userId);
      } catch (e) {
        console.warn("⚠️ Error cleaning auth.refresh_tokens:", e);
      }

      try {
        await supabaseAdmin.from('storage.objects')
          .delete()
          .eq('owner', userId);
      } catch (e) {
        console.warn("⚠️ Error cleaning storage.objects:", e);
      }

      try {
        await supabaseAdmin.from('auth.mfa_factors')
          .delete()
          .eq('user_id', userId);
      } catch (e) {
        console.warn("⚠️ Error cleaning auth.mfa_factors:", e);
      }

      try {
        await supabaseAdmin.from('auth.sessions')
          .delete()
          .eq('user_id', userId);
      } catch (e) {
        console.warn("⚠️ Error cleaning auth.sessions:", e);
      }

      // =====================================================
      // 🧹 FULL INTERNAL AUTH CLEANUP (FINAL)
      // =====================================================
      const internalAuthTables = [
        "auth.identities",
        "auth.refresh_tokens",
        "auth.sessions",
        "auth.mfa_factors",
        "auth.mfa_challenges",
        "auth.flow_state",
        "auth.audit_log_entries",
        "auth.instances",
        "auth.sso_domains",
        "auth.sso_providers",
        "auth.verification_requests",
        "auth.refresh_token_audits"
      ];

      for (const table of internalAuthTables) {
        try {
          console.log(`🧹 Cleaning table: ${table}`);

          const { error } = await supabaseAdmin
            .from(table)
            .delete()
            .eq("user_id", userId);

          if (error) {
            console.warn(`⚠️ Cleanup error in ${table}:`, error.message);
          } else {
            console.log(`✅ Cleaned ${table}`);
          }
        } catch (err) {
          console.warn(`⚠️ Exception cleaning ${table}:`, err);
        }
      }

      // Delete the auth user account using admin API
      console.log("🗑️ Deleting auth user account with admin client...");
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (deleteError) {
        console.error("❌ Failed to delete auth user:", deleteError);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Failed to delete user account: ${deleteError.message}`
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      console.log("✅ Successfully deleted auth user account:", userId);

      return new Response(
        JSON.stringify({
          success: true,
          message: "User account deleted successfully"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    } catch (innerError: any) {
      console.error("❌ Inner error in delete-user-account function:", innerError);
      console.error("❌ Inner error message:", innerError?.message);
      console.error("❌ Inner error stack:", innerError?.stack);
      return new Response(
        JSON.stringify({
          success: false,
          error: innerError?.message || "Internal server error during account deletion"
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
  } catch (error: any) {
    console.error("❌ Error in delete-user-account function:", error);
    console.error("❌ Error message:", error?.message);
    console.error("❌ Error stack:", error?.stack);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || "Internal server error"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});

