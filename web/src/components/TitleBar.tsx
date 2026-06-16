import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import { useHover } from '../lib/useHover'
import { winClose, winMinimize, winToggleMaximize } from '../lib/appWindow'
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
    transition: 'background .12s, color .12s',
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

function MacDot({
  bg, glyph, show, onClick,
}: {
  bg: string
  glyph: string
  show: boolean
  onClick: () => void
}) {
  return (
    <span
      onMouseDown={noDrag}
      onClick={onClick}
      style={{
        width: '12px', height: '12px', borderRadius: '50%', background: bg, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span
        style={{
          fontSize: '10px', fontWeight: 900, lineHeight: 1, color: 'rgba(0,0,0,.72)',
          opacity: show ? 1 : 0, transition: 'opacity .12s', pointerEvents: 'none',
        }}
      >
        {glyph}
      </span>
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
          height: '44px', flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '0 16px',
          background: 'var(--win)', borderBottom: '1px solid var(--bd)', position: 'relative',
        }}
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} {...dotsHoverProps}>
          <MacDot bg="#ff5f57" glyph="✕" show={dotsHover} onClick={winClose} />
          <MacDot bg="#febc2e" glyph="−" show={dotsHover} onClick={winMinimize} />
          <MacDot bg="#28c840" glyph="+" show={dotsHover} onClick={winToggleMaximize} />
        </div>
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
          label="Minimize"
          onClick={winMinimize}
          icon={winIcon(<line x1="1" y1="5.5" x2="10" y2="5.5" strokeWidth="1" />)}
        />
        <WinCtrl
          label="Maximize"
          onClick={winToggleMaximize}
          icon={winIcon(<rect x="1" y="1" width="9" height="9" rx="0.5" strokeWidth="1" />)}
        />
        <WinCtrl
          label="Close"
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
