import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useApp } from '../state/AppContext'
import { clampSidebar } from '../state/store'
import { applySidebarWidth } from '../lib/sidebarWidth'

// Drag handle straddling the sidebar / main divider. Negative margins let the
// 7px hot zone sit on top of the 1px border without taking real layout width,
// so resizing never nudges the content sideways.
export default function Resizer() {
  const { state, t, set } = useApp()
  const [active, setActive] = useState(false)
  // Live width during a drag. Written straight to the CSS var (no dispatch per
  // mousemove, which re-rendered the whole app and persisted settings each time);
  // committed to state once on mouseup.
  const liveWidth = useRef(state.sidebarWidth)

  const onMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = state.sidebarWidth
    liveWidth.current = startW
    setActive(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: globalThis.MouseEvent) => {
      const next = clampSidebar(startW + ev.clientX - startX)
      if (next === liveWidth.current) return
      liveWidth.current = next
      applySidebarWidth(next)
    }
    const onUp = () => {
      setActive(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (liveWidth.current !== startW) set({ sidebarWidth: liveWidth.current })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={() => set({ sidebarWidth: 280 })}
      onKeyDown={(e) => {
        let next = state.sidebarWidth
        if (e.key === 'ArrowLeft') next -= 8
        else if (e.key === 'ArrowRight') next += 8
        else if (e.key === 'Home') next = 220
        else if (e.key === 'End') next = 520
        else return
        e.preventDefault()
        set({ sidebarWidth: clampSidebar(next) })
      }}
      title={t('resizer.tooltip')}
      role="separator"
      tabIndex={0}
      aria-label={t('resizer.tooltip')}
      aria-orientation="vertical"
      aria-valuemin={220}
      aria-valuemax={520}
      aria-valuenow={state.sidebarWidth}
      style={{
        width: '7px',
        margin: '0 -3px',
        zIndex: 6,
        flex: '0 0 auto',
        cursor: 'col-resize',
        alignSelf: 'stretch',
        background: active ? 'var(--accent)' : 'transparent',
        transition: 'background .12s',
      }}
    />
  )
}
