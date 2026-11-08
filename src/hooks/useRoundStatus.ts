import { useCallback, useEffect, useState } from 'react'
import { roundStatus } from '@/api'
import type { RoundStatusResult } from '@/api'
import { friendlyError } from '@/lib/friendlyError'

/**
 * Polls the round_status Edge Function every ~5 s while the round is active
 * (contract client polling guide). Stops on lobby/ended.
 */
export function useRoundStatus(roomId: string, active: boolean) {
  const [state, setState] = useState<RoundStatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await roundStatus(roomId)
      setState(result)
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [roomId])

  useEffect(() => {
    if (!roomId || !active) {
      setState(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const loop = async () => {
      if (cancelled) return
      await refresh()
      if (cancelled || !active) return
      timer = setTimeout(loop, 5000)
    }

    loop()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [roomId, active, refresh])

  return { status: state, error, refresh }
}
