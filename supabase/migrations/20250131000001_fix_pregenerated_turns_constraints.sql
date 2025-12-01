-- Migration: Fix pregenerated_turns constraints and source tracking
-- Date: 2025-01-31
-- Purpose: 
--   1. Clean up duplicate turn_numbers before adding unique constraint
--   2. Add unique constraint to prevent duplicate turn_numbers
--   3. Allow source to be NULL initially (set only when option is selected)

-- 0) First, clean up duplicate rows
-- Keep the row with selected_message if one exists, otherwise keep the most recent one
DELETE FROM pregenerated_turns
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY chat_id, recipient_id, turn_number
             ORDER BY 
               CASE WHEN selected_message IS NOT NULL THEN 0 ELSE 1 END, -- Prefer rows with selected_message
               created_at DESC -- If both unused, keep the most recent
           ) as rn
    FROM pregenerated_turns
  ) duplicates
  WHERE rn > 1
);

-- 1) Add unique constraint to prevent duplicates
-- This ensures no two rows can have the same (chat_id, recipient_id, turn_number)
-- even with race conditions
ALTER TABLE pregenerated_turns 
ADD CONSTRAINT unique_pregenerated_turn 
UNIQUE (chat_id, recipient_id, turn_number);

-- 2) Allow source to be NULL initially (will be set when option is selected)
-- Check if NOT NULL constraint exists first
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'pregenerated_turns_source_check' 
    AND table_name = 'pregenerated_turns'
  ) THEN
    -- Drop the check constraint if it exists
    ALTER TABLE pregenerated_turns DROP CONSTRAINT IF EXISTS pregenerated_turns_source_check;
  END IF;
END $$;

-- Allow NULL values
ALTER TABLE pregenerated_turns 
ALTER COLUMN source DROP NOT NULL;

-- 3) Update existing rows: set source to NULL if selected_message is NULL
-- This fixes existing data where source was set on insert but never used
UPDATE pregenerated_turns 
SET source = NULL 
WHERE selected_message IS NULL AND source IS NOT NULL;

-- 4) Add comment explaining source tracking
COMMENT ON COLUMN pregenerated_turns.source IS 'Set only when user selects an option. NULL = generated but not yet selected.';