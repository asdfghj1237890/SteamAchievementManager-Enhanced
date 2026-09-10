import { describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent } from 'react'
import { activate } from '../a11y'

const key = (k: string) => {
  const preventDefault = vi.fn()
  return { event: { key: k, preventDefault } as unknown as KeyboardEvent, preventDefault }
}

describe('activate', () => {
  it('fires on click and on Enter / Space, swallowing the key default', () => {
    const fn = vi.fn()
    const props = activate(fn)
    props.onClick()
    const enter = key('Enter')
    props.onKeyDown(enter.event)
    const space = key(' ')
    props.onKeyDown(space.event)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(enter.preventDefault).toHaveBeenCalledTimes(1)
    expect(space.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('ignores every other key so Tab and arrows keep their meaning', () => {
    const fn = vi.fn()
    const props = activate(fn)
    for (const k of ['Tab', 'ArrowDown', 'Escape', 'a']) {
      const other = key(k)
      props.onKeyDown(other.event)
      expect(other.preventDefault).not.toHaveBeenCalled()
    }
    expect(fn).not.toHaveBeenCalled()
  })
})
