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
