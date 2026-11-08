/**
 * Snapfind — pure snapshot-window helpers (Phase 4).
 *
 * No Supabase / Deno imports here: everything is pure so Vitest can test it
 * directly (like lib/round.ts and lib/geo.ts). Game numbers come from
 * shared/constants.ts (the single source of truth); the Edge Functions that
 * use this file must be deployed with the Supabase CLI so the local import
 * graph is bundled.
 */

import {
  LAST_KNOWN_REVEAL_DURATION_SEC,
  LAST_KNOWN_REVEAL_RADIUS_M,
  LAST_KNOWN_SECOND_DURATION_SEC,
  LAST_KNOWN_SECOND_RADIUS_M,
  SNAPSHOT_BONUS_WINDOW_INDEX,
  SNAPSHOT_LATE_TOLERANCE_SEC,
  SNAPSHOT_ON_TIME_POINTS,
  SNAPSHOT_ON_TIME_TOLERANCE_SEC,
  SNAPSHOT_URL_TTL_SEC,
  SNAPSHOT_WINDOW_SEC,
} from '../../../shared/constants.ts'
import type { LatLng } from './geo.ts'

export type WindowState = 'not_open' | 'on_time' | 'late' | 'closed'

/**
 * Where is window n of the round?
 *
 * Window n opens at n * SNAPSHOT_WINDOW_SEC of round time. On time = within
 * SNAPSHOT_ON_TIME_TOLERANCE_SEC of the opening (+ points); late = within
 * SNAPSHOT_LATE_TOLERANCE_SEC; beyond that the window is closed.
 */
export function windowState(roundSeconds: number, windowIndex: number): WindowState {
  const open = windowIndex * SNAPSHOT_WINDOW_SEC
  if (roundSeconds < open) return 'not_open'
  if (roundSeconds <= open + SNAPSHOT_ON_TIME_TOLERANCE_SEC) return 'on_time'
  if (roundSeconds <= open + SNAPSHOT_LATE_TOLERANCE_SEC) return 'late'
  return 'closed'
}

/** The points a regular (non-bonus) snapshot earns in this window state. */
export function windowPoints(state: WindowState): number {
  return state === 'on_time' ? SNAPSHOT_ON_TIME_POINTS : 0
}

/** The image path of a snapshot inside the private bucket. */
export function snapshotImagePath(roomId: string, playerId: string, windowIndex: number): string {
  return `${roomId}/${playerId}/${windowIndex}.jpg`
}

/** True when the path is exactly the caller's own folder for this window. */
export function isValidSnapshotImagePath(
  roomId: string,
  playerId: string,
  windowIndex: number,
  path: string,
): boolean {
  return path === snapshotImagePath(roomId, playerId, windowIndex)
}

/** Round time in seconds from a room's round clock fields (server clock). */
export function roundSeconds(
  nowMs: number,
  startedAtIso: string | null,
  pausedTotalMs: number,
): number {
  if (!startedAtIso) return 0
  return (nowMs - Date.parse(startedAtIso) - pausedTotalMs) / 1000
}

/** Point on the play-area boundary (east of the centre) — used when a hider
 * has no stored position for a missed-window reveal. */
export function playAreaEdge(area: { lat: number; lng: number; radiusM: number }): LatLng {
  const lngOffset = area.radiusM / (111320 * Math.cos((area.lat * Math.PI) / 180))
  return { lat: area.lat, lng: area.lng + lngOffset }
}

/** Reveal label for a missed snapshot window. */
export function lastKnownLabel(windowIndex: number, secondMiss: boolean): string {
  return `last_known: missed window ${windowIndex}${secondMiss ? ' (repeat miss)' : ''}`
}

/** Radius / duration for a missed-window reveal: 60 m / 15 s first miss,
 * 40 m / 30 s second miss in the round. */
export function lastKnownReveal(secondMiss: boolean): { radiusM: number; durationSec: number } {
  return secondMiss
    ? { radiusM: LAST_KNOWN_SECOND_RADIUS_M, durationSec: LAST_KNOWN_SECOND_DURATION_SEC }
    : { radiusM: LAST_KNOWN_REVEAL_RADIUS_M, durationSec: LAST_KNOWN_REVEAL_DURATION_SEC }
}

export {
  LAST_KNOWN_REVEAL_DURATION_SEC,
  LAST_KNOWN_REVEAL_RADIUS_M,
  LAST_KNOWN_SECOND_DURATION_SEC,
  LAST_KNOWN_SECOND_RADIUS_M,
  SNAPSHOT_BONUS_WINDOW_INDEX,
  SNAPSHOT_LATE_TOLERANCE_SEC,
  SNAPSHOT_ON_TIME_POINTS,
  SNAPSHOT_ON_TIME_TOLERANCE_SEC,
  SNAPSHOT_URL_TTL_SEC,
  SNAPSHOT_WINDOW_SEC,
}
