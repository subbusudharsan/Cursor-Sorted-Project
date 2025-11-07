```sql
-- This migration file is intended to fix previous syntax errors and ensure all schema changes are applied correctly.

-- Remove invalid IF NOT EXISTS from previous ALTER TABLE ADD CONSTRAINT statements
-- These constraints will be re-added with correct syntax if they don't exist.

-- Add new columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text,
ADD COLUMN IF NOT EXISTS phone_number text,
ADD COLUMN IF NOT EXISTS date_of_birth date,
ADD COLUMN IF NOT EXISTS nickname text,
ADD COLUMN IF NOT EXISTS country_code text,
ADD COLUMN IF NOT EXISTS country_name text;

-- Add new columns to contacts table
ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS category text;

-- Add new columns to chats table
ALTER TABLE public.chats
ADD COLUMN IF NOT EXISTS contact_relationship_id uuid,
ADD COLUMN IF NOT EXISTS session_name text,
ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS context_contact_id uuid,
ADD COLUMN IF NOT EXISTS participants uuid[] DEFAULT ARRAY[]::uuid[],
ADD COLUMN IF NOT EXISTS context_data jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS ai_source_chat_id uuid,
ADD COLUMN IF NOT EXISTS turn_state text;

-- Add new columns to messages table
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS sender_id uuid;

-- Add new columns to message_options table
ALTER TABLE public.message_options
ADD COLUMN IF NOT EXISTS sender_id uuid,
ADD COLUMN IF NOT EXISTS message_id uuid,
ADD COLUMN IF NOT EXISTS issue_context text,
ADD COLUMN IF NOT EXISTS option_category text DEFAULT 'general'::text,
ADD COLUMN IF NOT EXISTS option_sentiment text DEFAULT 'neutral'::text,
ADD COLUMN IF NOT EXISTS option_therapeutic_goal text DEFAULT 'communication'::text,
ADD COLUMN IF NOT EXISTS option_used_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS similar_options_shown text[] DEFAULT ARRAY[]::text[],
ADD COLUMN IF NOT EXISTS option_effectiveness_score integer DEFAULT 50;

-- Add new columns to options_cache table
ALTER TABLE public.options_cache
ADD COLUMN IF NOT EXISTS recipient_id uuid;

-- Add new columns to notifications table
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}'::jsonb;

-- Update existing data for new columns (if necessary)
-- For example, populate first_name and last_name from full_name
UPDATE public.profiles
SET
    first_name = split_part(full_name, ' ', 1),
    last_name = split_part(full_name, ' ', 2)
WHERE full_name IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL);

-- Add foreign key constraints (without IF NOT EXISTS, as it's not supported for ADD CONSTRAINT)
-- Ensure referenced tables and columns exist before running these.

-- Foreign key for chats.contact_relationship_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chats_contact_relationship') THEN
        ALTER TABLE public.chats
        ADD CONSTRAINT fk_chats_contact_relationship FOREIGN KEY (contact_relationship_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Foreign key for chats.context_contact_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_context_contact_id_fkey') THEN
        ALTER TABLE public.chats
        ADD CONSTRAINT chats_context_contact_id_fkey FOREIGN KEY (context_contact_id) REFERENCES public.profiles(id);
    END IF;
END $$;

-- Foreign key for chats.ai_source_chat_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_ai_source_chat_id_fkey') THEN
        ALTER TABLE public.chats
        ADD CONSTRAINT chats_ai_source_chat_id_fkey FOREIGN KEY (ai_source_chat_id) REFERENCES public.chats(id);
    END IF;
END $$;

-- Foreign key for messages.sender_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sender_id_fkey') THEN
        ALTER TABLE public.messages
        ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id);
    END IF;
END $$;

-- Foreign key for message_options.sender_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_options_sender_id_fkey') THEN
        ALTER TABLE public.message_options
        ADD CONSTRAINT message_options_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Foreign key for message_options.message_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_options_message_id_fkey') THEN
        ALTER TABLE public.message_options
        ADD CONSTRAINT message_options_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Foreign key for options_cache.recipient_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_options_cache_recipient') THEN
        ALTER TABLE public.options_cache
        ADD CONSTRAINT fk_options_cache_recipient FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add CHECK constraints (without IF NOT EXISTS)
-- These are wrapped in DO $$ BEGIN ... END $$; blocks with IF NOT EXISTS checks for idempotency.

-- profiles_country_code_format
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_country_code_format') THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_country_code_format CHECK (((country_code IS NULL) OR ((length(country_code) = 2) AND (country_code ~ '^[A-Z]{2}$'::text))));
    END IF;
END $$;

-- profiles_date_of_birth_range
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_date_of_birth_range') THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_date_of_birth_range CHECK (((date_of_birth IS NULL) OR ((date_of_birth >= '1900-01-01'::date) AND (date_of_birth <= CURRENT_DATE))));
    END IF;
END $$;

-- profiles_phone_number_format
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_phone_number_format') THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_phone_number_format CHECK (((phone_number IS NULL) OR (phone_number ~ '^\\+[1-9]\\d{1,14}$'::text)));
    END IF;
END $$;

-- chats_chat_type_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_chat_type_check') THEN
        ALTER TABLE public.chats
        ADD CONSTRAINT chats_chat_type_check CHECK ((chat_type = ANY (ARRAY['ai_assistant'::text, 'contact_chat'::text])));
    END IF;
END $$;

-- chats_turn_state_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_turn_state_check') THEN
        ALTER TABLE public.chats
        ADD CONSTRAINT chats_turn_state_check CHECK ((turn_state = ANY (ARRAY['waiting_for_user'::text, 'waiting_for_contact'::text, 'both_active'::text, 'resolved'::text])));
    END IF;
END $$;

-- messages_message_type_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_message_type_check') THEN
        ALTER TABLE public.messages
        ADD CONSTRAINT messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'ai_options'::text, 'system'::text, 'ready_button'::text])));
    END IF;
END $$;

-- messages_sender_type_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sender_type_check') THEN
        ALTER TABLE public.messages
        ADD CONSTRAINT messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['user'::text, 'ai'::text, 'contact'::text])));
    END IF;
END $$;

-- message_options_category_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_options_category_check') THEN
        ALTER TABLE public.message_options
        ADD CONSTRAINT message_options_category_check CHECK ((option_category = ANY (ARRAY['emotional_expression'::text, 'boundary_setting'::text, 'empathy_showing'::text, 'solution_focused'::text, 'vulnerability'::text, 'acknowledgment'::text, 'general'::text])));
    END IF;
END $$;

-- message_options_effectiveness_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_options_effectiveness_check') THEN
        ALTER TABLE public.message_options
        ADD CONSTRAINT message_options_effectiveness_check CHECK (((option_effectiveness_score >= 0) AND (option_effectiveness_score <= 100))));
    END IF;
END $$;

-- message_options_sentiment_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_options_sentiment_check') THEN
        ALTER TABLE public.message_options
        ADD CONSTRAINT message_options_sentiment_check CHECK ((option_sentiment = ANY (ARRAY['gentle'::text, 'direct'::text, 'vulnerable'::text, 'assertive'::text, 'apologetic'::text, 'loving'::text, 'neutral'::text])));
    END IF;
END $$;

-- notifications_type_check
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check') THEN
        ALTER TABLE public.notifications
        ADD CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['message'::text, 'contact_invite'::text, 'contact_accepted'::text])));
    END IF;
END $$;

-- Add indexes (without IF NOT EXISTS)
-- These are wrapped in DO $$ BEGIN ... END $$; blocks with IF NOT EXISTS checks for idempotency.

-- Index for profiles.country_code
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_profiles_country_code' AND n.nspname = 'public') THEN
        CREATE INDEX idx_profiles_country_code ON public.profiles USING btree (country_code);
    END IF;
END $$;

-- Index for profiles.first_name
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_profiles_first_name' AND n.nspname = 'public') THEN
        CREATE INDEX idx_profiles_first_name ON public.profiles USING btree (first_name);
    END IF;
END $$;

-- Index for profiles.last_name
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_profiles_last_name' AND n.nspname = 'public') THEN
        CREATE INDEX idx_profiles_last_name ON public.profiles USING btree (last_name);
    END IF;
END $$;

-- Index for profiles.phone_number
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_profiles_phone_number' AND n.nspname = 'public') THEN
        CREATE INDEX idx_profiles_phone_number ON public.profiles USING btree (phone_number);
    END IF;
END $$;

-- Index for profiles.user_preferences (GIN for JSONB)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_profiles_user_preferences' AND n.nspname = 'public') THEN
        CREATE INDEX idx_profiles_user_preferences ON public.profiles USING gin (user_preferences);
    END IF;
END $$;

-- Index for chats.ai_source_chat_id
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_chats_ai_source_chat_id' AND n.nspname = 'public') THEN
        CREATE INDEX idx_chats_ai_source_chat_id ON public.chats USING btree (ai_source_chat_id);
    END IF;
END $$;

-- Index for chats.context_data (GIN for JSONB)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_chats_context_data' AND n.nspname = 'public') THEN
        CREATE INDEX idx_chats_context_data ON public.chats USING gin (context_data);
    END IF;
END $$;

-- Index for chats.turn_state
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_chats_turn_state' AND n.nspname = 'public') THEN
        CREATE INDEX idx_chats_turn_state ON public.chats USING btree (turn_state);
    END IF;
END $$;

-- Index for messages.is_ai_generated
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_messages_is_ai_generated' AND n.nspname = 'public') THEN
        CREATE INDEX idx_messages_is_ai_generated ON public.messages USING btree (is_ai_generated);
    END IF;
END $$;

-- Index for messages.sender_type
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_messages_sender_type' AND n.nspname = 'public') THEN
        CREATE INDEX idx_messages_sender_type ON public.messages USING btree (sender_type);
    END IF;
END $$;

-- Index for message_options.category
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_message_options_category' AND n.nspname = 'public') THEN
        CREATE INDEX idx_message_options_category ON public.message_options USING btree (option_category);
    END IF;
END $$;

-- Index for options_cache.recipient_id and cache_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_options_cache_recipient_key' AND n.nspname = 'public') THEN
        CREATE INDEX idx_options_cache_recipient_key ON public.options_cache USING btree (recipient_id, cache_key);
    END IF;
END $$;

-- Index for notifications.user_id, type, read, created_at
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_notifications_user_type_read_created' AND n.nspname = 'public') THEN
        CREATE INDEX idx_notifications_user_type_read_created ON public.notifications USING btree (user_id, type, read, created_at DESC);
    END IF;
END $$;

-- Index for notifications.user_id, type, read
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'idx_notifications_user_type_read' AND n.nspname = 'public') THEN
        CREATE INDEX idx_notifications_user_type_read ON public.notifications USING btree (user_id, type, read);
    END IF;
END $$;

-- Add unique constraint for options_cache.recipient_id and cache_key
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'options_cache_recipient_key_unique') THEN
        ALTER TABLE public.options_cache
        ADD CONSTRAINT options_cache_recipient_key_unique UNIQUE (recipient_id, cache_key);
    END IF;
END $$;

-- Add user_preferences column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS user_preferences jsonb DEFAULT '{}'::jsonb;

-- Add push_token column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS push_token text;

-- Add updated_at column to soulroom_entries table
ALTER TABLE public.soulroom_entries
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Add updated_at column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Add updated_at column to chats table
ALTER TABLE public.chats
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Create update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for soulroom_entries.updated_at
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_soulroom_entries_updated_at') THEN
        CREATE TRIGGER update_soulroom_entries_updated_at
        BEFORE UPDATE ON public.soulroom_entries
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END $$;

-- Create trigger for profiles.updated_at
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at') THEN
        CREATE TRIGGER update_profiles_updated_at
        BEFORE UPDATE ON public.profiles
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END $$;

-- Create trigger for chats.updated_at
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_chats_updated_at') THEN
        CREATE TRIGGER update_chats_updated_at
        BEFORE UPDATE ON public.chats
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END $$;

-- Create update_full_name_from_parts function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_full_name_from_parts()
RETURNS TRIGGER AS $$
BEGIN
    NEW.full_name = TRIM(CONCAT(NEW.first_name, ' ', NEW.last_name));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for profiles.full_name update
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_full_name') THEN
        CREATE TRIGGER trigger_update_full_name
        BEFORE INSERT OR UPDATE OF first_name, last_name ON public.profiles
        FOR EACH ROW
        EXECUTE FUNCTION public.update_full_name_from_parts();
    END IF;
END $$;

-- Create create_reciprocal_contact function if it doesn't exist
CREATE OR REPLACE FUNCTION public.create_reciprocal_contact()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if a reciprocal contact already exists
    IF NOT EXISTS (
        SELECT 1 FROM public.contacts
        WHERE user_id = NEW.contact_id AND contact_id = NEW.user_id
    ) THEN
        INSERT INTO public.contacts (user_id, contact_id, status)
        VALUES (NEW.contact_id, NEW.user_id, NEW.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for contacts.reciprocal
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contacts_reciprocal') THEN
        CREATE TRIGGER contacts_reciprocal
        AFTER INSERT ON public.contacts
        FOR EACH ROW
        WHEN (NEW.status = 'accepted')
        EXECUTE FUNCTION public.create_reciprocal_contact();
    END IF;
END $$;

-- Create delete_reciprocal_contact function if it doesn't exist
CREATE OR REPLACE FUNCTION public.delete_reciprocal_contact()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.contacts
    WHERE user_id = OLD.contact_id AND contact_id = OLD.user_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for contacts.reciprocal_delete
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contacts_reciprocal_delete') THEN
        CREATE TRIGGER contacts_reciprocal_delete
        AFTER DELETE ON public.contacts
        FOR EACH ROW
        EXECUTE FUNCTION public.delete_reciprocal_contact();
    END IF;
END $$;

-- Create create_contact_notification function if it doesn't exist
CREATE OR REPLACE FUNCTION public.create_contact_notification()
RETURNS TRIGGER AS $$
DECLARE
    inviter_name text;
    recipient_id uuid;
    notification_title text;
    notification_message text;
    notification_type text;
BEGIN
    -- Determine inviter's name
    SELECT full_name INTO inviter_name FROM public.profiles WHERE id = NEW.user_id;

    IF NEW.status = 'invited' THEN
        -- Notification for the recipient of the invite
        recipient_id := NEW.contact_id;
        notification_title := 'New Contact Invitation';
        notification_message := inviter_name || ' has invited you to connect.';
        notification_type := 'contact_invite';

        INSERT INTO public.notifications (user_id, type, title, message, data)
        VALUES (recipient_id, notification_type, notification_title, notification_message, jsonb_build_object('contact_id', NEW.user_id, 'contact_name', inviter_name));

    ELSIF NEW.status = 'accepted' AND OLD.status = 'invited' THEN
        -- Notification for the inviter when their invite is accepted
        recipient_id := OLD.user_id; -- The original inviter
        notification_title := 'Contact Request Accepted';
        notification_message := inviter_name || ' has accepted your contact invitation.';
        notification_type := 'contact_accepted';

        INSERT INTO public.notifications (user_id, type, title, message, data)
        VALUES (recipient_id, notification_type, notification_title, notification_message, jsonb_build_object('contact_id', NEW.contact_id, 'contact_name', inviter_name));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for contacts.trigger_contact_notification
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_contact_notification') THEN
        CREATE TRIGGER trigger_contact_notification
        AFTER INSERT OR UPDATE ON public.contacts
        FOR EACH ROW
        EXECUTE FUNCTION public.create_contact_notification();
    END IF;
END $$;

-- Create create_message_notification function if it doesn't exist
CREATE OR REPLACE FUNCTION public.create_message_notification()
RETURNS TRIGGER AS $$
DECLARE
    chat_record record;
    recipient_id uuid;
    sender_name text;
    notification_title text;
    notification_message text;
BEGIN
    -- Fetch chat details
    SELECT user_id, contact_id INTO chat_record FROM public.chats WHERE id = NEW.chat_id;

    -- Determine recipient and sender
    IF NEW.sender_id = chat_record.user_id THEN
        recipient_id := chat_record.contact_id;
        SELECT full_name INTO sender_name FROM public.profiles WHERE id = chat_record.user_id;
    ELSE
        recipient_id := chat_record.user_id;
        SELECT full_name INTO sender_name FROM public.profiles WHERE id = chat_record.contact_id;
    END IF;

    -- Only create notification if recipient is not null (i.e., not an AI chat)
    IF recipient_id IS NOT NULL THEN
        notification_title := 'New Message from ' || sender_name;
        notification_message := NEW.content;

        INSERT INTO public.notifications (user_id, type, title, message, data)
        VALUES (recipient_id, 'message', notification_title, notification_message, jsonb_build_object('chat_id', NEW.chat_id, 'sender_id', NEW.sender_id));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for messages.trigger_message_notification
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_message_notification') THEN
        CREATE TRIGGER trigger_message_notification
        AFTER INSERT ON public.messages
        FOR EACH ROW
        EXECUTE FUNCTION public.create_message_notification();
    END IF;
END $$;

-- Create notify_message_options function if it doesn't exist
CREATE OR REPLACE FUNCTION public.notify_message_options()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('message_options_insert', json_build_object(
        'id', NEW.id,
        'chat_id', NEW.chat_id,
        'recipient_id', NEW.recipient_id,
        'options', NEW.options,
        'context_data', NEW.context_data,
        'used', NEW.used,
        'created_at', NEW.created_at,
        'expires_at', NEW.expires_at
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for message_options.message_options_notify_trigger
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'message_options_notify_trigger') THEN
        CREATE TRIGGER message_options_notify_trigger
        AFTER INSERT ON public.message_options
        FOR EACH ROW
        EXECUTE FUNCTION public.notify_message_options();
    END IF;
END $$;

-- Create update_session_activity function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_session_activity()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_active = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for user_sessions.update_user_sessions_last_active
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_sessions_last_active') THEN
        CREATE TRIGGER update_user_sessions_last_active
        BEFORE UPDATE ON public.user_sessions
        FOR EACH ROW
        EXECUTE FUNCTION public.update_session_activity();
    END IF;
END $$;
```