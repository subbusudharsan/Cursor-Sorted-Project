/*
  # Initial Database Schema for Sorted App

  ## Overview
  This migration creates the complete database structure for a conversation management application
  with AI assistance, contact relationships, message exchanges, and emotional resolution tracking.

  ## New Tables Created

  ### 1. `profiles`
  User profile information extending Supabase auth.users
  - `id` (uuid, primary key) - Links to auth.users.id
  - `email` (text, unique, not null)
  - `full_name` (text, nullable)
  - `nickname` (text, nullable)
  - `avatar_url` (text, nullable)
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())

  ### 2. `contacts`
  Manages bidirectional contact relationships between users
  - `id` (uuid, primary key)
  - `user_id` (uuid, not null) - The user who owns this contact
  - `contact_id` (uuid, not null) - The user being added as a contact
  - `status` (text, not null) - 'invited', 'accepted', 'blocked'
  - `category` (text, nullable) - 'Family', 'Work', 'Teacher', 'Service', 'Friend', 'General'
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())

  ### 3. `chats`
  Stores all conversation sessions (AI assistant and contact chats)
  - Multiple columns for tracking conversation state, AI confidence, closure detection

  ### 4. `messages`
  Stores individual messages in conversations

  ### 5. `message_options`
  AI-generated response options for guided conversations

  ### 6. `notifications`
  User notifications for chat requests, messages, and system events

  ## Security (RLS Policies)
  
  All tables have Row Level Security enabled with appropriate policies ensuring:
  - Users can only access their own data
  - Contact relationships are bidirectional and secure
  - Message access is restricted to chat participants
  - Notifications are private to each user
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. PROFILES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  nickname text,
  avatar_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Index for efficient email lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- =====================================================
-- 2. CONTACTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'blocked')),
  category text CHECK (category IN ('Family', 'Work', 'Teacher', 'Service', 'Friend', 'General')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, contact_id),
  CHECK (user_id != contact_id)
);

-- Indexes for efficient contact queries
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_contact_id ON contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);

-- =====================================================
-- 3. CHATS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  chat_type text NOT NULL CHECK (chat_type IN ('ai_assistant', 'contact_chat')),
  session_name text NOT NULL DEFAULT 'New Conversation',
  participants uuid[],
  last_message text,
  last_message_at timestamptz DEFAULT now() NOT NULL,
  is_resolved boolean DEFAULT false NOT NULL,
  context_data jsonb,
  context_contact_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ai_source_chat_id uuid REFERENCES chats(id) ON DELETE SET NULL,
  ai_confidence_level text DEFAULT 'high' CHECK (ai_confidence_level IN ('high', 'medium', 'low')),
  options_stage text DEFAULT 'ai_assisted' CHECK (options_stage IN ('ai_assisted', 'fallback', 'manual')),
  conversation_phase text DEFAULT 'opening' CHECK (conversation_phase IN ('warmup', 'opening', 'discussion', 'closing')),
  turn_count_a integer DEFAULT 0 NOT NULL,
  turn_count_b integer DEFAULT 0 NOT NULL,
  resolution_detected boolean DEFAULT false NOT NULL,
  closure_state text DEFAULT 'active' CHECK (closure_state IN ('active', 'pending_user_a_smiley', 'pending_user_b_smiley', 'closed')),
  user_a_smiley_sent boolean DEFAULT false NOT NULL,
  user_b_smiley_sent boolean DEFAULT false NOT NULL,
  closure_achieved_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes for efficient chat queries
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_contact_id ON chats(contact_id);
CREATE INDEX IF NOT EXISTS idx_chats_chat_type ON chats(chat_type);
CREATE INDEX IF NOT EXISTS idx_chats_is_resolved ON chats(is_resolved);
CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON chats(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_participants ON chats USING GIN(participants);

-- =====================================================
-- 4. MESSAGES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'ai', 'contact')),
  content text NOT NULL,
  message_type text DEFAULT 'text' CHECK (message_type IN ('text', 'ready_button', 'system')),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes for efficient message queries
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- =====================================================
-- 5. MESSAGE_OPTIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS message_options (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  options text[] NOT NULL DEFAULT '{}',
  context_data jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes for efficient option queries
CREATE INDEX IF NOT EXISTS idx_message_options_chat_id ON message_options(chat_id);
CREATE INDEX IF NOT EXISTS idx_message_options_recipient_id ON message_options(recipient_id);
CREATE INDEX IF NOT EXISTS idx_message_options_created_at ON message_options(created_at DESC);

-- =====================================================
-- 6. NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('chat_request', 'new_message', 'system')),
  title text NOT NULL,
  message text,
  data jsonb,
  read boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes for efficient notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can view contacts profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contacts
      WHERE (contacts.user_id = auth.uid() AND contacts.contact_id = profiles.id)
         OR (contacts.contact_id = auth.uid() AND contacts.user_id = profiles.id)
    )
  );

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Contacts policies
CREATE POLICY "Users can view own contacts"
  ON contacts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = contact_id);

CREATE POLICY "Users can insert own contacts"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contacts"
  ON contacts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = contact_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = contact_id);

CREATE POLICY "Users can delete own contacts"
  ON contacts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Chats policies
CREATE POLICY "Users can view own chats"
  ON chats FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id 
    OR auth.uid() = contact_id 
    OR (participants IS NOT NULL AND auth.uid() = ANY(participants))
  );

CREATE POLICY "Users can insert own chats"
  ON chats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chats"
  ON chats FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id 
    OR auth.uid() = contact_id 
    OR (participants IS NOT NULL AND auth.uid() = ANY(participants))
  )
  WITH CHECK (
    auth.uid() = user_id 
    OR auth.uid() = contact_id 
    OR (participants IS NOT NULL AND auth.uid() = ANY(participants))
  );

CREATE POLICY "Users can delete own chats"
  ON chats FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Messages policies
CREATE POLICY "Users can view messages in their chats"
  ON messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = messages.chat_id
        AND (
          chats.user_id = auth.uid()
          OR chats.contact_id = auth.uid()
          OR (chats.participants IS NOT NULL AND auth.uid() = ANY(chats.participants))
        )
    )
  );

CREATE POLICY "Users can insert messages in their chats"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = messages.chat_id
        AND (
          chats.user_id = auth.uid()
          OR chats.contact_id = auth.uid()
          OR (chats.participants IS NOT NULL AND auth.uid() = ANY(chats.participants))
        )
    )
  );

-- Message options policies
CREATE POLICY "Users can view own message options"
  ON message_options FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_id);

CREATE POLICY "Users can insert message options"
  ON message_options FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = message_options.chat_id
        AND (
          chats.user_id = auth.uid()
          OR chats.contact_id = auth.uid()
          OR (chats.participants IS NOT NULL AND auth.uid() = ANY(chats.participants))
        )
    )
  );

-- Notifications policies
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_chats_updated_at ON chats;
CREATE TRIGGER update_chats_updated_at
  BEFORE UPDATE ON chats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
