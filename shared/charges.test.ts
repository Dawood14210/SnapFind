import { describe, expect, it } from 'vitest'
import { getCharges } from './charges'

describe('getCharges', () => {
  it('is zero before the hunt starts', () => {
    expect(getCharges(0, 0)).toBe(0)
    expect(getCharges(-60, 0)).toBe(0)
  })

  it('grants 1 charge per 4 minutes of hunt time', () => {
    expect(getCharges(239, 0)).toBe(0)
    expect(getCharges(240, 0)).toBe(1)
    expect(getCharges(479, 0)).toBe(1)
    expect(getCharges(480, 0)).toBe(2)
    expect(getCharges(1199, 0)).toBe(4)
  })

  it('grants the extra charge once at 20:00', () => {
    expect(getCharges(1199, 0)).toBe(4)
    expect(getCharges(1200, 0)).toBe(6) // 5 base + 1 extra
    expect(getCharges(1440, 0)).toBe(7)
  })

  it('subtracts the charges spent', () => {
    expect(getCharges(480, 2)).toBe(0)
    expect(getCharges(480, 1)).toBe(1)
    expect(getCharges(1200, 3)).toBe(3)
  })

  it('never goes negative', () => {
    expect(getCharges(120, 5)).toBe(0)
    expect(getCharges(0, 99)).toBe(0)
  })
})
