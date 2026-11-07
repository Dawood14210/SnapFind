/**
 * Typed API errors.
 *
 * The contract's error codes are matched as follows:
 * - RPCs (PostgREST): the contract code is the exception message, e.g.
 *   `ROOM_FULL`; `code` is PostgREST's SQLSTATE.
 * - Edge Functions: the contract code is `error.code` in the JSON envelope.
 */

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

/** Map a PostgREST RPC error to an ApiError (contract code = message). */
export function rpcErrorToApi(
  error: { message?: string; code?: string; detail?: string; hint?: string } | null,
): ApiError {
  const message = error?.message ?? 'RPC error'
  return new ApiError(message, message, 400)
}

/** Map an Edge Function error (or fetch failure) to an ApiError. */
export function edgeErrorToApi(error: unknown): ApiError {
  const err = error as {
    status?: number
    message?: string
    value?: { error?: { code?: string; message?: string } }
  }
  const envelope = err?.value?.error
  return new ApiError(
    envelope?.code ?? 'EDGE_ERROR',
    envelope?.message ?? err?.message ?? 'Edge function error',
    err?.status ?? 500,
  )
}
