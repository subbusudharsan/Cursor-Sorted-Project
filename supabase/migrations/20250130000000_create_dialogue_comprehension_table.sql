-- Migration: Create dialogue_comprehension archive table
-- Date: 2025-01-30
-- Purpose: Archive pre-generated turns for closed/resolved chats to keep pregenerated_turns clean

-- 1) New table for archived dialogue comprehension
CREATE TABLE IF NOT EXISTS dialogue_comprehension (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  recipient_id UUID NOT NULL REFERENCES profiles(id),
  role TEXT NOT NULL CHECK (role IN ('User A', 'User B')),
  options TEXT[] NOT NULL,              -- All 3 options shown to user
  selected_message TEXT,                -- Which option was actually used
  used_at TIMESTAMPTZ,                  -- When user consumed this turn
  context_data JSONB,                   -- Snapshot of context when generated
  archived_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,  -- When archived
  created_at TIMESTAMPTZ                -- Original creation time from pregenerated_turns
);

-- Make lookups fast
CREATE INDEX IF NOT EXISTS idx_dialogue_comprehension_chat 
  ON dialogue_comprehension(chat_id);

CREATE INDEX IF NOT EXISTS idx_dialogue_comprehension_recipient 
  ON dialogue_comprehension(chat_id, recipient_id);

CREATE INDEX IF NOT EXISTS idx_dialogue_comprehension_archived 
  ON dialogue_comprehension(archived_at);

-- 2) Enable RLS
ALTER TABLE dialogue_comprehension ENABLE ROW LEVEL SECURITY;

-- 3) Policy: users can read their own archived dialogue
CREATE POLICY "Users can read own archived dialogue"
  ON dialogue_comprehension
  FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

-- 4) Service role (edge functions) can manage rows
CREATE POLICY "Service role can manage archived dialogue"
  ON dialogue_comprehension
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);




