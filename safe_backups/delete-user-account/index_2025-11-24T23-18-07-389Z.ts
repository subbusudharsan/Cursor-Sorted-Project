// @ts-ignore
export const config = {
  runtime: "edge",
  regions: ["*"],
  auth: false,
  verify_jwt: false,
};



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

    // Load environment variables
    console.log("🔧 Loading environment variables...");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("🔧 SUPABASE_URL present:", !!SUPABASE_URL);
    console.log("🔧 SUPABASE_SERVICE_ROLE_KEY present:", !!SUPABASE_SERVICE_ROLE_KEY);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
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

    try {
      // Create admin client for deleting the auth user (service role only, no user token)
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
      // Note: auth schema tables may not be accessible via PostgREST .from() method
      // We verify deletions succeeded before attempting deleteUser
      console.log("🧹 Cleaning auth.identities...");
      const { error: identitiesError, count: identitiesCount } = await supabaseAdmin
        .from('auth.identities')
        .delete({ count: 'exact' })
        .eq('user_id', userId);
      if (identitiesError) {
        console.warn("⚠️ Error cleaning auth.identities:", identitiesError);
        console.warn("⚠️ This may cause deleteUser to fail - auth.identities rows may still exist");
      } else {
        console.log(`✅ Cleaned auth.identities (${identitiesCount || 0} rows)`);
      }

      console.log("🧹 Cleaning auth.refresh_tokens...");
      const { error: refreshTokensError, count: refreshTokensCount } = await supabaseAdmin
        .from('auth.refresh_tokens')
        .delete({ count: 'exact' })
        .eq('user_id', userId);
      if (refreshTokensError) {
        console.warn("⚠️ Error cleaning auth.refresh_tokens:", refreshTokensError);
        console.warn("⚠️ This may cause deleteUser to fail - auth.refresh_tokens rows may still exist");
      } else {
        console.log(`✅ Cleaned auth.refresh_tokens (${refreshTokensCount || 0} rows)`);
      }

      console.log("🧹 Cleaning storage.objects...");
      const { error: storageError } = await supabaseAdmin
        .from('storage.objects')
        .delete()
        .eq('owner', userId);
      if (storageError) {
        console.warn("⚠️ Error cleaning storage.objects:", storageError);
      } else {
        console.log("✅ Cleaned storage.objects");
      }

      console.log("🧹 Cleaning auth.mfa_factors...");
      const { error: mfaFactorsError, count: mfaFactorsCount } = await supabaseAdmin
        .from('auth.mfa_factors')
        .delete({ count: 'exact' })
        .eq('user_id', userId);
      if (mfaFactorsError) {
        console.warn("⚠️ Error cleaning auth.mfa_factors:", mfaFactorsError);
      } else {
        console.log(`✅ Cleaned auth.mfa_factors (${mfaFactorsCount || 0} rows)`);
      }

      console.log("🧹 Cleaning auth.sessions...");
      const { error: sessionsError, count: sessionsCount } = await supabaseAdmin
        .from('auth.sessions')
        .delete({ count: 'exact' })
        .eq('user_id', userId);
      if (sessionsError) {
        console.warn("⚠️ Error cleaning auth.sessions:", sessionsError);
        console.warn("⚠️ This may cause deleteUser to fail - auth.sessions rows may still exist");
      } else {
        console.log(`✅ Cleaned auth.sessions (${sessionsCount || 0} rows)`);
      }

      // Critical: Verify no rows remain in auth.identities before deleteUser
      // This is the most common cause of "Database error deleting user"
      console.log("🔍 Verifying auth.identities is empty...");
      const { count: remainingCount, error: checkError } = await supabaseAdmin
        .from('auth.identities')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      
      if (checkError) {
        console.warn("⚠️ Could not verify auth.identities cleanup:", checkError);
        console.warn("⚠️ Proceeding with deleteUser - may fail if rows still exist");
      } else {
        if (remainingCount && remainingCount > 0) {
          const errorMsg = `Cannot delete user: ${remainingCount} row(s) still exist in auth.identities. Cleanup failed. The .from() method may not have access to auth schema tables.`;
          console.error(`❌ ${errorMsg}`);
          return new Response(
            JSON.stringify({
              success: false,
              error: errorMsg
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            }
          );
        }
        console.log("✅ Verified: auth.identities is empty");
      }

      // Delete the auth user account using admin API
      console.log("🗑️ Deleting auth user account with admin client...");
      console.log("🔎 Verifying user before delete:");
      const check = await supabaseAdmin.auth.admin.getUserById(userId);
      console.log("User data:", JSON.stringify(check));
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

