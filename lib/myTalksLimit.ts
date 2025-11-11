import { supabase } from "@/lib/supabase";

export const MY_TALKS_LIMIT = 3;

export const buildMyTalksLimitMessage = (contactName: string): string =>
  `You've got 3 chats going with ${contactName}.\n\nTake a pause — just making sure you’re not carrying too much. ❤️`
;

type ChatRow = {
  id: string;
  last_message_at: string | null;
  context_data: {
    initial_pending?: boolean | string | null;
  } | null;
};

const isInitialPending = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
};

export const getCompletedMyTalksCount = async (
  userId: string | null | undefined,
  contactId: string | null | undefined
): Promise<number> => {
  if (!userId || !contactId) return 0;

  const { data, error } = await supabase
    .from("chats")
    .select("id, last_message_at, context_data")
    .eq("user_id", userId)
    .eq("contact_id", contactId)
    .eq("chat_type", "contact_chat")
    .eq("is_resolved", false);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ChatRow[];
  return rows.filter((chat) => {
    const delivered = Boolean(chat.last_message_at);
    const pending = isInitialPending(chat.context_data?.initial_pending);
    return delivered && !pending;
  }).length;
};

