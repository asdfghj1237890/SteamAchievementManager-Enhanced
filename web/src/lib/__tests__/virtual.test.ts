import { describe, expect, it } from 'vitest'
import { virtualGridRange, virtualRange } from '../virtual'

describe('virtualRange', () => {
  it('keeps the visible slice within bounds with overscan', () => {
    expect(virtualRange(100, 20, 100, 200, 2)).toEqual({
      start: 8,
      end: 17,
      offsetY: 160,
      totalHeight: 2000,
    })
  })

  it('handles empty input', () => {
    expect(virtualRange(0, 20, 100, 0)).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 })
  })
})

describe('virtualGridRange', () => {
  it('returns full-row slices for a responsive grid', () => {
    expect(virtualGridRange(50, 760, 232, 214, 16, 430, 460, 1)).toEqual({
      start: 3,
      end: 15,
      offsetY: 230,
      totalHeight: 3894,
      columns: 3,
    })
  })
})
