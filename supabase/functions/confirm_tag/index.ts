/**
 * confirm_tag — the hider confirms a tag request (Phase 7).
 *
 * The tag moves to confirmed, the hider becomes tagged, and the finder is
 * credited 60 + 1 point per full minute left in the round (room
 * duration_min, like advance_round). When no active hider remains, the
 * finder is credited the 100 untagged-end bonus and the round ends. The
 * hider cannot confirm a tag that is not pending (TAG_NOT_PENDING).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { applyTagConfirm } from '../lib/tag-confirm.ts'

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
  const tagId = String(body.tag_id ?? '')
  if (!roomId || !tagId) return jsonError('BAD_REQUEST', 'room_id and tag_id are required')

  // 1. Membership first — the caller must be the tagged hider.
  const { data: playerRows, error: playerError } = await service
    .from('players')
    .select('id, room_id, role, status')
    .eq('room_id', roomId)
  if (playerError) return jsonError('DB_ERROR', playerError.message, 500)
  const player = (playerRows ?? []).find((p) => p.id === caller)
  if (!player) return jsonError('NOT_A_PLAYER', 'Not a player in this room')
  if (player.role !== 'hider') return jsonError('NOT_HIDERS', 'Only hiders can confirm tags')

  const { data: room } = await service.from('rooms').select('status').eq('id', roomId).maybeSingle()
  if (!room) return jsonError('ROOM_NOT_FOUND', 'Room not found', 404)
  if (room.status !== 'hunting') return jsonError('ROUND_NOT_HUNTING', 'Not currently hunting')

  // 2. The tag must belong to this room, be pending, and target this hider.
  const { data: tagRows, error: tagError } = await service
    .from('tags')
    .select('id, room_id, finder_id, hider_id, status, points, created_at')
    .eq('id', tagId)
    .maybeSingle()
  if (tagError) return jsonError('DB_ERROR', tagError.message, 500)
  const tag = tagRows
  if (!tag || tag.room_id !== roomId || tag.hider_id !== caller) {
    return jsonError('TAG_NOT_PENDING', 'No pending tag for you in this room')
  }
  if (tag.status !== 'pending') return jsonError('TAG_NOT_PENDING', 'Tag is no longer pending')

  // 3. Score the tag and apply it (shared with finalize_tag / resolve_dispute).
  const result = await applyTagConfirm(service, roomId, tag, Date.now())
  if (result.points === null) return jsonError('DB_ERROR', 'Could not confirm the tag', 500)
  return Response.json({ ok: true, hider_status: 'tagged', finder_points: result.points })
})
