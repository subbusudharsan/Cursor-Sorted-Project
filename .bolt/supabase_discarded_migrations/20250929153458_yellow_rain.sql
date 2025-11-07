```sql
-- This migration file is intended to fix previous syntax errors and apply all necessary schema changes.

-- Add new columns to the 'profiles' table if they don't exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_name text;

-- Add new column to the 'contacts' table if it doesn't exist
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS category text;

-- Add new columns to the 'chats' table if they don't exist
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS session_name text;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT false;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS context_contact_id uuid;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS participants uuid[] DEFAULT ARRAY[]::uuid[];
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS context_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS ai_source_chat_id uuid;
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS turn_state text;

-- Add new columns to the 'messages' table if they don't exist
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_id uuid;

-- Add new columns to the 'message_options' table if they don't exist
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS sender_id uuid;
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS message_id uuid;
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS issue_context text;
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS option_category text DEFAULT 'general'::text;
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS option_sentiment text DEFAULT 'neutral'::text;
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS option_therapeutic_goal text DEFAULT 'communication'::text;
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS option_used_count integer DEFAULT 0;
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS similar_options_shown text[] DEFAULT ARRAY[]::text[];
ALTER TABLE public.message_options ADD COLUMN IF NOT EXISTS option_effectiveness_score integer DEFAULT 50;

-- Add new columns to the 'options_cache' table if they don't exist
ALTER TABLE public.options_cache ADD COLUMN IF NOT EXISTS recipient_id uuid;

-- Add new columns to the 'user_sessions' table if they don't exist
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval);
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Add new columns to the 'notifications' table if they don't exist
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}'::jsonb;

-- Create 'muted_contacts' table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.muted_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- Set up primary keys and unique constraints for new tables/columns
ALTER TABLE public.muted_contacts ADD CONSTRAINT muted_contacts_pkey PRIMARY KEY (id);
ALTER TABLE public.muted_contacts ADD CONSTRAINT muted_contacts_user_id_contact_id_key UNIQUE (user_id, contact_id);

-- Add foreign key constraints
ALTER TABLE public.muted_contacts ADD CONSTRAINT muted_contacts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.muted_contacts ADD CONSTRAINT muted_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.chats ADD CONSTRAINT chats_ai_source_chat_id_fkey FOREIGN KEY (ai_source_chat_id) REFERENCES public.chats(id);
ALTER TABLE public.chats ADD CONSTRAINT chats_context_contact_id_fkey FOREIGN KEY (context_contact_id) REFERENCES public.profiles(id);
ALTER TABLE public.chats ADD CONSTRAINT fk_chats_contact_relationship FOREIGN KEY (contact_relationship_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id);

ALTER TABLE public.message_options ADD CONSTRAINT message_options_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;
ALTER TABLE public.message_options ADD CONSTRAINT message_options_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.contacts(id) ON DELETE CASCADE;

ALTER TABLE public.options_cache ADD CONSTRAINT fk_options_cache_recipient FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.user_sessions ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_muted_contacts_contact_id ON public.muted_contacts USING btree (contact_id);
CREATE INDEX IF NOT EXISTS idx_muted_contacts_user_id ON public.muted_contacts USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_chats_ai_source_chat_id ON public.chats USING btree (ai_source_chat_id);
CREATE INDEX IF NOT EXISTS idx_chats_context_data ON public.chats USING gin (context_data);
CREATE INDEX IF NOT EXISTS idx_chats_turn_state ON public.chats USING btree (turn_state);

CREATE INDEX IF NOT EXISTS idx_messages_is_ai_generated ON public.messages USING btree (is_ai_generated);
CREATE INDEX IF NOT EXISTS idx_messages_sender_type ON public.messages USING btree (sender_type);

CREATE INDEX IF NOT EXISTS idx_message_options_category ON public.message_options USING btree (option_category);
CREATE INDEX IF NOT EXISTS idx_message_options_effectiveness_score ON public.message_options USING btree (option_effectiveness_score);
CREATE INDEX IF NOT EXISTS idx_message_options_sentiment ON public.message_options USING btree (option_sentiment);
CREATE INDEX IF NOT EXISTS idx_message_options_therapeutic_goal ON public.message_options USING btree (option_therapeutic_goal);
CREATE INDEX IF NOT EXISTS idx_message_options_used_count ON public.message_options USING btree (option_used_count);

CREATE INDEX IF NOT EXISTS idx_options_cache_recipient_key ON public.options_cache USING btree (recipient_id, cache_key);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON public.user_sessions USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON public.user_sessions USING btree (is_active);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications USING btree (read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type_read ON public.notifications USING btree (user_id, type, read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type_read_created ON public.notifications USING btree (user_id, type, read, created_at DESC);

-- Add check constraints (removed IF NOT EXISTS)
ALTER TABLE public.profiles ADD CONSTRAINT profiles_country_code_format CHECK (((country_code IS NULL) OR ((length(country_code) = 2) AND (country_code ~ '^[A-Z]{2}$'::text))));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_date_of_birth_range CHECK (((date_of_birth IS NULL) OR ((date_of_birth >= '1900-01-01'::date) AND (date_of_birth <= CURRENT_DATE))));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_phone_number_format CHECK (((phone_number IS NULL) OR (phone_number ~ '^\\+[1-9]\\d{1,14}$'::text))));

ALTER TABLE public.chats ADD CONSTRAINT chats_chat_type_check CHECK ((chat_type = ANY (ARRAY['ai_assistant'::text, 'contact_chat'])));
ALTER TABLE public.chats ADD CONSTRAINT chats_turn_state_check CHECK ((turn_state = ANY (ARRAY['waiting_for_user'::text, 'waiting_for_contact'::text, 'both_active'::text, 'resolved'::text])));

ALTER TABLE public.messages ADD CONSTRAINT messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'ai_options'::text, 'system'::text, 'ready_button'::text])));
ALTER TABLE public.messages ADD CONSTRAINT messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['user'::text, 'ai'::text, 'contact'::text])));

ALTER TABLE public.message_options ADD CONSTRAINT message_options_category_check CHECK ((option_category = ANY (ARRAY['emotional_expression'::text, 'boundary_setting'::text, 'empathy_showing'::text, 'solution_focused'::text, 'vulnerability'::text, 'acknowledgment'::text, 'general'::text])));
ALTER TABLE public.message_options ADD CONSTRAINT message_options_effectiveness_check CHECK (((option_effectiveness_score >= 0) AND (option_effectiveness_score <= 100)));
ALTER TABLE public.message_options ADD CONSTRAINT message_options_sentiment_check CHECK ((option_sentiment = ANY (ARRAY['gentle'::text, 'direct'::text, 'vulnerable'::text, 'assertive'::text, 'apologetic'::text, 'loving'::text, 'neutral'::text])));

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['message'::text, 'contact_invite'::text, 'contact_accepted'::text])));

-- Create or replace functions
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_reciprocal_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Check if a reciprocal contact entry already exists
    PERFORM 1
    FROM public.contacts
    WHERE user_id = NEW.contact_id AND contact_id = NEW.user_id;

    IF NOT FOUND THEN
        -- If not, create the reciprocal entry
        INSERT INTO public.contacts (user_id, contact_id, status)
        VALUES (NEW.contact_id, NEW.user_id, NEW.status);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_reciprocal_contact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Delete the reciprocal contact entry
    DELETE FROM public.contacts
    WHERE user_id = OLD.contact_id AND contact_id = OLD.user_id;
    RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_contact_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    inviter_profile jsonb;
    recipient_profile jsonb;
    notification_title text;
    notification_message text;
    notification_type text;
BEGIN
    -- Fetch inviter's profile
    SELECT to_jsonb(p) INTO inviter_profile FROM public.profiles p WHERE p.id = NEW.user_id;

    -- Fetch recipient's profile
    SELECT to_jsonb(p) INTO recipient_profile FROM public.profiles p WHERE p.id = NEW.contact_id;

    IF NEW.status = 'invited' THEN
        notification_title := 'New Contact Invitation';
        notification_message := inviter_profile->>'full_name' || ' (' || inviter_profile->>'email' || ') has sent you a contact invitation.';
        notification_type := 'contact_invite';

        INSERT INTO public.notifications (user_id, type, title, message, data)
        VALUES (NEW.contact_id, notification_type, notification_title, notification_message, jsonb_build_object('inviter_id', NEW.user_id, 'contact_id', NEW.id));

    ELSIF NEW.status = 'accepted' THEN
        -- Notification for the inviter that their invite was accepted
        notification_title := 'Contact Invitation Accepted';
        notification_message := recipient_profile->>'full_name' || ' (' || recipient_profile->>'email' || ') has accepted your contact invitation.';
        notification_type := 'contact_accepted';

        INSERT INTO public.notifications (user_id, type, title, message, data)
        VALUES (NEW.user_id, notification_type, notification_title, notification_message, jsonb_build_object('accepter_id', NEW.contact_id, 'contact_id', NEW.id));

        -- Notification for the accepter that they are now connected (if reciprocal was just created)
        -- This part is tricky with reciprocal trigger, might need to ensure it only fires once or for the right user
        -- For simplicity, we'll assume the above covers the primary flow.
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_message_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    chat_row record;
    sender_profile jsonb;
    recipient_id uuid;
    notification_title text;
    notification_message text;
    is_muted boolean;
BEGIN
    -- Fetch chat details
    SELECT * INTO chat_row FROM public.chats WHERE id = NEW.chat_id;

    -- Determine the recipient of the message
    IF NEW.sender_id = chat_row.user_id THEN
        recipient_id := chat_row.contact_id;
    ELSE
        recipient_id := chat_row.user_id;
    END IF;

    -- If no recipient (e.g., AI chat without contact), or sender is AI, do not create notification
    IF recipient_id IS NULL OR NEW.sender_type = 'ai' THEN
        RETURN NEW;
    END IF;

    -- Check if the recipient has muted the sender
    SELECT EXISTS (
        SELECT 1 FROM public.muted_contacts
        WHERE user_id = recipient_id AND contact_id = NEW.sender_id
    ) INTO is_muted;

    IF is_muted THEN
        RETURN NEW; -- Do not send notification if muted
    END IF;

    -- Fetch sender's profile for notification message
    SELECT to_jsonb(p) INTO sender_profile FROM public.profiles p WHERE p.id = NEW.sender_id;

    notification_title := 'New Message from ' || sender_profile->>'full_name';
    notification_message := NEW.content;

    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (recipient_id, 'message', notification_title, notification_message, jsonb_build_object('chat_id', NEW.chat_id, 'sender_id', NEW.sender_id, 'message_id', NEW.id));

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_message_options()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    recipient_push_token text;
    notification_payload jsonb;
BEGIN
    -- Fetch the recipient's push token
    SELECT push_token INTO recipient_push_token
    FROM public.profiles
    WHERE id = NEW.recipient_id;

    IF recipient_push_token IS NOT NULL THEN
        -- Construct the notification payload
        notification_payload := jsonb_build_object(
            'to', recipient_push_token,
            'title', 'New Response Options Available!',
            'body', 'Tap to see suggested ways to reply in your chat.',
            'data', jsonb_build_object(
                'type', 'message_options',
                'chat_id', NEW.chat_id,
                'message_options_id', NEW.id
            )
        );

        -- Send the notification (this would typically involve an external service or another edge function)
        -- For now, we'll just log it. In a real app, you'd call an Expo Push Notification API or similar.
        RAISE NOTICE 'Sending push notification to %: %', recipient_push_token, notification_payload;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_full_name_from_parts()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.full_name = TRIM(CONCAT(NEW.first_name, ' ', NEW.last_name));
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_session_activity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.last_active = now();
    RETURN NEW;
END;
$function$;

-- Create triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_soulroom_entries_updated_at BEFORE UPDATE ON public.soulroom_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trigger_update_full_name BEFORE INSERT OR UPDATE OF first_name, last_name ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_full_name_from_parts();
CREATE TRIGGER contacts_reciprocal AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION create_reciprocal_contact();
CREATE TRIGGER contacts_reciprocal_delete AFTER DELETE ON public.contacts FOR EACH ROW EXECUTE FUNCTION delete_reciprocal_contact();
CREATE TRIGGER trigger_contact_notification AFTER INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION create_contact_notification();
CREATE TRIGGER trigger_message_notification AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION create_message_notification();
CREATE TRIGGER update_user_sessions_last_active BEFORE UPDATE ON public.user_sessions FOR EACH ROW EXECUTE FUNCTION update_session_activity();
CREATE TRIGGER message_options_notify_trigger AFTER INSERT ON public.message_options FOR EACH ROW EXECUTE FUNCTION notify_message_options();

-- Enable Row Level Security (RLS) for new tables
ALTER TABLE public.muted_contacts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for 'muted_contacts'
DROP POLICY IF EXISTS "Users can manage own muted contacts" ON public.muted_contacts;
CREATE POLICY "Users can manage own muted contacts" ON public.muted_contacts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Update RLS policies for 'chats' to include participants array
DROP POLICY IF EXISTS "Users can read own chats" ON public.chats;
CREATE POLICY "Users can read own chats" ON public.chats
  FOR SELECT USING ((auth.uid() = user_id) OR (auth.uid() = contact_id) OR (auth.uid() = ANY (participants)));

DROP POLICY IF EXISTS "Users can insert own chats" ON public.chats;
CREATE POLICY "Users can insert own chats" ON public.chats
  FOR INSERT WITH CHECK ((auth.uid() = user_id) OR (auth.uid() = ANY (participants)));

DROP POLICY IF EXISTS "Users can update own chats" ON public.chats;
CREATE POLICY "Users can update own chats" ON public.chats
  FOR UPDATE USING ((auth.uid() = user_id) OR (auth.uid() = contact_id) OR (auth.uid() = ANY (participants))) WITH CHECK ((auth.uid() = user_id) OR (auth.uid() = contact_id) OR (auth.uid() = ANY (participants)));

DROP POLICY IF EXISTS "Users can delete own chats" ON public.chats;
CREATE POLICY "Users can delete own chats" ON public.chats
  FOR DELETE USING ((auth.uid() = user_id) OR (auth.uid() = ANY (participants)));

-- Update RLS policies for 'messages' to include participants array
DROP POLICY IF EXISTS "Users can insert messages to their chats" ON public.messages;
CREATE POLICY "Users can insert messages to their chats" ON public.messages
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.chats WHERE (chats.id = messages.chat_id) AND ((chats.user_id = auth.uid()) OR (chats.contact_id = auth.uid()) OR (auth.uid() = ANY (chats.participants)))));

DROP POLICY IF EXISTS "Users can read messages from their chats" ON public.messages;
CREATE POLICY "Users can read messages from their chats" ON public.messages
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.chats WHERE (chats.id = messages.chat_id) AND ((chats.user_id = auth.uid()) OR (chats.contact_id = auth.uid()) OR (auth.uid() = ANY (chats.participants)))));

DROP POLICY IF EXISTS "Users can update messages in their chats" ON public.messages;
CREATE POLICY "Users can update messages in their chats" ON public.messages
  FOR UPDATE USING (EXISTS (SELECT 1 FROM public.chats WHERE (chats.id = messages.chat_id) AND ((chats.user_id = auth.uid()) OR (auth.uid() = ANY (chats.participants))))) WITH CHECK (EXISTS (SELECT 1 FROM public.chats WHERE (chats.id = messages.chat_id) AND ((chats.user_id = auth.uid()) OR (auth.uid() = ANY (chats.participants)))));

-- Update RLS policies for 'message_options'
DROP POLICY IF EXISTS "Users can read options where they are recipient" ON public.message_options;
CREATE POLICY "Users can read options where they are recipient" ON public.message_options
  FOR SELECT USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Users can update their own message options" ON public.message_options;
CREATE POLICY "Users can update their own message options" ON public.message_options
  FOR UPDATE USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

-- Update RLS policies for 'options_cache'
DROP POLICY IF EXISTS "Users can manage options cache" ON public.options_cache;
CREATE POLICY "Users can manage options cache" ON public.options_cache
  FOR ALL USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

-- Update RLS policies for 'user_sessions'
DROP POLICY IF EXISTS "Users can read own sessions" ON public.user_sessions;
CREATE POLICY "Users can read own sessions" ON public.user_sessions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert sessions" ON public.user_sessions;
CREATE POLICY "Users can insert sessions" ON public.user_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own sessions" ON public.user_sessions;
CREATE POLICY "Users can update own sessions" ON public.user_sessions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own sessions" ON public.user_sessions;
CREATE POLICY "Users can delete own sessions" ON public.user_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Update RLS policies for 'notifications'
DROP POLICY IF EXISTS "Users can read own notifications" ON public.notifications;
CREATE POLICY "Users can read own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
CREATE POLICY "System can create notifications" ON public.notifications
  FOR INSERT WITH CHECK (true); -- This policy allows the system to insert notifications for any user.

-- Data migration for existing profiles to populate first_name and last_name
UPDATE public.profiles
SET
    first_name = split_part(full_name, ' ', 1),
    last_name = CASE
        WHEN position(' ' IN full_name) > 0 THEN substring(full_name FROM position(' ' IN full_name) + 1)
        ELSE NULL
    END
WHERE full_name IS NOT NULL
  AND (first_name IS NULL OR last_name IS NULL);

-- Drop unused tables (if they exist)
DROP TABLE IF EXISTS public.conversation_analytics;
DROP TABLE IF EXISTS public.conversation_analytics_realtime;
DROP TABLE IF EXISTS public.conversation_options;
DROP TABLE IF EXISTS public.conversation_sessions;
DROP TABLE IF EXISTS public.conversation_turns;
DROP TABLE IF EXISTS public.issue_vocabulary;
DROP TABLE IF EXISTS public.user_option_patterns;
```