import { describe, expect, it } from 'vitest'
import { computeServerOffset } from './clock'

describe('computeServerOffset', () => {
  it('is server minus local', () => {
    expect(computeServerOffset(1000, 900)).toBe(100)
    expect(computeServerOffset(900, 1000)).toBe(-100)
    expect(computeServerOffset(500, 500)).toBe(0)
  })
})
