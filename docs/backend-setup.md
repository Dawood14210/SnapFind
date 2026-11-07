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
| 1 | `001_lobby.sql` | ships with the Phase 1 PR |
| 2 | `002_play_area.sql` | ships with the Phase 2 PR |
| 3 | `003_location.sql` | ships with the Phase 3 PR |
| 4 | `004_snapshots.sql` | ships with the Phase 4 PR |
| 5 | `005_tasks.sql` | ships with the Phase 5 PR |
| 6 | `006_abilities.sql` | ships with the Phase 6 PR |
| 7 | `007_tags.sql` | ships with the Phase 7 PR |
| 8 | `008_safety.sql` | ships with the Phase 8 PR |

Each phase's PR includes the combined SQL for that phase in its report.

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
