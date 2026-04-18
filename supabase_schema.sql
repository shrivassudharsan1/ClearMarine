-- ============================================================
-- ClearMarine — Ocean Waste Coordination System
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- Drop old tables if migrating from ClearER
drop table if exists ocean_currents cascade;
drop table if exists alerts cascade;
drop table if exists supplies cascade;
drop table if exists rooms cascade;
drop table if exists patients cascade;

-- Debris sightings reported by public/crews
create table debris_sightings (
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
  status text default 'reported',     -- reported / assigned / intercepted / cleared
  jurisdiction text default 'Local Coastguard',
  source_jurisdiction text default 'public',
  handoff_status text default 'none', -- none / pending / accepted
  created_at timestamp default now()
);

-- Cleanup vessels / crews
create table vessels (
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
create table drift_predictions (
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
create table supplies (
  id uuid primary key default gen_random_uuid(),
  name text,
  zone text,
  quantity int,
  low_threshold int,
  updated_at timestamp default now()
);

-- Real ocean current data populated by scripts/seed_currents.js (NOAA HYCOM)
create table ocean_currents (
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
create index on ocean_currents (lat, lon);

-- Crew assignments linking vessel to sighting intercept
create table assignments (
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

-- ============================================================
-- Disable RLS for hackathon demo
-- ============================================================
alter table debris_sightings disable row level security;
alter table vessels disable row level security;
alter table drift_predictions disable row level security;
alter table supplies disable row level security;
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
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE assignments; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='drift_predictions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE drift_predictions; END IF;
END $$;

-- ============================================================
-- Seed vessels
-- ============================================================
delete from assignments;
delete from drift_predictions;
delete from debris_sightings;
delete from supplies;
delete from vessels;

insert into vessels (name, zone, agency, status, fuel_level, fuel_threshold, capacity, current_lat, current_lon) values
  ('Ocean Guardian I',   'Zone A — California Coast', 'Local Coastguard', 'available',  78, 25, 100, 34.05, -120.42),
  ('Sea Shepherd II',    'Zone B — Hawaii Waters',    'Local Coastguard', 'available',  91, 25, 120, 21.30, -157.82),
  ('EPA Response Unit',  'Zone C — Federal Waters',   'EPA',              'available',  55, 25, 200, 36.10, -124.90),
  ('Pacific Interceptor','Zone A — California Coast', 'Local Coastguard', 'deployed',   40, 25,  80, 33.70, -118.50),
  ('Deep Clean Alpha',   'Zone D — Open Pacific',     'EPA',              'maintenance',20, 25, 150, 28.00, -145.00);

-- ============================================================
-- Seed supplies per zone
-- ============================================================
insert into supplies (name, zone, quantity, low_threshold) values
  ('Collection Nets',       'Zone A — California Coast', 8,  3),
  ('Fuel Drums',            'Zone A — California Coast', 3,  4),
  ('PPE Kits',              'Zone A — California Coast', 15, 5),
  ('Collection Bags',       'Zone A — California Coast', 40, 10),
  ('Collection Nets',       'Zone B — Hawaii Waters',    5,  3),
  ('Fuel Drums',            'Zone B — Hawaii Waters',    6,  4),
  ('Hazmat Suits',          'Zone B — Hawaii Waters',    2,  3),
  ('Collection Nets',       'Zone C — Federal Waters',   12, 3),
  ('Fuel Drums',            'Zone C — Federal Waters',   2,  4),
  ('Oil Booms',             'Zone C — Federal Waters',   4,  5),
  ('Skimmer Equipment',     'Zone D — Open Pacific',     1,  2),
  ('Fuel Drums',            'Zone D — Open Pacific',     3,  4);

-- ============================================================
-- Seed sample debris sightings + drift predictions
-- ============================================================
with s1 as (
  insert into debris_sightings (reporter_name, latitude, longitude, debris_type, density_score, density_label, estimated_volume, gemini_analysis, status, jurisdiction)
  values ('Coastal Patrol Officer Chen', 33.95, -119.20, 'plastic', 8, 'Critical', '~200 kg',
    'Large accumulation of plastic bottles, bags and microplastics observed. High marine life entanglement risk. Immediate cleanup recommended.',
    'reported', 'Local Coastguard')
  returning id
),
s2 as (
  insert into debris_sightings (reporter_name, latitude, longitude, debris_type, density_score, density_label, estimated_volume, gemini_analysis, status, jurisdiction)
  values ('Fisherman Rodriguez', 35.40, -122.80, 'fishing_gear', 6, 'Dense', '~80 kg',
    'Abandoned fishing nets and lines creating ghost fishing hazard. Moderate entanglement risk to marine mammals. Cleanup within 48 hours recommended.',
    'reported', 'Local Coastguard')
  returning id
)
insert into drift_predictions (sighting_id, lat_24h, lon_24h, lat_48h, lon_48h, lat_72h, lon_72h, current_speed, current_bearing)
select s1.id, 34.12, -118.60, 34.30, -118.00, 34.50, -117.40, 1.8, 75 from s1
union all
select s2.id, 35.55, -122.20, 35.70, -121.60, 35.85, -121.00, 1.5, 80 from s2;
