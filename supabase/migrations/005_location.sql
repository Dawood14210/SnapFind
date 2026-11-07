-- ============================================================================
-- Snapfind — Phase 3: location
--
-- Tables:
--   locations — per-player GPS readings (own row only: read + write)
--   reveals   — finder-only location clues (finder select; service-key write)
-- players.suspect — set by the speed check in round_status (service key).
--
-- RLS model: locations is the only table where clients write their own rows
-- (the location hook upserts readings). reveals is read-only for clients and
-- written only by Edge Functions with the service role key.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- locations: per-player GPS readings
-- -----------------------------------------------------------------------------
create table locations (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms (id) on delete cascade,
  player_id   uuid not null references auth.users (id) on delete cascade,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  accuracy_m  double precision,
  reading_at  timestamptz not null default now()
);

create index locations_room_player_idx on locations (room_id, player_id, reading_at desc);

-- Own row only: a player reads, inserts, updates and deletes their own rows.
alter table locations enable row level security;

drop policy if exists locations_own_select on locations;
create policy locations_own_select on locations
  for select to public using (player_id = auth.uid());

drop policy if exists locations_own_insert on locations;
create policy locations_own_insert on locations
  for insert to public with check (player_id = auth.uid());

drop policy if exists locations_own_update on locations;
create policy locations_own_update on locations
  for update to public using (player_id = auth.uid()) with check (player_id = auth.uid());

drop policy if exists locations_own_delete on locations;
create policy locations_own_delete on locations
  for delete to public using (player_id = auth.uid());

-- -----------------------------------------------------------------------------
-- reveals: finder-only location clues (pulse / zone_scan / clue / last_known /
-- out_of_bounds). target_player_id = the player the clue is about (the finder
-- for abilities, a hider for last_known / out_of_bounds).
-- -----------------------------------------------------------------------------
create table reveals (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms (id) on delete cascade,
  player_id        uuid not null references auth.users (id) on delete cascade,
  target_player_id uuid references auth.users (id) on delete set null,
  kind             text not null
                   check (kind in ('pulse', 'zone_scan', 'clue', 'last_known', 'out_of_bounds')),
  lat              double precision not null,
  lng              double precision not null,
  radius_m         integer,
  count            integer,
  label            text,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

create index reveals_room_player_idx on reveals (room_id, player_id, expires_at);
create index reveals_room_target_idx on reveals (room_id, target_player_id, kind, expires_at);

-- Finder select only (player_id = the finder). No client write policies —
-- Edge Functions write with the service role key.
alter table reveals enable row level security;

drop policy if exists reveals_finder_select on reveals;
create policy reveals_finder_select on reveals
  for select to public using (player_id = auth.uid());

-- -----------------------------------------------------------------------------
-- players.suspect: speed-check flag (service key writes it; clients read it)
-- -----------------------------------------------------------------------------
alter table players add column if not exists suspect boolean not null default false;

-- -----------------------------------------------------------------------------
-- Realtime: locations and reveals stay OUT of the Realtime publication (the
-- frontend polls round_status). No change to the publication needed.
-- -----------------------------------------------------------------------------
