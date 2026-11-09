import { useCallback, useEffect, useState } from 'react'
import { skipTask, taskProgress } from '@/api'
import type { TaskView } from '@/api'
import { friendlyError } from '@/lib/friendlyError'
import { MAX_SKIPS_PER_ROUND } from '@shared/constants'

export interface UseTasksInput {
  roomId: string
  /** True while the hider is hunting (tasks only exist then). */
  enabled: boolean
}

export interface UseTasksResult {
  /** All tasks of this hider in the room, newest first. */
  tasks: TaskView[]
  /** The current task (the newest one), or null. */
  currentTask: TaskView | null
  skipsLeft: number
  error: string | null
  /** Re-fetch immediately. */
  refresh: () => void
  /** Skip the given task (server marks it skipped and assigns the next). */
  skip: (taskId: string) => Promise<void>
}

/**
 * Hider task state (Phase 5): polls task_progress every ~5 s while hunting.
 * The server owns assignment, completion and points; the client only
 * displays the current task and skips. The first poll after hunt start
 * assigns the opening task.
 */
export function useTasks(input: UseTasksInput): UseTasksResult {
  const { roomId, enabled } = input
  const [tasks, setTasks] = useState<TaskView[]>([])
  const [skipsLeft, setSkipsLeft] = useState(MAX_SKIPS_PER_ROUND)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!roomId) return
    try {
      const result = await taskProgress(roomId)
      setTasks(result.tasks ?? [])
      setSkipsLeft(result.skips_left)
      setError(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [roomId])

  useEffect(() => {
    if (!enabled || !roomId) {
      setTasks([])
      return
    }
    refresh()
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [enabled, roomId, refresh])

  const skip = useCallback(
    async (taskId: string) => {
      // The server marks the task skipped, applies the -5 penalty and
      // assigns the next task; the refresh picks it up.
      await skipTask(roomId, taskId)
      await refresh()
    },
    [roomId, refresh],
  )

  const currentTask = tasks[0] ?? null

  return { tasks, currentTask, skipsLeft, error, refresh, skip }
}
