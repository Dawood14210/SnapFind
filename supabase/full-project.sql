-- SNAPFIND: FULL FRESH-SUPABASE-PROJECT SETUP
-- Paste this entire script into the Supabase SQL Editor, once.
-- Requires Supabase-managed auth/storage schemas and roles.
-- NOT an upgrade or rerunnable reset. It deliberately refuses an existing rooms table.
-- No data is dropped. Edge Functions, anonymous sign-in and env vars need separate setup.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.rooms') IS NOT NULL THEN
    RAISE EXCEPTION 'Existing Snapfind schema detected. Apply only missing migrations; do not run full setup.';
  END IF;
END $$;


-- SOURCE: supabase/migrations/001_lobby.sql
-- =============================================================================
-- Snapfind — Phase 1: lobby
-- Tables: rooms, players, events
-- RPCs:   create_room, join_room, leave_room, kick_player, set_ready
--
-- Run in the Supabase SQL Editor, in order, before Phase 2.
--
-- RPCs are SECURITY DEFINER: they run as the function owner and perform their
-- own permission checks in SQL.
--
-- RLS policy model (corrected form):
--   * rooms, players and events are READ-ONLY for clients. Every policy is a
--     select policy and uses the is_room_member() helper.
--   * There are NO direct client write policies. Every write goes through an
--     RPC (SECURITY DEFINER, which bypasses RLS) or server-side code with the
--     service role key.
--   * Realtime: enable Realtime for the rooms, players and events tables
--     (Supabase default publication supabase_realtime). Changes respect RLS,
--     so members receive live updates for their own room only.
--
-- RPC errors are raised as exceptions whose message is the contract error
-- code, e.g. raise exception 'ROOM_FULL' -> PostgREST message 'ROOM_FULL'.
--
-- Naming rule: parameters are p_*, local variables are v_*, so PL/pgSQL
-- variable substitution never collides with column names.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- rooms
-- -----------------------------------------------------------------------------
create table rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  host_id          uuid not null references auth.users (id) on delete cascade,
  status           text not null default 'lobby'
                   check (status in ('lobby', 'hiding', 'hunting', 'paused', 'ended')),
  center_lat       double precision,
  center_lng       double precision,
  radius_m         integer,
  duration_min     integer not null default 30,
  started_at       timestamptz,
  paused_at        timestamptz,
  paused_total_ms  bigint not null default 0,
  finder_id        uuid references auth.users (id) on delete set null,
  scores_finalized boolean not null default false
);

-- -----------------------------------------------------------------------------
-- players (id = auth user id; one membership per player)
-- -----------------------------------------------------------------------------
create table players (
  id         uuid primary key references auth.users (id) on delete cascade,
  room_id    uuid not null references rooms (id) on delete cascade,
  nickname   text not null,
  role       text check (role in ('finder', 'hider')),
  status     text not null default 'active' check (status in ('active', 'tagged')),
  points     integer not null default 0,
  ready      boolean not null default false,
  joined_at  timestamptz not null default now(),
  unique (room_id, nickname)
);

-- -----------------------------------------------------------------------------
-- events (append-only game events, written by server code only)
-- -----------------------------------------------------------------------------
create table events (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms (id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index rooms_code_idx on rooms (code);
create index players_room_idx on players (room_id);
create index players_room_nickname_idx on players (room_id, nickname);
create index events_room_created_idx on events (room_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Row Level Security — read-only policies only
-- -----------------------------------------------------------------------------
alter table rooms enable row level security;
alter table players enable row level security;
alter table events enable row level security;

-- Membership helper (SECURITY DEFINER): true when the caller's auth user id
-- has a players row in the given room.
create or replace function is_room_member(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1 from players where id = auth.uid() and room_id = p_room_id
  );
end;
$$;

-- rooms: members read (no client write policies — writes go through RPCs)
create policy "rooms_members_select" on rooms for select to authenticated
  using (is_room_member(rooms.id));

-- players: members read (no client write policies — writes go through RPCs)
create policy "players_members_select" on players for select to authenticated
  using (is_room_member(players.room_id));

-- events: members read (no client write policies — server writes only)
create policy "events_members_select" on events for select to authenticated
  using (is_room_member(events.room_id));

-- -----------------------------------------------------------------------------
-- create_room: caller becomes host and a player
-- -----------------------------------------------------------------------------
create or replace function create_room(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alphabet text default 'ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code     text;
  v_attempts int := 0;
  v_j        int;
  v_room     rooms;
  v_player   players;
begin
  p_nickname := btrim(p_nickname);
  if p_nickname is null or length(p_nickname) < 1 or length(p_nickname) > 20 then
    raise exception 'NICKNAME_INVALID';
  end if;

  -- one membership per player: drop any previous ended-room membership
  delete from players
  where id = auth.uid()
    and room_id in (select id from rooms where status = 'ended');

  if exists (
    select 1 from players p join rooms r on r.id = p.room_id
    where p.id = auth.uid() and r.status <> 'ended'
  ) then
    raise exception 'ALREADY_IN_ROOM';
  end if;

  -- unique 6-letter code, no O, I, L
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'CODE_GENERATION_FAILED';
    end if;
    v_code := '';
    for v_j in 1..6 loop
      v_code := v_code || substr(v_alphabet, (floor(random() * length(v_alphabet)) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from rooms where code = v_code);
  end loop;

  insert into rooms (code, host_id) values (v_code, auth.uid()) returning * into v_room;
  insert into players (id, room_id, nickname)
  values (auth.uid(), v_room.id, p_nickname) returning * into v_player;

  return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player), 'host', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- join_room: lobby rooms only, max 25, unique nickname per room
-- -----------------------------------------------------------------------------
create or replace function join_room(p_code text, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room    rooms;
  v_player  players;
begin
  p_code := upper(btrim(p_code));
  p_nickname := btrim(p_nickname);

  if p_nickname is null or length(p_nickname) < 1 or length(p_nickname) > 20 then
    raise exception 'NICKNAME_INVALID';
  end if;
  if length(p_code) <> 6 or p_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ]+$' then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  -- one membership per player: drop any previous ended-room membership
  delete from players
  where id = auth.uid()
    and room_id in (select id from rooms where status = 'ended');

  if exists (
    select 1 from players p join rooms r on r.id = p.room_id
    where p.id = auth.uid() and r.status <> 'ended'
  ) then
    raise exception 'ALREADY_IN_ROOM';
  end if;

  select * into v_room from rooms where code = p_code;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'ROOM_NOT_LOBBY';
  end if;
  if exists (
    select 1 from players
    where room_id = v_room.id and lower(nickname) = lower(p_nickname)
  ) then
    raise exception 'NICKNAME_DUPLICATE';
  end if;
  if (select count(*) from players where room_id = v_room.id) >= 25 then
    raise exception 'ROOM_FULL';
  end if;

  insert into players (id, room_id, nickname)
  values (auth.uid(), v_room.id, p_nickname) returning * into v_player;

  return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player));
end;
$$;

-- -----------------------------------------------------------------------------
-- leave_room: allowed in lobby and after the round ended; a running round
-- (hiding/hunting/paused) refuses with ROUND_ACTIVE. Host handoff to the
-- earliest-joined player.
-- -----------------------------------------------------------------------------
create or replace function leave_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_host uuid;
begin
  if not exists (select 1 from players where id = auth.uid() and room_id = p_room_id) then
    raise exception 'NOT_IN_ROOM';
  end if;
  if (select status from rooms where id = p_room_id) in ('hiding', 'hunting', 'paused') then
    raise exception 'ROUND_ACTIVE';
  end if;

  if (select host_id from rooms where id = p_room_id) = auth.uid() then
    select id into v_new_host from players
    where room_id = p_room_id and id <> auth.uid()
    order by joined_at asc
    limit 1;
    if v_new_host is null then
      -- last player leaves: delete the room (cascades players + events)
      delete from rooms where id = p_room_id;
    else
      update rooms set host_id = v_new_host where id = p_room_id;
    end if;
  end if;

  delete from players where id = auth.uid() and room_id = p_room_id;
  return '{"ok": true}'::jsonb;
end;
$$;

-- -----------------------------------------------------------------------------
-- kick_player: host only, lobby only, never the host
-- -----------------------------------------------------------------------------
create or replace function kick_player(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  if (select status from rooms where id = p_room_id) <> 'lobby' then
    raise exception 'ROUND_ACTIVE';
  end if;
  if not exists (select 1 from players where id = p_player_id and room_id = p_room_id) then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if p_player_id = (select host_id from rooms where id = p_room_id) then
    raise exception 'CANNOT_KICK_HOST';
  end if;

  delete from players where id = p_player_id and room_id = p_room_id;
  return '{"ok": true}'::jsonb;
end;
$$;

-- -----------------------------------------------------------------------------
-- set_ready: lobby only
-- -----------------------------------------------------------------------------
create or replace function set_ready(p_room_id uuid, p_ready boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from players where id = auth.uid() and room_id = p_room_id) then
    raise exception 'NOT_IN_ROOM';
  end if;
  if (select status from rooms where id = p_room_id) <> 'lobby' then
    raise exception 'ROUND_ACTIVE';
  end if;

  update players set ready = p_ready where id = auth.uid() and room_id = p_room_id;
  return jsonb_build_object('ready', p_ready);
end;
$$;


-- SOURCE: supabase/migrations/002_play_area.sql
-- =============================================================================
-- Snapfind — Phase 2: play area, start, clock
-- RPCs: set_play_area, start_round, server_now, advance_round,
--       pause_round, resume_round, end_round
-- No new tables: all fields already exist on rooms / players / events.
--
-- The `round` object returned by advance_round matches shared/roundState.ts
-- getRoundState exactly (same field names, same paused-state semantics).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- set_play_area: host only, lobby only, radius 100-600 m
-- -----------------------------------------------------------------------------
create or replace function set_play_area(
  p_room_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  if (select status from rooms where id = p_room_id) <> 'lobby' then
    raise exception 'ROUND_ACTIVE';
  end if;
  if p_radius_m is null or p_radius_m < 100 or p_radius_m > 600 then
    raise exception 'INVALID_RADIUS';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'INVALID_COORDS';
  end if;

  update rooms
  set center_lat = p_lat, center_lng = p_lng, radius_m = p_radius_m
  where id = p_room_id;

  return jsonb_build_object(
    'ok', true,
    'play_area', jsonb_build_object(
      'center_lat', p_lat, 'center_lng', p_lng, 'radius_m', p_radius_m
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- start_round: host only; needs play area, all ready, >= 4 players;
-- picks the finder (chosen or random); sets status hiding, started_at = now()
-- -----------------------------------------------------------------------------
create or replace function start_round(p_room_id uuid, p_finder_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room      rooms;
  v_finder    uuid;
  v_players   integer;
  v_not_ready integer;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  select * into v_room from rooms where id = p_room_id;
  if v_room.status <> 'lobby' then
    raise exception 'ROUND_ACTIVE';
  end if;
  if v_room.center_lat is null or v_room.center_lng is null or v_room.radius_m is null then
    raise exception 'NO_PLAY_AREA';
  end if;
  select count(*) into v_players from players where room_id = p_room_id;
  if v_players < 4 then
    raise exception 'MIN_PLAYERS';
  end if;
  select count(*) into v_not_ready from players where room_id = p_room_id and ready = false;
  if v_not_ready > 0 then
    raise exception 'NOT_ALL_READY';
  end if;

  if p_finder_id is null then
    select id into v_finder from players where room_id = p_room_id order by random() limit 1;
  else
    if not exists (select 1 from players where id = p_finder_id and room_id = p_room_id) then
      raise exception 'FINDER_NOT_IN_ROOM';
    end if;
    v_finder := p_finder_id;
  end if;

  update rooms
  set status = 'hiding',
      started_at = now(),
      paused_at = null,
      paused_total_ms = 0,
      finder_id = v_finder
  where id = p_room_id;

  update players
  set role = case when id = v_finder then 'finder' else 'hider' end
  where room_id = p_room_id;

  insert into events (room_id, type, payload)
  values (p_room_id, 'round_started', jsonb_build_object('finder_id', v_finder));

  select * into v_room from rooms where id = p_room_id;
  return jsonb_build_object('ok', true, 'room', to_jsonb(v_room), 'finder_id', v_finder);
end;
$$;

-- -----------------------------------------------------------------------------
-- server_now: server clock in ms since epoch
-- -----------------------------------------------------------------------------
create or replace function server_now()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return jsonb_build_object('now', floor(extract(epoch from now()) * 1000)::bigint);
end;
$$;

-- -----------------------------------------------------------------------------
-- advance_round: idempotent phase transitions (hiding -> hunting at 3:00,
-- hunting -> ended at 30:00); returns room + round state
-- -----------------------------------------------------------------------------
create or replace function advance_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room              rooms;
  v_round_seconds     double precision;
  v_phase             text;
  v_seconds_left_phase double precision;
  v_seconds_left_round double precision;
  v_hunt_seconds      double precision;
  v_window            integer;
  v_now               timestamptz;
begin
  if not exists (select 1 from players where id = auth.uid() and room_id = p_room_id) then
    raise exception 'NOT_IN_ROOM';
  end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  v_now := case when v_room.status = 'paused' then v_room.paused_at else now() end;
  if v_room.started_at is null then
    v_round_seconds := 0;
  else
    v_round_seconds := greatest(0, least(1800,
      extract(epoch from (v_now - v_room.started_at)) - v_room.paused_total_ms / 1000.0));
  end if;

  -- idempotent transitions; no-op while paused
  if v_room.status = 'hiding' and v_round_seconds >= 180 then
    update rooms set status = 'hunting' where id = p_room_id;
    insert into events (room_id, type, payload)
    values (p_room_id, 'round_phase_changed',
            jsonb_build_object('from', 'hiding', 'to', 'hunting'));
    select * into v_room from rooms where id = p_room_id;
  end if;
  if v_room.status = 'hunting' and v_round_seconds >= 1800 then
    update rooms set status = 'ended' where id = p_room_id;
    insert into events (room_id, type, payload)
    values (p_room_id, 'round_ended', '{}');
    select * into v_room from rooms where id = p_room_id;
  end if;

  -- round state (matches shared/roundState.ts getRoundState)
  if v_room.started_at is null or v_room.status = 'lobby' then
    v_phase := 'lobby';
    v_round_seconds := 0;
    v_seconds_left_phase := 0;
    v_seconds_left_round := 0;
    v_hunt_seconds := 0;
    v_window := 0;
  else
    v_phase := v_room.status;
    v_seconds_left_round := greatest(0, 1800 - v_round_seconds);
    v_hunt_seconds := greatest(0, v_round_seconds - 180);
    if v_room.status = 'hiding'
       or (v_room.status = 'paused' and v_round_seconds < 180) then
      v_seconds_left_phase := greatest(0, 180 - v_round_seconds);
    else
      v_seconds_left_phase := v_seconds_left_round;
    end if;
    if v_room.status in ('hiding', 'hunting', 'paused') then
      v_window := least(5, floor(v_round_seconds / 300)::int);
    else
      v_window := 0;
    end if;
  end if;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'round', jsonb_build_object(
      'phase', v_phase,
      'round_seconds', v_round_seconds,
      'seconds_left_in_round', v_seconds_left_round,
      'seconds_left_in_phase', v_seconds_left_phase,
      'hunt_seconds', v_hunt_seconds,
      'window', v_window
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- pause_round: host only, hiding/hunting only
-- -----------------------------------------------------------------------------
create or replace function pause_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paused_at timestamptz;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  if (select status from rooms where id = p_room_id) not in ('hiding', 'hunting') then
    raise exception 'NOT_ACTIVE';
  end if;

  v_paused_at := now();
  update rooms set status = 'paused', paused_at = v_paused_at where id = p_room_id;
  return jsonb_build_object('ok', true, 'paused_at', v_paused_at);
end;
$$;

-- -----------------------------------------------------------------------------
-- resume_round: host only, paused only; adds the pause to paused_total_ms and
-- returns to hiding/hunting based on the round time at resume
-- -----------------------------------------------------------------------------
create or replace function resume_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room          rooms;
  v_elapsed_ms    bigint;
  v_round_seconds double precision;
  v_new_status    text;
  v_new_total     bigint;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  select * into v_room from rooms where id = p_room_id;
  if v_room.status <> 'paused' then
    raise exception 'NOT_PAUSED';
  end if;

  v_elapsed_ms := floor(extract(epoch from (now() - v_room.paused_at)) * 1000)::bigint;
  v_round_seconds := greatest(0, least(1800,
    extract(epoch from (now() - v_room.started_at)) - (v_room.paused_total_ms + v_elapsed_ms) / 1000.0));
  v_new_status := case when v_round_seconds < 180 then 'hiding' else 'hunting' end;
  v_new_total := v_room.paused_total_ms + v_elapsed_ms;

  update rooms
  set status = v_new_status,
      paused_at = null,
      paused_total_ms = v_new_total
  where id = p_room_id;

  return jsonb_build_object('ok', true, 'paused_total_ms', v_new_total);
end;
$$;

-- -----------------------------------------------------------------------------
-- end_round: host only, manual end (scores are finalised separately)
-- -----------------------------------------------------------------------------
create or replace function end_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room rooms;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  update rooms set status = 'ended' where id = p_room_id;
  select * into v_room from rooms where id = p_room_id;
  return jsonb_build_object('ok', true, 'room', to_jsonb(v_room));
end;
$$;


-- SOURCE: supabase/migrations/003_room_settings.sql
-- ============================================================================
-- Snapfind — Room settings (hide duration, round duration, player limit)
--
-- Adds per-room settings on rooms and a set_room_settings RPC so the host can
-- edit them before the round starts. The round clock then uses these values:
--   - join_room        refuses when the room is at the room's max_players
--   - advance_round    transitions at hide_duration_min and duration_min
--   - getRoundState    (shared/roundState.ts) reads the same fields
--
-- Defaults match shared/constants.ts: hide 3 min, round 30 min, max 25 players.
-- Naming rule: parameters are p_*, local variables are v_*.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- rooms: per-room settings
-- -----------------------------------------------------------------------------
alter table rooms
  add column if not exists hide_duration_min integer not null default 3,
  add column if not exists max_players integer not null default 25;

-- Existing rows get the defaults via the not-null defaults above.

-- -----------------------------------------------------------------------------
-- set_room_settings: host only, lobby only
-- Validations: hide 1-15 min, round 5-60 min, round > hide, players 4-25.
-- -----------------------------------------------------------------------------
create or replace function set_room_settings(
  p_room_id uuid,
  p_hide_duration_min integer,
  p_duration_min integer,
  p_max_players integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room rooms;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  if (select status from rooms where id = p_room_id) <> 'lobby' then
    raise exception 'ROUND_ACTIVE';
  end if;
  if p_hide_duration_min is null or p_hide_duration_min < 1 or p_hide_duration_min > 15 then
    raise exception 'INVALID_HIDE_DURATION';
  end if;
  if p_duration_min is null or p_duration_min < 5 or p_duration_min > 60 then
    raise exception 'INVALID_ROUND_DURATION';
  end if;
  if p_duration_min <= p_hide_duration_min then
    raise exception 'INVALID_ROUND_DURATION';
  end if;
  if p_max_players is null or p_max_players < 4 or p_max_players > 25 then
    raise exception 'INVALID_PLAYER_LIMIT';
  end if;

  select * into v_room from rooms where id = p_room_id;
  update rooms
  set hide_duration_min = p_hide_duration_min,
      duration_min = p_duration_min,
      max_players = p_max_players
  where id = p_room_id;
  select * into v_room from rooms where id = p_room_id;

  return jsonb_build_object('ok', true, 'room', to_jsonb(v_room));
end;
$$;

-- -----------------------------------------------------------------------------
-- join_room: room full check uses the room's max_players (was hard-coded 25)
-- -----------------------------------------------------------------------------
create or replace function join_room(p_code text, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room    rooms;
  v_player  players;
  v_count   integer;
begin
  select * into v_room from rooms where code = upper(p_code);
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'ROOM_NOT_LOBBY';
  end if;
  if exists (
    select 1 from players where id = auth.uid() and room_id = v_room.id
  ) then
    raise exception 'ALREADY_IN_ROOM';
  end if;
  if exists (
    select 1 from players where room_id = v_room.id
      and lower(nickname) = lower(btrim(p_nickname))
  ) then
    raise exception 'NICKNAME_DUPLICATE';
  end if;
  if (select count(*) from players where room_id = v_room.id) >= v_room.max_players then
    raise exception 'ROOM_FULL';
  end if;

  insert into players (id, room_id, nickname)
  values (auth.uid(), v_room.id, btrim(p_nickname)) returning * into v_player;

  return jsonb_build_object('room', to_jsonb(v_room), 'player', to_jsonb(v_player));
end;
$$;

-- -----------------------------------------------------------------------------
-- advance_round: phase transitions use the room's hide_duration_min and
-- duration_min (was hard-coded 180 / 1800 seconds)
-- -----------------------------------------------------------------------------
create or replace function advance_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room              rooms;
  v_round_seconds     double precision;
  v_phase             text;
  v_seconds_left_phase double precision;
  v_seconds_left_round double precision;
  v_hunt_seconds      double precision;
  v_window            integer;
  v_now               timestamptz;
  v_hide_sec          double precision;
  v_round_sec         double precision;
begin
  if not exists (select 1 from players where id = auth.uid() and room_id = p_room_id) then
    raise exception 'NOT_IN_ROOM';
  end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  v_hide_sec := v_room.hide_duration_min * 60.0;
  v_round_sec := v_room.duration_min * 60.0;

  v_now := case when v_room.status = 'paused' then v_room.paused_at else now() end;
  if v_room.started_at is null then
    v_round_seconds := 0;
  else
    v_round_seconds := greatest(0, least(v_round_sec,
      extract(epoch from (v_now - v_room.started_at)) - v_room.paused_total_ms / 1000.0));
  end if;

  -- idempotent transitions; no-op while paused
  if v_room.status = 'hiding' and v_round_seconds >= v_hide_sec then
    update rooms set status = 'hunting' where id = p_room_id;
    insert into events (room_id, type, payload)
    values (p_room_id, 'round_phase_changed',
            jsonb_build_object('from', 'hiding', 'to', 'hunting'));
    select * into v_room from rooms where id = p_room_id;
  end if;
  if v_room.status = 'hunting' and v_round_seconds >= v_round_sec then
    update rooms set status = 'ended' where id = p_room_id;
    insert into events (room_id, type, payload)
    values (p_room_id, 'round_ended', '{}');
    select * into v_room from rooms where id = p_room_id;
  end if;

  -- round state (matches shared/roundState.ts getRoundState)
  if v_room.started_at is null or v_room.status = 'lobby' then
    v_phase := 'lobby';
    v_round_seconds := 0;
    v_seconds_left_phase := 0;
    v_seconds_left_round := 0;
    v_hunt_seconds := 0;
    v_window := 0;
  else
    v_phase := v_room.status;
    v_seconds_left_round := greatest(0, v_round_sec - v_round_seconds);
    v_hunt_seconds := greatest(0, v_round_seconds - v_hide_sec);
    if v_room.status = 'hiding'
       or (v_room.status = 'paused' and v_round_seconds < v_hide_sec) then
      v_seconds_left_phase := greatest(0, v_hide_sec - v_round_seconds);
    else
      v_seconds_left_phase := v_seconds_left_round;
    end if;
    if v_room.status in ('hiding', 'hunting', 'paused') then
      v_window := least(5, floor(v_round_seconds / 300)::int);
    else
      v_window := 0;
    end if;
  end if;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'round', jsonb_build_object(
      'phase', v_phase,
      'round_seconds', v_round_seconds,
      'seconds_left_in_round', v_seconds_left_round,
      'seconds_left_in_phase', v_seconds_left_phase,
      'hunt_seconds', v_hunt_seconds,
      'window', v_window
    )
  );
end;
$$;


-- SOURCE: supabase/migrations/004_dev_tools.sql
-- ============================================================================
-- Snapfind — Dev tools: dummy players for testing
--
-- dev_add_dummy_players(p_room_id, p_count) lets the host of a lobby room
-- drop in 1-10 ready dummy players so rounds can be tested without enough
-- real phones. Each dummy gets a fresh auth.users row (players.id references
-- auth.users) and a players row with a unique nickname, ready = true.
-- The host can remove them with the normal Kick button.
--
-- Naming rule: parameters are p_*, local variables are v_*.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- dev_add_dummy_players: host only, lobby only, 1-10 players
-- Errors: NOT_HOST, ROUND_ACTIVE, INVALID_COUNT, ROOM_FULL
-- -----------------------------------------------------------------------------
create or replace function dev_add_dummy_players(p_room_id uuid, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room   rooms;
  v_i      integer;
  v_uid    uuid;
  v_nick   text;
  v_added  integer := 0;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  if (select status from rooms where id = p_room_id) <> 'lobby' then
    raise exception 'ROUND_ACTIVE';
  end if;
  if p_count is null or p_count < 1 or p_count > 10 then
    raise exception 'INVALID_COUNT';
  end if;

  select * into v_room from rooms where id = p_room_id;
  if (select count(*) from players where room_id = p_room_id) + p_count > v_room.max_players then
    raise exception 'ROOM_FULL';
  end if;

  for v_i in 1..p_count loop
    v_uid := gen_random_uuid();
    v_nick := 'dummy' || v_i || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    insert into auth.users (id, email)
    values (v_uid, v_nick || '@example.com');
    insert into players (id, room_id, nickname, ready)
    values (v_uid, p_room_id, v_nick, true);
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('ok', true, 'added', v_added);
end;
$$;


-- SOURCE: supabase/migrations/005_location.sql
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


-- SOURCE: supabase/migrations/006_snapshots.sql
-- ============================================================================
-- Snapfind — Phase 4: snapshots
-- ----------------------------------------------------------------------------
-- Tables:
--   snapshots          — submitted photos (finder/tagged read all; a hider
--                        reads their own; own insert; service-key writes)
--   reveals.window_index — marks which snapshot window a last_known reveal
--                        answers to (keeps resolve_window idempotent)
--
-- Storage:
--   this migration creates the private `snapshots` bucket itself (insert
--   into storage.buckets, idempotent). Clients may insert images only into
--   their own folder {room_id}/{player_id}/{window_index}.jpg (policy
--   below); images are served via 60-second signed URLs from the
--   snapshot_urls Edge Function (service key).
--
-- The snapshot flow itself (submit_snapshot, resolve_window, snapshot_urls)
-- lives in Edge Functions — see docs/api-contract.md section 4 and
-- docs/backend-setup.md section 6.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- snapshots: one row per hider per window (window 0 = bonus photo-task
-- snapshot, Phase 5; task_id is set for those).
-- ----------------------------------------------------------------------------
create table snapshots (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms (id) on delete cascade,
  player_id    uuid not null references auth.users (id) on delete cascade,
  window_index integer not null check (window_index >= 0),
  task_id      uuid,
  image_path   text not null,
  taken_at     timestamptz not null default now(),
  late         boolean not null default false,
  unique (room_id, player_id, window_index)
);

create index snapshots_room_idx on snapshots (room_id, taken_at desc);
create index snapshots_room_window_idx on snapshots (room_id, window_index);

alter table snapshots enable row level security;

-- select: own row; the room's finder; tagged players; anyone once the round
-- has ended. Multiple select policies OR together.
drop policy if exists snapshots_own_select on snapshots;
create policy snapshots_own_select on snapshots for select to authenticated
  using (player_id = auth.uid());

drop policy if exists snapshots_finder_select on snapshots;
create policy snapshots_finder_select on snapshots for select to authenticated
  using (exists (
    select 1 from players p
    where p.id = auth.uid() and p.room_id = snapshots.room_id and p.role = 'finder'
  ));

drop policy if exists snapshots_tagged_select on snapshots;
create policy snapshots_tagged_select on snapshots for select to authenticated
  using (exists (
    select 1 from players p
    where p.id = auth.uid() and p.room_id = snapshots.room_id and p.status = 'tagged'
  ));

drop policy if exists snapshots_ended_select on snapshots;
create policy snapshots_ended_select on snapshots for select to authenticated
  using (exists (
    select 1 from rooms r where r.id = snapshots.room_id and r.status = 'ended'
  ));

-- insert: own row only (the client inserts after uploading its own image;
-- submit_snapshot also inserts with the service key). INSERT policies use
-- WITH CHECK only (USING is meaningless on insert).
drop policy if exists snapshots_own_insert on snapshots;
create policy snapshots_own_insert on snapshots for insert to authenticated
  with check (player_id = auth.uid());

-- ----------------------------------------------------------------------------
-- reveals.window_index: which snapshot window a last_known reveal answers
-- to. NULL for ability / out_of_bounds reveals. Used to keep
-- resolve_window idempotent (a hider is revealed once per missed window).
-- ----------------------------------------------------------------------------
alter table reveals add column if not exists window_index integer;
create index if not exists reveals_room_target_window_idx
  on reveals (room_id, target_player_id, kind, window_index);

-- ----------------------------------------------------------------------------
-- Storage: create the private `snapshots` bucket (idempotent — the dashboard
-- step in docs/backend-setup.md section 3 becomes optional), then allow
-- uploads only into the caller's own folder
-- {room_id}/{player_id}/{window_index}.jpg, and only while the caller has a
-- players row in that room. Reads stay denied for the anon key (images are
-- served via signed URLs from snapshot_urls). INSERT policies use WITH CHECK
-- only.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('snapshots', 'snapshots', false)
on conflict do nothing;

create or replace function is_snapshot_uploader(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return (
    p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+\.jpg$'
    and split_part(p_name, '/', 2)::uuid = auth.uid()
    and exists (
      select 1 from players
      where id = auth.uid() and room_id = split_part(p_name, '/', 1)::uuid
    )
  );
end;
$$;

drop policy if exists snapshots_bucket_own_insert on storage.objects;
create policy snapshots_bucket_own_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'snapshots' and is_snapshot_uploader(name));


-- SOURCE: supabase/migrations/007_tasks.sql
-- ============================================================================
-- Snapfind — Phase 5: tasks
-- ----------------------------------------------------------------------------
-- Tables:
--   tasks            — per-hide tasks (own row read only; service-key write)
--   players.skips_used — skips used this round (2 per round, -5 points each;
--                        reset by rematch, Phase 7)
--
-- The task flow itself (assignment, completion, skip) lives in Edge
-- Functions — see docs/api-contract.md section 4 and docs/backend-setup.md
-- section 6. Completion is server-side: task_progress reads the hider's own
-- GPS readings from `locations` and the bonus snapshot from `snapshots`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tasks: one row per task assignment. status moves active -> done / skipped /
-- expired (server-side, in task_progress / skip_task). params is jsonb:
--   reach_zone { lat, lng, radius_m: 30 } — a circle inside the play area;
--   distance  { lat, lng, radius_m: 80 } — the play area centre (get 80 m away);
--   stay_put / photo — {}.
-- ----------------------------------------------------------------------------
create table tasks (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms (id) on delete cascade,
  player_id    uuid not null references auth.users (id) on delete cascade,
  type         text not null
               check (type in ('reach_zone', 'stay_put', 'distance', 'photo')),
  params       jsonb not null default '{}'::jsonb,
  status       text not null default 'active'
               check (status in ('pending', 'active', 'done', 'skipped', 'expired')),
  points       integer not null,
  assigned_at  timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index tasks_room_player_idx on tasks (room_id, player_id, assigned_at desc);

-- Hider reads their own rows only; Edge Functions write with the service
-- role key (no client write policies).
alter table tasks enable row level security;

drop policy if exists tasks_own_select on tasks;
create policy tasks_own_select on tasks for select to authenticated
  using (player_id = auth.uid());

-- ----------------------------------------------------------------------------
-- players.skips_used: skips used this round (skip_task increments it;
-- rematch resets players, Phase 7).
-- ----------------------------------------------------------------------------
alter table players add column if not exists skips_used integer not null default 0;


-- SOURCE: supabase/migrations/008_abilities.sql
-- ============================================================================
-- Snapfind — Phase 6: abilities
-- ----------------------------------------------------------------------------
-- Tables:
--   ability_uses — one row per ability use (finder reads own rows; the
--                  service key writes). The charge spend, the 30 s cooldown
--                  and the pulse repeat check all read this table.
--
-- The ability flow itself (charges, cooldown, reveals) lives in the
-- use_ability Edge Function — see docs/api-contract.md section 4 and
-- docs/backend-setup.md section 6. Ability reveals are written to the
-- existing `reveals` table with kind 'pulse' / 'zone_scan' / 'clue'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ability_uses: one row per ability use. kind = the ability name only
-- (pulse / zone_scan / clue_card) — never coordinates or hider identities.
-- ----------------------------------------------------------------------------
create table ability_uses (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms (id) on delete cascade,
  player_id    uuid not null references auth.users (id) on delete cascade,
  kind         text not null
               check (kind in ('pulse', 'zone_scan', 'clue_card')),
  created_at   timestamptz not null default now()
);

create index ability_uses_room_player_idx
  on ability_uses (room_id, player_id, created_at desc);

-- Finder reads their own rows only; Edge Functions write with the service
-- role key (no client write policies).
alter table ability_uses enable row level security;

drop policy if exists ability_uses_finder_select on ability_uses;
create policy ability_uses_finder_select on ability_uses for select to authenticated
  using (player_id = auth.uid());


-- SOURCE: supabase/migrations/009_tags.sql
-- ============================================================================
-- Snapfind — Phase 7: tags, scores, rematch
-- ----------------------------------------------------------------------------
-- Tables:
--   tags — one row per tag request (finder+hider); status moves
--          pending -> confirmed / disputed / denied. The hider confirms or
--          disputes; 10 s of silence auto-confirms. The host resolves
--          disputes (confirmed applies the same effects as confirm_tag;
--          denied closes the tag with no points and the hider stays active).
--
-- RPCs:
--   rematch — host only, round must be ended. Wipes round data, resets
--             players, keeps the play area, sets status lobby. Returns the
--             next finder (top-scoring hider of the finished round).
--
-- Scoring lives in Edge Functions (finalize_scores) and shared helpers
-- (functions/lib/tags.ts) — see docs/api-contract.md section 4.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- tags: one row per tag request. status moves pending -> confirmed / disputed
-- / denied. points stores the finder points awarded on confirmation (null
-- until then).
-- ----------------------------------------------------------------------------
create table tags (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms (id) on delete cascade,
  finder_id  uuid not null references auth.users (id) on delete cascade,
  hider_id   uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending', 'confirmed', 'disputed', 'denied')),
  points     integer,
  created_at timestamptz not null default now()
);

create index tags_room_created_idx on tags (room_id, created_at desc);
create index tags_room_hider_status_idx on tags (room_id, hider_id, status);

-- Finder reads own tags; hider reads tags about them; host reads all;
-- everyone reads all after the round ends. Edge Functions write with the
-- service role key (no client write policies).
alter table tags enable row level security;

drop policy if exists tags_finder_select on tags;
create policy tags_finder_select on tags for select to authenticated
  using (finder_id = auth.uid());

drop policy if exists tags_hider_select on tags;
create policy tags_hider_select on tags for select to authenticated
  using (hider_id = auth.uid());

drop policy if exists tags_host_select on tags;
create policy tags_host_select on tags for select to authenticated
  using (exists (select 1 from rooms where id = tags.room_id and host_id = auth.uid()));

drop policy if exists tags_after_round_select on tags;
create policy tags_after_round_select on tags for select to authenticated
  using (exists (select 1 from rooms where id = tags.room_id and status = 'ended'));

-- ----------------------------------------------------------------------------
-- rematch: host only, round must be ended. Wipes round data, resets players,
-- keeps the play area, sets status lobby. Next finder = top-scoring hider.
-- ----------------------------------------------------------------------------
create or replace function rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room          rooms;
  v_next_finder   uuid;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'ended' then
    raise exception 'ROUND_NOT_ENDED';
  end if;

  -- Next finder: top-scoring hider (ties broken by nickname for determinism).
  select id into v_next_finder from players
  where room_id = p_room_id and role = 'hider'
  order by points desc, nickname asc
  limit 1;

  -- Wipe round data.
  delete from snapshots where room_id = p_room_id;
  delete from tasks where room_id = p_room_id;
  delete from ability_uses where room_id = p_room_id;
  delete from tags where room_id = p_room_id;
  delete from reveals where room_id = p_room_id;
  delete from events where room_id = p_room_id;
  delete from locations where room_id = p_room_id;

  -- Reset players for the next round.
  update players set
    points      = 0,
    ready       = false,
    status      = 'active',
    role        = null,
    suspect     = false,
    skips_used  = 0
  where room_id = p_room_id;

  -- Lobby: keep the play area and room settings, reset the round clock.
  update rooms set
    status           = 'lobby',
    scores_finalized = false,
    finder_id        = null,
    started_at       = null,
    paused_at        = null,
    paused_total_ms  = 0
  where id = p_room_id;

  return jsonb_build_object('ok', true, 'finder_id', v_next_finder);
end;
$$;


-- SOURCE: supabase/migrations/010_safety.sql
-- Phase 8: private SOS positions and atomic pause.
create table public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now()
);
create index sos_alerts_room_created_idx on public.sos_alerts(room_id, created_at desc);
alter table public.sos_alerts enable row level security;
create policy sos_alerts_host_select on public.sos_alerts for select to authenticated
  using (exists (select 1 from public.rooms r where r.id = sos_alerts.room_id and r.host_id = auth.uid()));

create or replace function public.record_sos(p_room_id uuid, p_player_id uuid, p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_room public.rooms; v_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if not exists (select 1 from public.players where room_id = p_room_id and id = p_player_id) then raise exception 'NOT_IN_ROOM'; end if;
  if v_room.status not in ('hiding','hunting','paused') then raise exception 'ROUND_NOT_ACTIVE'; end if;
  insert into public.sos_alerts(room_id,player_id,lat,lng) values(p_room_id,p_player_id,p_lat,p_lng) returning id into v_id;
  -- Repeated alerts must not restart the pause clock.
  if v_room.status <> 'paused' then
    update public.rooms set status='paused', paused_at=clock_timestamp() where id=p_room_id;
  end if;
  -- Events are member-readable: coordinates must NEVER go here.
  insert into public.events(room_id,type,payload) values(p_room_id,'sos',jsonb_build_object('alert_id',v_id,'player_id',p_player_id));
  return jsonb_build_object('ok',true,'alert_id',v_id,'round_paused',true);
end; $$;
revoke all on function public.record_sos(uuid,uuid,double precision,double precision) from public, anon, authenticated;
grant execute on function public.record_sos(uuid,uuid,double precision,double precision) to service_role;

-- Guard the SQL reset and remove old safety alerts.
create or replace function rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room          rooms;
  v_next_finder   uuid;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'NOT_HOST';
  end if;
  select * into v_room from rooms where id = p_room_id;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'ended' then
    raise exception 'ROUND_NOT_ENDED';
  end if;

  -- Direct RPC callers must not bypass storage cleanup.
  if exists (select 1 from storage.objects where bucket_id='snapshots'
    and name like p_room_id::text || '/%') then
    raise exception 'PHOTOS_NOT_PURGED';
  end if;

  -- Next finder: top-scoring hider (ties broken by nickname for determinism).
  select id into v_next_finder from players
  where room_id = p_room_id and role = 'hider'
  order by points desc, nickname asc
  limit 1;

  -- Wipe round data.
  delete from sos_alerts where room_id = p_room_id;
  delete from snapshots where room_id = p_room_id;
  delete from tasks where room_id = p_room_id;
  delete from ability_uses where room_id = p_room_id;
  delete from tags where room_id = p_room_id;
  delete from reveals where room_id = p_room_id;
  delete from events where room_id = p_room_id;
  delete from locations where room_id = p_room_id;

  -- Reset players for the next round.
  update players set
    points      = 0,
    ready       = false,
    status      = 'active',
    role        = null,
    suspect     = false,
    skips_used  = 0
  where room_id = p_room_id;

  -- Lobby: keep the play area and room settings, reset the round clock.
  update rooms set
    status           = 'lobby',
    scores_finalized = false,
    finder_id        = null,
    started_at       = null,
    paused_at        = null,
    paused_total_ms  = 0
  where id = p_room_id;

  return jsonb_build_object('ok', true, 'finder_id', v_next_finder);
end;
$$;


-- SOURCE: supabase/migrations/fixes/leave_room_ended.sql
-- ============================================================================
-- Snapfind — bug fix: leave an ended room
-- ----------------------------------------------------------------------------
-- Problem: leave_room refused whenever rooms.status <> 'lobby', so after a
-- round ended (status 'ended') the player could not leave — the UI showed
-- ROUND_ACTIVE ("The round already started.").
--
-- Fix: leave_room now refuses only while the round is actually running
-- (hiding / hunting / paused). Leaving is allowed in the lobby and after
-- the round has ended.
--
-- Paste this into the Supabase SQL Editor (Authentication → SQL Editor →
-- New query) if you have already run 001_lobby.sql. The updated function
-- is also in 001_lobby.sql in the repo (the source of truth).
-- ============================================================================

create or replace function leave_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_host uuid;
begin
  if not exists (select 1 from players where id = auth.uid() and room_id = p_room_id) then
    raise exception 'NOT_IN_ROOM';
  end if;
  if (select status from rooms where id = p_room_id) in ('hiding', 'hunting', 'paused') then
    raise exception 'ROUND_ACTIVE';
  end if;

  if (select host_id from rooms where id = p_room_id) = auth.uid() then
    select id into v_new_host from players
    where room_id = p_room_id and id <> auth.uid()
    order by joined_at asc
    limit 1;
    if v_new_host is null then
      -- last player leaves: delete the room (cascades players + events)
      delete from rooms where id = p_room_id;
    else
      update rooms set host_id = v_new_host where id = p_room_id;
    end if;
  end if;

  delete from players where id = auth.uid() and room_id = p_room_id;
  return '{"ok": true}'::jsonb;
end;
$$;


-- Realtime: private locations and SOS positions stay out of the publication.
DO $$ DECLARE v_table text; BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['rooms','players','events'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
        AND schemaname='public' AND tablename=v_table) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
      END IF;
    END LOOP;
  END IF;
END $$;
COMMIT;
