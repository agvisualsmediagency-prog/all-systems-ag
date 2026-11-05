-- AG Marketing — Company Systems Map
-- Run this once in Supabase → SQL Editor → New query → Run.

-- 1) Who is allowed in. Only these emails can read or edit the map.
create table if not exists public.team_members (
  email      text primary key,
  name       text,
  created_at timestamptz not null default now()
);

-- 2) The map itself: one row ("main") holding the whole map as JSON.
create table if not exists public.company_maps (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- 3) Security: signed-in team members only.
alter table public.team_members enable row level security;
alter table public.company_maps enable row level security;

create or replace function public.is_team_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

drop policy if exists "team reads map"    on public.company_maps;
drop policy if exists "team inserts map"  on public.company_maps;
drop policy if exists "team updates map"  on public.company_maps;
drop policy if exists "members see self"  on public.team_members;

create policy "team reads map"   on public.company_maps for select to authenticated using (public.is_team_member());
create policy "team inserts map" on public.company_maps for insert to authenticated with check (public.is_team_member());
create policy "team updates map" on public.company_maps for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "members see self" on public.team_members for select to authenticated using (lower(email) = lower(auth.jwt() ->> 'email'));

-- 4) Live updates: everyone sees each other's edits without reloading.
do $$
begin
  alter publication supabase_realtime add table public.company_maps;
exception when duplicate_object then null;
end $$;

-- 5) Add your team. Replace with real emails, then run.
insert into public.team_members (email, name) values
  ('ANDRES_EMAIL_HERE',   'Andres'),
  ('ESTEBAN_EMAIL_HERE',  'Esteban'),
  ('ISABELLA_EMAIL_HERE', 'Isabella')
on conflict (email) do nothing;

-- Add someone later:
--   insert into public.team_members (email, name) values ('new@person.com', 'Name');
-- Remove someone:
--   delete from public.team_members where email = 'old@person.com';
