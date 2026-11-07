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
| 2 | `002_play_area.sql` | ships with the Phase 2 PR |
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
-- RPCs are SECURITY DEFINER: they run as the function owner and perform their
-- own permission checks in SQL. RLS still guards direct table access from
-- clients. RPC errors are raised as exceptions whose message is the contract
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
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table rooms enable row level security;
alter table players enable row level security;
alter table events enable row level security;

-- rooms: members read; host updates/deletes
create policy "rooms_members_select" on rooms for select to authenticated
  using (auth.uid() in (select room_id from players where room_id = rooms.id));

create policy "rooms_host_update" on rooms for update to authenticated
  using (auth.uid() = rooms.host_id) with check (auth.uid() = rooms.host_id);

create policy "rooms_host_delete" on rooms for delete to authenticated
  using (auth.uid() = rooms.host_id);

-- players: members read; own row insert/update/delete; host deletes members
create policy "players_members_select" on players for select to authenticated
  using (auth.uid() in (select room_id from players p2 where p2.room_id = players.room_id));

create policy "players_own_insert" on players for insert to authenticated
  with check (id = auth.uid());

create policy "players_own_update" on players for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "players_own_delete" on players for delete to authenticated
  using (id = auth.uid());

create policy "players_host_delete" on players for delete to authenticated
  using (exists (
    select 1 from rooms where rooms.id = players.room_id and rooms.host_id = auth.uid()
  ));

-- events: members read; no client insert (server writes only)
create policy "events_members_select" on events for select to authenticated
  using (auth.uid() in (select room_id from players where room_id = events.room_id));

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
| rooms | 1 | members select; host update/delete |
| players | 1 | members select; own row write; host delete members |
| events | 1 | members select; service-key insert |
| locations | 3 | **own row only** |
| reveals | 3/4 | **finder select only** |
| snapshots | 4 | finder/tagged read all; hider own; own insert; service-key update/delete |
| tasks | 5 | **own row read** |
| ability_uses | 6 | **finder select** |
| tags | 7 | members select; service-key write |
| sos_alerts | 8 | **host select** |

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
