import { useEffect, useState } from 'react'
import type { ProximityBand } from '@/api'
import { proximityColor, proximityHint, proximityLabel, proximityVibrate } from '@/lib/proximity'

/**
 * Hider's proximity ring: a coloured ring (green/amber/red) with a text
 * label and a hint — never a distance. A short vibration fires at close.
 */
export default function ProximityRing({ band }: { band: ProximityBand | undefined }) {
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (!proximityVibrate(band)) return
    if ('vibrate' in navigator) navigator.vibrate(100)
    setPulse(true)
    const id = setTimeout(() => setPulse(false), 600)
    return () => clearTimeout(id)
  }, [band])

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow">
      <div
        className={`flex h-14 w-14 flex-none items-center justify-center rounded-full border-4 ${
          pulse ? 'animate-pulse ' : ''
        }${proximityColor(band)}`}
      >
        <span className="text-xs font-bold text-white">{proximityLabel(band)}</span>
      </div>
      <div className="min-w-0">
        <p className="font-bold text-slate-900">Proximity to the finder</p>
        <p className="text-sm text-slate-500">{proximityHint(band)}</p>
      </div>
    </div>
  )
}
