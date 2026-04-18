-- Adds the synthetic shore-patrol columns to the assignments table.
-- Safe to run multiple times.

alter table assignments add column if not exists shore_station_lat float;
alter table assignments add column if not exists shore_station_lon float;
alter table assignments add column if not exists shore_station_name text;

comment on column assignments.shore_station_lat is 'For synthetic shore patrols (land_crew_id is null) — base latitude on the coast';
comment on column assignments.shore_station_lon is 'For synthetic shore patrols (land_crew_id is null) — base longitude on the coast';
comment on column assignments.shore_station_name is 'Display name for the synthetic shore patrol';
