/**
 * Server clock offset.
 *
 * The server is the source of truth for round time. The client fetches
 * server_now once (per contract client polling guide) and keeps the offset so
 * local ticks between polls stay aligned with the server clock.
 */

import { serverNow } from '@/api'

let offsetMs = 0
let fetched = false

/** Pure: serverNow - localNow (ms). */
export function computeServerOffset(serverNowMs: number, localNowMs: number): number {
  return serverNowMs - localNowMs
}

/**
 * Fetch server_now once and cache the offset. Subsequent calls return the
 * cached offset without hitting the API.
 */
export async function fetchServerOffset(): Promise<number> {
  if (fetched) return offsetMs
  const result = await serverNow()
  offsetMs = computeServerOffset(result.now, Date.now())
  fetched = true
  return offsetMs
}

/** Current server time in ms (local clock + cached offset). */
export function getServerNowMs(): number {
  return Date.now() + offsetMs
}

/** True once server_now has been fetched at least once. */
export function hasServerOffset(): boolean {
  return fetched
}
