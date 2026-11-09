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
