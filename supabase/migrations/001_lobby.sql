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
