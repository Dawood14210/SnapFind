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
