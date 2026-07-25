-- Joyforce — Schema für die bestehende onlymakkus-Supabase-Instanz
-- Im Supabase SQL Editor einmal komplett ausführen.
-- profiles wird NICHT verändert, nur referenziert.

-- 1) Tageseinträge -----------------------------------------------------------

create table if not exists public.jf_entries (
  id          bigint generated always as identity primary key,
  profile_id  bigint not null references public.profiles(id) on delete cascade,
  day         date   not null default current_date,
  value       integer not null check (value > 0 and value < 3600),
  created_at  timestamptz default now(),
  unique (profile_id, day)          -- ein Wert pro Tag, wird per upsert überschrieben
);

create index if not exists jf_entries_profile_day_idx
  on public.jf_entries (profile_id, day desc);

-- Grants + RLS. Fehlt eine dieser Zeilen -> stillschweigend null Zeilen.
grant select, insert, update, delete on public.jf_entries to anon;
grant usage, select on sequence public.jf_entries_id_seq to anon;

alter table public.jf_entries enable row level security;

drop policy if exists "anon full access" on public.jf_entries;
create policy "anon full access" on public.jf_entries
  for all to anon using (true) with check (true);


-- 2) Ranking-View ------------------------------------------------------------
-- Gewertet wird der Schnitt der letzten 7 Tage (so steht es in den Regeln der Seite).

create or replace view public.jf_ranking as
select
  p.id                                              as profile_id,
  coalesce(nullif(p.display_name, ''), p.name)      as name,
  p.discriminator,
  p.avatar_url,
  max(e.value)                                      as best,
  coalesce(
    round(avg(e.value) filter (where e.day > current_date - 7))::int,
    max(e.value)
  )                                                 as score,
  count(*)::int                                     as entry_count,
  max(e.day)                                        as last_day
from public.profiles p
join public.jf_entries e on e.profile_id = p.id
group by p.id, p.display_name, p.name, p.discriminator, p.avatar_url;

grant select on public.jf_ranking to anon;


-- 3) Optional: Challenge-Einstellungen ---------------------------------------
-- Muster analog zu calorie_settings. Nur anlegen, wenn pro Profil ein eigenes
-- Tagesziel gebraucht wird; sonst reicht der feste Wert im Frontend.

-- create table if not exists public.jf_settings (
--   profile_id bigint primary key references public.profiles(id) on delete cascade,
--   daily_goal integer not null default 100
-- );
-- grant select, insert, update, delete on public.jf_settings to anon;
-- alter table public.jf_settings enable row level security;
-- create policy "anon full access" on public.jf_settings
--   for all to anon using (true) with check (true);


-- 4) Gegenprobe --------------------------------------------------------------
-- Vor dem ersten Schreibzugriff einmal die echten Spalten von profiles prüfen:
--   select * from public.profiles limit 1;
