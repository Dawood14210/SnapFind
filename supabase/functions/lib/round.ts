/**
 * Snapfind — round-state bridge for Edge Functions.
 *
 * The round-state math lives in shared/roundState.ts (the single source of
 * truth, used by the frontend and matching the advance_round RPC). Edge
 * Functions re-export it so the `round` object in every response is identical
 * to the frontend's getRoundState output (contract parity).
 *
 * NOTE: shared/roundState.ts must keep its local imports extension-explicit
 * ('./constants.ts') so Deno can resolve them.
 */

export { getRoundState } from '../../../shared/roundState.ts'
export type { RoomView, RoundState, RoundPhase } from '../../../shared/roundState.ts'
