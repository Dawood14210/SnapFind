import { useMemo } from 'react'
import type { TaskView } from '@/api'
import {
  DISTANCE_TASK_RADIUS_M,
  PHOTO_PROMPTS,
  REACH_ZONE_DURATION_SEC,
  REACH_ZONE_RADIUS_M,
  STAY_PUT_DURATION_SEC,
  STAY_PUT_MOVE_TOLERANCE_M,
} from '@shared/constants'

interface TaskCardProps {
  task: TaskView
  skipsLeft: number
  serverNowMs: number
  onSkip: () => void
  onPhoto: () => void
  devTools: boolean
  onDevComplete: () => void
}

/** Random photo prompt per task (stable while the task is shown). */
function usePhotoPrompt(taskId: string): string {
  return useMemo(
    () => PHOTO_PROMPTS[Math.floor(Math.random() * PHOTO_PROMPTS.length)],
    [taskId],
  )
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * The hider's current task card (Phase 5): description, progress bar, time
 * left, the photo button (photo tasks) and Skip with the skips left. The
 * server completes tasks; the client only skips.
 */
export default function TaskCard({
  task,
  skipsLeft,
  serverNowMs,
  onSkip,
  onPhoto,
  devTools,
  onDevComplete,
}: TaskCardProps) {
  const photoPrompt = usePhotoPrompt(task.id)

  const assignedMs = Date.parse(task.assigned_at)
  const expiresMs = Date.parse(task.expires_at)
  const totalMs = expiresMs - assignedMs
  const elapsedMs = Math.min(totalMs, Math.max(0, serverNowMs - assignedMs))
  const pct = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0
  const secondsLeft = Math.max(0, Math.round((expiresMs - serverNowMs) / 1000))
  const urgent = secondsLeft <= 30

  const description =
    task.type === 'reach_zone'
      ? `Get inside the circle on your map and stay ${REACH_ZONE_DURATION_SEC} seconds`
      : task.type === 'stay_put'
        ? `Stay within ${STAY_PUT_MOVE_TOLERANCE_M} m of this spot for ${STAY_PUT_DURATION_SEC / 60} minutes`
        : task.type === 'distance'
          ? `Get ${DISTANCE_TASK_RADIUS_M} m away from the play area centre`
          : photoPrompt

  return (
    <div className="rounded-2xl bg-white p-4 shadow">
      <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Task</p>
      <p className="mt-1 text-base font-bold text-slate-900">{description}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-600">
        +{task.points} points
      </p>

      {/* Progress bar + time left. */}
      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full ${urgent ? 'bg-red-500' : 'bg-indigo-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className={`mt-1 text-xs font-semibold ${urgent ? 'text-red-600' : 'text-slate-500'}`}>
          {secondsLeft > 0 ? `${formatDuration(secondsLeft)} left` : 'Expiring…'}
        </p>
      </div>

      <div className="mt-3 flex gap-2">
        {task.type === 'photo' && (
          <button
            onClick={onPhoto}
            className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white shadow active:scale-95"
          >
            Take photo
          </button>
        )}
        <button
          onClick={onSkip}
          disabled={skipsLeft <= 0}
          className={`flex-1 rounded-xl py-2.5 text-sm font-bold shadow active:scale-95 ${
            skipsLeft > 0
              ? 'bg-white text-red-600 shadow-sm'
              : 'bg-slate-100 text-slate-400'
          }`}
        >
          Skip ({skipsLeft} left)
        </button>
      </div>

      {devTools && (
        <button
          onClick={onDevComplete}
          className="mt-3 text-xs font-bold uppercase tracking-wide text-emerald-700"
        >
          Dev: complete task
        </button>
      )}
    </div>
  )
}
