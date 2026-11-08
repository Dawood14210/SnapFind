# Migrations

One SQL file per phase, named `NNN_phase_name.sql`, run in numeric order in the
Supabase SQL Editor (see `/docs/backend-setup.md` for the combined per-phase SQL
files and the run order).

Planned files:

- `001_lobby.sql` — Phase 1: rooms, players, events + RLS + RPCs
- `002_play_area.sql` — Phase 2: play-area + round-clock RPCs
- `003_room_settings.sql` — room settings (hide/round/players) + RPC
- `004_dev_tools.sql` — dummy players dev tool
- `005_location.sql` — Phase 3: locations, reveals + RLS + round_status
- `fixes/leave_room_ended.sql` — fix: leave_room allows ended rooms
- `006_snapshots.sql` — Phase 4: snapshots table + RLS + storage policy
  (submit_snapshot / resolve_window / snapshot_urls are Edge Functions)
- `007_tasks.sql` — Phase 5: tasks + RLS + task_progress/skip_task
- `008_abilities.sql` — Phase 6: ability_uses + RLS + use_ability
- `009_tags.sql` — Phase 7: tags + RLS + tagging/scores/rematch
- `010_safety.sql` — Phase 8: sos_alerts + RLS + sos/purge_photos
