/**
 * resolve_dispute — the host resolves a disputed tag (Phase 7).
 *
 * Input: room_id, tag_id, decision ('confirmed' | 'denied'). confirmed applies
 * the same effects as confirm_tag; denied closes the tag with no points and
 * the hider stays active. The tag must be disputed (TAG_NOT_DISPUTED).
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
  const decision = String(body.decision ?? '')
  if (!roomId || !tagId || !decision) return jsonError('BAD_REQUEST', 'room_id, tag_id and decision are required')
  if (decision !== 'confirmed' && decision !== 'denied') {
    return jsonError('BAD_REQUEST', 'decision must be confirmed or denied')
  }

  // 1. Membership first — the caller must be the room host.
  const { data: room } = await service
    .from('rooms')
    .select('id, host_id, status')
    .eq('id', roomId)
    .maybeSingle()
  if (!room) return jsonError('ROOM_NOT_FOUND', 'Room not found', 404)
  if (room.host_id !== caller) return jsonError('NOT_HOST', 'Only the host can resolve disputes')

  // 2. The tag must exist in this room and be disputed.
  const { data: tagRows, error: tagError } = await service
    .from('tags')
    .select('id, room_id, finder_id, hider_id, status, points, created_at')
    .eq('id', tagId)
    .maybeSingle()
  if (tagError) return jsonError('DB_ERROR', tagError.message, 500)
  const tag = tagRows
  if (!tag || tag.room_id !== roomId) return jsonError('TAG_NOT_DISPUTED', 'No tag in this room')
  if (tag.status !== 'disputed') return jsonError('TAG_NOT_DISPUTED', 'Tag is not disputed')

  // 3. Apply the decision.
  if (decision === 'denied') {
    const { error: closeError } = await service
      .from('tags')
      .update({ status: 'denied' })
      .eq('id', tag.id)
    if (closeError) return jsonError('DB_ERROR', closeError.message, 500)
    await service.from('events').insert({
      room_id: roomId,
      type: 'tag_dispute_denied',
      payload: { host_id: caller, tag_id: tag.id },
    })
    return Response.json({ ok: true, confirmed: false, points: null })
  }

  const result = await applyTagConfirm(service, roomId, tag, Date.now())
  if (result.points === null) return jsonError('DB_ERROR', 'Could not confirm the tag', 500)
  return Response.json({ ok: true, confirmed: true, points: result.points })
})
