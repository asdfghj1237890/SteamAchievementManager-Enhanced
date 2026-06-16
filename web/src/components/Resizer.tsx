import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useApp } from '../state/AppContext'
import { clampSidebar } from '../state/store'

// Drag handle straddling the sidebar / main divider. Negative margins let the
// 7px hot zone sit on top of the 1px border without taking real layout width,
// so resizing never nudges the content sideways.
export default function Resizer() {
  const { state, t, set } = useApp()
  const [active, setActive] = useState(false)

  const onMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = state.sidebarWidth
    setActive(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: globalThis.MouseEvent) => {
      set({ sidebarWidth: clampSidebar(startW + ev.clientX - startX) })
    }
    const onUp = () => {
      setActive(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={() => set({ sidebarWidth: 280 })}
      title={t('resizer.tooltip')}
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
