/**
 * Snapfind — pure task helpers (Phase 5).
 *
 * No Supabase / Deno imports here: everything is pure so Vitest can test it
 * directly (like lib/round.ts, lib/geo.ts and lib/snapshot.ts). Game numbers
 * come from shared/constants.ts (the single source of truth); the Edge
 * Functions that use this file must be deployed with the Supabase CLI so the
 * local import graph is bundled.
 *
 * Task types: reach_zone (30 m circle for 20 s, 35 points), stay_put (within
 * 10 m for 3 minutes, ignore accuracy worse than 25 m, 10 points), distance
 * (80 m from the play area centre, 20 points), photo (bonus snapshot, 20
 * points). Assignment: 4–8 minutes, a movement task is forced when the last
 * two were not movement, never the same type three times in a row.
 */

import {
  DISTANCE_TASK_POINTS,
  DISTANCE_TASK_RADIUS_M,
  PHOTO_TASK_POINTS,
  REACH_ZONE_DURATION_SEC,
  REACH_ZONE_POINTS,
  REACH_ZONE_RADIUS_M,
  STAY_PUT_ACCURACY_IGNORE_M,
  STAY_PUT_DURATION_SEC,
  STAY_PUT_MOVE_TOLERANCE_M,
  STAY_PUT_POINTS,
  TASK_MAX_DURATION_SEC,
  TASK_MIN_DURATION_SEC,
  TASK_MOVEMENT_TYPES,
  TASK_TYPES,
} from '../../../shared/constants.ts'
import { haversineM, type LatLng } from './geo.ts'

export type TaskType = (typeof TASK_TYPES)[number]
export type TaskStatus = 'pending' | 'active' | 'done' | 'skipped' | 'expired'

/** Task params as stored in the tasks table (jsonb). */
export interface TaskParams {
  lat?: number
  lng?: number
  radius_m?: number
}

/** A tasks row (only the columns the Edge Functions use). */
export interface TaskRow {
  id: string
  room_id: string
  player_id: string
  type: TaskType
  params: TaskParams
  status: TaskStatus
  points: number
  assigned_at: string
  expires_at: string
}

/** A locations reading (only the columns the task checks use). */
export interface Reading {
  lat: number
  lng: number
  accuracyM: number | null
  atMs: number
}

/** Points each task type earns when completed. */
export const TASK_POINTS: Record<TaskType, number> = {
  reach_zone: REACH_ZONE_POINTS,
  stay_put: STAY_PUT_POINTS,
  distance: DISTANCE_TASK_POINTS,
  photo: PHOTO_TASK_POINTS,
}

export function isMovementTask(type: TaskType): boolean {
  return TASK_MOVEMENT_TYPES.includes(type)
}

/** Task duration: uniformly random between 4 and 8 minutes. */
export function taskDurationSec(): number {
  const span = TASK_MAX_DURATION_SEC - TASK_MIN_DURATION_SEC
  return TASK_MIN_DURATION_SEC + Math.floor(Math.random() * (span + 1))
}

/**
 * Pick the next task type from the hider's task history (newest first).
 * Rules: never the same type three times in a row; force a movement task
 * (reach_zone / distance) when the last two were both non-movement.
 */
export function pickTaskType(history: TaskType[]): TaskType {
  const last1 = history[0] ?? null
  const last2 = history[1] ?? null
  let candidates: TaskType[] = [...TASK_TYPES]
  if (last1 && last2 && last1 === last2) {
    // Never the same type three times in a row.
    candidates = candidates.filter((t) => t !== last1)
  }
  if (last1 && last2 && !isMovementTask(last1) && !isMovementTask(last2)) {
    // The last two were not movement — force a movement task.
    candidates = [...TASK_MOVEMENT_TYPES]
  }
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/**
 * Random point uniformly inside a circle of radiusM metres around the
 * centre (used for the reach_zone circle, kept inside the play area).
 */
export function randomPointInCircle(centre: LatLng, radiusM: number): LatLng {
  const angle = Math.random() * 2 * Math.PI
  const r = Math.sqrt(Math.random()) * radiusM
  const dLat = (r * Math.cos(angle)) / 111_320
  const dLng = (r * Math.sin(angle)) / (111_320 * Math.cos((centre.lat * Math.PI) / 180))
  return { lat: centre.lat + dLat, lng: centre.lng + dLng }
}

/**
 * Task params per type: reach_zone gets a 30 m circle somewhere inside the
 * play area; distance gets the play area centre (the hider must get 80 m
 * away from it); stay_put and photo have no params.
 */
export function taskParams(
  type: TaskType,
  area: LatLng & { radiusM: number },
): TaskParams {
  if (type === 'reach_zone') {
    const spot = randomPointInCircle(area, Math.max(0, area.radiusM - REACH_ZONE_RADIUS_M))
    return { lat: spot.lat, lng: spot.lng, radius_m: REACH_ZONE_RADIUS_M }
  }
  if (type === 'distance') {
    return { lat: area.lat, lng: area.lng, radius_m: DISTANCE_TASK_RADIUS_M }
  }
  return {}
}

/**
 * Is the task complete? `readings` are the hider's own GPS readings in this
 * room (order-agnostic); `nowMs` is the server clock. Photo tasks are
 * completed by a bonus snapshot (window 0) — the Edge Function checks that
 * against the snapshots table, not here.
 */
export function isTaskComplete(
  task: Pick<TaskRow, 'type' | 'params'>,
  readings: Reading[],
  nowMs: number,
): boolean {
  switch (task.type) {
    case 'reach_zone':
      return reachZoneComplete(task.params, readings, nowMs)
    case 'stay_put':
      return stayPutComplete(readings, nowMs)
    case 'distance':
      return distanceComplete(task.params, readings)
    case 'photo':
      return false
  }
}

/**
 * reach_zone: every reading in the last REACH_ZONE_DURATION_SEC (20 s) is
 * inside the 30 m circle. The client stores readings every ~3 s, so a
 * window of readings all inside means the hider stayed inside.
 */
function reachZoneComplete(params: TaskParams, readings: Reading[], nowMs: number): boolean {
  const centre = { lat: params.lat ?? 0, lng: params.lng ?? 0 }
  const radius = params.radius_m ?? REACH_ZONE_RADIUS_M
  const window = readings.filter((r) => r.atMs >= nowMs - REACH_ZONE_DURATION_SEC * 1000)
  return window.length > 0 && window.every((r) => haversineM(r, centre) <= radius)
}

/**
 * stay_put: valid readings (accuracy no worse than 25 m — worse readings are
 * ignored) spanning STAY_PUT_DURATION_SEC (3 min) with every consecutive
 * pair within STAY_PUT_MOVE_TOLERANCE_M (10 m).
 */
function stayPutComplete(readings: Reading[], nowMs: number): boolean {
  const valid = readings
    .filter((r) => (r.accuracyM ?? 0) <= STAY_PUT_ACCURACY_IGNORE_M)
    .sort((a, b) => a.atMs - b.atMs)
  if (valid.length < 2) return false
  if (valid[valid.length - 1].atMs - valid[0].atMs < STAY_PUT_DURATION_SEC * 1000) return false
  for (let i = 1; i < valid.length; i++) {
    if (haversineM(valid[i - 1], valid[i]) > STAY_PUT_MOVE_TOLERANCE_M) return false
  }
  return true
}

/**
 * distance: the latest reading is outside the radius_m circle around the
 * target point (the play area centre).
 */
function distanceComplete(params: TaskParams, readings: Reading[]): boolean {
  if (readings.length === 0) return false
  const target = { lat: params.lat ?? 0, lng: params.lng ?? 0 }
  const radius = params.radius_m ?? DISTANCE_TASK_RADIUS_M
  const latest = readings.reduce((a, b) => (a.atMs >= b.atMs ? a : b))
  return haversineM(latest, target) > radius
}
