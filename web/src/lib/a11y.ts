import type { KeyboardEvent } from 'react'

/**
 * Make a non-`<button>` element (a styled `<div>`) operable by keyboard as well as
 * mouse: spread the result onto the element alongside `role="button"` and
 * `tabIndex={0}`. Enter/Space fire the same action as a click.
 */
export function activate(fn: () => void) {
  return {
    onClick: fn,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        fn()
      }
    },
  }
}
