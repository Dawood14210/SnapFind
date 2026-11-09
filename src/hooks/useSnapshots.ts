import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveWindow, snapshotUrls } from '@/api'
import type { SnapshotWithUrl } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { playWindowBeep } from '@/lib/sound'
import {
  SNAPSHOT_LATE_TOLERANCE_SEC,
  SNAPSHOT_ON_TIME_TOLERANCE_SEC,
  SNAPSHOT_WINDOW_COUNT,
  SNAPSHOT_WINDOW_SEC,
} from '@shared/constants'

export interface SnapshotPrompt {
  open: boolean
  secondsLeft: number
}

export interface UseSnapshotsInput {
  roomId: string
  /** Round time in seconds (server clock, from getRoundState). */
  roundSeconds: number
  role: 'finder' | 'hider' | null
  /** True while the round is hunting (windows only exist then). */
  hunting: boolean
}

export interface UseSnapshotsResult {
  /** Current window index (0..SNAPSHOT_WINDOW_COUNT). */
  windowIndex: number
  /** Full-screen prompt with the 45 s countdown after a window opens. */
  prompt: SnapshotPrompt
  /** The hider's own submitted snapshots (with signed URLs). */
  sentSnapshots: SnapshotWithUrl[]
  /** "in 4:15" label for the next snapshot window, or null. */
  nextSnapshotLabel: string | null
  /** Dev tool (?dev=1): force the window prompt open now. */
  devOpenWindow: () => void
  /** Close the prompt (e.g. after submitting or dismissing). */
  dismissPrompt: () => void
  /** Re-fetch the hider's sent snapshots. */
  refresh: () => void
  error: string | null
}

/**
 * Snapshot state for the round screen (Phase 4).
 *
 * - windowIndex follows the round clock: floor(roundSeconds / 300).
 * - When a window opens (n >= 1), the full-screen prompt opens with a 45 s
 *   countdown, a sound and a vibration.
 * - 2 minutes after each window closes, resolve_window is called (idempotent
 *   server-side; each window is resolved once per round).
 * - The hider's own sent snapshots are polled via snapshot_urls.
 */
export function useSnapshots(input: UseSnapshotsInput): UseSnapshotsResult {
  const { roomId, roundSeconds, role, hunting } = input

  const windowIndex = Math.min(
    SNAPSHOT_WINDOW_COUNT,
    Math.max(0, Math.floor(roundSeconds / SNAPSHOT_WINDOW_SEC)),
  )

  const [prompt, setPrompt] = useState<SnapshotPrompt>({ open: false, secondsLeft: 0 })
  const [sentSnapshots, setSentSnapshots] = useState<SnapshotWithUrl[]>([])
  const [error, setError] = useState<string | null>(null)

  // Last window that triggered the prompt, and windows already resolved.
  const promptedRef = useRef<number>(-1)
  const resolvedRef = useRef<Set<number>>(new Set())

  const openPrompt = useCallback(() => {
    setPrompt({ open: true, secondsLeft: SNAPSHOT_ON_TIME_TOLERANCE_SEC })
    playWindowBeep()
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200])
  }, [])

  const dismissPrompt = useCallback(() => {
    setPrompt({ open: false, secondsLeft: 0 })
  }, [])

  const devOpenWindow = useCallback(() => {
    openPrompt()
  }, [openPrompt])

  // Countdown while the prompt is open.
  useEffect(() => {
    if (!prompt.open) return
    const id = setInterval(() => {
      setPrompt((prev) => {
        if (prev.secondsLeft <= 1) {
          clearInterval(id)
          return { open: false, secondsLeft: 0 }
        }
        return { open: true, secondsLeft: prev.secondsLeft - 1 }
      })
    }, 1000)
    return () => clearInterval(id)
  }, [prompt.open])

  // Reset the per-round state when the window goes backwards (rematch).
  useEffect(() => {
    if (windowIndex < promptedRef.current) {
      promptedRef.current = -1
      resolvedRef.current = new Set()
    }
  }, [windowIndex])

  // Trigger the prompt when a new window opens (n >= 1).
  useEffect(() => {
    if (!hunting || windowIndex < 1) return
    if (windowIndex !== promptedRef.current) {
      promptedRef.current = windowIndex
      openPrompt()
    }
  }, [hunting, windowIndex, openPrompt])

  // resolve_window 2 minutes after each window closes (once per window per
  // round; the server call is idempotent). Loops over every window so a
  // clock jump still resolves the windows it skipped.
  useEffect(() => {
    if (!hunting || !roomId) return
    for (let w = 1; w <= SNAPSHOT_WINDOW_COUNT; w++) {
      if (resolvedRef.current.has(w)) continue
      const closeSec = (w + 1) * SNAPSHOT_WINDOW_SEC + SNAPSHOT_LATE_TOLERANCE_SEC
      if (roundSeconds < closeSec) continue
      resolvedRef.current.add(w)
      resolveWindow(roomId, w)
        .then(() => setError(null))
        .catch((err) => {
          // Best-effort: the window stays unresolved and can be retried by
          // the next poll cycle of the round screen.
          resolvedRef.current.delete(w)
          setError(friendlyError(err))
        })
    }
  }, [hunting, roundSeconds, roomId])

  // The hider's sent snapshots (own rows via snapshot_urls).
  const refresh = useCallback(async () => {
    if (!roomId || role !== 'hider') return
    try {
      const result = await snapshotUrls(roomId, null)
      setSentSnapshots(result.snapshots ?? [])
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [roomId, role])

  useEffect(() => {
    if (!hunting || role !== 'hider' || !roomId) return
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [hunting, role, roomId, refresh])

  // "Next snapshot" label: the window after the current one.
  const nextSnapshotLabel = useMemo(
    () => formatNextSnapshot(roundSeconds, windowIndex),
    [roundSeconds, windowIndex],
  )

  return {
    windowIndex,
    prompt,
    sentSnapshots,
    nextSnapshotLabel,
    devOpenWindow,
    dismissPrompt,
    refresh,
    error,
  }
}

/** "in 4:15" until the next window opens, or null when there is none. */
function formatNextSnapshot(roundSeconds: number, windowIndex: number): string | null {
  if (windowIndex >= SNAPSHOT_WINDOW_COUNT) return null
  const nextOpen = (windowIndex + 1) * SNAPSHOT_WINDOW_SEC
  const seconds = Math.max(0, Math.round(nextOpen - roundSeconds))
  return `in ${formatClock(seconds)}`
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
