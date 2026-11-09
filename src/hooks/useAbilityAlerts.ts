import { useCallback, useEffect, useRef } from 'react'
import { getSupabase } from '@/api/client'
import type { AbilityKind } from '@/api'
import { friendlyError } from '@/lib/friendlyError'

export interface UseAbilityAlertsInput {
  roomId: string
  /** True while the round is hunting (alerts only exist then). */
  enabled: boolean
  /** Fired once per new ability_used event (kind only). */
  onAlert: (kind: AbilityKind) => void
}

/**
 * Hider ability alerts (Phase 6): polls the room's recent events and fires
 * onAlert for every new `ability_used` event — "The finder used Pulse".
 * The event payload carries only the ability name, so hiders learn the
 * ability but never a position.
 */
export function useAbilityAlerts(input: UseAbilityAlertsInput): void {
  const { roomId, enabled, onAlert } = input
  const seenRef = useRef<Set<string>>(new Set())
  const onAlertRef = useRef(onAlert)
  onAlertRef.current = onAlert

  const poll = useCallback(async () => {
    if (!roomId) return
    try {
      const { data } = await getSupabase()
        .from('events')
        .select('id, type, payload, created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(10)
      for (const row of data ?? []) {
        if (row.type !== 'ability_used') continue
        const kind = (row.payload as { kind?: unknown } | null)?.kind
        if (kind !== 'pulse' && kind !== 'zone_scan' && kind !== 'clue_card') continue
        if (seenRef.current.has(row.id)) continue
        seenRef.current.add(row.id)
        onAlertRef.current(kind as AbilityKind)
      }
    } catch (err) {
      console.error(friendlyError(err))
    }
  }, [roomId])

  useEffect(() => {
    if (!enabled || !roomId) return
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [enabled, roomId, poll])
}
