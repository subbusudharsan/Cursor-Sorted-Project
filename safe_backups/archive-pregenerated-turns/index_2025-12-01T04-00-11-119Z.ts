import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 200 });
  }

  try {
    const { chatId } = await req.json();

    if (!chatId) {
      return new Response(
        JSON.stringify({ error: "chatId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase credentials" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log(`📦 Archiving pregenerated turns for chat: ${chatId}`);

    // 1. Fetch all pregenerated turns for this chat (used and unused)
    const { data: pregenTurns, error: fetchError } = await supabase
      .from("pregenerated_turns")
      .select("*")
      .eq("chat_id", chatId)
      .order("turn_number", { ascending: true });

    if (fetchError) {
      console.error("❌ Failed to fetch pregenerated turns:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch pregenerated turns", details: fetchError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    if (!pregenTurns || pregenTurns.length === 0) {
      console.log(`ℹ️ No pregenerated turns to archive for chat: ${chatId}`);
      return new Response(
        JSON.stringify({ success: true, archived: 0, message: "No turns to archive" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    console.log(`📋 Found ${pregenTurns.length} pregenerated turns to archive`);

    // 2. Prepare archive data (copy all fields, add archived_at)
    const archiveData = pregenTurns.map(turn => ({
      chat_id: turn.chat_id,
      turn_number: turn.turn_number,
      recipient_id: turn.recipient_id,
      role: turn.role,
      options: turn.options,
      selected_message: turn.selected_message,
      used_at: turn.used_at,
      context_data: turn.context_data,
      created_at: turn.created_at, // Preserve original creation time
      archived_at: new Date().toISOString()
    }));

    // 3. Insert into dialogue_comprehension table
    const { data: archivedData, error: archiveError } = await supabase
      .from("dialogue_comprehension")
      .insert(archiveData)
      .select();

    if (archiveError) {
      console.error("❌ Failed to archive pregenerated turns:", archiveError);
      return new Response(
        JSON.stringify({ error: "Failed to archive turns", details: archiveError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    console.log(`✅ Successfully archived ${archivedData?.length || 0} turns`);

    // 4. Delete from pregenerated_turns (clean up active table)
    const { error: deleteError } = await supabase
      .from("pregenerated_turns")
      .delete()
      .eq("chat_id", chatId);

    if (deleteError) {
      console.error("❌ Failed to delete pregenerated turns after archiving:", deleteError);
      // Don't fail the request - archiving succeeded, deletion is cleanup
      console.warn("⚠️ Turns archived but not deleted - manual cleanup may be needed");
    } else {
      console.log(`✅ Deleted ${pregenTurns.length} turns from pregenerated_turns`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        archived: archivedData?.length || 0,
        message: `Archived ${archivedData?.length || 0} turns to dialogue_comprehension`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("❌ Archive error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});


