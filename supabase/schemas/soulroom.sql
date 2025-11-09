-- Soulroom tables & storage configuration

create table if not exists public.soul_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  text text not null,
  title text,
  ai_summary text,
  emotion_tag text,
  voice_url text,
  tags text[],
  transcript text,
  related_chat_id uuid references public.chats(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger soul_entries_updated_at
before update on public.soul_entries
for each row
execute procedure public.set_updated_at();

create table if not exists public.emotion_timeline (
  user_id uuid references auth.users(id) on delete cascade,
  date date not null,
  dominant_emotion text,
  intensity integer default 0,
  closure_flag boolean default false,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, date)
);

-- storage bucket for voice journals
insert into storage.buckets (id, name, public)
select 'voice_journal', 'voice_journal', false
where not exists (select 1 from storage.buckets where id = 'voice_journal');

alter table if exists public.soulroom_entries
  add column if not exists ai_summary text;

alter table if exists public.soulroom_entries
  add column if not exists emotion_tag text;

alter table if exists public.soulroom_entries
  add column if not exists voice_url text;

alter table if exists public.soulroom_entries
  add column if not exists transcript text;

alter table if exists public.soulroom_entries
  add column if not exists emotion_keywords text[];

create table if not exists public.soul_coach_nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  headline text not null,
  message text not null,
  prompts text[] default array[]::text[],
  generated_week date not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, generated_week)
);

create trigger soul_coach_nudges_updated_at
before update on public.soul_coach_nudges
for each row
execute procedure public.set_updated_at();

create table if not exists public.emotion_intent_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  reflection_id uuid references public.soulroom_entries(id) on delete cascade,
  chat_id uuid,
  contact_id uuid,
  emotion_intent text,
  emotional_layer text,
  reflection_mood text,
  message_source text default 'soulroom',
  message_content text,
  intent_confidence numeric,
  transition_from text,
  transition_quality text,
  hint_present boolean default false,
  hint_text text,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.emotion_intent_history enable row level security;

create policy emotion_intent_history_user_select
on public.emotion_intent_history
for select using (auth.uid() = user_id);

create policy emotion_intent_history_user_insert
on public.emotion_intent_history
for insert with check (auth.uid() = user_id);

create table if not exists public.conversation_orchestration (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  chat_id uuid,
  reflection_id uuid,
  source text default 'orchestrator',
  current_emotion_intent text,
  current_emotional_layer text,
  reasoning text,
  confidence_score numeric,
  detected_sentiment text,
  hint_integration_status text,
  relationship_context jsonb,
  closure_readiness_score numeric,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.conversation_orchestration enable row level security;

create policy conversation_orchestration_user_select
on public.conversation_orchestration
for select using (auth.uid() = user_id);

create policy conversation_orchestration_user_insert
on public.conversation_orchestration
for insert with check (auth.uid() = user_id);

create table if not exists public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  chat_id uuid,
  reflection_id uuid,
  decision_type text not null,
  agent_name text,
  input_data jsonb,
  reasoning_steps text[],
  decision_output jsonb,
  confidence_score numeric,
  execution_time_ms integer,
  success boolean default true,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.agent_decisions enable row level security;

create policy agent_decisions_user_select
on public.agent_decisions
for select using (auth.uid() = user_id);

create policy agent_decisions_user_insert
on public.agent_decisions
for insert with check (auth.uid() = user_id);

create table if not exists public.soul_ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  headline text not null,
  insight text not null,
  reflections_count integer default 0,
  chats_count integer default 0,
  source_context jsonb,
  generated_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.soul_ai_insights enable row level security;

create policy soul_ai_insights_user_select
on public.soul_ai_insights
for select using (auth.uid() = user_id);

create policy soul_ai_insights_user_insert
on public.soul_ai_insights
for insert with check (auth.uid() = user_id);

create table if not exists public.wellness_daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  mood_score integer not null,
  mood_label text not null,
  emoji text,
  recorded_date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, recorded_date)
);

alter table if exists public.wellness_daily_checkins enable row level security;

create policy wellness_checkins_user_select
on public.wellness_daily_checkins
for select using (auth.uid() = user_id);

create policy wellness_checkins_user_upsert
on public.wellness_daily_checkins
for insert with check (auth.uid() = user_id);

create policy wellness_checkins_user_update
on public.wellness_daily_checkins
for update using (auth.uid() = user_id)
with check (auth.uid() = user_id);
