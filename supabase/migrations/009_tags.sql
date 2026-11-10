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
