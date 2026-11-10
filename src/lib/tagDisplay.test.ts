import { describe, expect, it } from 'vitest'
import { tagSecondsLeft } from './tagDisplay'

describe('tagSecondsLeft', () => {
  const created = '2026-11-07T00:00:00Z'
  const start = Date.parse(created)
  it('starts with ten seconds', () => expect(tagSecondsLeft(created, start)).toBe(10))
  it('rounds up partial seconds', () => expect(tagSecondsLeft(created, start + 9500)).toBe(1))
  it('stops at zero', () => expect(tagSecondsLeft(created, start + 15000)).toBe(0))
  it('handles malformed timestamps', () => expect(tagSecondsLeft('invalid', start)).toBe(0))
})
