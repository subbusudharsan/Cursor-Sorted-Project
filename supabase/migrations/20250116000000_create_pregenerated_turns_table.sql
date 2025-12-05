-- Migration: Create pregenerated_turns table for 3-turn pre-generation system
-- Date: 2025-01-16
-- Purpose: Store pre-generated conversation turns for instant option retrieval

-- 1) New table for pre-generated turns
CREATE TABLE IF NOT EXISTS pregenerated_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL, -- 0,1,2,... (per recipient)
  recipient_id UUID NOT NULL REFERENCES profiles(id),
  role TEXT NOT NULL CHECK (role IN ('User A', 'User B')),
  options TEXT[] NOT NULL DEFAULT '{}',           -- 3–5 options for this turn
  selected_message TEXT,                          -- Which option was actually used
  used_at TIMESTAMPTZ,                            -- When user consumed this turn
  context_data JSONB,                             -- Snapshot of context when generated
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Make lookups fast
CREATE INDEX IF NOT EXISTS idx_pregenerated_turns_lookup
  ON pregenerated_turns(chat_id, recipient_id, turn_number, used_at);

CREATE INDEX IF NOT EXISTS idx_pregenerated_turns_chat
  ON pregenerated_turns(chat_id);

-- 2) Enable RLS
ALTER TABLE pregenerated_turns ENABLE ROW LEVEL SECURITY;

-- 3) Policy: users can read only their own pre-generated turns
CREATE POLICY "Users can read own pregenerated turns"
  ON pregenerated_turns
  FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

-- 4) Service role (edge functions) can manage rows
-- (Edge functions run with service_role key and bypass RLS anyway,
-- but we keep this permissive for safety / future use.)
CREATE POLICY "Service role can manage pregenerated turns"
  ON pregenerated_turns
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);







