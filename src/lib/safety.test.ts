import { afterEach, describe, expect, it, vi } from 'vitest'
import { freshForSos, holdForSos, outsideDaylight } from './safety'
afterEach(() => vi.useRealTimers())
describe('safety controls', () => {
  it('requires the full two-second hold', () => {
    vi.useFakeTimers(); const send = vi.fn(); holdForSos(send)
    vi.advanceTimersByTime(1999); expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1); expect(send).toHaveBeenCalledTimes(1)
  })
  it('cancels a short hold', () => {
    vi.useFakeTimers(); const send = vi.fn(); const cancel = holdForSos(send)
    vi.advanceTimersByTime(1000); cancel(); vi.advanceTimersByTime(2000)
    expect(send).not.toHaveBeenCalled()
  })
  it('rejects stale, invalid and future readings', () => {
    expect(freshForSos(10_000, 40_000)).toBe(true)
    expect(freshForSos(10_000, 40_001)).toBe(false)
    expect(freshForSos(NaN, 40_000)).toBe(false)
    expect(freshForSos(50_000, 40_000)).toBe(false)
  })
  it('distinguishes equatorial midday and midnight', () => {
    expect(outsideDaylight(Date.parse('2026-03-20T12:00:00Z'), 0, 0)).toBe(false)
    expect(outsideDaylight(Date.parse('2026-03-20T00:00:00Z'), 0, 0)).toBe(true)
  })
})
