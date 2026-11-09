/**
 * Snapfind — skip_task Edge Function (Phase 5).
 *
 * POST { "room_id": string, "task_id": string }
 *
 * The hider skips their current active task: it is marked `skipped`, the
 * hider loses SKIP_POINTS_PENALTY (5) points, their skips_used counter goes
 * up (2 skips per round), and the next task is assigned. The task must be
 * the caller's own active task in a hunting round.
 *
 * Deploy with the Supabase CLI (local import graph must be bundled):
 *   supabase functions deploy skip_task
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  pickTaskType,
  taskDurationSec,
  taskParams,
  TASK_POINTS,
  type TaskRow,
  type TaskType,
} from '../lib/tasks.ts'
import { MAX_SKIPS_PER_ROUND, SKIP_POINTS_PENALTY } from '../../../shared/constants.ts'

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

/** Assign the hider's next task (shared shape with task_progress). */
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

  let body: { room_id?: unknown; task_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return errorJson('BAD_REQUEST', 'JSON body required', 400)
  }
  if (typeof body.room_id !== 'string' || !body.room_id) {
    return errorJson('BAD_REQUEST', 'room_id required', 400)
  }
  if (typeof body.task_id !== 'string' || !body.task_id) {
    return errorJson('BAD_REQUEST', 'task_id required', 400)
  }
  const roomId = body.room_id
  const taskId = body.task_id

  // Membership first: an unknown room simply has no member row, so the
  // caller is not a hider there.
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

  const { data: roomData } = await service
    .from('rooms')
    .select('id, status, center_lat, center_lng, radius_m')
    .eq('id', roomId)
    .maybeSingle()
  if (!roomData) return errorJson('NOT_HIDER', 'Only hiders have tasks', 403)
  const room = roomData as RoomRow

  if (room.status !== 'hunting') {
    return errorJson('ROUND_NOT_HUNTING', 'The round is not hunting', 422)
  }

  // The task must be the caller's own active task.
  const { data: taskData } = await service
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('id', taskId)
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .maybeSingle()
  if (!taskData || taskData.status !== 'active') {
    return errorJson('NO_ACTIVE_TASK', 'No active task to skip', 409)
  }
  const task = taskData as TaskRow

  if (player.skips_used >= MAX_SKIPS_PER_ROUND) {
    return errorJson('SKIPS_EXHAUSTED', 'No skips left', 409)
  }

  // Skip the task: -5 points, skips_used + 1, then assign the next task.
  const { error: skipError } = await service
    .from('tasks')
    .update({ status: 'skipped' })
    .eq('id', task.id)
  if (skipError) return errorJson('INTERNAL', 'Could not skip the task', 500)
  const { data: pointsData } = await service
    .from('players')
    .select('points')
    .eq('room_id', roomId)
    .eq('id', userId)
    .maybeSingle()
  const { error: playerError } = await service
    .from('players')
    .update({
      points: (pointsData?.points ?? 0) - SKIP_POINTS_PENALTY,
      skips_used: player.skips_used + 1,
    })
    .eq('room_id', roomId)
    .eq('id', userId)
  if (playerError) return errorJson('INTERNAL', 'Could not apply the skip', 500)

  const area =
    room.center_lat !== null && room.center_lng !== null && room.radius_m !== null
      ? { lat: room.center_lat, lng: room.center_lng, radiusM: room.radius_m }
      : null
  if (area) {
    // The history includes the skipped task (it is already `skipped`).
    const { data: historyData } = await service
      .from('tasks')
      .select('type')
      .eq('room_id', roomId)
      .eq('player_id', userId)
      .order('assigned_at', { ascending: false })
      .limit(2)
    const history = (historyData ?? []).map((t) => t.type as TaskType)
    const assigned = await assignNextTask(service, roomId, userId, history, area, Date.now())
    if (!assigned) return errorJson('INTERNAL', 'Could not assign a task', 500)
  }

  return json({
    ok: true,
    points_penalty: SKIP_POINTS_PENALTY,
    skips_left: MAX_SKIPS_PER_ROUND - (player.skips_used + 1),
  })
})
