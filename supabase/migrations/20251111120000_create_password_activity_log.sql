create extension if not exists "pgcrypto";

create table if not exists password_activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  action_type text not null check (action_type in ('signup', 'password_change')),
  status text not null check (status in ('success', 'failed')),
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists password_activity_log_user_id_idx
  on password_activity_log(user_id);

create index if not exists password_activity_log_created_at_idx
  on password_activity_log(created_at);

