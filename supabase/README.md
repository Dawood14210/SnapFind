# Snapfind backend

- `migrations/` — SQL migrations, one file per phase, run in numeric order in the
  Supabase SQL Editor (see `/docs/backend-setup.md`).
- `functions/` — Supabase Edge Functions (TypeScript), deployed from this folder
  (see `/docs/backend-setup.md`).

The API contract lives in `/docs/api-contract.md`; progress is tracked in
`/docs/status-a.md`.
