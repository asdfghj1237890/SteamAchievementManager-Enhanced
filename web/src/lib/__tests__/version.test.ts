import { describe, expect, it } from 'vitest'
import { isNewer } from '../version'

describe('isNewer', () => {
  it('detects a newer patch / minor / major', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true)
    expect(isNewer('1.2.0', '1.1.5')).toBe(true)
    expect(isNewer('2.0.0', '1.9.9')).toBe(true)
  })
  it('is false for equal or older', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', '1.0.1')).toBe(false)
  })
  it('ignores a leading v', () => {
    expect(isNewer('v1.2.0', '1.1.0')).toBe(true)
    expect(isNewer('v1.0.0', 'v1.0.0')).toBe(false)
  })
  it('treats a missing patch segment as 0', () => {
    expect(isNewer('1.0', '1.0.0')).toBe(false)
  })
  it('never reports an update for a malformed latest', () => {
    expect(isNewer('garbage', '1.0.0')).toBe(false)
  })
})
