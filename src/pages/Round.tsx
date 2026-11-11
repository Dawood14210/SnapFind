import TagsPanel from '@/components/TagsPanel'
import RoundResults from '@/components/RoundResults'
import { useEffect, useState } from 'react'
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
import CameraCapture from '@/components/CameraCapture'
import GameMap from '@/components/GameMap'
import ProximityRing from '@/components/ProximityRing'
import SnapshotFeed from '@/components/SnapshotFeed'
import SnapshotPrompt from '@/components/SnapshotPrompt'
import TaskCard from '@/components/TaskCard'
import AbilitiesPanel, { ABILITY_LABELS } from '@/components/AbilitiesPanel'
import { useAbilities } from '@/hooks/useAbilities'
import { useAbilityAlerts } from '@/hooks/useAbilityAlerts'
import { useReveals } from '@/hooks/useReveals'
import { useSnapshots } from '@/hooks/useSnapshots'
import { useTasks } from '@/hooks/useTasks'
import type { AbilityKind, TaskView } from '@/api'

const FALLBACK_CENTRE: [number, number] = [31.5204, 74.3587]

/** A numeric task param (params is Record<string, unknown> from the server). */
function numParam(params: Record<string, unknown>, key: string): number | null {
  const value = params[key]
  return typeof value === 'number' ? value : null
}

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

  // Phase 4: snapshot windows — the hider gets the capture prompt, the
  // finder gets the snapshot feed and live reveals on the map.
  const snapshots = useSnapshots({
    roomId,
    roundSeconds: display?.round_seconds ?? 0,
    role: me?.status === 'tagged' ? null : me?.role ?? null,
    hunting: phase === 'hunting',
  })
  const [captureOpen, setCaptureOpen] = useState(false)
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null)
  const [feedOpen, setFeedOpen] = useState(false)
  const [devTools] = useState(() => new URLSearchParams(window.location.search).has('dev'))
  const { reveals } = useReveals({
    roomId,
    hunting: isFinder && phase === 'hunting',
    isFinder,
    userId: user?.id ?? null,
  })

  // Phase 5: hider tasks — polled every ~5 s during the hunt (the server
  // assigns, completes and scores them).
  const tasks = useTasks({
    roomId,
    enabled: me?.role === 'hider' && me.status === 'active' && phase === 'hunting',
  })
  const currentTask = tasks.currentTask
  const [photoCaptureTask, setPhotoCaptureTask] = useState<TaskView | null>(null)
  const [taskToast, setTaskToast] = useState<string | null>(null)

  // Phase 6: finder abilities — charge meter via getCharges, cooldown and
  // history; hiders get a toast + vibration when the finder uses one.
  const abilities = useAbilities({
    roomId,
    enabled: isFinder && phase === 'hunting',
    huntSeconds: display?.round_seconds ?? 0,
  })
  const [abilityPanelOpen, setAbilityPanelOpen] = useState(false)
  const [scanRadiusM, setScanRadiusM] = useState(80)
  const [abilityToast, setAbilityToast] = useState<string | null>(null)

  useAbilityAlerts({
    roomId,
    enabled: me?.role === 'hider' && me.status === 'active' && phase === 'hunting',
    onAlert: (kind: AbilityKind) => {
      setAbilityToast(`The finder used ${ABILITY_LABELS[kind]}`)
      if ('vibrate' in navigator) navigator.vibrate(200)
    },
  })

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

  // Auto-dismiss the snapshot toast.
  useEffect(() => {
    if (!snapshotToast) return
    const id = setTimeout(() => setSnapshotToast(null), 3000)
    return () => clearTimeout(id)
  }, [snapshotToast])

  // Auto-dismiss the task toast.
  useEffect(() => {
    if (!taskToast) return
    const id = setTimeout(() => setTaskToast(null), 3000)
    return () => clearTimeout(id)
  }, [taskToast])

  // Auto-dismiss the ability toast.
  useEffect(() => {
    if (!abilityToast) return
    const id = setTimeout(() => setAbilityToast(null), 3000)
    return () => clearTimeout(id)
  }, [abilityToast])

  useEffect(() => {
    if (room?.status === 'lobby') navigate(`/room/${code}`, { replace: true })
  }, [room?.status, code, navigate])

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

  // Reveals for the finder's map: pulse = amber, zone_scan = teal, clue =
  // violet, red = penalty reveals (last_known / out_of_bounds). The popup
  // uses the server label plus the expiry.
  const finderRevealDots = reveals.map((r) => ({
        id: r.id,
        latlng: [r.lat, r.lng] as [number, number],
        radiusM: r.radius_m ?? 40,
        color:
          r.kind === 'pulse'
            ? '#d97706'
            : r.kind === 'zone_scan'
              ? '#0d9488'
              : r.kind === 'clue'
                ? '#7c3aed'
                : '#dc2626',
        label: `${r.label} — until ${new Date(r.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      }))

  // Clue cards for the abilities panel: the live clue reveals.
  const clueCards = reveals
        .filter((r) => r.kind === 'clue')
        .map((r) => ({ id: r.id, label: r.label, expiresAtMs: Date.parse(r.expires_at) }))

  // Fire an ability (throws with the server error — shown as a toast).
  const fireAbility = async (kind: AbilityKind) => {
    try {
      await abilities.use(kind, { lat: null, lng: null, radiusM: null })
      setAbilityToast(`${ABILITY_LABELS[kind]} used`)
    } catch (err) {
      setAbilityToast(friendlyError(err))
    }
  }

  // Task target circle on the hider's own map (Phase 5): the reach_zone
  // circle, or the play-area circle the hider must get outside of.
  const taskTarget = (() => {
    const t = currentTask
    if (!t) return null
    const lat = numParam(t.params, 'lat')
    if (lat === null) return null
    const lng = numParam(t.params, 'lng') ?? 0
    if (t.type === 'reach_zone') {
      return {
        lat,
        lng,
        radiusM: numParam(t.params, 'radius_m') ?? 30,
        color: '#2563eb',
      }
    }
    if (t.type === 'distance') {
      return {
        lat,
        lng,
        radiusM: numParam(t.params, 'radius_m') ?? 80,
        color: '#2563eb',
      }
    }
    return null
  })()

  // Dev tool (?dev=1): complete the current task. Teleports the fake
  // position onto the target (reach_zone / distance) so the next server
  // poll completes it; opens the photo capture for photo tasks.
  const devCompleteTask = () => {
    const t = currentTask
    if (!t) return
    if (!location.fakeMode) {
      setTaskToast('Dev teleport needs ?fake=1')
      return
    }
    const lat = numParam(t.params, 'lat')
    const lng = numParam(t.params, 'lng')
    if (t.type === 'reach_zone' && lat !== null) {
      location.setFake({ lat, lng: lng ?? 0 })
      setTaskToast('Dev: teleported into the task circle')
    } else if (t.type === 'distance' && lat !== null) {
      // ~220 m north of the play area centre.
      location.setFake({ lat: lat + 0.002, lng: lng ?? 0 })
      setTaskToast('Dev: teleported far from the centre')
    } else if (t.type === 'photo') {
      setPhotoCaptureTask(t)
    } else {
      setTaskToast('Dev: stay still 3 minutes to complete stay_put')
    }
  }

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

      {me?.role === 'hider' && phase === 'hunting' && currentTask && (
        <TaskCard
          task={currentTask}
          skipsLeft={tasks.skipsLeft}
          serverNowMs={serverNowMs}
          onSkip={() => {
            void tasks
              .skip(currentTask.id)
              .then(() => setTaskToast('Task skipped — 5 points lost'))
              .catch((err) => setTaskToast(friendlyError(err)))
          }}
          onPhoto={() => setPhotoCaptureTask(currentTask)}
          devTools={devTools}
          onDevComplete={devCompleteTask}
        />
      )}

      {me?.role === 'hider' && me.status === 'active' && phase === 'hunting' && (
        <div className="rounded-2xl bg-white p-4 shadow">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Snapshots</p>
          <p className="mt-1 text-base font-semibold text-slate-900">
            Next snapshot {snapshots.nextSnapshotLabel ?? '— none left'}
          </p>
          {snapshots.sentSnapshots.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {snapshots.sentSnapshots.map((s) => (
                <img
                  key={s.id}
                  src={s.image_url}
                  alt="Your snapshot"
                  className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                />
              ))}
            </div>
          )}
          {devTools && (
            <button
              onClick={snapshots.devOpenWindow}
              className="mt-3 text-xs font-bold uppercase tracking-wide text-emerald-700"
            >
              Dev: open window now
            </button>
          )}
        </div>
      )}

      {(snapshotToast ?? taskToast ?? abilityToast) && (
        <div className="fixed bottom-6 left-1/2 z-[65] -translate-x-1/2 rounded-full bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow">
          {snapshotToast ?? taskToast ?? abilityToast}
        </div>
      )}

      {snapshots.prompt.open && (
        <SnapshotPrompt
          secondsLeft={snapshots.prompt.secondsLeft}
          windowIndex={snapshots.windowIndex}
          onOpenCamera={() => setCaptureOpen(true)}
          onDismiss={snapshots.dismissPrompt}
        />
      )}

      {captureOpen && (
        <CameraCapture
          roomId={roomId}
          windowIndex={snapshots.windowIndex}
          userId={user?.id ?? ''}
          onCancel={() => setCaptureOpen(false)}
          onDone={(result) => {
            setCaptureOpen(false)
            snapshots.dismissPrompt()
            setSnapshotToast(
              result.late
                ? 'Snapshot was late — 0 points'
                : `Snapshot on time — +${result.points_awarded} points`,
            )
          }}
        />
      )}

      {photoCaptureTask && (
        <CameraCapture
          roomId={roomId}
          windowIndex={0}
          taskId={photoCaptureTask.id}
          userId={user?.id ?? ''}
          onCancel={() => setPhotoCaptureTask(null)}
          onDone={(result) => {
            setPhotoCaptureTask(null)
            setTaskToast(
              result.late
                ? 'Photo was late — 0 points'
                : 'Photo submitted — task completes on the next poll',
            )
            void tasks.refresh()
          }}
        />
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

      {(active || phase === 'ended') && <TagsPanel roomId={roomId} userId={user?.id ?? ''} players={players} isHost={isHost} isFinder={isFinder} hunting={phase === 'hunting'} nowMs={serverNowMs} />}
      {phase === 'ended' && <RoundResults roomId={roomId} players={players} isHost={isHost} onLobby={() => navigate(`/room/${room.code}`, { replace: true })} onLeave={() => navigate('/', { replace: true })} />}
      {me?.status === 'tagged' && active && <button className="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white" onClick={() => setFeedOpen(true)}>Watch snapshots</button>}

      {showRing && <ProximityRing band={myBand} />}

      {showMap && (
        <div className="relative">
          <GameMap
            centre={mapCentre}
            radiusM={room.radius_m}
            dots={myDot}
            reveals={finderRevealDots}
            target={me?.role === 'hider' ? taskTarget : null}
            onTap={
              abilities.placing
                ? (l) => {
                    void abilities
                      .use('zone_scan', { lat: l.lat, lng: l.lng, radiusM: scanRadiusM })
                      .then((result) => {
                        abilities.setPlacing(false)
                        setAbilityToast(`Zone scan: ${result.reveal.label}`)
                      })
                      .catch((err) => {
                        abilities.setPlacing(false)
                        setAbilityToast(friendlyError(err))
                      })
                  }
                : location.fakeMode
                  ? (l) => location.setFake(l)
                  : undefined
            }
          />
          {isFinder && phase === 'hunting' && (
            <button
              onClick={() => setAbilityPanelOpen(true)}
              className="absolute right-3 top-3 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white shadow active:scale-95"
            >
              Abilities
            </button>
          )}
          {isFinder && phase === 'hunting' && (
            <button
              onClick={() => setFeedOpen(true)}
              className="absolute right-3 top-14 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow active:scale-95"
            >
              Snapshots
            </button>
          )}
          {abilities.placing && (
            <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-teal-900/90 px-3 py-1 text-xs font-bold text-white shadow">
              Tap the map to place the zone scan ({scanRadiusM} m)
            </p>
          )}
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

      {feedOpen && (
        <SnapshotFeed roomId={roomId} players={players} onClose={() => setFeedOpen(false)} />
      )}

      {abilityPanelOpen && (
        <AbilitiesPanel
          huntSeconds={display?.round_seconds ?? 0}
          serverNowMs={serverNowMs}
          chargesLeft={abilities.chargesLeft}
          cooldownUntilMs={abilities.cooldownUntilMs}
          history={abilities.history}
          clueCards={clueCards}
          scanRadiusM={scanRadiusM}
          onScanRadiusChange={setScanRadiusM}
          onUse={(kind) => void fireAbility(kind)}
          onStartZoneScan={() => {
            setAbilityPanelOpen(false)
            abilities.setPlacing(true)
          }}
          onDevGiveCharges={abilities.devGiveCharges}
          devTools={devTools}
          onClose={() => setAbilityPanelOpen(false)}
        />
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
