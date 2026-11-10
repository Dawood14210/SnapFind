/**
 * rematch — host starts a new round in the same play area (Phase 7).
 *
 * The host can only rematch after the round has ended. The SECURITY DEFINER
 * rematch RPC (009_tags.sql) does the work: wipes the round's data (snapshots,
 * tasks, ability uses, tags, reveals, events, locations), resets players
 * (points, roles, status, ready), resets the room clock to lobby, and picks
 * the next finder as the top-scoring hider of the finished round.
 *
 * Returns { ok: true, finder_id }.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  if (!roomId) return jsonError('BAD_REQUEST', 'room_id is required')

  // 1. Membership first — the caller must be the room host, and the round
  //    must have ended (the RPC enforces this too; we check early for a
  //    clean error code).
  const { data: roomRows, error: roomError } = await service
    .from('rooms')
    .select('id, host_id, status')
    .eq('id', roomId)
    .maybeSingle()
  if (roomError) return jsonError('DB_ERROR', roomError.message, 500)
  const room = roomRows
  if (!room) return jsonError('ROOM_NOT_FOUND', 'Room not found', 404)
  if (room.host_id !== caller) return jsonError('NOT_HOST', 'Only the host can rematch')
  if (room.status !== 'ended') return jsonError('ROUND_NOT_ENDED', 'The round has not ended yet')

  // 2. The RPC wipes the round data, resets players, and picks the next
  //    finder (top-scoring hider).
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${auth}` } },
    auth: { persistSession: false },
  })
  const { data: result, error: rematchError } = await userClient.rpc('rematch', {
    p_room_id: roomId,
  })
  if (rematchError) {
    const code = /NOT_HOST|ROUND_NOT_ENDED|ROOM_NOT_FOUND/.exec(rematchError.message)?.[0]
    if (code) return jsonError(code, rematchError.message, 400)
    return jsonError('DB_ERROR', rematchError.message, 500)
  }
  return Response.json({ ok: true, finder_id: result?.finder_id ?? null })
})
