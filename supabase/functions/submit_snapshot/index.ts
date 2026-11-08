/**
 * Snapfind — submit_snapshot Edge Function (Phase 4).
 *
 * POST { "room_id": string, "window_index": number, "task_id": string|null,
 *        "image_path": string, "taken_at": string }
 *
 * The hider uploads the image to `snapshots/{room_id}/{player_id}/{window_index}.jpg`
 * first (own folder, RLS-allowed), then calls this. The window opens at
 * n * 5 minutes of round time: on time = within 45 s (+10 points), late =
 * within 2 min (0 points, late: true), beyond that WINDOW_CLOSED. The bonus
 * window (0, photo task) skips the timing check — the task owns its timing.
 *
 * The player comes from the token. The server validates everything:
 * membership (hider), round state (hunting), window timing (server clock),
 * image path (own folder + window index) and duplicates.
 *
 * Deploy with the Supabase CLI (local import graph must be bundled):
 *   supabase functions deploy submit_snapshot
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  SNAPSHOT_BONUS_WINDOW_INDEX,
  isValidSnapshotImagePath,
  roundSeconds,
  windowPoints,
  windowState,
} from '../lib/snapshot.ts'

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

interface RoomRow {
  id: string
  status: string
  started_at: string | null
  paused_total_ms: number
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

  let body: {
    room_id?: unknown
    window_index?: unknown
    task_id?: unknown
    image_path?: unknown
    taken_at?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return errorJson('BAD_REQUEST', 'JSON body required', 400)
  }
  if (typeof body.room_id !== 'string' || !body.room_id) {
    return errorJson('BAD_REQUEST', 'room_id required', 400)
  }
  const roomId = body.room_id

  // Room + membership (service key reads; checks happen server-side).
  const { data: roomData } = await service
    .from('rooms')
    .select('id, status, started_at, paused_total_ms')
    .eq('id', roomId)
    .maybeSingle()
  if (!roomData) return errorJson('ROOM_NOT_FOUND', 'Room not found', 404)
  const room = roomData as RoomRow

  const { data: memberData } = await service
    .from('players')
    .select('role')
    .eq('room_id', roomId)
    .eq('id', userId)
    .maybeSingle()
  if (!memberData || memberData.role !== 'hider') {
    return errorJson('NOT_HIDER', 'Only hiders submit snapshots', 403)
  }

  if (room.status !== 'hunting') {
    return errorJson('ROUND_NOT_HUNTING', 'The round is not hunting', 422)
  }

  if (
    typeof body.window_index !== 'number' ||
    !Number.isInteger(body.window_index) ||
    body.window_index < 0
  ) {
    return errorJson('INVALID_WINDOW', 'window_index must be a non-negative integer', 400)
  }
  const windowIndex = body.window_index

  if (typeof body.image_path !== 'string' || !body.image_path) {
    return errorJson('INVALID_IMAGE_PATH', 'image_path required', 400)
  }
  if (!isValidSnapshotImagePath(roomId, userId, windowIndex, body.image_path)) {
    return errorJson(
      'INVALID_IMAGE_PATH',
      `image_path must be {room_id}/{player_id}/${windowIndex}.jpg`,
      400,
    )
  }

  if (typeof body.taken_at !== 'string' || Number.isNaN(Date.parse(body.taken_at))) {
    return errorJson('BAD_REQUEST', 'taken_at must be an ISO timestamp', 400)
  }
  const takenAt = body.taken_at

  const taskId: string | null =
    typeof body.task_id === 'string' && body.task_id ? body.task_id : null

  // Window timing on the server clock (bonus window 0: no timing here).
  let late = false
  let points = 0
  if (windowIndex !== SNAPSHOT_BONUS_WINDOW_INDEX) {
    const state = windowState(
      roundSeconds(Date.now(), room.started_at, room.paused_total_ms),
      windowIndex,
    )
    if (state === 'not_open') {
      return errorJson('WINDOW_NOT_OPEN', `Window ${windowIndex} has not opened yet`, 422)
    }
    if (state === 'closed') {
      return errorJson('WINDOW_CLOSED', `Window ${windowIndex} is closed`, 422)
    }
    late = state === 'late'
    points = windowPoints(state)
  }

  // One snapshot per hider per window.
  const { data: existing } = await service
    .from('snapshots')
    .select('id')
    .eq('room_id', roomId)
    .eq('player_id', userId)
    .eq('window_index', windowIndex)
    .maybeSingle()
  if (existing) {
    return errorJson('ALREADY_SUBMITTED', 'You already submitted a snapshot for this window', 409)
  }

  const { data: inserted, error: insertError } = await service
    .from('snapshots')
    .insert({
      room_id: roomId,
      player_id: userId,
      window_index: windowIndex,
      task_id: taskId,
      image_path: body.image_path,
      taken_at: takenAt,
      late,
    })
    .select('id')
    .maybeSingle()
  if (insertError || !inserted) {
    return errorJson('INTERNAL', 'Could not save the snapshot', 500)
  }

  if (points > 0) {
    // +10 points for an on-time snapshot. One snapshot per player per window
    // makes a double award impossible.
    const { data: playerData } = await service
      .from('players')
      .select('points')
      .eq('room_id', roomId)
      .eq('id', userId)
      .maybeSingle()
    const current = playerData?.points ?? 0
    const { error: updateError } = await service
      .from('players')
      .update({ points: current + points })
      .eq('room_id', roomId)
      .eq('id', userId)
    if (updateError) return errorJson('INTERNAL', 'Could not award points', 500)
  }

  return json({
    ok: true,
    snapshot_id: inserted.id,
    late,
    points_awarded: points,
  })
})
