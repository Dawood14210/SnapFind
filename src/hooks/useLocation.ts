import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSupabase } from '@/api/client'

export type LocationPermission = 'unknown' | 'granted' | 'denied'

export interface LocationReading {
  lat: number
  lng: number
  accuracyM: number
  atMs: number
}

export interface LocationState {
  permission: LocationPermission
  reading: LocationReading | null
  /** Ready gate: permission granted + a reading with accuracy ≤ 30 m. */
  ready: boolean
  /** Ask the browser for location permission (one-shot prompt). */
  requestPermission: () => void
  /** Dev tool (?fake=1): set the position from a map tap instead of GPS. */
  setFake: (latlng: { lat: number; lng: number }) => void
  fakeMode: boolean
}

/** A Ready toggle only works after permission + a reading of 30 m or better. */
const READY_ACCURACY_M = 30

/** Readings are stored at most every 3 seconds during a round. */
const UPSERT_INTERVAL_MS = 3000

interface UseLocationOptions {
  roomId: string
  /** True during a live round: watch + upsert readings. */
  active: boolean
  userId: string | null
}

/**
 * GPS location for the app:
 * - Lobby (active=false): one permission prompt + a reading for the Ready gate.
 * - Round (active=true): watchPosition (high accuracy) and upsert readings
 *   into `locations` at most every 3 s; stops when the round ends.
 * - Dev tool (?fake=1): no GPS; setFake() places the position from map taps.
 */
export function useLocation(options: UseLocationOptions): LocationState {
  const { roomId, active, userId } = options
  const [permission, setPermission] = useState<LocationPermission>('unknown')
  const [reading, setReading] = useState<LocationReading | null>(null)
  const watchId = useRef<number | null>(null)
  const lastUpsertMs = useRef(0)

  const fakeMode = useMemo(
    () => new URLSearchParams(window.location.search).has('fake'),
    [],
  )

  const upsert = useCallback(
    async (r: LocationReading, immediate = false) => {
      if (!roomId || !userId || !active) return
      const now = Date.now()
      if (!immediate && now - lastUpsertMs.current < UPSERT_INTERVAL_MS) return
      lastUpsertMs.current = now
      const supabase = getSupabase()
      const { error } = await supabase.from('locations').insert({
        room_id: roomId,
        player_id: userId,
        lat: r.lat,
        lng: r.lng,
        accuracy_m: r.accuracyM,
        reading_at: new Date(r.atMs).toISOString(),
      })
      if (error) console.error('location upsert failed', error)
    },
    [roomId, userId, active],
  )

  const applyReading = useCallback(
    (lat: number, lng: number, accuracyM: number, atMs: number) => {
      const r = { lat, lng, accuracyM, atMs }
      setReading(r)
      setPermission('granted')
      void upsert(r)
    },
    [upsert],
  )

  // Dev fake mode: no GPS watch; setFake places the position.
  useEffect(() => {
    if (fakeMode) {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      }
      return
    }
    if (!active || !roomId) return

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => applyReading(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 0, Date.now()),
      (err) => setPermission(err.code === err.PERMISSION_DENIED ? 'denied' : 'unknown'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current)
        watchId.current = null
      }
    }
  }, [fakeMode, active, roomId, applyReading])

  const requestPermission = useCallback(() => {
    if (fakeMode || !('geolocation' in navigator)) {
      setPermission(fakeMode ? 'granted' : 'denied')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        applyReading(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 0, Date.now()),
      (err) => setPermission(err.code === err.PERMISSION_DENIED ? 'denied' : 'unknown'),
      { enableHighAccuracy: true, timeout: 20000 },
    )
  }, [fakeMode, applyReading])

  const setFake = useCallback(
    (latlng: { lat: number; lng: number }) => {
      if (!fakeMode) return
      applyReading(latlng.lat, latlng.lng, 5, Date.now())
    },
    [fakeMode, applyReading],
  )

  const ready =
    permission === 'granted' &&
    reading !== null &&
    reading.accuracyM <= READY_ACCURACY_M

  return { permission, reading, ready, requestPermission, setFake, fakeMode }
}
