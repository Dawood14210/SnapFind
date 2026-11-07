import { useNavigate, useParams } from 'react-router-dom'
import { endRound, pauseRound, resumeRound } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { useAuth } from '@/auth/AuthProvider'
import { useLobby } from '@/hooks/useLobby'
import { useRound } from '@/hooks/useRound'
import { useServerNow, useServerOffset } from '@/hooks/useClock'
import { getRoundState } from '@shared/roundState'
import { HIDE_DURATION_SEC } from '@shared/constants'
import { countdownSeconds, formatSeconds, phaseColor, phaseLabel } from '@/lib/roundDisplay'

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

  const handleHostAction = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await refresh()
    } catch (err) {
      await refresh()
      console.error(friendlyError(err))
    }
  }

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

  const display = getRoundState(room, serverNowMs)
  const phase = display.phase
  const active = phase === 'hiding' || phase === 'hunting' || phase === 'paused'
  const countdown = formatSeconds(countdownSeconds(display))
  const hiders = players.filter((p) => p.role === 'hider')
  const finderNick = players.find((p) => p.role === 'finder')?.nickname

  return (
    <div className="min-h-screen flex flex-col gap-4 p-6 bg-slate-50 max-w-lg mx-auto">
      {phase === 'paused' && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Round paused by the host — the clock is stopped on every phone.
        </div>
      )}

      {me?.role && active && (
        <div
          className={`rounded-2xl px-4 py-3 text-center shadow ${
            me.role === 'finder'
              ? 'bg-amber-100 text-amber-900'
              : 'bg-blue-100 text-blue-900'
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

      {isFinder && display.phase === 'hiding' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-emerald-400">HIDE</p>
          <p className="text-8xl font-black tabular-nums text-white">
            {formatSeconds(display.seconds_left_in_phase)}
          </p>
          <p className="max-w-xs text-lg font-semibold text-slate-200">
            You are the finder. The hide phase is locked — stay exactly where you are.
          </p>
          <p className="max-w-xs text-sm text-slate-400">
            Hunting starts when the countdown ends.
          </p>
        </div>
      )}

      {isFinder && display.phase === 'paused' && display.round_seconds < HIDE_DURATION_SEC && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-400">PAUSED</p>
          <p className="text-8xl font-black tabular-nums text-white">
            {formatSeconds(display.seconds_left_in_phase)}
          </p>
          <p className="max-w-xs text-lg font-semibold text-slate-200">
            The round is paused — stay where you are until the host resumes.
          </p>
        </div>
      )}
    </div>
  )
}
