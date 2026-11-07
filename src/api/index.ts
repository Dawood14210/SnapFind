/**
 * Snapfind API layer — the single frontend entry point for every RPC and
 * Edge Function in /docs/api-contract.md.
 */

export * from './types'
export { ApiError, isApiError } from './errors'
export * from './rpc'
export * from './edge'
