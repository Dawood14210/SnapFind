/**
 * Snapfind — task_progress Edge Function (Phase 5).
 *
 * POST { "room_id": string }
 *
 * The hider polls this every ~5 s during the hunt. The server:
 *  - updates the hider's current task: expired when past its deadline, or
 *    done when its completion rule is met (+ the task's points);
 *  - assigns a new task when the current one is done/skipped/expired or
 *    missing and the round is hunting (first call after hunt start assigns);
 *  - returns the hider's tasks (newest first) and the skips left.
 *
 * Completion rules (server-side, from the hider's own GPS readings):
 *  - reach_zone: every reading in the last 20 s inside the 30 m circle;
 *  - stay_put: readings spanning 3 min, each pair within 10 m, accuracy
 *    worse than 25 m ignored;
 *  - distance: the latest reading is outside the 80 m circle;
 *  - photo: a bonus snapshot (window 0) exists for this hider.
 *
 * Deploy with the Supabase CLI (local import graph must be bundled):
 *   supabase functions deploy task_progress
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  isTaskComplete,
  pickTaskType,
  taskDurationSec,
  taskParams,
  TASK_POINTS,
  type Reading,
  type TaskRow,
  type TaskType,
} from '../lib/tasks.ts'
import { MAX_SKIPS_PER_ROUND } from '../../../shared/constants.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorJson(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status)
}

const TASK_COLUMNS =
  'id, room_id, player_id, type, params, status, points, assigned_at, expires_at'

interface RoomRow {
  id: string
  status: string
  center_lat: number | null
  center_lng: number | null
  radius_m: number | null
}

interface PlayerRow {
  role: string
  skips_used: number
}

/** Assign the hider's next task (shared shape with skip_task). */
async function assignNextTask(
  service: SupabaseClient,
  roomId: string,
  userId: string,
  history: TaskType[],
  area: { lat: number; lng: number; radiusM: number },
  nowMs: number,
): Promise<TaskRow | null> {
  const type = pickTaskType(history)
  const { data, error } = await service
    .from('tasks')
    .insert({
      room_id: roomId,
      player_id: userId,
      type,
      params: taskParams(type, area),
      points: TASK_POINTS[type],
      expires_at: new Date(nowMs + taskDurationSec() * 1000).toISOString(),
    })
    .select(TASK_COLUMNS)
    .maybeSingle()
  if (error || !data) return null
  return data as TaskRow
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return errorJson('METHOD_NOT_ALLOWED', 'POST required', 405)
  }

  const anon = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const service = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The player comes from the token — never from the request body.
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return errorJson('UNAUTHENTICATED', 'Missing token', 401)
  const { data: userData, error: userError } = await anon.auth.getUser(token)
  if (userError || !userData.user) return errorJson('UNAUTHENTICATED', 'Invalid token', 401)
  const userId = userData.user.id

  let body: { room_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return errorJson('BAD_REQUEST', 'JSON body required', 400)
  }
  if (typeof body.room_id !== 'string' || !body.room_id) {
    return errorJson('BAD_REQUEST', 'room_id required', 400)
  }
  const roomId = body.room_id

  const { data: roomData } = await service
    .from('rooms')
    .select('id, status, center_lat, center_lng, radius_m')
    .eq('id', roomId)
    .maybeSingle()
  if (!roomData) return errorJson('ROOM_NOT_FOUND', 'Room not found', 404)
  const room = roomData as RoomRow

  const { data: playerData } = await service
    .from('players')
    .select('role, skips_used')
    .eq('room_id', roomId)
    .eq('id', userId)
    .maybeSingle()
  if (!playerData || playerData.role !== 'hider') {
    return errorJson('NOT_HIDER', 'Only hiders have tasks', 403)
  }
  const player = playerData as PlayerRow

  const nowMs = Date.now()

  // The hider's tasks in this room, newest first.
  const { data: taskData } = await service
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .order('assigned_at', { ascending: false })
  const tasks = (taskData ?? []) as TaskRow[]

  // The hider's recent GPS readings (newest first; the completion helpers
  // are order-agnostic). 200 readings covers 3+ minutes at the 3 s
  // upsert cadence.
  const { data: locData } = await service
    .from('locations')
    .select('lat, lng, accuracy_m, reading_at')
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .order('reading_at', { ascending: false })
    .limit(200)
  const readings: Reading[] = (locData ?? []).map((r) => ({
    lat: r.lat,
    lng: r.lng,
    accuracyM: r.accuracy_m,
    atMs: Date.parse(r.reading_at),
  }))

  // 1. Update the current task: expire it past its deadline, or complete it.
  const current = tasks[0] ?? null
  let currentStatus = current?.status ?? null
  if (current && current.status === 'active') {
    if (Date.parse(current.expires_at) <= nowMs) {
      const { error: expireError } = await service
        .from('tasks')
        .update({ status: 'expired' })
        .eq('id', current.id)
      if (expireError) return errorJson('INTERNAL', 'Could not update the task', 500)
      currentStatus = 'expired'
    } else {
      let done = false
      if (current.type === 'photo') {
        // The photo task is completed by a bonus snapshot (window 0).
        const { data: snap } = await service
          .from('snapshots')
          .select('id')
          .eq('room_id', roomId)
          .eq('player_id', userId)
          .eq('window_index', 0)
          .maybeSingle()
        done = Boolean(snap)
      } else {
        done = isTaskComplete(current, readings, nowMs)
      }
      if (done) {
        const { data: pointsData } = await service
          .from('players')
          .select('points')
          .eq('room_id', roomId)
          .eq('id', userId)
          .maybeSingle()
        const { error: taskError } = await service
          .from('tasks')
          .update({ status: 'done' })
          .eq('id', current.id)
        if (taskError) return errorJson('INTERNAL', 'Could not complete the task', 500)
        const { error: pointsError } = await service
          .from('players')
          .update({ points: (pointsData?.points ?? 0) + current.points })
          .eq('room_id', roomId)
          .eq('id', userId)
        if (pointsError) return errorJson('INTERNAL', 'Could not award points', 500)
        currentStatus = 'done'
      }
    }
  }

  // 2. Hunting and no active task → assign a new one (first call after
  // hunt start assigns the opening task).
  const area =
    room.center_lat !== null && room.center_lng !== null && room.radius_m !== null
      ? { lat: room.center_lat, lng: room.center_lng, radiusM: room.radius_m }
      : null
  if (room.status === 'hunting' && currentStatus !== 'active' && area) {
    const history = tasks.map((t) => t.type)
    const assigned = await assignNextTask(service, roomId, userId, history, area, nowMs)
    if (!assigned) return errorJson('INTERNAL', 'Could not assign a task', 500)
  }

  // Final state for the response (includes the new task when assigned).
  const { data: finalData } = await service
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .order('assigned_at', { ascending: false })

  return json({
    tasks: finalData ?? [],
    skips_left: MAX_SKIPS_PER_ROUND - player.skips_used,
  })
})
