import { describe, expect, it } from 'vitest'
import {
  outOfBoundsBanner,
  proximityColor,
  proximityHint,
  proximityLabel,
  proximityVibrate,
} from './proximity'

describe('proximityLabel', () => {
  it('labels every band and unknown', () => {
    expect(proximityLabel('far')).toBe('FAR')
    expect(proximityLabel('near')).toBe('NEAR')
    expect(proximityLabel('close')).toBe('CLOSE')
    expect(proximityLabel('unknown')).toBe('UNKNOWN')
    expect(proximityLabel(undefined)).toBe('UNKNOWN')
  })
})

describe('proximityColor', () => {
  it('maps bands to colours', () => {
    expect(proximityColor('far')).toBe('bg-emerald-500')
    expect(proximityColor('near')).toBe('bg-amber-500')
    expect(proximityColor('close')).toBe('bg-red-500')
    expect(proximityColor('unknown')).toBe('bg-slate-400')
  })
})

describe('proximityVibrate', () => {
  it('vibrates only at close', () => {
    expect(proximityVibrate('close')).toBe(true)
    expect(proximityVibrate('near')).toBe(false)
    expect(proximityVibrate('far')).toBe(false)
    expect(proximityVibrate('unknown')).toBe(false)
  })
})

describe('proximityHint', () => {
  it('describes each band without distances', () => {
    expect(proximityHint('far')).toContain('far')
    expect(proximityHint('near')).toContain('near')
    expect(proximityHint('close')).toContain('close')
    expect(proximityHint('unknown')).toContain('No fresh reading')
  })
})

describe('outOfBoundsBanner', () => {
  it('is hidden while in bounds', () => {
    expect(outOfBoundsBanner(0)).toEqual({ show: false, graceLeft: 0, revealIn: 0 })
    expect(outOfBoundsBanner(-5)).toEqual({ show: false, graceLeft: 0, revealIn: 0 })
  })

  it('shows the 20 s grace countdown', () => {
    expect(outOfBoundsBanner(10)).toEqual({ show: true, graceLeft: 10, revealIn: 50 })
    expect(outOfBoundsBanner(20)).toEqual({ show: true, graceLeft: 0, revealIn: 40 })
  })

  it('counts down to the 60 s penalty reveal', () => {
    expect(outOfBoundsBanner(30)).toEqual({ show: true, graceLeft: 0, revealIn: 30 })
    expect(outOfBoundsBanner(59.5)).toEqual({ show: true, graceLeft: 0, revealIn: 0.5 })
    expect(outOfBoundsBanner(120)).toEqual({ show: true, graceLeft: 0, revealIn: 0 })
  })
})
