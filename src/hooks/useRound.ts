import { useCallback, useEffect, useRef, useState } from 'react'
import { advanceRound } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import type { RoomView, RoundState } from '@/api'

export interface RoundStateView {
  room: RoomView | null
  round: RoundState | null
  loading: boolean
  error: string | null
}

/**
 * Round screen state for a room id: polls advance_round every ~1 s while the
 * round is active (contract client polling guide). The server performs the
 * phase transitions (hiding -> hunting at 3:00, hunting -> ended at 30:00);
 * the hook just keeps the latest room + round state fresh. Polling stops on
 * lobby or ended.
 */
export function useRound(roomId: string) {
  const [state, setState] = useState<RoundStateView>({
    room: null,
    round: null,
    loading: true,
    error: null,
  })

  // Latest room status, readable from inside the polling loop without
  // recreating it on every response.
  const roomRef = useRef<RoomView | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await advanceRound(roomId)
      roomRef.current = result.room
      setState({ room: result.room, round: result.round, loading: false, error: null })
    } catch (err) {
      setState({
        room: roomRef.current,
        round: null,
        loading: false,
        error: friendlyError(err),
      })
    }
  }, [roomId])

  useEffect(() => {
    roomRef.current = null
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const loop = async () => {
      if (cancelled) return
      await refresh()
      if (cancelled) return
      const status = roomRef.current?.status
      if (status === 'hiding' || status === 'hunting' || status === 'paused') {
        timer = setTimeout(loop, 1000)
      }
    }

    if (roomId) loop()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [roomId, refresh])

  return { ...state, refresh }
}
