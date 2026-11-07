# Snapfind — Backend Setup (human runs these)

This document lists everything the human must do by hand in Supabase. Agent A
(backend) writes the SQL migrations and Edge Functions; nothing here is automatic.

## 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and create a new project
   (e.g. named `snapfind`). Pick any region.
2. Note the project URL: `https://<ref>.supabase.co`.

## 2. Enable anonymous sign-in

1. Authentication → Providers → **Anonymous** → Enable.
2. (Optional but recommended) Authentication → Authentication → Security → restrict
   sign-ups to anonymous only, per your preference. The game uses anonymous
   sign-in exclusively.

## 3. Create the snapshots bucket

1. Storage → New bucket → name: **`snapshots`** → private (never public).
2. The bucket stores photos at `{room_id}/{player_id}/{window_index}.jpg`.
   Row Level Security on the `snapshots` table enforces who may read which rows;
   the bucket itself stays private and files are served via short-lived signed
   URLs from the `snapshot_urls` Edge Function.

## 4. Environment variables

| Variable | Where | Who uses it |
|----------|-------|-------------|
| `SUPABASE_URL` | Edge Functions + local scripts | all |
| `SUPABASE_ANON_KEY` | Edge Functions + local scripts | all (public key, safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions + local scripts **only** | server logic; **never in the frontend, never in git** |

- Edge Functions: add them in the dashboard under each function's settings
  (or via the Supabase CLI). The service role key is a secret — store it in the
  function's environment, not in code.
- Local scripts (`scripts/rls-check.ts`, `scripts/bots.ts`): copy
  `scripts/.env.example` to `scripts/.env` (gitignored) and fill in the values.

## 5. Run the migrations

Migrations live in `/supabase/migrations/`, one file per phase, named
`NNN_phase_name.sql`. Run them **in numeric order** in the Supabase SQL Editor
(Authentication → SQL Editor → New query → paste → Run).

Combined per-phase SQL (paste the whole block for a phase in order):

| Phase | File | Combined SQL |
|-------|------|--------------|
| 1 | `001_lobby.sql` | **shipped** — full SQL below |
| 2 | `002_play_area.sql` | **shipped** — full SQL below |
| 3 | `003_location.sql` | ships with the Phase 3 PR |
| 4 | `004_snapshots.sql` | ships with the Phase 4 PR |
| 5 | `005_tasks.sql` | ships with the Phase 5 PR |
| 6 | `006_abilities.sql` | ships with the Phase 6 PR |
| 7 | `007_tags.sql` | ships with the Phase 7 PR |
| 8 | `008_safety.sql` | ships with the Phase 8 PR |

Each phase's PR includes the combined SQL for that phase in its report.

## 5b. Phase 1 combined SQL (paste into the SQL Editor)

This is the complete Phase 1 migration (`001_lobby.sql`) — paste it as one block:

```sql
-- =============================================================================
-- Snapfind — Phase 1: lobby
-- Tables: rooms, players, events
-- RPCs:   create_room, join_room, leave_room, kick_player, set_ready
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
-- RPCs are SECURITY DEFINER: they run as the function owner and perform their
-- own permission checks in SQL.
--
-- RPC errors are raised as exceptions whose message is the contract
-- error code, e.g. raise exception 'ROOM_FULL' -> PostgREST message 'ROOM_FULL'.
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
-- leave_room: lobby only; host handoff to the earliest-joined player
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
  if (select status from rooms where id = p_room_id) <> 'lobby' then
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
```

## 5c. Phase 2 combined SQL (paste into the SQL Editor)

This is the complete Phase 2 migration (`002_play_area.sql`) — paste it as one block:

```sql
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
```

## 6. Add the Edge Functions

Edge Functions live in `/supabase/functions/*.ts`. Add each one in the dashboard
(Edge Functions → New function, or deploy the folder with the Supabase CLI).

| Function | Phase | File | Required env |
|----------|-------|------|--------------|
| `round_status` | 3 | `functions/round_status/index.ts` | URL, anon key, service key |
| `submit_snapshot` | 4 | `functions/submit_snapshot/index.ts` | URL, anon key, service key |
| `snapshot_urls` | 4 | `functions/snapshot_urls/index.ts` | URL, anon key, service key |
| `resolve_window` | 4 | `functions/resolve_window/index.ts` | URL, anon key, service key |
| `task_progress` | 5 | `functions/task_progress/index.ts` | URL, anon key, service key |
| `skip_task` | 5 | `functions/skip_task/index.ts` | URL, anon key, service key |
| `use_ability` | 6 | `functions/use_ability/index.ts` | URL, anon key, service key |
| `request_tag` | 7 | `functions/request_tag/index.ts` | URL, anon key, service key |
| `confirm_tag` | 7 | `functions/confirm_tag/index.ts` | URL, anon key, service key |
| `dispute_tag` | 7 | `functions/dispute_tag/index.ts` | URL, anon key, service key |
| `finalize_tag` | 7 | `functions/finalize_tag/index.ts` | URL, anon key, service key |
| `resolve_dispute` | 7 | `functions/resolve_dispute/index.ts` | URL, anon key, service key |
| `finalize_scores` | 7 | `functions/finalize_scores/index.ts` | URL, anon key, service key |
| `sos` | 8 | `functions/sos/index.ts` | URL, anon key, service key |
| `purge_photos` | 8 | `functions/purge_photos/index.ts` | URL, anon key, service key |

RPCs (`create_room`, `join_room`, …) are plain Postgres functions created by the
migrations — no manual step beyond running the SQL.

## 7. Row Level Security checklist

Every table must have RLS enabled. Policies are created by the migrations; the
`scripts/rls-check.ts` script (Phase 8) verifies them by signing in as a test
hider and a test finder and attempting forbidden reads.

| Table | Phase | Policy summary |
|-------|-------|----------------|
| rooms | 1 | members select (read-only); all writes via RPCs |
| players | 1 | members select (read-only); all writes via RPCs |
| events | 1 | members select (read-only); server writes only |
| locations | 3 | **own row only** |
| reveals | 3/4 | **finder select only** |
| snapshots | 4 | finder/tagged read all; hider own; own insert; service-key update/delete |
| tasks | 5 | **own row read** |
| ability_uses | 6 | **finder select** |
| tags | 7 | members select; service-key write |
| sos_alerts | 8 | **host select** |

All policies use the `is_room_member()` helper (SECURITY DEFINER). There are
**no direct client write policies** on rooms, players or events — every write
goes through an RPC or server-side code with the service role key.

Realtime: enable Realtime for the `rooms`, `players` and `events` tables (the
Supabase default publication `supabase_realtime` includes them; make sure
Realtime is switched on for those tables). Changes respect RLS, so members
receive live updates for their own room only.

## 8. Frontend bundle check (Phase 8)

Before deploying, confirm the service role key never appears in the frontend
bundle: build the frontend and grep the output for the key. The key must only
exist in Supabase Edge Function env vars and the gitignored `scripts/.env`.

## 9. Deploy steps (Phase 8)

1. Run all migrations in order in the production SQL Editor.
2. Deploy all Edge Functions to production (dashboard or CLI) with the service
   role key set as an environment variable.
3. Create the `snapshots` bucket (private) in production.
4. Enable anonymous sign-in in production.
5. Run `scripts/rls-check.ts` against production with a throwaway test account and
   confirm every line prints PASS.
6. Merge the frontend to Vercel; verify the service key is not in the bundle.
