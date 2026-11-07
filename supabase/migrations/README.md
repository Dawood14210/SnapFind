# Migrations

One SQL file per phase, named `NNN_phase_name.sql`, run in numeric order in the
Supabase SQL Editor (see `/docs/backend-setup.md` for the combined per-phase SQL
files and the run order).

Planned files:

- `001_lobby.sql` — Phase 1: rooms, players, events + RLS + RPCs
- `002_play_area.sql` — Phase 2: play-area + round-clock RPCs
- `003_location.sql` — Phase 3: locations, reveals + RLS + round_status
- `004_snapshots.sql` — Phase 4: snapshots + RLS + submit_snapshot/resolve_window/snapshot_urls
- `005_tasks.sql` — Phase 5: tasks + RLS + task_progress/skip_task
- `006_abilities.sql` — Phase 6: ability_uses + RLS + use_ability
- `007_tags.sql` — Phase 7: tags + RLS + tagging/scores/rematch
- `008_safety.sql` — Phase 8: sos_alerts + RLS + sos/purge_photos
