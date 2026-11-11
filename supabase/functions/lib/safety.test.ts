import { describe, expect, it } from 'vitest'
import { validCoordinates } from './safety'
describe('SOS coordinates', () => {
  it('allows boundaries and zero', () => {
    expect(validCoordinates(-90, 180)).toBe(true)
    expect(validCoordinates(0, 0)).toBe(true)
  })
  it('rejects missing, nonfinite and out-of-range values', () => {
    for (const [lat, lng] of [[undefined, 0], [0, null], [NaN, 0], [0, Infinity], [91, 0], [0, -181], ['32', 74]]) expect(validCoordinates(lat, lng)).toBe(false)
  })
})
