import type { ProximityBand } from '@/api'

// ---------------------------------------------------------------------------
// Proximity ring (hiders): a coloured ring with a text label — never a
// distance. Short vibration when the band is close.
// ---------------------------------------------------------------------------

export function proximityLabel(band: ProximityBand | undefined): string {
  switch (band) {
    case 'far':
      return 'FAR'
    case 'near':
      return 'NEAR'
    case 'close':
      return 'CLOSE'
    default:
      return 'UNKNOWN'
  }
}

export function proximityColor(band: ProximityBand | undefined): string {
  switch (band) {
    case 'far':
      return 'bg-emerald-500'
    case 'near':
      return 'bg-amber-500'
    case 'close':
      return 'bg-red-500'
    default:
      return 'bg-slate-400'
  }
}

export function proximityVibrate(band: ProximityBand | undefined): boolean {
  return band === 'close'
}

export function proximityHint(band: ProximityBand | undefined): string {
  switch (band) {
    case 'far':
      return 'The finder is far away — over 150 m.'
    case 'near':
      return 'The finder is getting near — 50 to 150 m.'
    case 'close':
      return 'The finder is close — under 50 m. Stay still!'
    default:
      return 'No fresh reading from the finder.'
  }
}

// ---------------------------------------------------------------------------
// Out-of-bounds banner: 20 s grace to get back inside, then the countdown to
// the 60 s penalty reveal (out_of_bounds reveal on the finder's map).
// ---------------------------------------------------------------------------

export interface OutOfBoundsBanner {
  show: boolean
  /** Seconds left to get back inside (0 once ≥ 20 s out). */
  graceLeft: number
  /** Seconds until the penalty reveal (0 once ≥ 60 s out). */
  revealIn: number
}

const OUT_OF_BOUNDS_GRACE_SEC = 20
const OUT_OF_BOUNDS_REVEAL_SEC = 60

export function outOfBoundsBanner(secondsOut: number): OutOfBoundsBanner {
  if (secondsOut <= 0) return { show: false, graceLeft: 0, revealIn: 0 }
  return {
    show: true,
    graceLeft: Math.max(0, OUT_OF_BOUNDS_GRACE_SEC - secondsOut),
    revealIn: Math.max(0, OUT_OF_BOUNDS_REVEAL_SEC - secondsOut),
  }
}
