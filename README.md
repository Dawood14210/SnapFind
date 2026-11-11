# Snapfind

Hide-and-seek for your campus. 4–25 players join a room with a 6-letter code,
one becomes the finder, the rest hide for 3 minutes and then send live
snapshots while the finder hunts them down with limited abilities. No accounts,
no public matchmaking.

## Stack

- React + Vite + TypeScript + Tailwind, mobile-first
- react-router, @supabase/supabase-js, react-leaflet + leaflet (OpenStreetMap)
- Supabase: Postgres, Realtime, Storage, Edge Functions (TypeScript)
- Anonymous sign-in only. Frontend uses only the anon key — the service role
  key stays in the Edge Functions and never appears in the frontend or in git.

## Development

```bash
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

The Supabase project setup (project creation, anonymous sign-in, the private
`snapshots` bucket, env vars, and how to run each migration / deploy each Edge
Function) is documented in `docs/backend-setup.md`.

## Tests and checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run (frontend)
npm run build       # type check + production build
```

The shared game constants and round-state helpers live in `shared/` with their
own package.json and tests: `cd shared && npm install && npm test`. The frontend
imports them through the Vite alias `@shared` — it never copies them.

## Docs

- `docs/api-contract.md` — the single source of truth for every table, RPC and
  Edge Function (request/response shapes, error codes).
- `docs/PLAN.md` — the step order and remaining specs.
- `docs/status-a.md` — one line per step.
- `docs/backend-setup.md` — everything to set up by hand in Supabase.

## Deployment

Frontend deploys to Vercel (`npm run build`). `vercel.json` rewrites every path
to `/index.html`, so client-side routes like `/rules` and `/room/:code` work
without 404s. See `docs/backend-setup.md` for the deploy steps for migrations
and Edge Functions.

## One-paste database setup

For a **fresh Supabase project**, paste all of [`supabase/full-project.sql`](supabase/full-project.sql)
into the SQL Editor and run once. It is one transactional script containing
migrations 001–010, the ended-room leave fix, the private storage bucket and
Realtime publication setup. It deliberately refuses an existing `rooms` table;
it is **not** a destructive reset or an upgrade script. Existing projects must
apply only missing numbered migrations/fixes. Regenerate with:

```bash
python3 scripts/combined-sql.py
```

SQL does **not** deploy Edge Functions, enable anonymous sign-in, configure auth
URLs, or set environment variables. Follow `docs/backend-setup.md` and deploy
`host_safety` in addition to its function list. SQL has not been executed against
a live project in this workspace; smoke-test on staging before production.

## Vercel and mobile deployment

- Framework: Vite. Build: `npm run build`; output: `dist`.
- Set only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in frontend env.
  Never expose the service role key. Run the actual-key bundle scanner before
  release. Configure Supabase allowed site/redirect URLs for your deployment.
- `vercel.json` supports direct room-route refreshes while preserving static
  manifest, icons and asset URLs. Use HTTPS for GPS, camera and install support.
- Anonymous sessions persist on the same browser/device; clearing browser storage
  loses that identity. Do not clear data during a game.
- Manifest and 192/512px icons support installation where the browser permits it.
  There is no offline service worker/cache or offline gameplay: network is
  required for game actions, GPS uploads and SOS delivery.
- SOS does not call emergency services. Players must agree on emergency contact
  procedures, a safe play area and daylight-only play. Battery/vibration/audio
  APIs depend on browser support; sound is off until explicitly enabled.
- Run the six-phone checklist in `PLAYTEST.md`. Live multi-phone acceptance,
  production RLS verification and deployed CORS checks are still required.

### Existing database with rooms/locations/snapshots but no tasks/abilities/tags/SOS

Use [`supabase/upgrade-from-006.sql`](supabase/upgrade-from-006.sql), not the
fresh-project setup. Back up first, then run the entire file once in Supabase
SQL Editor. It checks earlier tables/columns, applies migrations 007–010 and
the ended-room leave fix in a transaction, and preserves existing data. It
refuses partial/already-installed target tables. A failed prerequisite check
requires inspecting the earlier schema, not deleting the guard. Regenerate
with `python3 scripts/upgrade-from-006.py`. Not live-database validated here.
Deploy the corresponding Edge Functions separately per backend-setup.md.
