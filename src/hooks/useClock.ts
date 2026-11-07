import { useEffect, useState } from 'react'
import { friendlyError } from '@/lib/friendlyError'
import { fetchServerOffset, getServerNowMs, hasServerOffset } from '@/lib/clock'

/**
 * Fetch server_now once (after joining) and keep the offset.
 *
 * Falls back to a zero offset if the fetch fails — the countdown then runs
 * on the local clock until the offset is known.
 */
export function useServerOffset(): { offsetMs: number; ready: boolean; error: string | null } {
  const [state, setState] = useState<{ offsetMs: number; ready: boolean; error: string | null }>(
    () => ({
      offsetMs: 0,
      ready: hasServerOffset(),
      error: null,
    }),
  )

  useEffect(() => {
    if (state.ready) return
    let cancelled = false
    fetchServerOffset()
      .then((offset) => {
        if (!cancelled) setState({ offsetMs: offset, ready: true, error: null })
      })
      .catch((err) => {
        if (!cancelled) setState({ offsetMs: 0, ready: false, error: friendlyError(err) })
      })
    return () => {
      cancelled = true
    }
  }, [state.ready])

  return state
}

/** Server-aligned "now" in ms, ticking every second. */
export function useServerNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => getServerNowMs())

  useEffect(() => {
    const id = setInterval(() => setNow(getServerNowMs()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
