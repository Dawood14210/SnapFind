-- SNAPFIND: EXISTING PHASE-4 DATABASE -> PHASES 5–8
-- Run the entire script ONCE in Supabase SQL Editor. Back up first.
-- Preserves existing room/player/location/snapshot data. No DROP TABLE/reset.
-- Requires migrations 001–006 (including room settings) already installed.
-- If a preflight check fails, stop and inspect the schema; do not remove guards.
BEGIN;
SET LOCAL search_path = public, pg_temp;
DO $$
DECLARE v_table text; v_column text; v_spec text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['rooms','players','events','locations','reveals','snapshots'] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Required earlier table missing: %. Apply earlier migrations first.', v_table;
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['tasks','ability_uses','tags','sos_alerts'] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      RAISE EXCEPTION 'Upgrade target % already exists. Script is one-time only; inspect installed migrations.', v_table;
    END IF;
  END LOOP;
  FOREACH v_spec IN ARRAY ARRAY[
    'rooms.id','rooms.host_id','rooms.status','rooms.finder_id',
    'rooms.scores_finalized','rooms.started_at','rooms.paused_at','rooms.paused_total_ms',
    'rooms.hide_duration_min','rooms.max_players',
    'players.id','players.room_id','players.nickname','players.role','players.status',
    'players.points','players.ready','players.suspect',
    'events.room_id','events.type','events.payload',
    'locations.player_id','locations.reading_at',
    'snapshots.image_path','snapshots.task_id','reveals.window_index'
  ] LOOP
    v_table := split_part(v_spec,'.',1); v_column := split_part(v_spec,'.',2);
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=v_table AND column_name=v_column) THEN
      RAISE EXCEPTION 'Earlier schema column missing: %. Inspect migrations 001–006.', v_spec;
    END IF;
  END LOOP;
END $$;


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


-- Only public game-state tables need Realtime; private positions stay excluded.
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

-- All four should now show table names, not NULL.
SELECT to_regclass('public.tasks') AS tasks,
       to_regclass('public.ability_uses') AS ability_uses,
       to_regclass('public.tags') AS tags,
       to_regclass('public.sos_alerts') AS sos_alerts;
