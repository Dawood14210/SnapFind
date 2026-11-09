/**
 * Snapfind — ability charge math (Phase 6).
 *
 * Backend owns this file; the frontend imports it and must never edit it.
 * Pure function of (hunt time in seconds, charges already spent): 1 charge
 * per ABILITY_CHARGE_INTERVAL_SEC of hunt time, plus 1 once the round
 * reaches ABILITY_EXTRA_CHARGE_AT_ROUND_SEC, minus spent. Shared by the
 * use_ability Edge Function (server-side charge check) and the finder's
 * charge meter (frontend).
 */

import {
  ABILITY_CHARGE_INTERVAL_SEC,
  ABILITY_EXTRA_CHARGE_AT_ROUND_SEC,
} from './constants.ts'

/** Ability charges available at a given hunt time, minus the spent ones. */
export function getCharges(huntSeconds: number, spent: number): number {
  const base = Math.floor(huntSeconds / ABILITY_CHARGE_INTERVAL_SEC)
  const extra = huntSeconds >= ABILITY_EXTRA_CHARGE_AT_ROUND_SEC ? 1 : 0
  return Math.max(0, base + extra - spent)
}

export { ABILITY_CHARGE_INTERVAL_SEC, ABILITY_EXTRA_CHARGE_AT_ROUND_SEC }
