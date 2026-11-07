import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { kickPlayer, leaveRoom, setReady } from '@/api'
import type { PlayerView } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { useAuth } from '@/auth/AuthProvider'
import { useLobby } from '@/hooks/useLobby'

export default function Lobby() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { room, players, loading, error, reload } = useLobby(code)
  const [actionError, setActionError] = useState<string | null>(null)

  const me = players.find((p) => p.id === user?.id) ?? null
  const isHost = room?.host_id === user?.id
  const roundStarted = room !== null && room.status !== 'lobby'

  const handleCopy = async () => {
    if (!room) return
    try {
      await navigator.clipboard.writeText(room.code)
    } catch {
      // clipboard may be blocked; the code is visible anyway
    }
  }

  const handleReady = async (ready: boolean) => {
    if (!room) return
    setActionError(null)
    try {
      await setReady(room.id, ready)
      await reload()
    } catch (err) {
      setActionError(friendlyError(err))
    }
  }

  const handleKick = async (player: PlayerView) => {
    if (!room) return
    setActionError(null)
    try {
      await kickPlayer(room.id, player.id)
      await reload()
    } catch (err) {
      setActionError(friendlyError(err))
    }
  }

  const handleLeave = async () => {
    if (!room) return
    setActionError(null)
    try {
      await leaveRoom(room.id)
      navigate('/', { replace: true })
    } catch (err) {
      setActionError(friendlyError(err))
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
        <p className="text-lg font-semibold text-slate-900">{error ?? 'You are not in this room.'}</p>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white"
        >
          Go home
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col gap-6 p-6 bg-slate-50 max-w-lg mx-auto">
      {roundStarted && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          This round has started — spectating is available during the hunt.
        </div>
      )}

      <div className="bg-white rounded-2xl shadow p-6">
        <p className="text-sm font-semibold text-slate-500">Room code</p>
        <div className="mt-1 flex items-center gap-3">
          <span className="text-5xl font-black tracking-[0.2em] text-slate-900">
            {room.code}
          </span>
          <button
            onClick={handleCopy}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 active:scale-95"
          >
            Copy
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          {players.length} of 25 players ·{' '}
          {isHost ? 'You are the host' : 'Host: ' + players.find((p) => p.id === room.host_id)?.nickname}
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <ul className="divide-y divide-slate-100">
          {players.map((player) => (
            <li key={player.id} className="flex items-center gap-3 py-3">
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700">
                {player.nickname.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">
                  {player.nickname}
                  {player.id === room.host_id && (
                    <span className="ml-2 align-middle text-xs font-bold text-amber-600">HOST</span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {player.ready ? 'Ready' : 'Not ready'}
                </p>
              </div>
              {player.id === user?.id ? (
                <span className="text-xs font-semibold text-slate-400">You</span>
              ) : isHost && !roundStarted ? (
                <button
                  onClick={() => handleKick(player)}
                  className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-600 active:scale-95"
                >
                  Kick
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {actionError && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {actionError}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {me && !roundStarted && (
          <button
            onClick={() => handleReady(!me.ready)}
            disabled={!room}
            className={`w-full rounded-xl py-3 text-base font-bold shadow active:scale-95 ${
              me.ready
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-200 text-slate-800'
            }`}
          >
            {me.ready ? '✓ Ready — waiting for others' : 'Mark ready'}
          </button>
        )}
        <button
          onClick={handleLeave}
          className="w-full rounded-xl bg-white py-3 text-base font-semibold text-slate-700 shadow active:scale-95"
        >
          Leave room
        </button>
      </div>
    </div>
  )
}
