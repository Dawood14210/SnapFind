/**
 * request_tag — the finder requests a tag for a hider (Phase 7).
 *
 * Input: room_id, hider_id. The real checks happen here: both latest
 * location rows must be fresher than TAG_LOCATION_MAX_AGE_SEC, the reading
 * accuracy must be ≤ TAG_ACCURACY_MAX_M, and the finder must be within
 * TAG_DISTANCE_M of the hider.
 *
 * Only the finder can tag (the hider must still be active; TAG_LOCKOUT_SEC
 * after a failed attempt). Success inserts a row into the tags table with
 * status pending; the hider then confirms or disputes, and 10 s of silence
 * auto-confirms via finalize_tag.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  TAG_ACCURACY_MAX_M,
  TAG_DISTANCE_M,
  TAG_LOCKOUT_SEC,
  TAG_LOCATION_MAX_AGE_SEC,
} from '../../../shared/constants.ts'
import { haversineM, type LatLng } from '../lib/geo.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

function jsonError(code: string, message: string, status = 400): Response {
  return Response.json({ error: { code, message } }, { status })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  }
  if (req.method !== 'POST') return jsonError('METHOD_NOT_ALLOWED', 'Use POST', 405)

  const auth = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!auth) return jsonError('NOT_AUTHENTICATED', 'Sign in required', 401)
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userError } = await anon.auth.getUser(auth)
  if (userError || !userData?.user) return jsonError('NOT_AUTHENTICATED', 'Sign in required', 401)
  const caller = userData.user.id
  const service = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonError('BAD_REQUEST', 'Expected a JSON body')
  }
  const roomId = String(body.room_id ?? '')
  const hiderId = String(body.hider_id ?? '')
  if (!roomId || !hiderId) return jsonError('BAD_REQUEST', 'room_id and hider_id are required')

  // 1. Membership first — the caller must be the room's finder.
  const { data: playerRows, error: playerError } = await service
    .from('players')
    .select('id, room_id, role, status')
    .eq('room_id', roomId)
  if (playerError) return jsonError('DB_ERROR', playerError.message, 500)
  const player = (playerRows ?? []).find((p) => p.id === caller)
  if (!player) return jsonError('NOT_A_PLAYER', 'Not a player in this room')
  if (player.role !== 'finder') return jsonError('NOT_FINDER', 'Only the finder can tag hiders')

  const { data: room } = await service.from('rooms').select('status').eq('id', roomId).maybeSingle()
  if (!room) return jsonError('ROOM_NOT_FOUND', 'Room not found', 404)
  if (room.status !== 'hunting') return jsonError('ROUND_NOT_HUNTING', 'Not currently hunting')

  // 2. Lockout — a failed attempt by this finder in this room recently.
  const lockoutCutoffMs = Date.now() - TAG_LOCKOUT_SEC * 1000
  const { data: lockRows } = await service
    .from('events')
    .select('created_at')
    .eq('room_id', roomId)
    .eq('payload->>finder_id', caller)
    .eq('type', 'tag_attempt_failed')
    .gte('created_at', new Date(lockoutCutoffMs).toISOString())
  if ((lockRows ?? []).length > 0) {
    return jsonError('ON_TAG_LOCKOUT', `Wait ${TAG_LOCKOUT_SEC} s before tagging again`)
  }

  async function failedAttempt(code: string, message: string): Promise<Response> {
    const { error } = await service.from('events').insert({
      room_id: roomId,
      type: 'tag_attempt_failed',
      payload: { finder_id: caller, hider_id: hiderId, reason: code },
    })
    if (error) return jsonError('DB_ERROR', error.message, 500)
    return jsonError(code, message)
  }

  // 3. The hider must still be active.
  const { data: hider } = await service
    .from('players')
    .select('id, room_id, status')
    .eq('id', hiderId)
    .maybeSingle()
  if (!hider || hider.room_id !== roomId) return jsonError('NOT_A_PLAYER', 'Not a player in this room')
  if (hider.status !== 'active') {
    return jsonError('HIDERS_ALREADY_TAGGED', 'That hider is no longer active')
  }

  // 4. Freshest location rows for both players.
  const { data: finderLocations, error: finderLocError } = await service
    .from('locations')
    .select('lat, lng, accuracy_m, reading_at')
    .eq('player_id', caller)
    .eq('room_id', roomId)
    .order('reading_at', { ascending: false })
    .limit(1)
  if (finderLocError) return jsonError('DB_ERROR', finderLocError.message, 500)
  const { data: hiderLocations, error: hiderLocError } = await service
    .from('locations')
    .select('lat, lng, accuracy_m, reading_at')
    .eq('player_id', hiderId)
    .eq('room_id', roomId)
    .order('reading_at', { ascending: false })
    .limit(1)
  if (hiderLocError) return jsonError('DB_ERROR', hiderLocError.message, 500)
  const finderReading = finderLocations?.[0]
  const hiderReading = hiderLocations?.[0]

  const nowMs = Date.now()
  const stale =
    !finderReading || !hiderReading ||
    nowMs - Date.parse(finderReading.reading_at) > TAG_LOCATION_MAX_AGE_SEC * 1000 ||
    nowMs - Date.parse(hiderReading.reading_at) > TAG_LOCATION_MAX_AGE_SEC * 1000
  if (stale) {
    return failedAttempt('LOCATION_TOO_OLD', `Both locations must be under ${TAG_LOCATION_MAX_AGE_SEC} s old`)
  }

  const badAccuracy =
    finderReading.accuracy_m === null || finderReading.accuracy_m > TAG_ACCURACY_MAX_M ||
    hiderReading.accuracy_m === null || hiderReading.accuracy_m > TAG_ACCURACY_MAX_M
  if (badAccuracy) {
    return failedAttempt('ACCURACY_TOO_POOR', `Both GPS readings must be accurate to within ${TAG_ACCURACY_MAX_M} m`)
  }

  const fromDb: LatLng = { lat: finderReading.lat, lng: finderReading.lng }
  const toDb: LatLng = { lat: hiderReading.lat, lng: hiderReading.lng }
  if (haversineM(fromDb, toDb) > TAG_DISTANCE_M) {
    return failedAttempt('TOO_FAR', `Must be within ${TAG_DISTANCE_M} m of the hider`)
  }

  // 5. All checks passed — insert a pending tag.
  const { data: tagRows, error: tagError } = await service
    .from('tags')
    .insert({ room_id: roomId, finder_id: caller, hider_id: hiderId, status: 'pending' })
    .select('id, room_id, finder_id, hider_id, status, points, created_at')
    .single()
  if (tagError) return jsonError('DB_ERROR', tagError.message, 500)
  await service.from('events').insert({
    room_id: roomId,
    type: 'tag_requested',
    payload: { finder_id: caller, hider_id: hiderId, tag_id: tagRows.id },
  })
  return Response.json({ ok: true, tag_id: tagRows.id, status: tagRows.status })
})
