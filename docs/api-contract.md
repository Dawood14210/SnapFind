# Snapfind — API Contract

**Owner:** Agent A (backend). Agent B (frontend) builds against this document from day one.
**Status:** Phase 0 draft — complete for all phases. Each item is tagged with the phase it lands in. An item is only callable once its phase's PR is merged into main.
**Governing rule:** The server is the source of truth. Clients never decide round time, tagging, tasks, abilities or points.

---

## 0. Conventions

### Auth

- Anonymous Supabase sign-in only. No accounts, no email, no public matchmaking.
- PostgREST calls (RPCs, table reads): use the Supabase JS client with the anonymous
  session; the session is attached automatically.
- Edge Functions: `Authorization: Bearer <access_token>` header. **The player is
  always taken from the token, never from the request body.**
- Every game call carries the room id — as `p_room_id` for RPCs (except
  `create_room` and `server_now`) and as `room_id` in Edge Function bodies.
- **RPC security:** RPCs are Postgres `SECURITY DEFINER` functions that run as the
  function owner and perform their own permission checks in SQL. RLS still guards
  direct client table access. RPCs never trust client-provided player ids — the
  player comes from `auth.uid()`.

### Time

- Server clock is the only truth. Round time (seconds) =
  `serverNowMs - rooms.started_at - rooms.paused_total_ms`.
- `server_now` returns ms since epoch. Clients compute an offset:
  `offset = serverNow - Date.now()`, then `clientNow = Date.now() + offset`, and use
  `clientNow` for every local timer. Never run a raw browser timer for the round.
- Timestamps in JSON are ISO 8601 UTC strings (Postgres `timestamptz`).
- During a pause the round clock is frozen (`paused_at` / `paused_total_ms`).

### Errors

All Edge Functions and RPCs return this envelope on failure:

```json
{ "error": { "code": "ROOM_FULL", "message": "Room is full." } }
```

HTTP status: `400` invalid input, `401` unauthenticated, `403` forbidden (not allowed),
`404` not found, `409` conflict, `422` business rule, `429` lockout, `500` server error.

PostgREST RPC errors arrive as `{ "code", "detail", "message", "hint" }` — match on
`code` or `message`. **For RPCs, the contract error code is carried in `message`**
(e.g. `ROOM_FULL`); `code` is PostgREST's SQLSTATE (`P0001` for raised exceptions).
For Edge Functions the contract code is in `error.code`.

Success responses return the data object directly (no envelope).

### IDs

All ids are uuid strings. `player.id` is the Supabase auth user id.

---

## 1. Shared shapes

These shapes are returned by every endpoint that includes them.

### RoomView

```json
{
  "id": "uuid",
  "code": "ABC123",
  "host_id": "uuid",
  "status": "lobby|hiding|hunting|paused|ended",
  "center_lat": 31.5204,
  "center_lng": 74.3587,
  "radius_m": 300,
  "duration_min": 30,
  "hide_duration_min": 3,
  "max_players": 25,
  "started_at": "2026-11-07T18:00:00.000Z",
  "paused_at": null,
  "paused_total_ms": 0,
  "finder_id": null,
  "scores_finalized": false
}
```

- `code` is 6 uppercase letters from `CODE_ALPHABET` (no O, I, L).
- `started_at` is null in `lobby`; `finder_id` is null until `start_round`.
- `paused_at` is null unless status is `paused`.
- `duration_min` / `hide_duration_min` / `max_players` are the host-editable
  round settings (defaults 30 / 3 / 25, see `set_room_settings`).

### PlayerView

```json
{
  "id": "uuid",
  "room_id": "uuid",
  "nickname": "string",
  "role": null,
  "status": "active|tagged",
  "points": 0,
  "ready": false,
  "suspect": false,
  "joined_at": "2026-11-07T17:50:00.000Z"
}
```

- `role` is `null` in the lobby, then `"finder"` or `"hider"` after `start_round`.
- `status` is `"active"` until tagged, then `"tagged"`.
- `suspect` is set by the `round_status` speed check (two readings implying
  over 12 m/s); the host sees it with the `speed_check` event.

### RoundState (output of `getRoundState`)

```json
{
  "phase": "lobby|hiding|hunting|paused|ended",
  "round_seconds": 123.4,
  "seconds_left_in_round": 1676.6,
  "seconds_left_in_phase": 476.6,
  "hunt_seconds": 0,
  "window": 0
}
```

- `round_seconds` is frozen while paused.
- `seconds_left_in_phase`: hide time left while `hiding`, hunt time left while
  `hunting`, 0 otherwise.
- `window` is the highest open snapshot window (1..5); 0 means none open (lobby,
  hide phase, after the last window closes).

### RevealView

```json
{
  "id": "uuid",
  "room_id": "uuid",
  "kind": "pulse|zone_scan|clue|last_known|out_of_bounds",
  "lat": 31.5204,
  "lng": 74.3587,
  "radius_m": 80,
  "count": null,
  "label": "pulse: 80 m circle",
  "expires_at": "2026-11-07T18:00:10.000Z",
  "window_index": 1,
  "target_player_id": "uuid|null"
}
```

- `count` is set only for `zone_scan` (number of hiders in the circle).
- `window_index` is set for `last_known` reveals (the missed snapshot window,
  Phase 4 — keeps `resolve_window` idempotent); null for every other kind.
- `label` is human-readable; for `clue` it is the hider's current task type (no name).
- `target_player_id` is the player the clue is about (a hider for
  `last_known` / `out_of_bounds`; null for abilities).
- Only the finder reads reveals (RLS).

### TaskView

```json
{
  "id": "uuid",
  "room_id": "uuid",
  "player_id": "uuid",
  "type": "reach_zone|stay_put|distance|photo",
  "params": { "lat": 31.5204, "lng": 74.3587, "radius_m": 30 },
  "status": "pending|active|done|skipped|expired",
  "points": 35,
  "assigned_at": "2026-11-07T18:03:00.000Z",
  "expires_at": "2026-11-07T18:08:00.000Z"
}
```

### TagView

```json
{
  "id": "uuid",
  "room_id": "uuid",
  "finder_id": "uuid",
  "hider_id": "uuid",
  "status": "pending|confirmed|disputed",
  "created_at": "2026-11-07T18:20:00.000Z"
}
```

### SnapshotView

```json
{
  "id": "uuid",
  "room_id": "uuid",
  "player_id": "uuid",
  "window_index": 1,
  "task_id": null,
  "image_path": "room-uuid/player-uuid/1.jpg",
  "taken_at": "2026-11-07T18:05:01.000Z",
  "late": false
}
```

- `image_path` is relative to the private `snapshots` bucket:
  `{room_id}/{player_id}/{window_index}.jpg` (bonus snapshots use window_index 0).

---

## 2. Tables

All tables live in the `public` schema. Row Level Security is enabled on every table.
Policies are summarised below; the authoritative policy SQL ships in each phase's
migration.

| Table | Phase | Purpose | RLS summary |
|-------|-------|---------|-------------|
| rooms | 1 | Room state, play area, round clock | members select (read-only); all writes via RPCs |
| players | 1 | Membership, nickname, role, points, skips_used | members select (read-only); all writes via RPCs |
| events | 1 | Append-only game events | members select (read-only); server writes only |
| locations | 3 | Per-player GPS readings | **own row only** (read+write); server logic via service key |
| reveals | 3/4 | Finder-only location clues | **finder select only**; service-key write |
| snapshots | 4 | Submitted photos | finder/tagged read all; hider own; own insert; service-key update/delete |
| tasks | 5 | Hider tasks | **own row read**; service-key write |
| ability_uses | 6 | Finder ability usage | **finder select**; service-key write |
| tags | 7 | Tag requests/resolutions | members select; service-key write |
| sos_alerts | 8 | SOS alerts | **host select**; service-key insert |

Detailed RLS per table (Phase 1, corrected form):

- All policies are **read-only** and use the `is_room_member()` helper
  (SECURITY DEFINER: true when `auth.uid()` has a players row in the room).
- **rooms** — `select`: `is_room_member(rooms.id)`. No client write policies —
  every write goes through an RPC.
- **players** — `select`: `is_room_member(players.room_id)`. No client write
  policies — every write goes through an RPC. (`suspect` is set by the
  `round_status` Edge Function with the service key.)
- **events** — `select`: `is_room_member(events.room_id)`. No client write
  policies — server writes only (RPCs / service key).

Detailed RLS per table (Phase 3, location):

- **locations** — own row only: `select` / `insert` / `update` / `delete`
  with `player_id = auth.uid()` (the location hook upserts its own readings).
  No policy ever exposes another player's readings.
- **reveals** — finder select only: `select` with `player_id = auth.uid()`
  (the `player_id` column is the finder who may read the clue). No client
  write policies — Edge Functions write with the service key. `target_player_id`
  records who the clue is about (a hider for `last_known` / `out_of_bounds`).

The remaining policies are listed per table when their phase lands (Phase 3–8).

Detailed RLS per table (Phase 4, snapshots):

- **snapshots** — `select`: own row (`player_id = auth.uid()`), the room's
  finder, tagged players, or anyone once the round has `ended` (multiple
  select policies OR together). `insert`: own row only. No update/delete
  policies — the Edge Functions write with the service key.
- The `snapshots` **bucket** is private. Clients may `insert` storage objects
  only into their own folder `{room_id}/{player_id}/{window_index}.jpg` (the
  `is_snapshot_uploader()` helper checks the path shape, that the player id
  segment is the caller and that the caller has a players row in that room).
  No anon select policy — images are served via 60-second signed URLs from
  `snapshot_urls` (service key).

Realtime: `rooms`, `players` and `events` are Realtime-enabled. Changes respect
RLS, so members receive live updates for their own room only. The frontend
subscribes to `rooms` and `players` filtered by room for the lobby live list.

---

## 3. RPCs

All RPCs are Postgres functions called via `supabase.rpc('name', params)`.
`params` must be an object (pass `{}` for no-argument RPCs).

**Parameter names:** PostgREST matches RPC arguments **by name** against the
SQL function parameter names, so every request key is the SQL parameter name
with a `p_` prefix (`p_room_id`, `p_nickname`, `p_code`, `p_lat`, `p_lng`,
`p_radius_m`, `p_finder_id`, `p_ready`, `p_player_id`). The frontend wrapper
signatures stay plain; only the argument objects sent to the server use the
`p_` names. Every RPC uses the same `p_` prefix and is listed below.

### create_room — Phase 1

- **Caller:** any authenticated player (must not already be in an active room).
- **Request:** `{ "p_nickname": string }` — 1..20 chars.
- **Response:** `{ "room": RoomView, "player": PlayerView, "host": true }`
- **Errors:** `NICKNAME_INVALID`, `ALREADY_IN_ROOM`, `CODE_GENERATION_FAILED`.
- **Notes:** generates a unique 6-letter code from `CODE_ALPHABET` (retries on
  collision). Caller becomes host and a player. Implicitly leaves any previous
  ended-room membership (one membership per player). Response is jsonb with
  exactly the keys `room`, `player` and `host` (true).

### join_room — Phase 1

- **Caller:** authenticated player not already in an active room.
- **Request:** `{ "p_code": string, "p_nickname": string }` — code is 6 uppercase letters.
- **Response:** `{ "room": RoomView, "player": PlayerView }`
- **Errors:** `ROOM_NOT_FOUND`, `ROOM_NOT_LOBBY`, `ROOM_FULL` (room at
  `max_players`), `NICKNAME_DUPLICATE`, `NICKNAME_INVALID`, `ALREADY_IN_ROOM`.
- **Notes:** nickname unique per room (trimmed, case-insensitive). Room must be in
  `lobby`. Max 25 players. Implicitly leaves any previous ended-room membership
  (one membership per player). Response is jsonb with exactly the keys `room`
  and `player`.

### leave_room — Phase 1

- **Caller:** player in the room.
- **Request:** `{ "p_room_id": string }`
- **Response:** `{ "ok": true }`
- **Errors:** `NOT_IN_ROOM`, `ROUND_ACTIVE` (only while the round is running:
  hiding/hunting/paused).
- **Notes:** host leaving hands the room to the earliest-joined player; if the last
  player leaves, the room is deleted. Leaving is allowed in the lobby and after
  the round has ended.

### kick_player — Phase 1

- **Caller:** host.
- **Request:** `{ "p_room_id": string, "p_player_id": string }`
- **Response:** `{ "ok": true }`
- **Errors:** `NOT_HOST`, `PLAYER_NOT_FOUND`, `CANNOT_KICK_HOST`, `ROUND_ACTIVE`.

### set_ready — Phase 1

- **Caller:** player in a lobby room.
- **Request:** `{ "p_room_id": string, "p_ready": boolean }`
- **Response:** `{ "ready": boolean }`
- **Errors:** `NOT_IN_ROOM`, `ROUND_ACTIVE`.

### set_room_settings — room settings

- **Caller:** host, lobby only.
- **Request:** `{ "p_room_id": string, "p_hide_duration_min": number,
  "p_duration_min": number, "p_max_players": number }`
- **Response:** `{ "ok": true, "room": RoomView }`
- **Errors:** `NOT_HOST`, `ROUND_ACTIVE`, `INVALID_HIDE_DURATION` (1–15 min),
  `INVALID_ROUND_DURATION` (5–60 min, must be greater than the hide time),
  `INVALID_PLAYER_LIMIT` (4–25).
- **Notes:** edits the per-room round settings. The clock then uses them:
  `join_room` refuses when the room is at `max_players`; `advance_round`
  transitions at `hide_duration_min` and `duration_min`; `getRoundState`
  (shared) reads the same fields. Defaults: hide 3, round 30, max 25.

### dev_add_dummy_players — dev tool

- **Caller:** host, lobby only.
- **Request:** `{ "p_room_id": string, "p_count": number }` — 1..10.
- **Response:** `{ "ok": true, "added": number }`
- **Errors:** `NOT_HOST`, `ROUND_ACTIVE`, `INVALID_COUNT`, `ROOM_FULL`.
- **Notes:** adds ready dummy players (fresh `auth.users` + `players` rows with
  unique nicknames) so rounds can be tested without enough real phones. The
  host can remove them with the normal kick button.

### set_play_area — Phase 2

- **Caller:** host, lobby only.
- **Request:** `{ "p_room_id": string, "p_lat": number, "p_lng": number, "p_radius_m": number }`
- **Response:** `{ "ok": true, "play_area": { "center_lat": number, "center_lng": number, "radius_m": number } }`
- **Errors:** `NOT_HOST`, `INVALID_RADIUS` (100–600 m), `INVALID_COORDS` (lat ±90, lng ±180), `ROUND_ACTIVE`.

### start_round — Phase 2

- **Caller:** host.
- **Request:** `{ "p_room_id": string, "p_finder_id": string | null }` — `null`
  picks a random ready player.
- **Response:** `{ "ok": true, "room": RoomView, "finder_id": string }`
- **Errors:** `NOT_HOST`, `NO_PLAY_AREA`, `NOT_ALL_READY`, `MIN_PLAYERS` (< 4),
  `ROUND_ACTIVE`, `FINDER_NOT_IN_ROOM`.
- **Notes:** requires a play area, all players ready, ≥ `MIN_PLAYERS` (4). Sets
  status `hiding`, `started_at = now()`, assigns roles, writes event
  `round_started`. The clock uses the room's `hide_duration_min` and
  `duration_min` from then on.

### server_now — Phase 2

- **Caller:** any authenticated player.
- **Request:** `{}`
- **Response:** `{ "now": number }` — ms since epoch.
- **Errors:** none.

### advance_round — Phase 2

- **Caller:** any authenticated member (client polls; idempotent).
- **Request:** `{ "p_room_id": string }`
- **Response:** `{ "room": RoomView, "round": RoundState }`
- **Errors:** `ROOM_NOT_FOUND`, `NOT_IN_ROOM`.
- **Notes:** transitions `hiding → hunting` at the room's `hide_duration_min`
  and `hunting → ended` at `duration_min` (writes event `round_phase_changed` /
  `round_ended`). Safe to call repeatedly; also a no-op while `paused`.

### pause_round — Phase 2

- **Caller:** host.
- **Request:** `{ "p_room_id": string }`
- **Response:** `{ "ok": true, "paused_at": string }`
- **Errors:** `NOT_HOST`, `NOT_ACTIVE` (must be `hiding` or `hunting`).
- **Notes:** sets status `paused`, `paused_at = now()`.

### resume_round — Phase 2

- **Caller:** host.
- **Request:** `{ "p_room_id": string }`
- **Response:** `{ "ok": true, "paused_total_ms": number }`
- **Errors:** `NOT_HOST`, `NOT_PAUSED`.
- **Notes:** status returns to `hiding` or `hunting` based on round time at resume
  (no extra column needed).

### end_round — Phase 2

- **Caller:** host.
- **Request:** `{ "p_room_id": string }`
- **Response:** `{ "ok": true, "room": RoomView }`
- **Errors:** `NOT_HOST`.
- **Notes:** manual end (e.g. safety). Sets status `ended`. Scores are finalised by
  `finalize_scores`.

### rematch — Phase 7

- **Caller:** host, round must be `ended`.
- **Request:** `{ "p_room_id": string }`
- **Response:** `{ "ok": true, "finder_id": string }`
- **Errors:** `NOT_HOST`, `ROUND_NOT_ENDED`.
- **Notes:** wipes round data (snapshots rows + stored files via `purge_photos`,
  tasks, ability_uses, tags, reveals, round events, locations), resets players
  (points 0, ready false, status active, role null), keeps the play area, sets status
  `lobby`. Next finder is the top-scoring hider of the finished round.

---

## 4. Edge Functions

All Edge Functions are `POST` with `Authorization: Bearer <token>`. The player comes
from the token. Request bodies are JSON. Responses are JSON.

### round_status — Phase 3

- **Caller:** any authenticated member of the room.
- **Request:** `{ "room_id": string }`
- **Response:**

```json
{
  "room": RoomView,
  "round": RoundState,
  "players": [PlayerView],
  "finder_id": "uuid|null",
  "proximity": { "<hider_id>": "far|near|close|unknown" },
  "out_of_bounds": { "<player_id>": 12.3 },
  "abilities": { "charges": 2, "cooldown_until": 1730000000000 },
  "counts": { "players": 8, "hiders": 7, "active_hiders": 5, "tagged": 2 }
}
```

- **proximity** — finder sees a band per active hider; a hider sees only their own
  band. Bands: `far` (> 150 m), `near` (50–150 m), `close` (< 50 m), `unknown` (no
  reading in the last 30 s). Never coordinates or distances.
- **out_of_bounds** — seconds outside the play area for every player.
- **abilities** — present only when the caller is the finder (`charges` from
  `getCharges`, `cooldown_until` ms epoch or null).
- **Errors:** `ROOM_NOT_FOUND`, `NOT_IN_ROOM`.
- **Notes:** uses the service key internally. After 60 s out of bounds, inserts an
  `out_of_bounds` reveal (30 m circle, 10 s) centred on the player's last known
  position (or the play-area edge if unknown) when none is active. Speed check:
  two consecutive readings implying over 12 m/s mark the player `suspect` and
  write a `speed_check` event for the host. The `round` object matches
  `getRoundState` exactly (shared parity). Deploy with the Supabase CLI
  (`supabase functions deploy round_status`) so the local import graph
  (`lib/geo.ts`, `lib/round.ts`) is bundled.

### submit_snapshot — Phase 4

- **Caller:** active hider.
- **Request:** `{ "room_id": string, "window_index": number, "task_id": string|null, "image_path": string, "taken_at": string }`
- **Response:** `{ "ok": true, "snapshot_id": string, "late": boolean, "points_awarded": number }`
- **Errors:** `NOT_HIDER`, `ROUND_NOT_HUNTING`, `WINDOW_NOT_OPEN`, `ALREADY_SUBMITTED`,
  `INVALID_IMAGE_PATH`, `INVALID_WINDOW`, `WINDOW_CLOSED`.
- **Notes:** the client uploads the image to
  `snapshots/{room_id}/{player_id}/{window_index}.jpg` first (own folder,
  storage-RLS-allowed — the path must match exactly, no subfolders), then calls
  this. Window n opens at n × 5 min of round time: on time = within 45 s of the
  opening (+10 points); late = within 2 min (0 points, `late: true`); beyond
  that `WINDOW_CLOSED`; before it `WINDOW_NOT_OPEN`. The bonus window
  (`window_index: 0`, photo task) skips the timing check — the task owns its
  timing (Phase 5) — and earns no points here. `points_awarded` is 10 or 0.
  Deploy with the Supabase CLI (`supabase functions deploy submit_snapshot`)
  so the local import graph (`lib/snapshot.ts`) is bundled.

### snapshot_urls — Phase 4

- **Caller:** finder (all), hider (own), tagged player (all), anyone after the round
  ends.
- **Request:** `{ "room_id": string, "window_index": number | null }` — `null` = all
  windows.
- **Response:** `{ "snapshots": [ { "id", "player_id", "window_index", "task_id", "taken_at", "late", "image_url" } ] }`
- **Errors:** `ROOM_NOT_FOUND`, `NOT_IN_ROOM`.
- **Notes:** `image_url` is a signed URL valid for 60 s (service key — the anon
  key can never sign). Newest first. Deploy with the Supabase CLI
  (`supabase functions deploy snapshot_urls`).

### resolve_window — Phase 4

- **Caller:** any authenticated member (idempotent; client calls 2 min after a
  window closes).
- **Request:** `{ "room_id": string, "window_index": number }`
- **Response:** `{ "ok": true, "resolved": boolean, "reveals_created": number }`
- **Errors:** `ROOM_NOT_FOUND`, `NOT_IN_ROOM`, `WINDOW_NOT_DUE` (window must be ≥ 2 min
  past its close), `ROUND_NOT_HUNTING`.
- **Notes:** for each active hider with no snapshot in that window, inserts a
  `last_known` reveal — 60 m / 15 s (first miss in the round) or 40 m / 30 s
  (second miss) — centred on the stored position at check time (latest reading;
  play-area edge if unknown), label noting the missed window
  (`last_known: missed window n`). A hider is revealed at most once per window:
  the reveal stores `window_index`, so repeat calls change nothing
  (`resolved: false`). Deploy with the Supabase CLI
  (`supabase functions deploy resolve_window`).

### task_progress — Phase 5

- **Caller:** hider.
- **Request:** `{ "room_id": string }`
- **Response:** `{ "tasks": [TaskView], "skips_left": number }`
- **Errors:** `ROOM_NOT_FOUND`, `NOT_HIDER`.
- **Notes:** also updates task statuses (done/expired) server-side and assigns a new
  task when the current one is done/skipped/expired, per the assignment rules.
  `skips_left` is `MAX_SKIPS_PER_ROUND` minus `players.skips_used`. The tasks
  list is the hider's tasks in the room, newest first. Completion is
  server-side from the hider's own GPS readings (fresh `locations` rows):
  `reach_zone` — every reading in the last 20 s inside the 30 m circle;
  `stay_put` — readings spanning 3 min, each consecutive pair within 10 m,
  readings with accuracy worse than 25 m ignored; `distance` — the latest
  reading outside the 80 m circle around the play area centre; `photo` — a
  bonus snapshot (`window_index: 0`) exists for this hider. A completed task
  awards its points once (status moves to `done` server-side, so a second
  poll cannot re-award); a task past `expires_at` becomes `expired` with no
  points. Assignment (also used at hunt start — the first poll after the
  round starts hunting assigns the opening task): duration is random 4–8
  minutes, `reach_zone` gets a 30 m circle inside the play area, a movement
  task (`reach_zone`/`distance`) is forced when the last two tasks were not
  movement, and a type is never repeated three times in a row. Points per
  type: 35 / 10 / 20 / 20.

### skip_task — Phase 5

- **Caller:** hider.
- **Request:** `{ "room_id": string, "task_id": string }`
- **Response:** `{ "ok": true, "points_penalty": 5, "skips_left": number }`
- **Errors:** `NOT_HIDER`, `NO_ACTIVE_TASK`, `SKIPS_EXHAUSTED`, `ROUND_NOT_HUNTING`.
- **Notes:** marks the task `skipped` (−5 points, counted in
  `players.skips_used`, capped at 2 per round — the counter is reset by
  rematch) and assigns the next task.

### use_ability — Phase 6

- **Caller:** finder.
- **Request:** `{ "room_id": string, "kind": "pulse|zone_scan|clue_card", "lat": number|null, "lng": number|null, "radius_m": number|null }`
  - `pulse`: no params — targets the nearest hider.
  - `zone_scan`: `lat`, `lng`, `radius_m` (≤ 100 m) required.
  - `clue_card`: no params.
- **Response:** `{ "ok": true, "reveal": RevealView, "charges_left": number, "cooldown_until": number }`
- **Errors:** `NOT_FINDER`, `ROUND_NOT_HUNTING`, `NOT_ENOUGH_CHARGES`, `ON_COOLDOWN`,
  `INVALID_PARAMS`, `PULSE_SAME_HIDERS` (same hider twice within 5 min).
- **Notes:** checks charges via `getCharges` (`shared/charges.ts`: 1 charge per
  4 min of hunt time, +1 once the round reaches 20:00, minus spent — the spend
  is the `ability_uses` row count for the finder in the room) and a 30 s
  cooldown between any two uses. `pulse` = 80 m circle centred up to 50 m away
  from the hider, 10 s; the same hider cannot be pulsed twice within 5
  minutes. `zone_scan` = hider count in the circle, 20 s. `clue_card` = current
  task type of one random active hider (no name), 30 s. Writes an
  `ability_used` event containing only the ability name, and one
  `ability_uses` row per use. Reveals are written to `reveals` with kind
  `pulse` / `zone_scan` / `clue` (the finder's own rows).

### request_tag — Phase 7

- **Caller:** finder.
- **Request:** `{ "room_id": string, "hider_id": string }`
- **Response:** `{ "ok": true, "tag_id": string, "status": "pending" }`
- **Errors:** `NOT_FINDER`, `ROUND_NOT_HUNTING`, `HIDERS_ALREADY_TAGGED`,
  `LOCATION_TOO_OLD` (both readings > 15 s), `ACCURACY_TOO_POOR` (> 15 m),
  `TOO_FAR` (> 15 m), `ON_TAG_LOCKOUT` (20 s after a failed attempt).
- **Notes:** reads both locations via the service key. A failed attempt writes an
  event `tag_attempt_failed`; a second attempt within 20 s is rejected with
  `ON_TAG_LOCKOUT`.

### confirm_tag — Phase 7

- **Caller:** the hider of the tag.
- **Request:** `{ "room_id": string, "tag_id": string }`
- **Response:** `{ "ok": true, "hider_status": "tagged", "finder_points": 73 }`
- **Errors:** `NOT_TAGGED_HIDERS`, `TAG_NOT_PENDING`.
- **Notes:** tag → `confirmed`, hider → `tagged`, finder += 60 + 1 per full minute
  left in the round. If no active hider remains: finder += 100, round ends
  (status `ended`, event `round_ended`).

### dispute_tag — Phase 7

- **Caller:** the hider of the tag.
- **Request:** `{ "room_id": string, "tag_id": string }`
- **Response:** `{ "ok": true, "status": "disputed" }`
- **Errors:** `NOT_TAGGED_HIDERS`, `TAG_NOT_PENDING`.

### finalize_tag — Phase 7

- **Caller:** any authenticated member (idempotent; client polls).
- **Request:** `{ "room_id": string, "tag_id": string }`
- **Response:** `{ "ok": true, "confirmed": boolean, "points": number | null }`
- **Errors:** `TAG_NOT_PENDING` (already resolved — returns the current state).
- **Notes:** a pending tag with no confirm/dispute for 10 s is auto-confirmed
  (silence counts). Idempotent: repeated calls return the same result.

### resolve_dispute — Phase 7

- **Caller:** host.
- **Request:** `{ "room_id": string, "tag_id": string, "decision": "confirmed|denied" }`
- **Response:** `{ "ok": true, "confirmed": boolean, "points": number | null }`
- **Errors:** `NOT_HOST`, `TAG_NOT_DISPUTED`.
- **Notes:** `confirmed` applies the same effects as `confirm_tag`; `denied` closes
  the tag with no points and the hider stays active.

### finalize_scores — Phase 7

- **Caller:** any authenticated member (idempotent; client polls after the round
  ends).
- **Request:** `{ "room_id": string }`
- **Response:** `{ "ok": true, "finalized": boolean, "scores": [ { "player_id", "nickname", "points", "breakdown": [ { "label": string, "points": number } ] } ], "finder_won": boolean }`
- **Errors:** `ROUND_NOT_ENDED`, `ALREADY_FINALIZED`.
- **Notes:** +15 per window (1..5) where the hider was still untagged, +50 if untagged
  at the end. Full breakdown written to an `events` row (`scores_finalized`).
  `finder_won` = every hider was tagged. Idempotent via `rooms.scores_finalized`.

### sos — Phase 8

- **Caller:** any authenticated member.
- **Request:** `{ "room_id": string, "lat": number, "lng": number }`
- **Response:** `{ "ok": true, "alert_id": string, "round_paused": true }`
- **Errors:** `ROOM_NOT_FOUND`, `NOT_IN_ROOM`, `ROUND_NOT_ACTIVE`, `BAD_REQUEST`.
- **Notes:** live hiding/hunting/paused rooms only. Inserts an `sos_alerts` row (service key), pauses the round
  (status `paused`, preserving an existing `paused_at`), atomically writes
  event `sos` containing alert/player IDs only, never coordinates.

### purge_photos — Phase 8

- **Caller:** host, round must be `ended`.
- **Request:** `{ "room_id": string }`
- **Response:** `{ "ok": true, "purged": number }`
- **Errors:** `NOT_HOST`, `ROUND_NOT_ENDED`.
- **Notes:** deletes all `snapshots` rows for the room and all storage objects under
  `{room_id}/` in the `snapshots` bucket (service key). Called internally by
  `rematch`.

---

## 5. Shared client helpers

### constants (Phase 0)

File: `shared/constants.ts` (import as `@shared/constants` — the Vite alias
`@shared` maps to the `shared/` folder; never copy the file into `src/`).
Exports every game number: `MIN_PLAYERS`, `MAX_PLAYERS`,
`ROUND_DURATION_SEC`, `HIDE_DURATION_SEC`, `HUNT_DURATION_SEC`,
`SNAPSHOT_WINDOW_SEC`, `SNAPSHOT_WINDOW_COUNT`, `SNAPSHOT_ON_TIME_TOLERANCE_SEC`,
`SNAPSHOT_LATE_TOLERANCE_SEC`, `SNAPSHOT_ON_TIME_POINTS`, `TAG_DISTANCE_M`,
`TAG_LOCATION_MAX_AGE_SEC`, `TAG_ACCURACY_MAX_M`, `TAG_LOCKOUT_SEC`,
`TAG_POINTS_BASE`, `TAG_POINTS_PER_MIN`, `UNTAGGED_END_BONUS`,
`WINDOW_UNTAGGED_BONUS`, `UNTAGGED_END_POINTS`, `FINALIZE_TAG_SILENCE_SEC`,
task values (`REACH_ZONE_*`, `STAY_PUT_*`, `DISTANCE_TASK_*`, `PHOTO_TASK_POINTS`,
`PHOTO_PROMPTS`, `MAX_SKIPS_PER_ROUND`, `SKIP_POINTS_PENALTY`), ability values
(`ABILITY_COST`, `ABILITY_CHARGE_INTERVAL_SEC`, `ABILITY_EXTRA_CHARGE_AT_ROUND_SEC`,
`ABILITY_COOLDOWN_SEC`, `PULSE_*`, `ZONE_SCAN_*`, `CLUE_CARD_DURATION_SEC`),
proximity bands, `SPEED_LIMIT_M_PER_S`, `OUT_OF_BOUNDS_*`, `LAST_KNOWN_*`,
`PLAY_AREA_RADIUS_MIN_M`/`MAX_M`, `CODE_ALPHABET`, `CODE_LENGTH`,
`STORAGE_BUCKET`, `SNAPSHOT_URL_TTL_SEC`, `NICKNAME_MAX_LEN`.

### roundState (Phase 2)

`getRoundState(room: RoomView, serverNowMs: number): RoundState`

- `round_seconds = (serverNowMs - started_at - paused_total_ms) / 1000`, clamped to
  `[0, ROUND_DURATION_SEC]`; while `paused`, use `paused_at` instead of
  `serverNowMs`.
- `phase`: `lobby` before `started_at`, `hiding` for `< HIDE_DURATION_SEC`,
  `hunting` for `< ROUND_DURATION_SEC`, else `ended`. `paused` overrides while the
  room is paused.
- `seconds_left_in_phase`: hide time left while `hiding` (or `paused` inside the
  hide phase), hunt time left while `hunting` (or `paused` inside the hunt
  phase), 0 otherwise.
- `window = clamp(floor(round_seconds / SNAPSHOT_WINDOW_SEC), 0, SNAPSHOT_WINDOW_COUNT)`
  for `hiding`/`hunting`/`paused`; 0 otherwise.
- **Parity:** the `round` object returned by the `advance_round` RPC has exactly
  these fields and semantics — the frontend may use either source.

`getCharges(room: RoomView, serverNowMs: number, spent: number): number` (Phase 6)

- `hunt_seconds = max(0, round_seconds - HIDE_DURATION_SEC)`
- `charges = floor(hunt_seconds / ABILITY_CHARGE_INTERVAL_SEC)` plus 1 when
  `round_seconds >= ABILITY_EXTRA_CHARGE_AT_ROUND_SEC`, minus `spent`. Clamped at 0.

---

## 6. Client polling guide (for Agent B)

1. On load: sign in anonymously, then call `server_now` once to compute the offset.
2. In a lobby: poll nothing (or `server_now` occasionally); use RPCs on action.
3. During a round: poll `advance_round` every ~1 s (drives phase transitions) and
   `round_status` every ~2–5 s (proximity, abilities, out-of-bounds).
4. At each window close (5:00, 10:00, …): after 2 min call `resolve_window`
   (idempotent — safe to call repeatedly).
5. On a tag request: poll `finalize_tag` until `confirmed`/`disputed` (10 s silence
   auto-confirms).
6. When the round ends: poll `finalize_scores` until `finalized`, then show results.
7. Never store the service key in the frontend or in git.

---

## 7. Phase availability

| Phase | Lands | Status |
|-------|-------|--------|
| 0 | layout, constants, this contract, setup docs | done (merged) |
| 1 | rooms/players/events tables + RLS; create_room, join_room, leave_room, kick_player, set_ready | landed (PR #2) |
| 2 | set_play_area, start_round, server_now, advance_round, pause_round, resume_round, end_round; getRoundState | landed (PR #3) |
| settings | rooms.hide_duration_min / max_players; set_room_settings; clock uses per-room settings | landed (PR #8) |
| dev tools | dev_add_dummy_players (testing) | landed (this PR) |
| 3 | locations, reveals + RLS; round_status | landed (this PR) |
| 4 | snapshots + RLS; submit_snapshot, snapshot_urls, resolve_window | planned |
| 5 | tasks + RLS; task_progress, skip_task | in this PR |
| 6 | ability_uses + RLS; use_ability; getCharges | in this PR |
| 7 | tags + RLS; request_tag, confirm_tag, dispute_tag, finalize_tag, resolve_dispute, finalize_scores, rematch | in this PR |
| 8 | sos_alerts + RLS; sos, purge_photos; RLS check script, bots | implemented; live checks pending |

Phase 8 rematch integration: frontend calls the `rematch` Edge Function with
`{room_id}` so storage cleanup precedes SQL reset. Direct SQL reset while room
objects remain fails `PHOTOS_NOT_PURGED`; cleanup failure reports `PURGE_FAILED`.

### host_safety — Phase 8 UI support

- **Caller:** authenticated room host only.
- **Request:** POST `{ "room_id": string }`.
- **Response:** `{ "players": [{ "id": string, "nickname": string,
  "status": string, "suspect": boolean, "last_reading_at": string|null,
  "out_of_area": boolean|null }] }`.
- **Errors:** `NOT_AUTHENTICATED`, `BAD_REQUEST`, `NOT_HOST`, `DB_ERROR`.
- **Privacy:** never returns coordinates or precise distances; missing readings
  yield null age timestamp and null area flag. Host UI polls every 5 seconds.
