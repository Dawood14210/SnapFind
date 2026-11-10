/**
 * Snapfind — tag confirmation application (Phase 7).
 *
 * This is the shared DB side of confirming a tag: the hider confirms it
 * (confirm_tag), 10 s of silence auto-confirms it (finalize_tag), or the
 * host confirms it in a dispute (resolve_dispute). Kept out of lib/tags.ts so
 * the pure scoring helpers stay unit-testable without a Supabase client.
 *
 * Effects: tag → confirmed with points 60 + 1 per full minute left in the
 * round (room duration_min, like advance_round), hider → tagged, finder
 * credited the tag points; when no active hider remains the finder also
 * gets the 100 untagged-end bonus and the round ends via the end_round RPC.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { UNTAGGED_END_BONUS } from '../../../shared/constants.ts'
import { getRoundState, type RoomView } from './round.ts'
import { tagPoints, type TagRow } from './tags.ts'

export interface TagConfirmResult {
  /** Points credited for the tag (null when nothing was confirmed). */
  points: number | null
  /** True when the round ended because this confirmation tagged the last hider. */
  ended: boolean
}

export async function applyTagConfirm(
  service: SupabaseClient,
  roomId: string,
  tag: TagRow,
  nowMs: number,
): Promise<TagConfirmResult> {
  const { data: roomRows } = await service
    .from('rooms')
    .select('id, code, host_id, status, center_lat, center_lng, radius_m, duration_min, hide_duration_min, max_players, started_at, paused_at, paused_total_ms, finder_id, scores_finalized')
    .eq('id', roomId)
    .maybeSingle()
  if (!roomRows) return { points: null, ended: false }
  const room = roomRows as unknown as RoomView

  const state = getRoundState(room, nowMs)
  const points = tagPoints(state.seconds_left_in_round)

  const { error: tagUpdateError } = await service
    .from('tags')
    .update({ status: 'confirmed', points })
    .eq('id', tag.id)
  if (tagUpdateError) return { points: null, ended: false }
  const { error: hiderUpdateError } = await service
    .from('players')
    .update({ status: 'tagged' })
    .eq('id', tag.hider_id)
  if (hiderUpdateError) return { points: null, ended: false }

  const { data: finderRow } = await service
    .from('players')
    .select('points')
    .eq('id', tag.finder_id)
    .maybeSingle()
  const finderPoints = (finderRow?.points ?? 0) + points
  const { error: pointsError } = await service
    .from('players')
    .update({ points: finderPoints })
    .eq('id', tag.finder_id)
  if (pointsError) return { points: null, ended: false }

  await service.from('events').insert({
    room_id: roomId,
    type: 'tag_confirmed',
    payload: { finder_id: tag.finder_id, hider_id: tag.hider_id, tag_id: tag.id, points },
  })

  let ended = false
  const { data: activeHiders } = await service
    .from('players')
    .select('id')
    .eq('room_id', roomId)
    .eq('role', 'hider')
    .eq('status', 'active')
  if ((activeHiders ?? []).length === 0) {
    const { error: bonusError } = await service
      .from('players')
      .update({ points: finderPoints + UNTAGGED_END_BONUS })
      .eq('id', tag.finder_id)
    if (bonusError) return { points: null, ended: false }
    await service.from('events').insert({
      room_id: roomId,
      type: 'round_ended',
      payload: { finder_id: tag.finder_id, bonus: UNTAGGED_END_BONUS },
    })
    // Automatic completion uses the service role; end_round is host-only.
    const { error: endError } = await service.from('rooms')
      .update({ status: 'ended' }).eq('id', roomId)
    if (endError) return { points: null, ended: false }
    ended = true
  }

  return { points, ended }
}
