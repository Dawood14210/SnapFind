"""Generate the one-paste fresh-project SQL; never run on an installed schema."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
files = sorted((root / 'supabase/migrations').glob('[0-9]*.sql'))
files += sorted((root / 'supabase/migrations/fixes').glob('*.sql'))
text = '''-- SNAPFIND: FULL FRESH-SUPABASE-PROJECT SETUP
-- Paste this entire script into the Supabase SQL Editor, once.
-- Requires Supabase-managed auth/storage schemas and roles.
-- NOT an upgrade or rerunnable reset. It deliberately refuses an existing rooms table.
-- No data is dropped. Edge Functions, anonymous sign-in and env vars need separate setup.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.rooms') IS NOT NULL THEN
    RAISE EXCEPTION 'Existing Snapfind schema detected. Apply only missing migrations; do not run full setup.';
  END IF;
END $$;

'''
for file in files:
    text += '\n-- SOURCE: ' + str(file.relative_to(root)) + '\n' + file.read_text() + '\n'
text += '''
-- Realtime: private locations and SOS positions stay out of the publication.
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
'''
(root / 'supabase/full-project.sql').write_text(text)
print('Generated supabase/full-project.sql from', len(files), 'migration/fix files')
