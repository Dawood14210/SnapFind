# Six-phone field test — Snapfind

Status: **not yet run**. Use a dedicated test project and a safe, daylight,
bounded area with an agreed emergency contact and no roads/water hazards.
Assign phone 1 host, phone 2 finder, phones 3–6 hiders. Keep browser consoles
available. Do not interpret a stale GPS status as proof someone is safe.

## Setup and room flow
- [ ] Deploy migrations and Edge Functions (including host_safety); enable
      anonymous sign-in, private snapshots and Realtime rooms/players/events.
- [ ] Run staging RLS fixture checks and SQL policy audit; all PASS.
- [ ] Scan actual production build using configured service key (never VITE_).
- [ ] Test landing, Rules, room creation/join, invalid/full/duplicate-name errors,
      host kick/leave, settings, roles, ready gate, play-area editor and minimum players.
- [ ] Verify mobile direct-route reload/rejoin keeps the same anonymous identity.
- [ ] Install/Add to Home Screen on supported devices; inspect icons and launch.
      Manifest does not provide offline gameplay; network is required.

## Round, location and clocks
- [ ] Host starts; finder hide lock and hide/hunt/paused clocks agree across phones.
- [ ] Pause/resume; offline one phone, refresh another, recover both without losing identity.
- [ ] Deny location, then restore; verify accuracy ready gate and permission feedback.
- [ ] Failed GPS upload shows Retry; reconnect and retry the last sensor timestamp,
      never relabel an old reading as fresh. New readings clear the error.
- [ ] Check hider proximity bands, out-of-bounds grace/reveal, and speed flag.
      No opponent's precise coordinates appear on a hider's screen.

## Snapshots, tasks, abilities
- [ ] Each phone submits on-time, late and missed windows; verify scores and reveals.
- [ ] Camera cancel/denial, photo task, bonus photo, finder feed filters and image zoom.
- [ ] Complete each task type; skip twice, reject third skip; verify penalties/expiry.
- [ ] Finder uses pulse, zone_scan placement/radius and clue_card; verify charges,
      cooldown, repeated-target restriction, reveal expiry and hider alerts.

## Tags and results
- [ ] Request tag too far away, with poor/stale readings; verify failure + lockout.
- [ ] Valid tag: Confirm; second tag: Dispute; host Accept/Reject on separate tries.
- [ ] Silence for ten seconds; check confirmation, points and Found counter.
- [ ] Tagged phone stops tasks/prompts and can spectate snapshots/timer/map.
- [ ] End naturally/manual/all-tagged; inspect winner, leaderboard, breakdown,
      timeline and hider-grouped gallery. Reload results in two sessions.
- [ ] Host Play again purges nested/orphan photos and old SOS alerts; returns all
      phones to lobby. Non-host cannot rematch/purge. Leave works after end.

## Safety and resilience
- [ ] Hold SOS for 1.9 seconds then release/drag away/cancel: no request.
- [ ] Hold for full two seconds via touch and keyboard: SOS records and pauses.
- [ ] Host sees full-screen alert, nickname and safe-resume action. Hiders cannot
      read SOS positions; host status panel shows ages/flags, never coordinates.
- [ ] Second SOS while paused preserves pause clock. Confirm everyone safe and
      Resume; later ordinary pause must not reshow an old SOS alert.
- [ ] Offline SOS explicitly warns to contact host/emergency services directly.
- [ ] Test low battery warning if Battery API exists; unsupported browsers work.
- [ ] Test daylight warning with device/time/location simulation; do not play at night.
- [ ] Enable/disable sound after gesture; vibration works where supported, silently
      degrades otherwise. In-round Rules opens separately without leaving room.
- [ ] Test large text, bright sunlight, keyboard focus in SOS alert, screen reader
      labels, large tap targets, and portrait/landscape layouts.
- [ ] Trigger a render failure in development; boundary offers reload/rejoin.
- [ ] Simulate storage failure during purge; rematch fails safely and can retry.

Record OS/browser, project version, expected vs observed, console errors (redact
keys/coordinates), reproduction steps, and pass/fail for each phone.
