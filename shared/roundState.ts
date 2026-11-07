/**
 * Snapfind — round state helpers.
 *
 * Agent A (backend) owns this file. Agent B (frontend) imports it and must
 * never edit it. These helpers are pure functions of (room, server clock):
 * the server remains the source of truth.
 *
 * The RoundState shape returned by getRoundState matches exactly the `round`
 * object returned by the advance_round RPC.
 */

import {
  HIDE_DURATION_SEC,
  HUNT_DURATION_SEC,
  ROUND_DURATION_SEC,
  SNAPSHOT_WINDOW_COUNT,
  SNAPSHOT_WINDOW_SEC,
} from './constants'

export type RoundPhase = 'lobby' | 'hiding' | 'hunting' | 'paused' | 'ended'

/** Shape of a rooms row as returned by the API (see api-contract.md). */
export interface RoomView {
  id: string
  code: string
  host_id: string
  status: RoundPhase
  center_lat: number | null
  center_lng: number | null
  radius_m: number | null
  duration_min: number
  started_at: string | null
  paused_at: string | null
  paused_total_ms: number
  finder_id: string | null
  scores_finalized: boolean
}

/** Round state derived from the room and the server clock. */
export interface RoundState {
  phase: RoundPhase
  round_seconds: number
  seconds_left_in_round: number
  seconds_left_in_phase: number
  hunt_seconds: number
  window: number
}

function parseMs(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Derive the round state from a rooms row and the current server time.
 *
 * Round time = (serverNowMs - started_at - paused_total_ms) / 1000, clamped to
 * [0, ROUND_DURATION_SEC]. While the room is paused the clock is frozen at
 * paused_at. The phase comes from the room status (advance_round performs the
 * actual transitions).
 */
export function getRoundState(room: RoomView, serverNowMs: number): RoundState {
  if (room.status === 'lobby' || room.started_at === null) {
    return {
      phase: 'lobby',
      round_seconds: 0,
      seconds_left_in_round: 0,
      seconds_left_in_phase: 0,
      hunt_seconds: 0,
      window: 0,
    }
  }

  if (room.status === 'ended') {
    return {
      phase: 'ended',
      round_seconds: ROUND_DURATION_SEC,
      seconds_left_in_round: 0,
      seconds_left_in_phase: 0,
      hunt_seconds: HUNT_DURATION_SEC,
      window: 0,
    }
  }

  // paused rooms use paused_at as the effective now
  const effectiveNowMs = room.status === 'paused' ? parseMs(room.paused_at) : serverNowMs
  const startedMs = parseMs(room.started_at)
  const roundSeconds = clamp(
    (effectiveNowMs - startedMs - room.paused_total_ms) / 1000,
    0,
    ROUND_DURATION_SEC,
  )

  const huntSeconds = Math.max(0, roundSeconds - HIDE_DURATION_SEC)
  const secondsLeftInRound = Math.max(0, ROUND_DURATION_SEC - roundSeconds)

  // While paused the clock is frozen, but the frozen hide/hunt state is still
  // reported so the UI can resume from the correct phase and window.
  let secondsLeftInPhase = 0
  if (room.status === 'hiding' || (room.status === 'paused' && roundSeconds < HIDE_DURATION_SEC)) {
    secondsLeftInPhase = Math.max(0, HIDE_DURATION_SEC - roundSeconds)
  } else if (room.status === 'hunting' || (room.status === 'paused' && roundSeconds >= HIDE_DURATION_SEC)) {
    secondsLeftInPhase = secondsLeftInRound
  }

  // highest open snapshot window (1..5); 0 = none open (lobby, hide phase,
  // before the first window, after the last window closes, ended)
  const window =
    room.status === 'hiding' || room.status === 'hunting' || room.status === 'paused'
      ? Math.min(SNAPSHOT_WINDOW_COUNT, Math.floor(roundSeconds / SNAPSHOT_WINDOW_SEC))
      : 0

  return {
    phase: room.status,
    round_seconds: roundSeconds,
    seconds_left_in_round: secondsLeftInRound,
    seconds_left_in_phase: secondsLeftInPhase,
    hunt_seconds: huntSeconds,
    window,
  }
}
