-- ============================================================
-- ClearMarine — Pickup dispatch migration
-- Adds the land_crews table + vessel speed/capacity_kg + assignments dispatch columns.
-- Idempotent: safe to re-run on databases already at this version.
-- ============================================================

create table if not exists land_crews (
  id uuid primary key default gen_random_uuid(),
  name text,
  agency text,
  status text default 'available',
  base_lat float,
  base_lon float,
  capacity_kg float default 100,
  transport_speed_kmh float default 40,
  response_minutes int default 15,
  updated_at timestamp default now()
);

alter table land_crews disable row level security;

alter table vessels add column if not exists vessel_speed_kn float default 12;
alter table vessels add column if not exists capacity_kg float default 1500;

alter table assignments add column if not exists crew_type text default 'ship';
alter table assignments add column if not exists land_crew_id uuid references land_crews(id) on delete set null;
alter table assignments add column if not exists estimated_kg float;
alter table assignments add column if not exists estimated_trips int;
alter table assignments add column if not exists total_minutes int;

do $$
begin
  begin
    alter table assignments alter column vessel_id drop not null;
  exception when others then
    null;
  end;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'land_crews'
  ) then
    alter publication supabase_realtime add table land_crews;
  end if;
end $$;
