import { useEffect } from 'react'

/**
 * Screen Wake Lock: keeps the phone's screen on during a round.
 *
 * The lock is released automatically when the tab is hidden, so it is
 * re-requested whenever the page becomes visible again.
 */

let wakeLock: WakeLockSentinel | null = null

async function requestWakeLock(): Promise<boolean> {
  try {
    if (!('wakeLock' in navigator)) return false
    wakeLock = await navigator.wakeLock.request('screen')
    return true
  } catch {
    return false
  }
}

function releaseWakeLock(): void {
  try {
    wakeLock?.release()
  } catch {
    // the lock may already be released
  }
  wakeLock = null
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) {
      releaseWakeLock()
      return
    }

    let cancelled = false
    const enable = async () => {
      if (!cancelled) await requestWakeLock()
    }
    void enable()

    const onVisible = () => {
      if (!document.hidden) void enable()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      releaseWakeLock()
    }
  }, [active])
}
