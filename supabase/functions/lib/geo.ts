/**
 * Snapfind — pure geo helpers for the round_status Edge Function.
 *
 * No Supabase / Deno imports here: everything is pure math so Vitest can test
 * it directly. Game numbers come from shared/constants.ts (the single source
 * of truth); the Edge Function must be deployed with the Supabase CLI so the
 * local import graph is bundled.
 */

import {
  OUT_OF_BOUNDS_REVEAL_DURATION_SEC,
  OUT_OF_BOUNDS_REVEAL_RADIUS_M,
  PROXIMITY_CLOSE_MAX_M,
  PROXIMITY_FAR_OVER_M,
  PROXIMITY_NEAR_MAX_M,
  PROXIMITY_NEAR_MIN_M,
  PROXIMITY_READING_MAX_AGE_SEC,
  SPEED_LIMIT_M_PER_S,
} from '../../../shared/constants.ts'

export interface LatLng {
  lat: number
  lng: number
}

export interface Reading {
  lat: number
  lng: number
  readingAtMs: number
}

export type ProximityBand = 'far' | 'near' | 'close' | 'unknown'

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Proximity band to the finder: far (> 150 m), near (50–150 m), close
 * (< 50 m), unknown (no reading in the last 30 s or no distance).
 */
export function proximityBand(distanceM: number | null, readingAgeMs: number): ProximityBand {
  if (distanceM === null || readingAgeMs > PROXIMITY_READING_MAX_AGE_SEC * 1000) {
    return 'unknown'
  }
  if (distanceM > PROXIMITY_FAR_OVER_M) return 'far'
  if (distanceM >= PROXIMITY_NEAR_MIN_M && distanceM <= PROXIMITY_NEAR_MAX_M) return 'near'
  if (distanceM < PROXIMITY_CLOSE_MAX_M) return 'close'
  return 'near'
}

export function isOutsideCircle(point: LatLng, centre: LatLng, radiusM: number): boolean {
  return haversineM(point, centre) > radiusM
}

/**
 * Seconds the player has been outside the play area, from the current
 * consecutive out-of-bounds streak of their readings (newest first). A player
 * with no out-of-bounds reading scores 0.
 */
export function secondsOutOfBounds(
  readings: Reading[], // newest first
  centre: LatLng,
  radiusM: number,
  nowMs: number,
): number {
  let streakStartMs = 0
  for (const r of readings) {
    if (isOutsideCircle(r, centre, radiusM)) {
      streakStartMs = r.readingAtMs
    } else {
      break
    }
  }
  return streakStartMs === 0 ? 0 : Math.max(0, nowMs - streakStartMs) / 1000
}

/**
 * Highest speed implied by consecutive readings (metres per second). Pairs
 * with a gap over maxGapMs are skipped (the device was offline).
 */
export function impliedSpeedMps(readings: Reading[], maxGapMs = 60_000): number {
  const sorted = [...readings].sort((a, b) => a.readingAtMs - b.readingAtMs)
  let max = 0
  for (let i = 1; i < sorted.length; i++) {
    const dt = (sorted[i].readingAtMs - sorted[i - 1].readingAtMs) / 1000
    if (dt <= 0 || dt * 1000 > maxGapMs) continue
    const d = haversineM(sorted[i - 1], sorted[i])
    max = Math.max(max, d / dt)
  }
  return max
}

export const OUT_OF_BOUNDS_REVEAL_SEC = OUT_OF_BOUNDS_REVEAL_DURATION_SEC
export const OUT_OF_BOUNDS_REVEAL_RADIUS = OUT_OF_BOUNDS_REVEAL_RADIUS_M
export const SPEED_LIMIT = SPEED_LIMIT_M_PER_S
