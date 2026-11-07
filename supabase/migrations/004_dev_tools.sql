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
