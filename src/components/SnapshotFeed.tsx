import { useCallback, useEffect, useState } from 'react'
import { snapshotUrls } from '@/api'
import type { PlayerView, SnapshotWithUrl } from '@/api'
import { friendlyError } from '@/lib/friendlyError'

interface SnapshotFeedProps {
  roomId: string
  players: PlayerView[]
  onClose: () => void
}

interface FeedItem extends SnapshotWithUrl {
  nickname: string
}

/**
 * Finder snapshot feed (Phase 4): polls snapshot_urls, newest first, with
 * nickname, time, Late and Bonus badges, a nickname filter and a full-screen
 * image view. The finder sees every hider's snapshots (server-side
 * visibility: finder reads all).
 */
export default function SnapshotFeed({ roomId, players, onClose }: SnapshotFeedProps) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [zoom, setZoom] = useState<FeedItem | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await snapshotUrls(roomId, null)
      const nicknameById = new Map(players.map((p) => [p.id, p.nickname]))
      setItems(
        (result.snapshots ?? []).map((s) => ({
          ...s,
          nickname: nicknameById.get(s.player_id) ?? 'Unknown',
        })),
      )
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [roomId, players])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 4000)
    return () => clearInterval(id)
  }, [refresh])

  const visible = items.filter((item) =>
    item.nickname.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <h2 className="text-lg font-black text-slate-900">Snapshots</h2>
        <button
          onClick={onClose}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white active:scale-95"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by nickname…"
          className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-emerald-500"
        />

        {error && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        {visible.length === 0 && (
          <p className="py-12 text-center text-slate-400">
            No snapshots yet — hiders submit when a window opens.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          {visible.map((item) => (
            <button
              key={item.id}
              onClick={() => setZoom(item)}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow active:scale-95"
            >
              <img
                src={item.image_url}
                alt={`${item.nickname} snapshot`}
                className="aspect-video w-full bg-slate-200 object-cover"
              />
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-sm font-bold text-slate-800">
                  {item.nickname}
                </span>
                <span className="flex flex-none flex-wrap justify-end gap-1">
                  {item.late && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                      Late
                    </span>
                  )}
                  {item.window_index === 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                      Bonus
                    </span>
                  )}
                </span>
              </div>
              <p className="px-3 pb-2 text-xs text-slate-500">
                Window {item.window_index} · {formatTime(item.taken_at)}
              </p>
            </button>
          ))}
        </div>
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-slate-950/95"
          onClick={() => setZoom(null)}
        >
          <button
            onClick={() => setZoom(null)}
            className="m-4 w-fit rounded-lg bg-white/10 px-3 py-1 text-sm font-semibold text-white"
          >
            Close
          </button>
          <img
            src={zoom.image_url}
            alt={`${zoom.nickname} snapshot`}
            className="m-4 max-h-[70vh] w-auto rounded-2xl object-contain"
          />
          <p className="px-4 pb-8 text-center text-white/80">
            {zoom.nickname} · Window {zoom.window_index} · {formatTime(zoom.taken_at)}
            {zoom.late ? ' · Late' : ''}
          </p>
        </div>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
