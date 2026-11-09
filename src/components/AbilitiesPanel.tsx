import type { AbilityKind } from '@/api'
import { ABILITY_COST, ABILITY_CHARGE_INTERVAL_SEC } from '@shared/constants'
import type { AbilityHistoryEntry } from '@/hooks/useAbilities'

export const ABILITY_LABELS: Record<AbilityKind, string> = {
  pulse: 'Pulse',
  zone_scan: 'Zone scan',
  clue_card: 'Clue card',
}

interface ClueCard {
  id: string
  label: string
  expiresAtMs: number
}

interface AbilitiesPanelProps {
  huntSeconds: number
  serverNowMs: number
  chargesLeft: number
  cooldownUntilMs: number | null
  history: AbilityHistoryEntry[]
  clueCards: ClueCard[]
  scanRadiusM: number
  onScanRadiusChange: (radiusM: number) => void
  onUse: (kind: AbilityKind) => void
  onStartZoneScan: () => void
  onDevGiveCharges: () => void
  devTools: boolean
  onClose: () => void
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * The finder's abilities panel (Phase 6): charge meter with the time to the
 * next charge, the cooldown indicator, the three ability buttons with their
 * costs and a reason when disabled, clue cards from the live reveals, and the
 * history list. Zone scan switches to tap-to-place on the map.
 */
export default function AbilitiesPanel({
  huntSeconds,
  serverNowMs,
  chargesLeft,
  cooldownUntilMs,
  history,
  clueCards,
  scanRadiusM,
  onScanRadiusChange,
  onUse,
  onStartZoneScan,
  onDevGiveCharges,
  devTools,
  onClose,
}: AbilitiesPanelProps) {
  // Time until the next base charge (the extra charge at 20:00 is not a
  // recharge tick, so it is not shown here).
  const nextChargeSec = Math.max(
    0,
    (Math.floor(huntSeconds / ABILITY_CHARGE_INTERVAL_SEC) + 1) * ABILITY_CHARGE_INTERVAL_SEC -
      huntSeconds,
  )
  const cooldownSeconds = cooldownUntilMs !== null ? Math.max(0, Math.ceil((cooldownUntilMs - serverNowMs) / 1000)) : 0
  const onCooldown = cooldownSeconds > 0

  const buttons = (
    <>
      <button
        onClick={() => onUse('pulse')}
        disabled={chargesLeft < ABILITY_COST.pulse || onCooldown}
        className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-bold text-amber-950 shadow active:scale-95 disabled:bg-slate-100 disabled:text-slate-400"
      >
        Pulse · 1
      </button>
      <button
        onClick={onStartZoneScan}
        disabled={chargesLeft < ABILITY_COST.zone_scan || onCooldown}
        className="flex-1 rounded-xl bg-teal-500 py-3 text-sm font-bold text-teal-950 shadow active:scale-95 disabled:bg-slate-100 disabled:text-slate-400"
      >
        Zone scan · 2
      </button>
      <button
        onClick={() => onUse('clue_card')}
        disabled={chargesLeft < ABILITY_COST.clue_card || onCooldown}
        className="flex-1 rounded-xl bg-violet-500 py-3 text-sm font-bold text-violet-950 shadow active:scale-95 disabled:bg-slate-100 disabled:text-slate-400"
      >
        Clue card · 1
      </button>
    </>
  )

  const disabledReason = (cost: number): string | null => {
    if (onCooldown) return 'On cooldown'
    if (chargesLeft < cost) return 'No charges'
    return null
  }

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <h2 className="text-lg font-black text-slate-900">Abilities</h2>
        <button
          onClick={onClose}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white active:scale-95"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Charge meter + cooldown. */}
        <div className="flex items-center justify-between rounded-2xl bg-white p-4 shadow">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Charges</p>
            <p className="text-3xl font-black text-slate-900">{chargesLeft}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Next charge</p>
            <p className="text-lg font-bold text-emerald-600">in {formatDuration(nextChargeSec)}</p>
          </div>
        </div>
        <p className={`mt-2 text-center text-sm font-semibold ${onCooldown ? 'text-amber-600' : 'text-slate-400'}`}>
          {onCooldown ? `Cooldown: ${cooldownSeconds}s` : 'Ready'}
        </p>

        {/* Ability buttons. */}
        <div className="mt-4 flex gap-2">{buttons}</div>
        <p className="mt-2 text-center text-xs font-medium text-slate-400">
          {disabledReason(1) ?? 'Tap an ability to use it'}
        </p>

        {/* Zone scan radius. */}
        <div className="mt-4 rounded-2xl bg-white p-4 shadow">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Zone scan radius
          </p>
          <div className="mt-2 flex gap-2">
            {[50, 80, 100].map((m) => (
              <button
                key={m}
                onClick={() => onScanRadiusChange(m)}
                className={`flex-1 rounded-xl py-2 text-sm font-bold active:scale-95 ${
                  scanRadiusM === m
                    ? 'bg-teal-600 text-white'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {m} m
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Tap Zone scan, then tap the map to scan that spot.
          </p>
        </div>

        {/* Clue cards from the live reveals. */}
        {clueCards.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Clue cards</p>
            <div className="mt-2 flex flex-col gap-2">
              {clueCards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-xl border border-violet-200 bg-violet-50 p-3"
                >
                  <p className="text-sm font-bold text-violet-900">{card.label}</p>
                  <p className="text-xs text-violet-600">
                    until {new Date(card.expiresAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* History. */}
        <div className="mt-4">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">History</p>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No abilities used yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {history.map((entry, i) => (
                <li
                  key={`${entry.kind}-${entry.atMs}-${i}`}
                  className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
                >
                  <span className="font-bold text-slate-800">{ABILITY_LABELS[entry.kind]}</span>
                  <span className="text-xs text-slate-500">
                    {new Date(entry.atMs).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {devTools && (
          <button
            onClick={onDevGiveCharges}
            className="mt-4 w-full rounded-xl bg-emerald-50 py-3 text-sm font-bold text-emerald-700 active:scale-95"
          >
            Dev: give 3 charges (display only)
          </button>
        )}
      </div>
    </div>
  )
}
