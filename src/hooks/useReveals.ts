import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '@/api/client'
import type { RevealView } from '@/api'
import { friendlyError } from '@/lib/friendlyError'

export interface UseRevealsInput {
  roomId: string
  /** True while the round is hunting (reveals only exist then). */
  hunting: boolean
  /** Only the finder reads reveals (RLS: player_id = auth.uid()). */
  isFinder: boolean
  userId: string | null
}

/**
 * Live reveals for the finder's map (Phase 4): polls the caller's own
 * unexpired reveals every ~5 s. Reveals carry kind, position, radius and
 * expiry; last_known reveals (missed snapshot windows) are drawn on the map
 * until they expire.
 */
export function useReveals(input: UseRevealsInput): { reveals: RevealView[]; error: string | null } {
  const { roomId, hunting, isFinder, userId } = input
  const [reveals, setReveals] = useState<RevealView[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!roomId || !isFinder || !userId) return
    try {
      const { data } = await getSupabase()
        .from('reveals')
        .select('id, room_id, player_id, target_player_id, kind, lat, lng, radius_m, count, label, expires_at, window_index')
        .eq('room_id', roomId)
        .eq('player_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: false })
      setReveals(data ?? [])
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [roomId, isFinder, userId])

  useEffect(() => {
    if (!hunting || !isFinder || !roomId) {
      setReveals([])
      return
    }
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [hunting, isFinder, roomId, refresh])

  return { reveals, error }
}
