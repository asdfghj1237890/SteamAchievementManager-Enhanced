import type { CSSProperties, ReactNode } from 'react'
import { segBase, segOn } from '../../lib/styles'
import { useHover } from '../../lib/useHover'

interface SegProps {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  style?: CSSProperties
  title?: string
}

/** Segmented / pill button matching the design's segBase / segOn styling, with a subtle hover. */
export default function Seg({ active = false, onClick, children, style, title }: SegProps) {
  const { hover, hoverProps } = useHover()
  const merged: CSSProperties = { ...(active ? segOn : segBase), ...style }
  if (hover) {
    if (active) {
      merged.filter = 'brightness(1.06)'
    } else {
      merged.color = 'var(--t1)'
      merged.borderColor = 'color-mix(in srgb, var(--accent) 35%, var(--bd))'
    }
  }
  return (
    <button type="button" title={title} onClick={onClick} style={merged} {...hoverProps}>
      {children}
    </button>
  )
}
