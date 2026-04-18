-- ============================================================
-- ClearMarine — Ocean Waste Coordination System
-- Safe to run on empty OR existing databases.
-- Fully non-destructive: no DROP, no DELETE, no TRUNCATE.
-- Only `create table if not exists`, `alter ... if not exists`, and guarded publication adds.
-- For a clean demo reset, run supabase_seed_demo.sql separately (it is the only file that wipes rows).
-- Legacy ClearER tables (alerts/rooms/patients) are intentionally NOT dropped — drop them manually if needed.
-- ============================================================

-- Debris sightings reported by public/crews
create table if not exists debris_sightings (
  id uuid primary key default gen_random_uuid(),
  reporter_name text,
  photo_url text,
  latitude float,
  longitude float,
  debris_type text default 'unknown',
  density_score int,
  density_label text,
  estimated_volume text,
  gemini_analysis text,
  pickup_mode text,                   -- land | ship | ship_coast | unknown (see src/lib/pickupClassification.js)
  status text default 'reported',     -- reported / assigned / intercepted / cleared
  jurisdiction text default 'Local Coastguard',
  source_jurisdiction text default 'public',
  handoff_status text default 'none', -- none / pending / accepted
  created_at timestamp default now()
);

-- Cleanup vessels / crews
create table if not exists vessels (
  id uuid primary key default gen_random_uuid(),
  name text,
  zone text,
  agency text,
  status text default 'available',    -- available / deployed / returning / maintenance
  fuel_level int default 80,
  fuel_threshold int default 25,
  capacity int default 100,
  current_lat float,
  current_lon float,
  updated_at timestamp default now()
);

-- Drift predictions per sighting
create table if not exists drift_predictions (
  id uuid primary key default gen_random_uuid(),
  sighting_id uuid references debris_sightings(id) on delete cascade,
  lat_24h float,
  lon_24h float,
  lat_48h float,
  lon_48h float,
  lat_72h float,
  lon_72h float,
  current_speed float,
  current_bearing float,
  created_at timestamp default now()
);

-- Supplies per zone (nets, fuel, collection bags, PPE)
create table if not exists supplies (
  id uuid primary key default gen_random_uuid(),
  name text,
  zone text,
  quantity int,
  low_threshold int,
  updated_at timestamp default now()
);

-- Inbound restock from external suppliers (inventory updates when ETA passes)
create table supply_orders (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references supplies(id) on delete cascade,
  zone text,
  quantity int not null check (quantity > 0),
  ordered_at timestamptz default now(),
  expected_arrival_at timestamptz not null,
  status text not null default 'in_transit',
  supplier_name text,
  fulfillment_note text,
  stock_profile text
);

-- Real ocean current data populated by scripts/seed_currents.js (NOAA HYCOM)
create table if not exists ocean_currents (
  id uuid primary key default gen_random_uuid(),
  lat float not null,
  lon float not null,
  u_ms float,           -- eastward current m/s
  v_ms float,           -- northward current m/s
  speed_knots float,
  bearing float,        -- direction current flows toward, degrees (0=N, 90=E)
  source text,
  recorded_at text,
  created_at timestamp default now()
);
create index if not exists idx_ocean_currents_lat_lon on ocean_currents (lat, lon);

-- Land cleanup crews (beach / shore teams) — counterpart to vessels for land pickups
create table if not exists land_crews (
  id uuid primary key default gen_random_uuid(),
  name text,
  agency text,
  status text default 'available',          -- available / deployed / returning / off_shift
  base_lat float,
  base_lon float,
  capacity_kg float default 100,            -- kg one trip can carry
  transport_speed_kmh float default 40,     -- ground transport cruise speed
  response_minutes int default 15,          -- one-time mobilization before first transit
  updated_at timestamp default now()
);

-- Crew assignments linking vessel OR land crew to sighting intercept / cleanup
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  sighting_id uuid references debris_sightings(id) on delete cascade,
  vessel_id uuid references vessels(id) on delete cascade,
  interception_lat float,
  interception_lon float,
  interception_hours int,
  status text default 'assigned',     -- assigned / en_route / completed
  gemini_brief text,
  created_at timestamp default now()
);

-- Columns added after initial deploy (safe if already present)
alter table debris_sightings add column if not exists pickup_mode text;
comment on column debris_sightings.pickup_mode is 'land | ship | ship_coast | unknown — from pickupClassification + drift';

alter table vessels add column if not exists vessel_speed_kn float default 12;
alter table vessels add column if not exists capacity_kg float default 1500;
comment on column vessels.vessel_speed_kn is 'Cruise speed in knots — used by cleanupTime.estimateShipPickupMinutes';
comment on column vessels.capacity_kg is 'Mass per trip in kg — overrides legacy `capacity` for trip math';

alter table assignments add column if not exists crew_type text default 'ship';
alter table assignments add column if not exists land_crew_id uuid references land_crews(id) on delete set null;
alter table assignments add column if not exists estimated_kg float;
alter table assignments add column if not exists estimated_trips int;
alter table assignments add column if not exists total_minutes int;
alter table assignments add column if not exists shore_station_lat float;
alter table assignments add column if not exists shore_station_lon float;
alter table assignments add column if not exists shore_station_name text;
comment on column assignments.crew_type is 'ship | land — which fleet handled this pickup';
comment on column assignments.shore_station_lat is 'For synthetic shore patrols (land_crew_id is null) — base latitude on the coast';
comment on column assignments.shore_station_lon is 'For synthetic shore patrols (land_crew_id is null) — base longitude on the coast';
comment on column assignments.shore_station_name is 'Display name for the synthetic shore patrol';

-- vessel_id was previously implicitly required via FK; allow null when crew_type=land
do $$
begin
  begin
    alter table assignments alter column vessel_id drop not null;
  exception when others then
    null; -- already nullable, ignore
  end;
end $$;

-- ============================================================
-- Disable RLS for hackathon demo
-- ============================================================
alter table debris_sightings disable row level security;
alter table vessels disable row level security;
alter table land_crews disable row level security;
alter table drift_predictions disable row level security;
alter table supplies disable row level security;
alter table supply_orders disable row level security;
alter table assignments disable row level security;

-- ============================================================
-- Enable Realtime
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='debris_sightings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE debris_sightings; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='vessels') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE vessels; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='supplies') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE supplies; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='supply_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE supply_orders; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE assignments; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='drift_predictions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE drift_predictions; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='land_crews') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE land_crews; END IF;
END $$;

-- Note: demo seed data (vessels, supplies, debris_sightings, drift_predictions, land_crews)
-- lives in supabase_seed_demo.sql. Keeping it out of this file makes re-runs of the schema
-- non-destructive — re-applying schema.sql never wipes rows.
