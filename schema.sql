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

-- Permissive policies (tighten later with auth)
create policy "Allow all on exercises" on exercises for all using (true) with check (true);
create policy "Allow all on sessions" on sessions for all using (true) with check (true);
create policy "Allow all on set_logs" on set_logs for all using (true) with check (true);
