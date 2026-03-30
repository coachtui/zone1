-- Zone1 MVP Schema
-- Run this in Supabase Dashboard > SQL Editor

create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  center_lng  double precision not null,
  center_lat  double precision not null,
  zoom        double precision not null default 17,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table overlays (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  name             text not null,
  image_url        text not null,
  opacity          double precision not null default 0.7,
  top_left_lng     double precision not null,
  top_left_lat     double precision not null,
  top_right_lng    double precision not null,
  top_right_lat    double precision not null,
  bottom_right_lng double precision not null,
  bottom_right_lat double precision not null,
  bottom_left_lng  double precision not null,
  bottom_left_lat  double precision not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Disable RLS for MVP (enable and add policies when adding auth)
alter table projects enable row level security;
create policy "Allow all access to projects" on projects for all using (true) with check (true);

alter table overlays enable row level security;
create policy "Allow all access to overlays" on overlays for all using (true) with check (true);
