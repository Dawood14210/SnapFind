/**
 * Typed wrappers for the contract's Edge Functions (called via
 * supabase.functions.invoke). Every Edge Function takes the player from the
 * auth token, never from the request body.
 */

import { getSupabase } from './client'
import { edgeErrorToApi } from './errors'
import type {
  ConfirmTagResult,
  DisputeTagResult,
  FinalizeScoresResult,
  FinalizeTagResult,
  PurgePhotosResult,
  RequestTagResult,
  ResolveDisputeResult,
  ResolveWindowResult,
  RoundStatusResult,
  SkipTaskResult,
  SosResult,
  SnapshotUrlsResult,
  SubmitSnapshotInput,
  SubmitSnapshotResult,
  TaskProgressResult,
  UseAbilityInput,
  UseAbilityResult,
} from './types'

async function edge<T>(name: string, body: object): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(name, {
    body: body as Record<string, unknown>,
  })
  if (error) throw edgeErrorToApi(error)
  return data as T
}

// Phase 3 — location
export const roundStatus = (roomId: string) =>
  edge<RoundStatusResult>('round_status', { room_id: roomId })

// Phase 4 — snapshots
export const submitSnapshot = (input: SubmitSnapshotInput) =>
  edge<SubmitSnapshotResult>('submit_snapshot', input)

export const snapshotUrls = (roomId: string, windowIndex: number | null) =>
  edge<SnapshotUrlsResult>('snapshot_urls', { room_id: roomId, window_index: windowIndex })

export const resolveWindow = (roomId: string, windowIndex: number) =>
  edge<ResolveWindowResult>('resolve_window', { room_id: roomId, window_index: windowIndex })

// Phase 5 — tasks
export const taskProgress = (roomId: string) =>
  edge<TaskProgressResult>('task_progress', { room_id: roomId })

export const skipTask = (roomId: string, taskId: string) =>
  edge<SkipTaskResult>('skip_task', { room_id: roomId, task_id: taskId })

// Phase 6 — abilities
export const useAbility = (input: UseAbilityInput) =>
  edge<UseAbilityResult>('use_ability', input)

// Phase 7 — tags and scores
export const requestTag = (roomId: string, hiderId: string) =>
  edge<RequestTagResult>('request_tag', { room_id: roomId, hider_id: hiderId })

export const confirmTag = (roomId: string, tagId: string) =>
  edge<ConfirmTagResult>('confirm_tag', { room_id: roomId, tag_id: tagId })

export const disputeTag = (roomId: string, tagId: string) =>
  edge<DisputeTagResult>('dispute_tag', { room_id: roomId, tag_id: tagId })

export const finalizeTag = (roomId: string, tagId: string) =>
  edge<FinalizeTagResult>('finalize_tag', { room_id: roomId, tag_id: tagId })

export const resolveDispute = (roomId: string, tagId: string, decision: 'confirmed' | 'denied') =>
  edge<ResolveDisputeResult>('resolve_dispute', { room_id: roomId, tag_id: tagId, decision })

export const finalizeScores = (roomId: string) =>
  edge<FinalizeScoresResult>('finalize_scores', { room_id: roomId })

// Phase 8 — safety
export const sos = (roomId: string, lat: number, lng: number) =>
  edge<SosResult>('sos', { room_id: roomId, lat, lng })

export const purgePhotos = (roomId: string) =>
  edge<PurgePhotosResult>('purge_photos', { room_id: roomId })
