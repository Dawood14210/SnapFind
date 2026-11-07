/**
 * Round screen display helpers (pure).
 *
 * The big countdown uses getRoundState's seconds_left_in_phase: hide time
 * left while hiding, hunt time left while hunting, frozen while paused.
 */

import type { RoundPhase, RoundState } from '@shared/roundState'

/** Phase -> label shown on the round screen. */
export function phaseLabel(phase: RoundPhase): string {
  switch (phase) {
    case 'lobby':
      return 'LOBBY'
    case 'hiding':
      return 'HIDE'
    case 'hunting':
      return 'HUNT'
    case 'paused':
      return 'PAUSED'
    case 'ended':
      return 'ENDED'
  }
}

/** Seconds -> M:SS (floored, clamped at 0). */
export function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.floor(total))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Seconds shown in the big countdown (0 for lobby/ended). */
export function countdownSeconds(state: RoundState): number {
  if (state.phase === 'lobby' || state.phase === 'ended') return 0
  return Math.max(0, state.seconds_left_in_phase)
}

/** Accent colour per phase. */
export function phaseColor(phase: RoundPhase): string {
  switch (phase) {
    case 'hiding':
      return 'text-emerald-700'
    case 'hunting':
      return 'text-red-700'
    case 'paused':
      return 'text-amber-700'
    default:
      return 'text-slate-700'
  }
}
