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

      // Cleanup public schema tables before auth user deletion
      // Do NOT attempt to delete from auth.* schema - deleteUser handles that
      console.log("🧹 Cleaning public schema tables...");

      // First, set context_contact_id to NULL for any chats referencing this user's profile
      // This prevents foreign key constraint violations when deleting the profile
      // The constraint chats_context_contact_id_fkey doesn't have ON DELETE SET NULL
      console.log("🧹 Clearing context_contact_id references...");
      const { error: contextContactError } = await supabaseAdmin
        .from('chats')
        .update({ context_contact_id: null })
        .eq('context_contact_id', userId);
      if (contextContactError) {
        console.warn("⚠️ Error clearing context_contact_id:", contextContactError);
      } else {
        console.log("✅ Cleared context_contact_id references");
      }

      // Delete chats (check user_id, contact_id, and participants array)
      console.log("🧹 Cleaning chats...");
      const { error: chatsError } = await supabaseAdmin
        .from('chats')
        .delete()
        .or(`user_id.eq.${userId},contact_id.eq.${userId},participants.cs.{"${userId}"}`);
      if (chatsError) {
        console.warn("⚠️ Error cleaning chats:", chatsError);
      } else {
        console.log("✅ Cleaned chats");
      }

      // Delete message_options
      console.log("🧹 Cleaning message_options...");
      const { error: messageOptionsError1 } = await supabaseAdmin
        .from('message_options')
        .delete()
        .eq('recipient_id', userId);
      const { error: messageOptionsError2 } = await supabaseAdmin
        .from('message_options')
        .delete()
        .eq('sender_id', userId);
      if (messageOptionsError1 || messageOptionsError2) {
        console.warn("⚠️ Error cleaning message_options:", messageOptionsError1 || messageOptionsError2);
      } else {
        console.log("✅ Cleaned message_options");
      }

      // Delete messages
      console.log("🧹 Cleaning messages...");
      const { error: messagesError } = await supabaseAdmin
        .from('messages')
        .delete()
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);
      if (messagesError) {
        console.warn("⚠️ Error cleaning messages:", messagesError);
      } else {
        console.log("✅ Cleaned messages");
      }

      // Delete soulroom_entries
      console.log("🧹 Cleaning soulroom_entries...");
      const { error: soulroomError } = await supabaseAdmin
        .from('soulroom_entries')
        .delete()
        .eq('user_id', userId);
      if (soulroomError) {
        console.warn("⚠️ Error cleaning soulroom_entries:", soulroomError);
      } else {
        console.log("✅ Cleaned soulroom_entries");
      }

      // Delete muted_contacts
      console.log("🧹 Cleaning muted_contacts...");
      const { error: mutedContactsError } = await supabaseAdmin
        .from('muted_contacts')
        .delete()
        .eq('user_id', userId);
      if (mutedContactsError) {
        console.warn("⚠️ Error cleaning muted_contacts:", mutedContactsError);
      } else {
        console.log("✅ Cleaned muted_contacts");
      }

      // Delete user_sessions
      console.log("🧹 Cleaning user_sessions...");
      const { error: userSessionsError } = await supabaseAdmin
        .from('user_sessions')
        .delete()
        .eq('user_id', userId);
      if (userSessionsError) {
        console.warn("⚠️ Error cleaning user_sessions:", userSessionsError);
      } else {
        console.log("✅ Cleaned user_sessions");
      }

      // Delete other public tables that reference user_id
      const otherTables = [
        'soul_entries',
        'soul_ai_insights',
        'wellness_daily_checkins',
        'emotion_timeline',
        'soul_coach_nudges',
        'emotion_intent_history',
        'conversation_orchestration',
        'agent_decisions',
        'notifications',
        'contacts',
        'profiles'
      ];

      for (const tableName of otherTables) {
        try {
          console.log(`🧹 Cleaning ${tableName}...`);
          if (tableName === 'contacts') {
            // Contacts table has both user_id and contact_id
            const { error } = await supabaseAdmin
              .from(tableName)
              .delete()
              .or(`user_id.eq.${userId},contact_id.eq.${userId}`);
            if (error) {
              console.warn(`⚠️ Error cleaning ${tableName}:`, error);
            } else {
              console.log(`✅ Cleaned ${tableName}`);
            }
          } else {
            const { error } = await supabaseAdmin
              .from(tableName)
              .delete()
              .eq('user_id', userId);
            if (error) {
              console.warn(`⚠️ Error cleaning ${tableName}:`, error);
            } else {
              console.log(`✅ Cleaned ${tableName}`);
            }
          }
        } catch (err) {
          console.warn(`⚠️ Exception cleaning ${tableName}:`, err);
        }
      }

      // Extra tables with custom user references
      try {
        console.log("🧹 Cleaning options_cache...");
        const { error: optionsCacheError } = await supabaseAdmin
          .from('options_cache')
          .delete()
          .eq('recipient_id', userId);
        if (optionsCacheError) {
          console.warn("⚠️ Error cleaning options_cache:", optionsCacheError);
        } else {
          console.log("✅ Cleaned options_cache");
        }

        console.log("🧹 Cleaning user_hashtags...");
        const { error: userHashtagsError } = await supabaseAdmin
          .from('user_hashtags')
          .delete()
          .eq('user_id', userId);
        if (userHashtagsError) {
          console.warn("⚠️ Error cleaning user_hashtags:", userHashtagsError);
        } else {
          console.log("✅ Cleaned user_hashtags");
        }

        console.log("🧹 Cleaning chats_history...");
        const { error: chatsHistoryError } = await supabaseAdmin
          .from('chats_history')
          .delete()
          .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);
        if (chatsHistoryError) {
          console.warn("⚠️ Error cleaning chats_history:", chatsHistoryError);
        } else {
          console.log("✅ Cleaned chats_history");
        }

        console.log("🧹 Cleaning structured_context_data...");
        const { error: scdError } = await supabaseAdmin
          .from('structured_context_data')
          .delete()
          .eq('answered_by', userId);
        if (scdError) {
          console.warn("⚠️ Error cleaning structured_context_data:", scdError);
        } else {
          console.log("✅ Cleaned structured_context_data");
        }

        console.log("🧹 Cleaning entity_registry...");
        const { error: entityRegistryError } = await supabaseAdmin
          .from('entity_registry')
          .delete()
          .eq('user_id', userId);
        if (entityRegistryError) {
          console.warn("⚠️ Error cleaning entity_registry:", entityRegistryError);
        } else {
          console.log("✅ Cleaned entity_registry");
        }

        console.log("🧹 Cleaning action_log...");
        const { error: actionLogError } = await supabaseAdmin
          .from('action_log')
          .delete()
          .eq('user_id', userId);
        if (actionLogError) {
          console.warn("⚠️ Error cleaning action_log:", actionLogError);
        } else {
          console.log("✅ Cleaned action_log");
        }

        console.log("🧹 Cleaning pronoun_resolutions...");
        const { error: pronounResError } = await supabaseAdmin
          .from('pronoun_resolutions')
          .delete()
          .eq('user_id', userId);
        if (pronounResError) {
          console.warn("⚠️ Error cleaning pronoun_resolutions:", pronounResError);
        } else {
          console.log("✅ Cleaned pronoun_resolutions");
        }

        console.log("🧹 Cleaning turn_analysis...");
        const { error: turnAnalysisError } = await supabaseAdmin
          .from('turn_analysis')
          .delete()
          .eq('user_id', userId);
        if (turnAnalysisError) {
          console.warn("⚠️ Error cleaning turn_analysis:", turnAnalysisError);
        } else {
          console.log("✅ Cleaned turn_analysis");
        }
      } catch (extraErr) {
        console.warn("⚠️ Exception cleaning extra user tables:", extraErr);
      }

      // Delete password_activity_log (uses email string)
      if (userData.user.email) {
        console.log("🧹 Cleaning password_activity_log...");
        const { error: passwordLogError } = await supabaseAdmin
          .from('password_activity_log')
          .delete()
          .eq('user_id', userData.user.email);
        if (passwordLogError) {
          console.warn("⚠️ Error cleaning password_activity_log:", passwordLogError);
        } else {
          console.log("✅ Cleaned password_activity_log");
        }
      }

      console.log("✅ Public schema cleanup complete");

      // Clean auth schema tables using database function before deleteUser
      // This is necessary because deleteUser fails if foreign key constraints exist
      console.log("🧹 Cleaning auth schema tables via database function...");
      
      try {
        // Ensure userId is a valid UUID string
        console.log("🔧 Calling delete_auth_user_data RPC with userId:", userId);
        
        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('delete_auth_user_data', {
          target_user_id: userId
        });
        
        if (rpcError) {
          console.error("❌ Error calling delete_auth_user_data RPC:", rpcError);
          console.error("❌ RPC Error code:", rpcError.code);
          console.error("❌ RPC Error message:", rpcError.message);
          console.error("❌ RPC Error details:", rpcError.details);
          console.error("❌ RPC Error hint:", rpcError.hint);
          
          // Don't continue if RPC fails - we need auth cleanup to succeed
          return new Response(
            JSON.stringify({
              success: false,
              error: "Failed to clean auth schema tables",
              details: rpcError.message || "RPC function call failed",
              rpcError: {
                code: rpcError.code,
                message: rpcError.message,
                details: rpcError.details,
                hint: rpcError.hint
              }
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            }
          );
        } else {
          console.log("✅ Successfully cleaned auth schema tables");
        }
      } catch (rpcException: any) {
        console.error("❌ Exception calling delete_auth_user_data:", rpcException);
        console.error("❌ Exception message:", rpcException?.message);
        console.error("❌ Exception stack:", rpcException?.stack);
        
        return new Response(
          JSON.stringify({
            success: false,
            error: "Exception during auth schema cleanup",
            details: rpcException?.message || "Unknown exception"
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      // Delete the auth user account using direct SQL deletion
      // This bypasses Supabase API constraints that might block deletion
      console.log("🗑️ Deleting auth user account using direct SQL deletion...");
      console.log("🔎 Verifying user before delete:");
      const check = await supabaseAdmin.auth.admin.getUserById(userId);
      console.log("User data:", JSON.stringify(check));
      
      if (!check?.data?.user) {
        console.error("❌ User not found before deletion attempt");
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
      
      // Try direct SQL deletion via RPC function
      console.log("⚠️ Attempting direct SQL deletion after auth schema cleanup");
      try {
        const { error: directDeleteError } = await supabaseAdmin.rpc('delete_auth_user_direct', {
          target_user_id: userId
        });
        
        if (directDeleteError) {
          console.error("❌ Failed to delete user via direct SQL");
          console.error("❌ Direct delete error:", directDeleteError);
          
          // Fallback to admin API if direct SQL fails
          console.log("⚠️ Falling back to admin API deleteUser...");
          const { error: deleteError, data: deleteData } = await supabaseAdmin.auth.admin.deleteUser(userId);
          
          if (deleteError) {
            console.error("❌ Failed to delete auth user via admin API");
            console.error("❌ Error name:", deleteError.name);
            console.error("❌ Error status:", deleteError.status);
            console.error("❌ Error message:", deleteError.message);
            console.error("❌ Full error object:", JSON.stringify(deleteError, null, 2));
            
            const errorMsg = deleteError.message || "Database error deleting user";
            return new Response(
              JSON.stringify({
                success: false,
                error: errorMsg,
                details: "The user account could not be deleted. This may be due to database constraints in the auth schema. All public data has been deleted successfully."
              }),
              {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              }
            );
          }
          
          console.log("✅ Successfully deleted auth user account via admin API:", userId);
        } else {
          console.log("✅ Successfully deleted auth user account via direct SQL:", userId);
        }
      } catch (directDeleteException: any) {
        console.error("❌ Exception during direct SQL deletion:", directDeleteException);
        
        // Fallback to admin API
        console.log("⚠️ Falling back to admin API deleteUser due to exception...");
        const { error: deleteError, data: deleteData } = await supabaseAdmin.auth.admin.deleteUser(userId);
        
        if (deleteError) {
          console.error("❌ Failed to delete auth user via admin API");
          console.error("❌ Error name:", deleteError.name);
          console.error("❌ Error status:", deleteError.status);
          console.error("❌ Error message:", deleteError.message);
          console.error("❌ Full error object:", JSON.stringify(deleteError, null, 2));
          
          const errorMsg = deleteError.message || "Database error deleting user";
          return new Response(
            JSON.stringify({
              success: false,
              error: errorMsg,
              details: "The user account could not be deleted. This may be due to database constraints in the auth schema. All public data has been deleted successfully."
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            }
          );
        }
        
        console.log("✅ Successfully deleted auth user account via admin API (fallback):", userId);
      }

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

