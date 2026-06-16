import { useState } from 'react'

/**
 * Mirrors the design prototype's `style-hover` behavior: merge an extra style
 * object while the pointer is over the element (inline styles can't use :hover).
 */
export function useHover() {
  const [hover, setHover] = useState(false)
  return {
    hover,
    hoverProps: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
    },
  }
}
