# Snapfind — PLAN

This file is the session map. A new session can resume from the repo alone by
reading this file, `docs/api-contract.md`, `docs/status-a.md` and
`docs/backend-setup.md`. Update the checklist at every step.

## Step order

Backend steps (N-B): build only the backend part of phase N, update the
contract, write the combined SQL file and the setup doc, run the type check and
tests, open the pull request "Phase N backend", write a short report and STOP.

Frontend steps (N-F): after the human says the backend is merged and deployed,
run `git pull origin main`, build only the frontend part of phase N against the
real API using the contract exactly, fix any backend problem found (update the
SQL file and contract, tell the human what to re-run), run the type check,
tests and build, open the pull request "Phase N frontend", write a short
two-phone test checklist and STOP.

| Step | Status |
|------|--------|
| 0-F frontend setup | done (this PR) |
| 1-F lobby frontend | done (this PR) |
| 2-F play area / roles / clock frontend | done |
| settings host round settings (backend + frontend) | done (PR #8) |
| dev tools dummy players (backend + frontend) | done (PR #9) |
| 3-B location backend | done (this PR) |
| 3-F location frontend | done (this PR) |
| 4-B snapshots backend | not started |
| 4-F snapshots frontend | not started |
| 5-B tasks backend | not started |
| 5-F tasks frontend | not started |
| 6-B abilities backend | not started |
| 6-F abilities frontend | not started |
| 7-B tags / scores / rematch backend | not started |
| 7-F tags / results frontend | not started |
| 8-B safety and checks backend | not started |
| 8-F safety and polish frontend | not started |

Done before this session: backend Phase 0 (layout, constants, contract, setup
docs), Phase 1 (rooms/players/events + RLS + lobby RPCs), Phase 2 (play area,
start, clock RPCs + getRoundState with tests). All merged into main.

## Rules (both sides)

1. The server is the source of truth. Round time comes from
   `rooms.started_at`, `paused_total_ms` and the server clock, never a browser
   timer. The client keeps an offset from `server_now()`.
2. Hider positions stay hidden. A player can write and read only their own
   locations row. The finder gets location information only through the
   reveals table (finder-only select). Anything that needs other players'
   positions runs in an Edge Function with the service role key. The service
   key never appears in the frontend or in git. The frontend uses only the
   anon key.
3. Every Edge Function takes the player from the auth token, never from a
   request parameter. Game decisions (starting, tagging, tasks, abilities,
   points) happen on the server. The frontend only calls the contract and
   shows results.
4. No scheduled jobs. Work out windows, expiry and penalties from timestamps.
5. Keep dependencies few. Plain, readable code. Build only the current step.
6. No mock backend. The frontend calls the real Supabase API.

## Git rules

- Work only on the current session branch. Do not create or switch branches.
  Never push to main. The human merges pull requests.
- One pull request per step. Run `git pull origin main` before every step.

## Repo map

- `docs/api-contract.md` — single source of truth for every table, RPC and
  Edge Function. Update whenever anything changes.
- `docs/backend-setup.md` — everything the human must do by hand in Supabase,
  one combined SQL file per phase.
- `docs/status-a.md` — one line per step.
- `shared/` — constants.ts and roundState.ts (getRoundState, getCharges) with
  Vitest tests and its own package.json. Imported via the Vite alias `@shared`.
- `supabase/` — migrations/ (one file per phase) and functions/ (Edge
  Functions, TypeScript).
- `scripts/` — helper scripts (RLS check, bots), own package.json.
- `src/` — frontend (React + Vite + TS + Tailwind).
- `src/api/` — typed API layer wrapping the contract's RPCs and Edge Functions.

## Remaining frontend specs

### Phase 1 (lobby)

Home screen (nickname remembered locally, Create room, code input and Join),
one-time Rules screen (stay inside the area, stay off roads, no photos of faces)
with Accept, Lobby (large room code with copy, live player list through
Realtime, Ready toggle, host mark, Leave, host Kick), routing /room/:code,
session kept across refresh, clear errors for a full room, wrong code,
duplicate nickname and started room.

### Phase 2 (play area, roles, clock)

Host play-area editor (Leaflet, Use my location, tap for centre, radius slider
100 to 600 m, default 250), finder choice (Random or pick), Start Round. After
joining, fetch server_now once and keep an offset. Role reveal card, round
screen shell with phase label and big countdown from getRoundState, locked
Hide-phase overlay for the finder, host Pause, Resume and End Round with a
paused banner on every phone. Call advance_round when a phase boundary passes.

### Phase 3 (location)

Location hook with watchPosition (high accuracy), upsert at most every 3
seconds during a round, stop at the end, Screen Wake Lock with a keep-screen-on
banner. A Ready toggle that only works after location permission and a reading
with accuracy of 30 m or better. Poll round_status every 5 seconds.
ProximityRing for hiders (green, amber, red, with a shape or text as well as
colour, and a short vibration at red), out-of-bounds banner with a 20-second
countdown, each player's own dot with an accuracy ring. Dev tool: with ?fake=1
(any build, explicit opt-in so it can be tested on Vercel) the map shows the
tap position and tapping the map moves the fake position there; a FAKE
POSITION badge offers Default position / Clear on the round screen.

### Phase 4 (snapshots)

Capture component using getUserMedia, no file picker; draw on a canvas, longest
side at most 1024 px, JPEG quality 0.7, one retake. Full-screen prompt with
sound, vibration and a 45-second countdown when a window opens. Hider screen
shows the next snapshot time and the ones already sent. Finder Snapshots tab:
live feed, newest first, nickname, time, Late and Bonus badges, filter by
nickname, full-screen view, signed URLs from snapshot_urls. Show last_known
reveals on the finder's map until they expire. Call resolve_window 2 minutes
after each window. Dev tool: open a window now.

### Phase 5 (tasks)

Task card on the hider screen (description, progress, time left, Skip with
remaining skips), the target circle for reach_zone on that hider's own map
only, task_progress polling every 5 seconds, the photo task reusing the capture
component. Dev tool: complete the current task.

### Phase 6 (abilities)

Abilities tab for the finder with a charge meter and time to the next charge
(using getCharges), three buttons with costs and a reason when disabled, a
cooldown indicator, tap-to-place for zone scan, results drawn on the map as
translucent circles or a clue card that vanish at expires_at, and a history
list. Hiders get a toast and short vibration: The finder used Pulse. Dev tool:
give 3 charges.

### Phase 7 (tags and results)

Tag button and a list of untagged hiders by nickname (no positions), result
messages and a Found 3 of 9 counter. The hider's tag prompt with Confirm,
Dispute and a 10-second timer; the host's dispute banner with Accept and
Reject. Spectator view for tagged hiders (snapshot feed, map, timer, counter).
Results screen: winner, ranking with breakdown, tag timeline, snapshot gallery
grouped by hider, Play again (host) and Leave.

### Phase 8 (safety and polish)

SOS button held for 2 seconds, with the host's full-screen alert and Resume.
Host safety panel (status, age of last reading, out-of-area flag, no
coordinates). Offline banner, retry of the last location upload, rejoin after a
refresh. Battery warning at 20 percent where supported. Daylight warning with
suncalc. In-round Rules button. Web Audio sounds, vibration, high-contrast
sunlight-readable colours, large touch targets, empty and loading states, an
error boundary. PWA manifest and icons, Vercel deploy notes in README.md, and
PLAYTEST.md: a checklist for a 6-phone test covering every feature.

## Remaining backend specs

### Phase 3 (location)

locations and reveals tables with the row level security from the rules.
round_status(room_id) returns out_of_bounds and seconds_out for everyone; for
hiders only a proximity band to the finder (far over 150 m, near 50 to 150 m,
close under 50 m, unknown without a reading in 30 seconds). Never return
coordinates or distances. After 60 seconds out of bounds, insert an
out_of_bounds reveal (30 m circle, 10 seconds). Speed check: if two readings
imply more than 12 m/s, set suspect and write an event for the host.

### Phase 4 (snapshots)

snapshots table, private bucket with upload allowed only in the player's own
folder (room_id/player_id/window_index.jpg), row level security (finder reads
all; a hider reads their own; tagged players read all; everyone after the round
ends). submit_snapshot (window n opens at n x 5 minutes of round time; on time
within 45 seconds, late within 2 minutes; +10 points if on time). resolve_window
(idempotent, callable 2 minutes after a window; for each hider with no snapshot
insert a last_known reveal, 60 m for 15 seconds, second miss 40 m for 30
seconds, using the stored position at check time, with a comment saying so).
snapshot_urls (60-second signed URLs for rows the caller may read).

### Phase 5 (tasks)

tasks table (hider reads own only). Task types, points, durations and the photo
prompt list live in constants. Types: reach_zone (30 m circle for 20 seconds,
35 points), stay_put (within 10 m for 3 minutes, ignore accuracy worse than 25
m, 10 points), distance (80 m, 20 points), photo (bonus snapshot, 20 points).
Assignment on hunt start, after done, skipped or expired; each lasts 4 to 8
minutes; a movement task is forced if the last two were not movement; never the
same type three times. task_progress and skip_task (2 skips per round, minus 5
points).

### Phase 6 (abilities)

ability_uses table (finder reads). getCharges in /shared (1 charge per 4
minutes of hunt time, plus 1 at 20:00, minus spent) with tests. use_ability
checks: caller is finder, round is hunting, enough charges, 30-second cooldown.
pulse (cost 1): nearest hider, circle of 80 m centred up to 50 m away from them,
10 seconds, same hider not twice within 5 minutes. zone_scan (cost 2): count of
hiders in a circle up to 100 m, 20 seconds. clue_card (cost 1): current task
type of one random hider, no name. Write an ability_used event with only the
ability name.

### Phase 7 (tags, scores, rematch)

tags table. request_tag (finder only, both locations under 15 seconds old,
accuracy 15 m or better, within 15 m; failure gives a 20-second lockout),
confirm_tag, dispute_tag, finalize_tag (10 seconds of silence counts as
confirmed), resolve_dispute (host). Confirmed tag: hider becomes tagged, finder
gets 60 points plus 1 per full minute left; when no active hider remains, +100
and the round ends. finalize_scores (idempotent via scores_finalized): +15 for
each window time a hider was still untagged, +50 if untagged at the end, a full
breakdown in an events row. The finder wins only if every hider was tagged.
rematch (host): wipes round data and stored photos, resets players, keeps the
play area, next finder is the top-scoring hider. purge_photos.

### Phase 8 (safety and checks)

sos_alerts table (host reads) and sos function that stores the position and
pauses the round. scripts/rls-check.ts signs in as a test hider and a test
finder and tries to read other players' locations, tasks, reveals,
ability_uses and sos_alerts; prints PASS or FAIL each. scripts/bots.ts creates 8
fake hiders that move randomly and send sample snapshots (service key from a
local gitignored .env). Check the frontend bundle for the service key, confirm
every table has RLS, list each policy in /docs/backend-setup.md, and write the
deploy steps.
