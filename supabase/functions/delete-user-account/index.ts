// @ts-ignore
export const config = {
  runtime: "edge",
  regions: ["*"],
  auth: false,
  verify_jwt: false,
};

/*
  # Delete User Account Edge Function

  The signed-in user's access token is verified before any deletion.
  The body user id is accepted only when it matches that verified user.
  Service role is used for the cleanup itself.
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_PAGE_SIZE = 100;

type StorageClient = ReturnType<typeof createClient>;
type StorageEntry = { name?: string | null; id?: string | null };

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function errorText(error: { message?: string } | null | undefined) {
  return error?.message || "Request failed";
}

function isMissingSchemaObject(error: { code?: string; message?: string; details?: string } | null | undefined) {
  const code = error?.code ?? "";
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return code === "42P01"
    || code === "42703"
    || code === "PGRST204"
    || code === "PGRST205"
    || text.includes("does not exist")
    || text.includes("could not find the table")
    || text.includes("could not find the column");
}

function assertOwnedObjectName(name: string) {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("Storage object name is outside the user's folder");
  }
}

function avatarObjectPath(avatarUrl: string | null, userId: string) {
  if (!avatarUrl || !avatarUrl.trim()) return null;

  const expectedPrefix = `avatars/${userId}-`;
  const raw = avatarUrl.trim();
  if (raw.startsWith(expectedPrefix) && !raw.includes("..")) {
    return raw;
  }

  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw;
  }

  const markers = ["/object/public/avatars/", "/object/sign/avatars/"];
  const marker = markers.find((item) => pathname.includes(item));
  if (!marker) return null;

  const objectPath = decodeURIComponent(pathname.split(marker)[1]?.split("?")[0] ?? "");
  if (!objectPath.startsWith(expectedPrefix) || objectPath.includes("..")) {
    return null;
  }
  return objectPath;
}

async function listStoragePage(
  supabaseAdmin: StorageClient,
  bucket: string,
  folder: string,
  offset: number
) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).list(folder, {
    limit: STORAGE_PAGE_SIZE,
    offset,
    sortBy: { column: "name", order: "asc" }
  });

  if (error) {
    throw new Error(`Could not list ${bucket}/${folder}: ${error.message}`);
  }

  return (data ?? []) as StorageEntry[];
}

async function removeStorageObjects(supabaseAdmin: StorageClient, bucket: string, paths: string[]) {
  const uniquePaths = [...new Set(paths)];
  for (let index = 0; index < uniquePaths.length; index += STORAGE_PAGE_SIZE) {
    const batch = uniquePaths.slice(index, index + STORAGE_PAGE_SIZE);
    const { error } = await supabaseAdmin.storage.from(bucket).remove(batch);
    if (error) {
      throw new Error(`Could not remove ${bucket} files: ${error.message}`);
    }
  }
}

async function deleteVoiceRecordings(supabaseAdmin: StorageClient, userId: string) {
  const paths: string[] = [];

  for (let offset = 0; offset < STORAGE_PAGE_SIZE * 1000; offset += STORAGE_PAGE_SIZE) {
    const entries = await listStoragePage(supabaseAdmin, "voice_journal", userId, offset);
    if (entries.length === 0) break;
    if (entries.length === STORAGE_PAGE_SIZE && offset + STORAGE_PAGE_SIZE >= STORAGE_PAGE_SIZE * 1000) {
      throw new Error("Too many voice recordings to delete safely in one pass");
    }

    for (const entry of entries) {
      const name = entry.name ?? "";
      if (!entry.id) {
        throw new Error("A voice recording is stored below the known user folder. Deletion stopped.");
      }
      assertOwnedObjectName(name);
      const objectPath = `${userId}/${name}`;
      if (!objectPath.startsWith(`${userId}/`)) {
        throw new Error("Voice path failed the ownership check");
      }
      paths.push(objectPath);
    }

    if (entries.length < STORAGE_PAGE_SIZE) break;
  }

  await removeStorageObjects(supabaseAdmin, "voice_journal", paths);
}

async function deleteProfilePhotos(supabaseAdmin: StorageClient, userId: string, avatarUrl: string | null) {
  const namePrefix = `${userId}-`;
  const paths: string[] = [];

  for (let offset = 0; offset < STORAGE_PAGE_SIZE * 1000; offset += STORAGE_PAGE_SIZE) {
    const entries = await listStoragePage(supabaseAdmin, "avatars", "avatars", offset);
    if (entries.length === 0) break;
    if (entries.length === STORAGE_PAGE_SIZE && offset + STORAGE_PAGE_SIZE >= STORAGE_PAGE_SIZE * 1000) {
      throw new Error("Too many profile photos to delete safely in one pass");
    }

    for (const entry of entries) {
      const name = entry.name ?? "";
      if (!entry.id) {
        if (name.startsWith(namePrefix)) {
          throw new Error("A profile photo is stored below the known avatar folder. Deletion stopped.");
        }
        continue;
      }
      if (!name.startsWith(namePrefix)) continue;
      assertOwnedObjectName(name);
      paths.push(`avatars/${name}`);
    }

    if (entries.length < STORAGE_PAGE_SIZE) break;
  }

  if (avatarUrl && avatarUrl.trim()) {
    const exactPath = avatarObjectPath(avatarUrl, userId);
    if (!exactPath) {
      throw new Error("The saved profile photo is outside this user's avatar folder");
    }
    paths.push(exactPath);
  }

  await removeStorageObjects(supabaseAdmin, "avatars", paths);
}

async function requireDelete(
  result: { error: { message?: string } | null },
  label: string
) {
  if (result.error) {
    throw new Error(`${label}: ${errorText(result.error)}`);
  }
}

async function deleteOptional(
  result: { error: { code?: string; message?: string; details?: string } | null },
  label: string
) {
  if (!result.error) {
    console.log(`✅ Cleaned optional ${label}`);
    return;
  }
  if (isMissingSchemaObject(result.error)) {
    console.warn(`⚠️ Skipping optional ${label}:`, result.error.message);
    return;
  }
  throw new Error(`${label}: ${errorText(result.error)}`);
}

Deno.serve(async (req) => {
  console.log("🔥 delete-user-account invoked");
  console.log("📥 Request method:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    let requestBody: { userId?: string } = {};
    try {
      requestBody = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid request body" }, 400);
    }

    const requestedUserId = requestBody?.userId;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ success: false, error: "Server configuration error" }, 500);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const accessToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return jsonResponse({ success: false, error: "Authentication required" }, 401);
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !authData?.user?.id) {
      return jsonResponse({ success: false, error: "Authentication required" }, 401);
    }

    const userId = authData.user.id;
    if (!USER_ID_PATTERN.test(userId)) {
      return jsonResponse({ success: false, error: "Authenticated user id is invalid" }, 401);
    }
    if (requestedUserId && requestedUserId !== userId) {
      return jsonResponse({ success: false, error: "You can delete only your own account" }, 403);
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !userData?.user) {
      return jsonResponse({ success: false, error: "User not found" }, 404);
    }

    let requiredCleanupComplete = false;

    try {
      const { data: profileRow, error: profileReadError } = await supabaseAdmin
        .from("profiles")
        .select("avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (profileReadError) {
        throw new Error(`profiles lookup: ${errorText(profileReadError)}`);
      }

      const avatarUrl = profileRow?.avatar_url ?? null;

      // chats.context_contact_id does not set itself to null, so clear it before the profile delete.
      await requireDelete(
        await supabaseAdmin.from("chats").update({ context_contact_id: null }).eq("context_contact_id", userId),
        "chats.context_contact_id"
      );

      // These profile references do not cascade and would block profile deletion.
      await requireDelete(
        await supabaseAdmin.from("pregenerated_turns").delete().eq("recipient_id", userId),
        "pregenerated_turns"
      );
      await requireDelete(
        await supabaseAdmin.from("dialogue_comprehension").delete().eq("recipient_id", userId),
        "dialogue_comprehension"
      );

      const chatFilter = `user_id.eq.${userId},contact_id.eq.${userId},participants.cs.{"${userId}"}`;
      const { data: chatsToDelete, error: chatSelectError } = await supabaseAdmin
        .from("chats")
        .select("id")
        .or(chatFilter);
      if (chatSelectError) {
        throw new Error(`chats lookup: ${errorText(chatSelectError)}`);
      }

      const chatIds = (chatsToDelete ?? [])
        .map((chat: { id?: string | null }) => chat.id)
        .filter((id: string | null | undefined): id is string => typeof id === "string" && id.length > 0);

      await requireDelete(
        await supabaseAdmin.from("messages").delete().eq("sender_id", userId),
        "messages.sender_id"
      );

      for (let index = 0; index < chatIds.length; index += 50) {
        const chatIdGroup = chatIds.slice(index, index + 50);
        await requireDelete(
          await supabaseAdmin.from("messages").delete().in("chat_id", chatIdGroup),
          "messages.chat_id"
        );
      }

      await requireDelete(
        await supabaseAdmin.from("message_options").delete().eq("recipient_id", userId),
        "message_options"
      );

      // Approach A: a matching shared chat is deleted, including the other participant's messages in that chat.
      await requireDelete(
        await supabaseAdmin.from("chats").delete().or(chatFilter),
        "chats"
      );

      const { data: survivingChats, error: survivingChatsError } = await supabaseAdmin
        .from("chats")
        .select("id, participants")
        .contains("participants", [userId]);
      if (survivingChatsError) {
        throw new Error(`chats.participants lookup: ${errorText(survivingChatsError)}`);
      }

      for (const chat of (survivingChats ?? []) as Array<{ id: string; participants?: string[] | null }>) {
        const remainingParticipants = Array.isArray(chat.participants)
          ? chat.participants.filter((participantId: string) => participantId !== userId)
          : [];
        await requireDelete(
          await supabaseAdmin.from("chats").update({ participants: remainingParticipants }).eq("id", chat.id),
          "chats.participants"
        );
      }

      await requireDelete(
        await supabaseAdmin.from("soulroom_entries").delete().eq("user_id", userId),
        "soulroom_entries"
      );
      await requireDelete(
        await supabaseAdmin.from("soul_entries").delete().eq("user_id", userId),
        "soul_entries"
      );
      await requireDelete(
        await supabaseAdmin.from("contacts").delete().or(`user_id.eq.${userId},contact_id.eq.${userId}`),
        "contacts"
      );
      await requireDelete(
        await supabaseAdmin.from("password_activity_log").delete().eq("user_id", userId),
        "password_activity_log"
      );

      const optionalTables = [
        "muted_contacts",
        "user_sessions",
        "soul_ai_insights",
        "wellness_daily_checkins",
        "emotion_timeline",
        "soul_coach_nudges",
        "emotion_intent_history",
        "conversation_orchestration",
        "agent_decisions",
        "notifications",
        "user_hashtags",
        "entity_registry",
        "action_log",
        "pronoun_resolutions",
        "turn_analysis"
      ];

      for (const tableName of optionalTables) {
        await deleteOptional(
          await supabaseAdmin.from(tableName).delete().eq("user_id", userId),
          tableName
        );
      }

      await deleteOptional(
        await supabaseAdmin.from("options_cache").delete().eq("recipient_id", userId),
        "options_cache"
      );
      await deleteOptional(
        await supabaseAdmin.from("chats_history").delete().or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`),
        "chats_history"
      );
      await deleteOptional(
        await supabaseAdmin.from("structured_context_data").delete().eq("answered_by", userId),
        "structured_context_data"
      );

      await requireDelete(
        await supabaseAdmin.from("profiles").delete().eq("id", userId),
        "profiles"
      );

      await deleteVoiceRecordings(supabaseAdmin, userId);
      await deleteProfilePhotos(supabaseAdmin, userId, avatarUrl);

      requiredCleanupComplete = true;
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : "Required account cleanup failed";
      console.error("❌ Required cleanup failed:", message);
      return jsonResponse({ success: false, error: message }, 500);
    }

    const { error: rpcError } = await supabaseAdmin.rpc("delete_auth_user_data", {
      target_user_id: userId
    });
    if (rpcError) {
      console.error("❌ delete_auth_user_data failed:", rpcError);
      return jsonResponse({
        success: false,
        error: "Failed to clean auth schema tables",
        details: rpcError.message
      }, 500);
    }

    const { error: directDeleteError } = await supabaseAdmin.rpc("delete_auth_user_direct", {
      target_user_id: userId
    });
    if (directDeleteError) {
      console.error("❌ delete_auth_user_direct failed:", directDeleteError);
      return jsonResponse({
        success: false,
        error: "Failed to delete the login",
        details: directDeleteError.message
      }, 500);
    }

    const loginExists = async () => {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (data?.user) return true;
      if (!error) return false;
      if (error.message.toLowerCase().includes("not found")) return false;
      throw new Error("Could not confirm that the login was deleted");
    };

    let stillExists: boolean;
    try {
      stillExists = await loginExists();
    } catch (confirmError) {
      const message = confirmError instanceof Error ? confirmError.message : "Could not confirm that the login was deleted";
      return jsonResponse({ success: false, error: message }, 500);
    }

    if (stillExists) {
      if (!requiredCleanupComplete) {
        return jsonResponse({ success: false, error: "Required account cleanup failed" }, 500);
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleteError) {
        return jsonResponse({
          success: false,
          error: deleteError.message || "Database error deleting user"
        }, 500);
      }

      try {
        stillExists = await loginExists();
      } catch (confirmError) {
        const message = confirmError instanceof Error ? confirmError.message : "Could not confirm that the login was deleted";
        return jsonResponse({ success: false, error: message }, 500);
      }
      if (stillExists) {
        return jsonResponse({ success: false, error: "Login was not deleted" }, 500);
      }
    }

    return jsonResponse({
      success: true,
      message: "User account deleted successfully"
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("❌ Error in delete-user-account function:", message);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
