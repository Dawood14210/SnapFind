# Snapfind — status

## Steps

| Step | Status |
|------|--------|
| 0-F frontend setup | ready for integration |
| 1-F lobby frontend | ready for integration |
| 2-F play area / roles / clock frontend | done |
| settings host round settings (backend + frontend) | done |
| dev tools dummy players (backend + frontend) | done |
| 3-B location backend | done |
| 3-F location frontend | done (PR #12) |
| home room-flow fix (rules → name → room area with in-room detection) | done (PR #13) |
| leave ended room fix (leave_room + Home card Leave in ended state) | PR open |
| 4-B snapshots backend | PR open |
| 4-F snapshots frontend | not started |
| 5-B tasks backend | not started |
| 5-F tasks frontend | not started |
| 6-B abilities backend | not started |
| 6-F abilities frontend | not started |
| 7-B tags / scores / rematch backend | not started |
| 7-F tags / results frontend | not started |
| 8-B safety and checks backend | not started |
| 8-F safety and polish frontend | not started |

## Phases

| Phase | Status |
|-------|--------|
| 0 — layout, shared constants, API contract, setup docs | ready for integration |
| 1 — lobby (rooms/players/events + RLS + RPCs) | ready for integration |
| 2 — play area, start, clock (RPCs + getRoundState) | ready for integration |
| 3 — location (locations/reveals + round_status) | backend done, frontend PR open |
| 4 — snapshots (submit/resolve/urls) | backend done, frontend PR #17 open |
| 5 — tasks (task_progress/skip_task) | backend done, frontend PR open |
| 6 — abilities (use_ability + getCharges) | not started |
| 7 — tags, scores, rematch | not started |
| 8 — safety and checks (sos, rls-check, bots) | not started |
