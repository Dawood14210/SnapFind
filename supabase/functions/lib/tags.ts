/**
 * Snapfind — pure tag and scoring helpers (Phase 7).
 *
 * No Supabase / Deno imports here: everything is pure so Vitest can test it
 * directly (like lib/round.ts, lib/geo.ts, lib/snapshot.ts, lib/tasks.ts and
 * lib/abilities.ts). Game numbers come from shared/constants.ts (the single
 * source of truth); the Edge Functions that use this file must be deployed
 * with the Supabase CLI so the local import graph is bundled.
 *
 * Tagging: the finder requests a tag when within 15 m of a hider (both
 * readings fresh, accuracy ≤ 15 m). The hider confirms or disputes; 10 s of
 * silence auto-confirms. Confirmed tag: hider → tagged, finder += 60 + 1 per
 * full minute left in the round; when no active hider remains, finder += 100
 * and the round ends.
 *
 * Scoring: +15 per snapshot window (1..5) where the hider was still untagged,
 * +50 if untagged at the end. Finder wins only if every hider was tagged.
 */

import {
  SNAPSHOT_WINDOW_COUNT,
  SNAPSHOT_WINDOW_SEC,
  TAG_ACCURACY_MAX_M,
  TAG_DISTANCE_M,
  TAG_LOCKOUT_SEC,
  TAG_LOCATION_MAX_AGE_SEC,
  TAG_POINTS_BASE,
  TAG_POINTS_PER_MIN,
  UNTAGGED_END_POINTS,
  WINDOW_UNTAGGED_BONUS,
} from '../../../shared/constants.ts'
import { haversineM, type LatLng } from './geo.ts'

export type TagStatus = 'pending' | 'confirmed' | 'disputed'

export interface TagRow {
  id: string
  room_id: string
  finder_id: string
  hider_id: string
  status: TagStatus
  points: number | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Tag request validation (pure)
// ---------------------------------------------------------------------------

/** Both readings must be fresher than TAG_LOCATION_MAX_AGE_SEC. */
export function readingFresh(readingAtMs: number, nowMs: number): boolean {
  return nowMs - readingAtMs <= TAG_LOCATION_MAX_AGE_SEC * 1000
}

/** The reading's GPS accuracy must be ≤ TAG_ACCURACY_MAX_M (null = unknown). */
export function accuracyOk(accuracyM: number | null): boolean {
  return accuracyM !== null && accuracyM <= TAG_ACCURACY_MAX_M
}

/** The finder must be within TAG_DISTANCE_M of the hider. */
export function distanceOk(finderPos: LatLng, hiderPos: LatLng): boolean {
  return haversineM(finderPos, hiderPos) <= TAG_DISTANCE_M
}

/** A failed attempt locks the finder out for TAG_LOCKOUT_SEC. */
export function lockoutActive(lastFailedAtMs: number | null, nowMs: number): boolean {
  return lastFailedAtMs !== null && nowMs - lastFailedAtMs < TAG_LOCKOUT_SEC * 1000
}

// ---------------------------------------------------------------------------
// Scoring (pure)
// ---------------------------------------------------------------------------

/** Tag points: 60 base + 1 per full minute left in the round. */
export function tagPoints(huntSecondsLeft: number): number {
  return TAG_POINTS_BASE + Math.floor(Math.max(0, huntSecondsLeft) / 60) * TAG_POINTS_PER_MIN
}

/** Window n opens at n * SNAPSHOT_WINDOW_SEC of round time (absolute ms). */
export function windowOpenMs(
  startedAtMs: number,
  pausedTotalMs: number,
  windowIndex: number,
): number {
  return startedAtMs + pausedTotalMs + windowIndex * SNAPSHOT_WINDOW_SEC * 1000
}

/** Was the hider still untagged when window n opened? */
export function untaggedAtWindow(taggedAtMs: number | null, openMs: number): boolean {
  return taggedAtMs === null || taggedAtMs > openMs
}

/**
 * +WINDOW_UNTAGGED_BONUS per window (1..SNAPSHOT_WINDOW_COUNT) where the
 * hider was still untagged at the window's opening.
 */
export function windowBonus(
  taggedAtMs: number | null,
  startedAtMs: number,
  pausedTotalMs: number,
): number {
  let bonus = 0
  for (let n = 1; n <= SNAPSHOT_WINDOW_COUNT; n++) {
    if (untaggedAtWindow(taggedAtMs, windowOpenMs(startedAtMs, pausedTotalMs, n))) {
      bonus += WINDOW_UNTAGGED_BONUS
    }
  }
  return bonus
}

/** +UNTAGGED_END_POINTS when the hider was never tagged. */
export function untaggedEndBonus(taggedAtMs: number | null): number {
  return taggedAtMs === null ? UNTAGGED_END_POINTS : 0
}

/** The finder wins only if every hider was tagged (needs at least one hider). */
export function finderWon(hiderTaggedCount: number, totalHiders: number): boolean {
  return totalHiders > 0 && hiderTaggedCount === totalHiders
}
