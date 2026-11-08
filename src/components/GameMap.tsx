import { Fragment, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Circle, CircleMarker, useMap } from 'react-leaflet'
import type { LatLng, LeafletMouseEvent, Map as LeafletMap } from 'leaflet'

export interface MapDot {
  id: string
  latlng: [number, number]
  /** Accuracy ring radius in metres (own position only). */
  accuracyM?: number | null
}

interface GameMapProps {
  centre: [number, number]
  /** Play-area circle radius in metres. */
  radiusM?: number | null
  dots?: MapDot[]
  /** Tap handler (the play-area editor uses it to set the centre). */
  onTap?: (latlng: LatLng) => void
  height?: string
  /** Expose the Leaflet map instance (e.g. for setView). */
  onMapReady?: (map: LeafletMap) => void
}

/** Map tap forwarding via useMap (react-leaflet v4 binds map events in children). */
function MapTap({ onTap }: { onTap: (latlng: LatLng) => void }) {
  const map = useMap()
  const ref = useRef(onTap)
  ref.current = onTap
  useEffect(() => {
    const handler = (e: LeafletMouseEvent) => ref.current(e.latlng)
    map.on('click', handler)
    return () => {
      map.off('click', handler)
    }
  }, [map])
  return null
}

/** Map ready forwarding. */
function MapReady({ onReady }: { onReady: (map: LeafletMap) => void }) {
  const map = useMap()
  useEffect(() => {
    onReady(map)
  }, [map, onReady])
  return null
}

/**
 * Shared Leaflet map: OSM tiles (with a fallback banner when tiles fail),
 * optional play-area circle, dots with accuracy rings and tap handling.
 */
export default function GameMap({
  centre,
  radiusM,
  dots = [],
  onTap,
  height = '55vh',
  onMapReady,
}: GameMapProps) {
  const [tilesError, setTilesError] = useState(false)

  return (
    <div className="relative bg-white rounded-2xl shadow overflow-hidden">
      <MapContainer center={centre} zoom={15} style={{ height }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
          eventHandlers={{
            tileerror: () => setTilesError(true),
            tileload: () => setTilesError((prev) => (prev ? false : prev)),
          }}
        />
        {radiusM ? (
          <Circle
            center={centre}
            radius={radiusM}
            pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.12 }}
          />
        ) : null}
        {dots.map((dot) => (
          <Fragment key={dot.id}>
            {dot.accuracyM ? (
              <Circle
                center={dot.latlng}
                radius={dot.accuracyM}
                pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.1 }}
              />
            ) : null}
            <CircleMarker
              center={dot.latlng}
              radius={8}
              pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }}
            />
          </Fragment>
        ))}
        {onMapReady && <MapReady onReady={onMapReady} />}
        {onTap && <MapTap onTap={onTap} />}
      </MapContainer>
      {tilesError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/85 p-6 text-center text-sm font-semibold text-slate-700">
          Map tiles failed to load — check your connection and tap the map to try again.
        </div>
      )}
    </div>
  )
}
