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
