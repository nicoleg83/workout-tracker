-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  day text not null,
  section text,
  name text not null,
  equipment text,
  weight_range text,
  sets_target int,
  reps_target text,
  instructions text[],
  image_key text,
  superset_group text,
  sort_order int
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default',
  day text not null,
  date date not null,
  notes text,
  created_at timestamptz default now(),
  synced_at timestamptz default now()
);

create table if not exists set_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  exercise_id uuid references exercises(id),
  set_number int not null,
  weight_lbs numeric,
  reps int,
  completed boolean default false,
  is_pr boolean default false,
  notes text,
  logged_at timestamptz default now(),
  synced_at timestamptz default now()
);

-- Enable RLS
alter table exercises enable row level security;
alter table sessions enable row level security;
alter table set_logs enable row level security;

-- Exercises are shared / read-only for all authenticated users
drop policy if exists "Allow all on exercises" on exercises;
create policy "Read exercises" on exercises for select using (true);
create policy "Insert exercises" on exercises for insert with check (true);

-- Sessions: each user can only see and write their own rows
drop policy if exists "Allow all on sessions" on sessions;
create policy "Users own sessions" on sessions
  for all
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

-- Set logs: accessible if the parent session belongs to the user
drop policy if exists "Allow all on set_logs" on set_logs;
create policy "Users own set_logs" on set_logs
  for all
  using (
    session_id in (
      select id from sessions where user_id = auth.uid()::text
    )
  )
  with check (
    session_id in (
      select id from sessions where user_id = auth.uid()::text
    )
  );

-- NOTE: Run this in Supabase Dashboard → SQL Editor after adding auth.
-- Also go to Authentication → Settings and disable "Confirm email" for
-- personal use so accounts activate immediately without email verification.
