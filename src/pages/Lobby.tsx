import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { devAddDummyPlayers, kickPlayer, leaveRoom, setReady, setRoomSettings, startRound } from '@/api'
import type { PlayerView } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { useAuth } from '@/auth/AuthProvider'
import { useLobby } from '@/hooks/useLobby'
import { useLocation } from '@/hooks/useLocation'
import { MIN_PLAYERS } from '@shared/constants'

export default function Lobby() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { room, players, loading, error, reload } = useLobby(code)
  const [actionError, setActionError] = useState<string | null>(null)
  const [finderChoice, setFinderChoice] = useState('')
  const [starting, setStarting] = useState(false)
  const [settings, setSettings] = useState({
    hide: room?.hide_duration_min ?? 3,
    round: room?.duration_min ?? 30,
    players: room?.max_players ?? 25,
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const [dummyCount, setDummyCount] = useState(3)
  const [dummyMessage, setDummyMessage] = useState<string | null>(null)

  // Location for the Ready gate: a Ready toggle only works after permission
  // and a reading with accuracy of 30 m or better.
  const location = useLocation({ roomId: room?.id ?? '', active: false, userId: user?.id ?? null })
  const promptedForLocation = useRef(false)

  useEffect(() => {
    if (room && !promptedForLocation.current) {
      promptedForLocation.current = true
      location.requestPermission()
    }
  }, [room, location.requestPermission])

  const me = players.find((p) => p.id === user?.id) ?? null
  const isHost = room?.host_id === user?.id
  const roundStarted = room !== null && room.status !== 'lobby'
  const roundActive = room?.status === 'hiding' || room?.status === 'hunting' || room?.status === 'paused'
  const roundEnded = room?.status === 'ended'

  // Re-sync the settings inputs when the room's values change (e.g. after
  // saving or after a Realtime update from another device).
  useEffect(() => {
    if (!room) return
    setSettings({
      hide: room.hide_duration_min,
      round: room.duration_min,
      players: room.max_players,
    })
  }, [room?.hide_duration_min, room?.duration_min, room?.max_players])

  const handleSaveSettings = async () => {
    if (!room) return
    setSavingSettings(true)
    setActionError(null)
    try {
      await setRoomSettings(room.id, settings.hide, settings.round, settings.players)
      await reload()
    } catch (err) {
      setActionError(friendlyError(err))
    } finally {
      setSavingSettings(false)
    }
  }

  const handleAddDummyPlayers = async () => {
    if (!room) return
    setDummyMessage(null)
    try {
      const result = await devAddDummyPlayers(room.id, dummyCount)
      await reload()
      setDummyMessage(`Added ${result.added} dummy player${result.added === 1 ? '' : 's'}.`)
    } catch (err) {
      setDummyMessage(friendlyError(err))
    }
  }

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

  const handleStartRound = async () => {
    if (!room) return
    setStarting(true)
    setActionError(null)
    try {
      await startRound(room.id, finderChoice === '' ? null : finderChoice)
      navigate(`/room/${room.code}/round`, { replace: true })
    } catch (err) {
      setActionError(friendlyError(err))
    } finally {
      setStarting(false)
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
      {roundActive && (
        <div className="flex flex-col items-stretch gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          <span>This round has started — spectating is available during the hunt.</span>
          <button
            onClick={() => navigate(`/room/${room.code}/round`)}
            className="rounded-lg bg-amber-600 px-4 py-2 font-bold text-white active:scale-95"
          >
            Go to the round
          </button>
        </div>
      )}

      {roundEnded && (
        <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          The round has ended — leave below to start a new one.
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
          {players.length} of {room.max_players} players ·{' '}
          {isHost ? 'You are the host' : 'Host: ' + players.find((p) => p.id === room.host_id)?.nickname}
        </p>
      </div>

      {isHost && !roundStarted && (
        <div className="bg-white rounded-2xl shadow p-4">
          <p className="font-semibold text-slate-900">Round settings</p>
          <p className="mt-1 text-sm text-slate-500">
            Hide time, round time (minutes) and the player limit.
          </p>

          <div className="mt-3 flex flex-col gap-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-700">Hide time</span>
              <input
                type="number"
                min={1}
                max={15}
                value={settings.hide}
                onChange={(e) => setSettings((s) => ({ ...s, hide: Number(e.target.value) }))}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-right font-semibold"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-700">Round time</span>
              <input
                type="number"
                min={5}
                max={60}
                value={settings.round}
                onChange={(e) => setSettings((s) => ({ ...s, round: Number(e.target.value) }))}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-right font-semibold"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-700">Player limit</span>
              <input
                type="number"
                min={4}
                max={25}
                value={settings.players}
                onChange={(e) => setSettings((s) => ({ ...s, players: Number(e.target.value) }))}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-right font-semibold"
              />
            </label>
          </div>

          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="mt-3 w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white shadow active:scale-95 disabled:opacity-50"
          >
            {savingSettings ? 'Saving…' : 'Save settings'}
          </button>
          {!(
            settings.hide >= 1 &&
            settings.hide <= 15 &&
            settings.round >= 5 &&
            settings.round <= 60 &&
            settings.round > settings.hide &&
            settings.players >= 4 &&
            settings.players <= 25
          ) && (
            <p className="mt-2 text-sm text-amber-700">
              Hide 1–15 min, round 5–60 min (longer than the hide time), 4–25 players.
            </p>
          )}
        </div>
      )}

      {isHost && !roundStarted && (
        <div className="bg-white rounded-2xl shadow p-4">
          <p className="font-semibold text-slate-900">Dummy players</p>
          <p className="mt-1 text-sm text-slate-500">
            Add test players (ready) to try a round without enough phones.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={10}
              value={dummyCount}
              onChange={(e) => setDummyCount(Number(e.target.value))}
              className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-center font-semibold"
            />
            <button
              onClick={handleAddDummyPlayers}
              className="flex-1 rounded-xl bg-slate-800 py-3 text-base font-bold text-white shadow active:scale-95"
            >
              Add dummy players
            </button>
          </div>
          {dummyMessage && (
            <p className="mt-2 text-sm font-medium text-slate-600">{dummyMessage}</p>
          )}
        </div>
      )}

      {isHost && !roundStarted && (
        <div className="bg-white rounded-2xl shadow p-4">
          <p className="font-semibold text-slate-900">Start the round</p>

          {room.center_lat !== null && room.center_lng !== null && room.radius_m !== null ? (
            <p className="mt-1 text-sm text-slate-600">
              Play area: {room.radius_m} m circle around the centre.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-amber-700">No play area yet — set one before starting.</p>
              <button
                onClick={() => navigate(`/room/${room.code}/area`)}
                className="w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white shadow active:scale-95"
              >
                Set play area
              </button>
            </div>
          )}

          {room.center_lat !== null && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => navigate(`/room/${room.code}/area`)}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 active:scale-95"
              >
                Edit play area
              </button>
            </div>
          )}

          <label className="mt-4 block text-sm font-semibold text-slate-700">Finder</label>
          <select
            value={finderChoice}
            onChange={(e) => setFinderChoice(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base font-semibold text-slate-900"
          >
            <option value="">Random</option>
            {players
              .filter((p) => p.ready)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname}
                </option>
              ))}
          </select>

          <button
            onClick={handleStartRound}
            disabled={
              starting ||
              room.center_lat === null ||
              players.length < MIN_PLAYERS ||
              players.some((p) => !p.ready)
            }
            className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-base font-bold text-white shadow active:scale-95 disabled:opacity-40"
          >
            {starting ? 'Starting…' : 'Start round'}
          </button>
          {players.length < MIN_PLAYERS && (
            <p className="mt-2 text-sm text-amber-700">
              Need at least {MIN_PLAYERS} players ({players.length} here).
            </p>
          )}
          {players.length >= MIN_PLAYERS && players.some((p) => !p.ready) && (
            <p className="mt-2 text-sm text-amber-700">Waiting for all players to be ready.</p>
          )}
        </div>
      )}

      {!isHost && !roundStarted && room.center_lat === null && (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-600">
          Waiting for the host to set the play area.
        </p>
      )}

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
          location.ready ? (
            <button
              onClick={() => handleReady(!me.ready)}
              disabled={!room}
              className={`w-full rounded-xl py-3 text-base font-bold shadow active:scale-95 ${
                me.ready ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-800'
              }`}
            >
              {me.ready ? '✓ Ready — waiting for others' : 'Mark ready'}
            </button>
          ) : (
            <button
              onClick={location.requestPermission}
              className="w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white shadow active:scale-95"
            >
              Enable location to mark ready
            </button>
          )
        )}
        {me && !roundStarted && !location.ready && (
          <p className="text-center text-sm text-slate-500">
            {location.permission === 'denied'
              ? 'Location permission denied — enable it in your browser settings.'
              : location.reading
                ? 'Waiting for a better GPS reading (30 m or better)…'
                : 'Location permission is needed to mark ready.'}
          </p>
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
