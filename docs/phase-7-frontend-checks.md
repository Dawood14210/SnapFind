# Phase 7 frontend checks

Requires migration 009 and all Phase 7 functions deployed, plus configured
frontend Supabase environment variables. Automated checks cover TypeScript,
production bundling, and countdown boundaries; live multi-player checks below
require a configured project and have not been run in this workspace.

1. Start a round with a host, finder, and two hiders in separate sessions.
2. Finder: check the Found counter and nickname-only active-hider list.
   Request a tag with stale GPS, poor accuracy, and outside 15 m. Check the
   error message and conservative 20-second local retry gate. Server checks
   remain authoritative; no coordinates are displayed in the tag list.
3. Request a valid tag. Hider sees Confirm/Dispute and a server-clock-based
   ten-second countdown. Confirm; verify player status and Found counter.
4. Repeat, allowing the timer to expire. Finder/host polling calls finalize_tag;
   reaching zero on the client does not independently award points.
5. Dispute a tag. Host sees Accept tag/Reject tag; verify each decision and
   that rejected tags allow a fresh attempt. Non-hosts cannot resolve tags.
6. Tagged hider: verify spectator message, snapshot feed, map, timer and counter;
   task polling stops. Spectator map shows only data allowed by existing RLS.
7. End the round. Check winner, ranking, expandable score breakdown, ordered
   tag timeline, and gallery grouped by hider. Reload results in another
   session: scores come from the saved scores_finalized event, not a second
   finalization. Retry is available on read/finalization failure.
8. Host clicks Play again. Verify all sessions return to lobby after room
   status changes. Non-host sees waiting text rather than a rematch button.
9. Leave from results; verify room membership is removed and Home is shown.

Known integration boundaries: results gallery uses 60-second signed URLs;
Retry reloads expired URLs. Finalization and tag award atomicity remain backend
responsibilities. No live Supabase credentials or project were provisioned here.
