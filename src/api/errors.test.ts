import { describe, it, expect } from 'vitest'
import { ApiError, edgeErrorToApi, rpcErrorToApi } from './errors'

describe('error mapping', () => {
  it('RPC errors carry the contract code (from the exception message)', () => {
    const err = rpcErrorToApi({ message: 'ROOM_FULL', code: 'P0001' })
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('ROOM_FULL')
    expect(err.status).toBe(400)
  })

  it('RPC errors fall back to a generic code', () => {
    const err = rpcErrorToApi(null)
    expect(err.code).toBe('RPC error')
    expect(err.status).toBe(400)
  })

  it('Edge errors unwrap the { error: { code, message } } envelope', () => {
    const err = edgeErrorToApi({
      status: 422,
      message: 'Edge function error',
      value: { error: { code: 'NOT_ENOUGH_CHARGES', message: 'No charges left' } },
    })
    expect(err.code).toBe('NOT_ENOUGH_CHARGES')
    expect(err.status).toBe(422)
  })

  it('Edge errors fall back when the envelope is missing', () => {
    const err = edgeErrorToApi(new Error('boom'))
    expect(err.code).toBe('EDGE_ERROR')
    expect(err.status).toBe(500)
  })
})
