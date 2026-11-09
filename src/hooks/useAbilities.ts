import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/api/client'
import { useAbility } from '@/api'
import type { AbilityKind, UseAbilityResult } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { getCharges } from '@shared/charges'

export interface UseAbilitiesInput {
  roomId: string
  /** True while the finder is hunting (abilities only exist then). */
  enabled: boolean
  /** Hunt time in seconds (server clock, from getRoundState). */
  huntSeconds: number
}

export interface AbilityHistoryEntry {
  kind: AbilityKind
  atMs: number
}

export interface UseAbilitiesResult {
  /** Charges available (server math, plus the dev-tool boost while testing). */
  chargesLeft: number
  /** Server timestamp (ms) until which the finder is on cooldown. */
  cooldownUntilMs: number | null
  /** Ability uses of this finder this round (newest first). */
  history: AbilityHistoryEntry[]
  /** Zone-scan placement mode (the next map tap fires the scan). */
  placing: boolean
  setPlacing: (placing: boolean) => void
  /** Use an ability (throws with the server error message). */
  use: (
    kind: AbilityKind,
    params: { lat: number | null; lng: number | null; radiusM: number | null },
  ) => Promise<UseAbilityResult>
  /** Dev tool (?dev=1): +3 charges (display only — the server enforces). */
  devGiveCharges: () => void
  error: string | null
}

/**
 * Finder abilities state (Phase 6): recharges via getCharges from the hunt
 * time and the ability_uses count, tracks the 30 s cooldown and the history,
 * and fires uses through the use_ability Edge Function. The server owns
 * charges, cooldown and reveals; the client only displays and sends.
 */
export function useAbilities(input: UseAbilitiesInput): UseAbilitiesResult {
  const { roomId, enabled, huntSeconds } = input

  const [baseCharges, setBaseCharges] = useState(0)
  const [devBoost, setDevBoost] = useState(0)
  const devBoostRef = useRef(0)
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number | null>(null)
  const [history, setHistory] = useState<AbilityHistoryEntry[]>([])
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!roomId) return
    try {
      const { data } = await getSupabase()
        .from('ability_uses')
        .select('kind, created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
      const rows = data ?? []
      setHistory(
        rows.map((r) => ({ kind: r.kind as AbilityKind, atMs: Date.parse(r.created_at) })),
      )
      // While the dev boost is active, keep the inflated display instead of
      // recomputing from the database.
      if (devBoostRef.current === 0) {
        setBaseCharges(getCharges(huntSeconds, rows.length))
      }
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [roomId, huntSeconds])

  useEffect(() => {
    if (!enabled || !roomId) return
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [enabled, roomId, refresh])

  const use = useCallback(
    async (
      kind: AbilityKind,
      params: { lat: number | null; lng: number | null; radiusM: number | null },
    ): Promise<UseAbilityResult> => {
      const result = await useAbility({
        room_id: roomId,
        kind,
        lat: params.lat,
        lng: params.lng,
        radius_m: params.radiusM,
      })
      // The server response is the real post-use state — drop the dev boost.
      devBoostRef.current = 0
      setDevBoost(0)
      setBaseCharges(result.charges_left)
      setCooldownUntilMs(result.cooldown_until)
      await refresh()
      return result
    },
    [roomId, refresh],
  )

  const devGiveCharges = useCallback(() => {
    devBoostRef.current += 3
    setDevBoost((n) => n + 3)
  }, [])

  return {
    chargesLeft: baseCharges + devBoost,
    cooldownUntilMs,
    history,
    placing,
    setPlacing,
    use,
    devGiveCharges,
    error,
  }
}
