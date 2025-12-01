-- Migration: Add source tracking to pregenerated_turns and message_options
-- Date: 2025-01-31
-- Purpose: Track which system generated each option (pregenerated_turns vs generate-contextual-options)

-- Add source column to pregenerated_turns
ALTER TABLE pregenerated_turns 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'pregenerated_turns' 
CHECK (source IN ('pregenerated_turns', 'generate-contextual-options'));

-- Add source column to message_options
ALTER TABLE message_options 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'generate-contextual-options' 
CHECK (source IN ('pregenerated_turns', 'generate-contextual-options'));

-- Add selected_message column to message_options if it doesn't exist
ALTER TABLE message_options 
ADD COLUMN IF NOT EXISTS selected_message TEXT;

-- Update existing rows
UPDATE pregenerated_turns 
SET source = 'pregenerated_turns' 
WHERE source IS NULL;

UPDATE message_options 
SET source = 'generate-contextual-options' 
WHERE source IS NULL;

