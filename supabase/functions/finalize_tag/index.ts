/**
 * finalize_tag — resolve a tag request after 10 s of silence (Phase 7).
 *
 * The client polls this for pending tags: if the hider has not confirmed or
 * disputed within FINALIZE_TAG_SILENCE_SEC (10 s), the tag is auto-confirmed
 * with the same effects as confirm_tag. Idempotent: repeated calls return
 * the same result, and a tag that is already disputed/confirmed is reported
 * back untouched (points = the stored points).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { FINALIZE_TAG_SILENCE_SEC } from '../../../shared/constants.ts'
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

  // 1. Membership first — any member of the room can poll this.
  const { data: playerRows, error: playerError } = await service
    .from('players')
    .select('id, room_id')
    .eq('room_id', roomId)
  if (playerError) return jsonError('DB_ERROR', playerError.message, 500)
  if (!(playerRows ?? []).some((p) => p.id === caller)) {
    return jsonError('NOT_A_PLAYER', 'Not a player in this room')
  }

  // 2. Look the tag up; already-resolved tags report their stored points.
  const { data: tagRows, error: tagError } = await service
    .from('tags')
    .select('id, room_id, finder_id, hider_id, status, points, created_at')
    .eq('id', tagId)
    .maybeSingle()
  if (tagError) return jsonError('DB_ERROR', tagError.message, 500)
  const tag = tagRows
  if (!tag || tag.room_id !== roomId) return jsonError('TAG_NOT_PENDING', 'No tag in this room')
  if (tag.status !== 'pending') {
    return Response.json({ ok: true, confirmed: false, points: tag.points })
  }

  // 3. Silence for FINALIZE_TAG_SILENCE_SEC counts as confirmation.
  const nowMs = Date.now()
  const ageMs = nowMs - Date.parse(tag.created_at)
  if (ageMs < FINALIZE_TAG_SILENCE_SEC * 1000) {
    return Response.json({ ok: true, confirmed: false, points: null })
  }

  const result = await applyTagConfirm(service, roomId, tag, nowMs)
  if (result.points === null) return jsonError('DB_ERROR', 'Could not finalize the tag', 500)
  return Response.json({ ok: true, confirmed: true, points: result.points })
})
