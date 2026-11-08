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
--   the `snapshots` bucket is created in the dashboard (private) — see
--   docs/backend-setup.md section 3. Clients may insert images only into
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
-- submit_snapshot also inserts with the service key).
drop policy if exists snapshots_own_insert on snapshots;
create policy snapshots_own_insert on snapshots for insert to authenticated
  using (player_id = auth.uid()) with check (player_id = auth.uid());

-- ----------------------------------------------------------------------------
-- reveals.window_index: which snapshot window a last_known reveal answers
-- to. NULL for ability / out_of_bounds reveals. Used to keep
-- resolve_window idempotent (a hider is revealed once per missed window).
-- ----------------------------------------------------------------------------
alter table reveals add column if not exists window_index integer;
create index if not exists reveals_room_target_window_idx
  on reveals (room_id, target_player_id, kind, window_index);

-- ----------------------------------------------------------------------------
-- Storage: uploads to the private `snapshots` bucket are allowed only into
-- the caller's own folder {room_id}/{player_id}/{window_index}.jpg, and only
-- while the caller has a players row in that room. Reads stay denied for the
-- anon key (images are served via signed URLs from snapshot_urls).
-- ----------------------------------------------------------------------------
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
  using (bucket_id = 'snapshots' and is_snapshot_uploader(name))
  with check (bucket_id = 'snapshots' and is_snapshot_uploader(name));
