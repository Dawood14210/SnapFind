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
