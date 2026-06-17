import type { CSSProperties } from 'react'
import { Outlet } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'
import Resizer from './Resizer'
import Toast from './Toast'
import UpdateBanner from './UpdateBanner'

// The app *is* the window (the design's outer canvas framing is not part of it):
// custom title bar + sidebar + main, filling the whole OS/browser viewport.
export default function AppLayout() {
  const { rootVars } = useApp()
  const root: CSSProperties = {
    ...rootVars,
    height: '100vh',
    width: '100vw',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--win)',
    color: 'var(--t1)',
    fontFamily: "'IBM Plex Sans','Noto Sans TC',system-ui,sans-serif",
  }
  return (
    <div style={root}>
      <TitleBar />
      <UpdateBanner />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar />
        <Resizer />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--s0)', minWidth: 0, minHeight: 0 }}>
          <Outlet />
        </main>
      </div>
      <Toast />
    </div>
  )
}
