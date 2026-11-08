import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { endRound, pauseRound, resumeRound } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { useAuth } from '@/auth/AuthProvider'
import { useLobby } from '@/hooks/useLobby'
import { useRound } from '@/hooks/useRound'
import { useRoundStatus } from '@/hooks/useRoundStatus'
import { useLocation } from '@/hooks/useLocation'
import { useWakeLock } from '@/hooks/useWakeLock'
import { useServerNow, useServerOffset } from '@/hooks/useClock'
import { getRoundState } from '@shared/roundState'
import { HIDE_DURATION_SEC } from '@shared/constants'
import { countdownSeconds, formatSeconds, phaseColor, phaseLabel } from '@/lib/roundDisplay'
import { outOfBoundsBanner } from '@/lib/proximity'
import GameMap from '@/components/GameMap'
import ProximityRing from '@/components/ProximityRing'

const FALLBACK_CENTRE: [number, number] = [31.5204, 74.3587]

export default function Round() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { room: lobbyRoom, players, loading: lobbyLoading } = useLobby(code)
  const roomId = lobbyRoom?.id ?? ''
  const { room, loading: roundLoading, error, refresh } = useRound(roomId)
  const { ready: clockReady } = useServerOffset()
  const serverNowMs = useServerNow()

  const me = players.find((p) => p.id === user?.id) ?? null
  const isHost = room?.host_id === user?.id
  const isFinder = room?.finder_id === user?.id

  const display = room ? getRoundState(room, serverNowMs) : null
  const phase = display?.phase ?? 'lobby'
  const active = phase === 'hiding' || phase === 'hunting' || phase === 'paused'



  // Location: watch + upsert readings during a live round; one reading for
  // the Ready gate in the lobby. Dev tool: ?fake=1 places the position from
  // map taps instead of GPS.
  const location = useLocation({ roomId, active, userId: user?.id ?? null })
  // Keep the screen on during the round.
  useWakeLock(active)
  // round_status polling (proximity, out-of-bounds, counts) every ~5 s.
  const { status, error: statusError } = useRoundStatus(roomId, active)

  const handleHostAction = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await refresh()
    } catch (err) {
      await refresh()
      console.error(friendlyError(err))
    }
  }

  const oob = outOfBoundsBanner(status?.out_of_bounds?.[user?.id ?? ''] ?? 0)
  const myBand = status?.proximity?.[user?.id ?? '']
  const showRing = me?.role === 'hider' && active
  const showMap = active && room !== null

  // Short vibration when the out-of-bounds grace runs out (penalty locked in).
  useEffect(() => {
    if (oob.show && oob.graceLeft === 0 && oob.revealIn > 0 && 'vibrate' in navigator) {
      navigator.vibrate(200)
    }
  }, [oob])

  if (lobbyLoading || roundLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading round…
      </div>
    )
  }

  if (!room || error) {
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

  // Non-null round state for the render (room is guaranteed after the guard).
  const d = getRoundState(room, serverNowMs)

  const countdown = formatSeconds(countdownSeconds(d))
  const hiders = players.filter((p) => p.role === 'hider')
  const finderNick = players.find((p) => p.role === 'finder')?.nickname

  const mapCentre: [number, number] = location.reading
    ? [location.reading.lat, location.reading.lng]
    : room.center_lat !== null && room.center_lng !== null
      ? [room.center_lat, room.center_lng]
      : FALLBACK_CENTRE
  const myDot = location.reading
    ? [
        {
          id: 'me',
          latlng: [location.reading.lat, location.reading.lng] as [number, number],
          accuracyM: location.reading.accuracyM,
        },
      ]
    : []

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 bg-slate-50 max-w-lg mx-auto">
      {phase === 'paused' && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Round paused by the host — the clock is stopped on every phone.
        </div>
      )}

      {oob.show && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-semibold ${
            oob.graceLeft > 0
              ? 'bg-amber-50 text-amber-800'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {oob.graceLeft > 0
            ? `You are outside the play area — get back inside in ${oob.graceLeft}s!`
            : `Out of bounds — penalty reveal in ${oob.revealIn}s`}
        </div>
      )}

      {active && (
        <p className="text-center text-xs font-medium text-slate-400">Keep screen on</p>
      )}
      {statusError && (
        <p className="text-center text-xs font-medium text-red-500">{statusError}</p>
      )}

      {me?.role && active && (
        <div
          className={`rounded-2xl px-4 py-3 text-center shadow ${
            me.role === 'finder' ? 'bg-amber-100 text-amber-900' : 'bg-blue-100 text-blue-900'
          }`}
        >
          <p className="text-lg font-bold">
            {me.role === 'finder' ? 'You are the FINDER' : 'You are a HIDDER'}
          </p>
          <p className="text-sm">
            {hiders.length} hiders · Finder: {finderNick}
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow p-8 text-center">
        <p className={`text-sm font-bold uppercase tracking-widest ${phaseColor(phase)}`}>
          {phaseLabel(phase)}
        </p>
        <p className={`mt-2 text-7xl font-black tabular-nums ${phaseColor(phase)}`}>{countdown}</p>
        <p className="mt-2 text-sm text-slate-500">
          {phase === 'hiding' && 'Hide time left'}
          {phase === 'hunting' && 'Hunt time left'}
          {phase === 'paused' && 'Paused'}
          {phase === 'ended' && 'The round is over'}
          {phase === 'lobby' && 'Waiting to start'}
        </p>
      </div>

      {showRing && <ProximityRing band={myBand} />}

      {showMap && (
        <div className="relative">
          <GameMap
            centre={mapCentre}
            radiusM={room.radius_m}
            dots={myDot}
            onTap={location.fakeMode ? (l) => location.setFake(l) : undefined}
          />
          {location.fakeMode && (
            <p className="absolute left-3 top-3 rounded-md bg-slate-900/80 px-2 py-1 text-xs font-bold text-white">
              FAKE POSITION
            </p>
          )}
          {location.permission === 'denied' && !location.reading && (
            <p className="absolute left-3 bottom-3 rounded-md bg-amber-900/80 px-2 py-1 text-xs font-semibold text-white">
              Location off — enable GPS for the round
            </p>
          )}
        </div>
      )}

      {active && isHost && (
        <div className="flex flex-col gap-3">
          {phase !== 'paused' && (
            <button
              onClick={() => handleHostAction(() => pauseRound(room.id))}
              className="w-full rounded-xl bg-amber-600 py-3 text-base font-bold text-white shadow active:scale-95"
            >
              Pause round
            </button>
          )}
          {phase === 'paused' && (
            <button
              onClick={() => handleHostAction(() => resumeRound(room.id))}
              className="w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white shadow active:scale-95"
            >
              Resume round
            </button>
          )}
          <button
            onClick={() => handleHostAction(() => endRound(room.id))}
            className="w-full rounded-xl bg-white py-3 text-base font-semibold text-red-600 shadow active:scale-95"
          >
            End round
          </button>
        </div>
      )}

      {phase === 'ended' && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate(`/room/${room.code}`, { replace: true })}
            className="w-full rounded-xl bg-slate-900 py-3 text-base font-bold text-white shadow active:scale-95"
          >
            Back to lobby
          </button>
        </div>
      )}

      {phase === 'lobby' && (
        <button
          onClick={() => navigate(`/room/${room.code}`, { replace: true })}
          className="w-full rounded-xl bg-white py-3 text-base font-semibold text-slate-700 shadow active:scale-95"
        >
          Back to lobby
        </button>
      )}

      {!clockReady && (
        <p className="text-center text-xs text-slate-400">Syncing server clock…</p>
      )}

      {isFinder && d && d.phase === 'hiding' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-emerald-400">HIDE</p>
          <p className="text-8xl font-black tabular-nums text-white">
            {formatSeconds(d.seconds_left_in_phase)}
          </p>
          <p className="max-w-xs text-lg font-semibold text-slate-200">
            You are the finder. The hide phase is locked — stay exactly where you are.
          </p>
          <p className="max-w-xs text-sm text-slate-400">
            Hunting starts when the countdown ends.
          </p>
        </div>
      )}

      {isFinder && d && d.phase === 'paused' && d.round_seconds < HIDE_DURATION_SEC && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-400">PAUSED</p>
          <p className="text-8xl font-black tabular-nums text-white">
            {formatSeconds(d.seconds_left_in_phase)}
          </p>
          <p className="max-w-xs text-lg font-semibold text-slate-200">
            The round is paused — stay where you are until the host resumes.
          </p>
        </div>
      )}
    </div>
  )
}
