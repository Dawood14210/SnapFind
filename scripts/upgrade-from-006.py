"""Build a non-destructive, one-time upgrade for a verified Phase 4 schema."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
text = '''-- SNAPFIND: EXISTING PHASE-4 DATABASE -> PHASES 5–8
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

'''
for name in ['007_tasks.sql','008_abilities.sql','009_tags.sql','010_safety.sql','fixes/leave_room_ended.sql']:
    path = root / 'supabase/migrations' / name
    text += '\n-- SOURCE: supabase/migrations/' + name + '\n' + path.read_text() + '\n'
text += '''
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
'''
(root / 'supabase/upgrade-from-006.sql').write_text(text)
print('Generated supabase/upgrade-from-006.sql')
