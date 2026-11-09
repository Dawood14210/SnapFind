/**
 * Snapfind — pure ability helpers (Phase 6).
 *
 * No Supabase / Deno imports here: everything is pure so Vitest can test it
 * directly (like lib/round.ts, lib/geo.ts, lib/snapshot.ts and lib/tasks.ts).
 * Game numbers come from shared/constants.ts (the single source of truth);
 * the Edge Function that uses this file must be deployed with the Supabase
 * CLI so the local import graph is bundled.
 *
 * Abilities: pulse (cost 1) — an 80 m circle centred up to 50 m away from
 * the nearest hider, 10 s, the same hider not twice within 5 minutes;
 * zone_scan (cost 2) — count of hiders in a circle up to 100 m, 20 s;
 * clue_card (cost 1) — current task type of one random active hider, no
 * name, 30 s.
 */

import {
  PULSE_MAX_OFFSET_M,
  PULSE_RADIUS_M,
  ZONE_SCAN_MAX_RADIUS_M,
} from '../../../shared/constants.ts'
import { haversineM, type LatLng } from './geo.ts'

export type AbilityKind = 'pulse' | 'zone_scan' | 'clue_card'

export interface Reading {
  lat: number
  lng: number
  atMs: number
}

export interface HiderReading {
  playerId: string
  reading: Reading | null
}

/**
 * The circle centre for a pulse: a random point up to PULSE_MAX_OFFSET_M
 * (50 m) away from the hider, so the reveal does not give the exact spot.
 */
export function pulseCentre(hider: LatLng, maxOffsetM = PULSE_MAX_OFFSET_M): LatLng {
  const angle = Math.random() * 2 * Math.PI
  const offset = Math.sqrt(Math.random()) * maxOffsetM
  const dLat = (offset * Math.cos(angle)) / 111_320
  const dLng = (offset * Math.sin(angle)) / (111_320 * Math.cos((hider.lat * Math.PI) / 180))
  return { lat: hider.lat + dLat, lng: hider.lng + dLng }
}

/**
 * zone_scan: count of hiders whose latest reading is inside the circle
 * (the reading is the hider's most recent one).
 */
export function zoneScanCount(hiders: HiderReading[], centre: LatLng, radiusM: number): number {
  return hiders.filter(
    (h) => h.reading !== null && haversineM(h.reading, centre) <= radiusM,
  ).length
}

/** zone_scan radius must be a positive number up to ZONE_SCAN_MAX_RADIUS_M. */
export function isValidZoneScanRadius(radiusM: number): boolean {
  return radiusM > 0 && radiusM <= ZONE_SCAN_MAX_RADIUS_M
}

/** The clue_card label: the hider's task type, never the hider's name. */
export function clueLabel(taskType: string): string {
  return `clue: ${taskType}`
}

export { PULSE_RADIUS_M, ZONE_SCAN_MAX_RADIUS_M }
