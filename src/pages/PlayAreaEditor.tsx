import { useEffect, useRef, useState } from 'react'
import { MapContainer, Circle, CircleMarker, useMap } from 'react-leaflet'
import type { LatLng, LeafletMouseEvent, Map as LeafletMap } from 'leaflet'
import { useNavigate, useParams } from 'react-router-dom'
import { setPlayArea } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { useAuth } from '@/auth/AuthProvider'
import { useLobby } from '@/hooks/useLobby'
import {
  PLAY_AREA_RADIUS_MAX_M,
  PLAY_AREA_RADIUS_MIN_M,
} from '@shared/constants'

// Default map centre (Lahore) — matches the contract's example coordinates;
// replaced by the room's play area or the device location when available.
const DEFAULT_CENTRE = { lat: 31.5204, lng: 74.3587 }
const DEFAULT_RADIUS_M = 250

interface Centre {
  lat: number
  lng: number
}

/** Expose the Leaflet map instance and forward map clicks to the parent. */
function MapController({
  onReady,
  onClick,
}: {
  onReady: (map: LeafletMap) => void
  onClick: (latlng: LatLng) => void
}) {
  const map = useMap()
  const clickRef = useRef(onClick)
  clickRef.current = onClick

  useEffect(() => {
    onReady(map)
  }, [map, onReady])

  useEffect(() => {
    const handler = (e: LeafletMouseEvent) => clickRef.current(e.latlng)
    map.on('click', handler)
    return () => {
      map.off('click', handler)
    }
  }, [map])

  return null
}

export default function PlayAreaEditor() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { room, loading, error } = useLobby(code)
  const mapRef = useRef<LeafletMap | null>(null)

  const [centre, setCentre] = useState<Centre>(DEFAULT_CENTRE)
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Seed the editor from the room's play area; otherwise try the device
  // location once so the host starts near where they are.
  useEffect(() => {
    if (!room) return
    if (room.center_lat !== null && room.center_lng !== null && room.radius_m !== null) {
      setCentre({ lat: room.center_lat, lng: room.center_lng })
      setRadius(room.radius_m)
    } else if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCentre({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        },
        () => {
          // denied or unavailable — keep the default centre
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
      )
    }
  }, [room])

  const handleMapClick = (latlng: LatLng) => {
    setCentre({ lat: latlng.lat, lng: latlng.lng })
  }

  const handleUseLocation = () => {
    if (!('geolocation' in navigator)) {
      setActionError('This device has no GPS.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setCentre(next)
        mapRef.current?.setView([next.lat, next.lng], 16)
        setActionError(null)
      },
      (err) => {
        setActionError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — tap the map instead.'
            : 'Could not get your location — tap the map instead.',
        )
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    )
  }

  const handleSave = async () => {
    if (!room) return
    setSaving(true)
    setActionError(null)
    try {
      await setPlayArea(room.id, centre.lat, centre.lng, radius)
      navigate(`/room/${room.code}`, { replace: true })
    } catch (err) {
      setActionError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading room…
      </div>
    )
  }

  if (!room) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-semibold text-slate-900">
          {error ?? 'You are not in this room.'}
        </p>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white"
        >
          Go home
        </button>
      </div>
    )
  }

  if (room.host_id !== user?.id) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-semibold text-slate-900">Only the host can set the play area.</p>
        <button
          onClick={() => navigate(`/room/${room.code}`, { replace: true })}
          className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white"
        >
          Back to lobby
        </button>
      </div>
    )
  }

  if (room.status !== 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-semibold text-slate-900">The round already started.</p>
        <button
          onClick={() => navigate(`/room/${room.code}/round`, { replace: true })}
          className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white"
        >
          Go to the round
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 bg-slate-50 max-w-lg mx-auto">
      <div className="bg-white rounded-2xl shadow p-4">
        <p className="font-semibold text-slate-900">Play area</p>
        <p className="text-sm text-slate-500">
          Tap the map to move the centre, adjust the radius, then save.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <MapContainer center={[centre.lat, centre.lng]} zoom={15} style={{ height: '55vh' }}>
          <Circle
            center={[centre.lat, centre.lng]}
            radius={radius}
            pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.12 }}
          />
          <CircleMarker
            center={[centre.lat, centre.lng]}
            radius={8}
            pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 1 }}
          />
          <MapController
            onReady={(map) => {
              mapRef.current = map
            }}
            onClick={handleMapClick}
          />
        </MapContainer>
      </div>

      <button
        onClick={handleUseLocation}
        className="rounded-xl bg-white px-4 py-3 text-base font-semibold text-slate-700 shadow active:scale-95"
      >
        Use my location
      </button>

      <div className="bg-white rounded-2xl shadow p-4">
        <label className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span>Radius</span>
          <span>{radius} m</span>
        </label>
        <input
          type="range"
          min={PLAY_AREA_RADIUS_MIN_M}
          max={PLAY_AREA_RADIUS_MAX_M}
          step={10}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="mt-3 w-full accent-blue-600"
        />
        <p className="mt-1 text-xs text-slate-500">
          {PLAY_AREA_RADIUS_MIN_M}–{PLAY_AREA_RADIUS_MAX_M} m
        </p>
      </div>

      {actionError && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {actionError}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-xl bg-slate-900 py-3 text-base font-bold text-white shadow active:scale-95 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save play area'}
        </button>
        <button
          onClick={() => navigate(`/room/${room.code}`, { replace: true })}
          className="w-full rounded-xl bg-white py-3 text-base font-semibold text-slate-700 shadow active:scale-95"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
