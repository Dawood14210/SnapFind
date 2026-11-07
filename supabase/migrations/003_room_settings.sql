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
