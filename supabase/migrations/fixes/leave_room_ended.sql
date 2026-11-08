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
