import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useApp } from '../state/AppContext'
import { useHover } from '../lib/useHover'
import { winClose, winMinimize, winToggleMaximize } from '../lib/appWindow'
import { isTauri } from '../data'
import BrandMark from './ui/BrandMark'

// Stop drag-region mousedown so the control still registers a click.
const noDrag = (e: MouseEvent) => e.stopPropagation()

function WinCtrl({
  icon, label, close = false, onClick,
}: {
  icon: ReactNode
  label: string
  close?: boolean
  onClick: () => void
}) {
  const { hover, hoverProps } = useHover()
  const style: CSSProperties = {
    width: '46px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    color: hover ? (close ? '#fff' : 'var(--t1)') : 'var(--t2)',
    background: hover ? (close ? '#e81123' : 'var(--s3)') : 'transparent',
    transition: 'background var(--m-fast), color var(--m-fast)',
  }
  return (
    <div style={style} {...hoverProps} onMouseDown={noDrag} onClick={onClick} role="button" aria-label={label}>
      {icon}
    </div>
  )
}

// All three controls share one 11×11 box and a 1px stroke so their proportions
// match (the old unicode glyphs — ─ ▢ ✕ — had mismatched metrics).
const winIcon = (paths: ReactNode): ReactNode => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" aria-hidden>
    {paths}
  </svg>
)

// macOS window-control metrics, measured from AppKit on macOS 26/27 with the unified
// toolbar macos_chrome.rs installs: 14pt buttons, 19pt leading inset, 9pt apart,
// centred in a 52pt toolbar row. The desktop app shows the real, native buttons; these
// only apply to the web demo's stand-ins and to the row height both share.
const MAC_BAR_H = 52
const MAC_DOT = 14
const MAC_DOT_INSET = 19
const MAC_DOT_GAP = 9

// Web-demo stand-ins for the traffic lights (decorative: there is no OS window to
// act on). Glyphs follow the native ones: ×, − and the zoom button's full-screen arrows.
const macGlyphs = {
  close: <path d="M4 4l6 6M10 4l-6 6" strokeWidth="1.3" strokeLinecap="round" />,
  minimize: <path d="M3.5 7h7" strokeWidth="1.3" strokeLinecap="round" />,
  zoom: (
    <g stroke="none">
      <path d="M4 4h4.6L4 8.6z" />
      <path d="M10 10H5.4L10 5.4z" />
    </g>
  ),
}

function MacDot({ bg, ink, glyph, show }: { bg: string; ink: string; glyph: keyof typeof macGlyphs; show: boolean }) {
  return (
    <span
      style={{
        width: `${MAC_DOT}px`, height: `${MAC_DOT}px`, borderRadius: '50%', background: bg,
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.14)', display: 'flex',
      }}
    >
      <svg
        width={MAC_DOT} height={MAC_DOT} viewBox="0 0 14 14" fill={ink} stroke={ink}
        style={{ opacity: show ? 1 : 0, transition: 'opacity var(--m-fast)' }}
      >
        {macGlyphs[glyph]}
      </svg>
    </span>
  )
}

export default function TitleBar() {
  const { state, t, activeGame } = useApp()
  const loc = useLocation()
  const { hover: dotsHover, hoverProps: dotsHoverProps } = useHover()
  const isMac = state.platform !== 'windows'

  const app = t('app.name')
  const title = loc.pathname.startsWith('/settings')
    ? `${app} — ${t('nav.settings')}`
    : loc.pathname.startsWith('/game/')
      ? `${app}  —  ${activeGame?.name ?? ''}`
      : `${app} — ${t('nav.library')}`

  if (isMac) {
    return (
      <div
        data-tauri-drag-region=""
        style={{
          // +1: the row itself is MAC_BAR_H, the bottom border sits below it.
          height: `${MAC_BAR_H + 1}px`, flex: '0 0 auto', display: 'flex', alignItems: 'center',
          paddingLeft: `${MAC_DOT_INSET}px`, background: 'var(--win)', borderBottom: '1px solid var(--bd)',
          position: 'relative',
        }}
      >
        {/* In the desktop app AppKit draws the real traffic lights over this row. */}
        {!isTauri() && (
          <div aria-hidden style={{ display: 'flex', gap: `${MAC_DOT_GAP}px` }} {...dotsHoverProps}>
            <MacDot bg="#ff5f57" ink="#4d0000" glyph="close" show={dotsHover} />
            <MacDot bg="#febc2e" ink="#995700" glyph="minimize" show={dotsHover} />
            <MacDot bg="#28c840" ink="#006500" glyph="zoom" show={dotsHover} />
          </div>
        )}
        <div
          style={{
            position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: '12.5px',
            fontWeight: 600, color: 'var(--t2)', pointerEvents: 'none',
          }}
        >
          {title}
        </div>
      </div>
    )
  }

  return (
    <div
      data-tauri-drag-region=""
      style={{
        height: '40px', flex: '0 0 auto', display: 'flex', alignItems: 'stretch',
        justifyContent: 'space-between', background: 'var(--win)', borderBottom: '1px solid var(--bd)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '9px', paddingLeft: '13px', minWidth: 0,
          flex: 1, overflow: 'hidden', pointerEvents: 'none',
        }}
      >
        <BrandMark size={18} />
        <span
          style={{
            fontSize: '12px', fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ display: 'flex' }}>
        <WinCtrl
          label={t('a11y.minimize')}
          onClick={winMinimize}
          icon={winIcon(<line x1="1" y1="5.5" x2="10" y2="5.5" strokeWidth="1" />)}
        />
        <WinCtrl
          label={t('a11y.maximize')}
          onClick={winToggleMaximize}
          icon={winIcon(<rect x="1" y="1" width="9" height="9" rx="0.5" strokeWidth="1" />)}
        />
        <WinCtrl
          label={t('a11y.close')}
          close
          onClick={winClose}
          icon={winIcon(
            <>
              <line x1="1.4" y1="1.4" x2="9.6" y2="9.6" strokeWidth="1.1" />
              <line x1="9.6" y1="1.4" x2="1.4" y2="9.6" strokeWidth="1.1" />
            </>,
          )}
        />
      </div>
    </div>
  )
}
