import type { CSSProperties, MouseEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import { useHover } from '../lib/useHover'
import { winClose, winMinimize, winToggleMaximize } from '../lib/appWindow'

// Stop drag-region mousedown so the control still registers a click.
const noDrag = (e: MouseEvent) => e.stopPropagation()

function WinCtrl({
  glyph, fontSize, close = false, onClick,
}: {
  glyph: string
  fontSize: string
  close?: boolean
  onClick: () => void
}) {
  const { hover, hoverProps } = useHover()
  const style: CSSProperties = {
    width: '46px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    fontSize,
    color: hover ? (close ? '#fff' : 'var(--t1)') : 'var(--t2)',
    background: hover ? (close ? '#e81123' : 'var(--s3)') : 'transparent',
    transition: 'background .12s, color .12s',
  }
  return (
    <div style={style} {...hoverProps} onMouseDown={noDrag} onClick={onClick}>
      {glyph}
    </div>
  )
}

function MacDot({ bg, onClick }: { bg: string; onClick: () => void }) {
  return (
    <span
      onMouseDown={noDrag}
      onClick={onClick}
      style={{ width: '12px', height: '12px', borderRadius: '50%', background: bg, cursor: 'pointer' }}
    />
  )
}

export default function TitleBar() {
  const { state, t, activeGame } = useApp()
  const loc = useLocation()
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <MacDot bg="#ff5f57" onClick={winClose} />
          <MacDot bg="#febc2e" onClick={winMinimize} />
          <MacDot bg="#28c840" onClick={winToggleMaximize} />
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
        <div
          style={{
            width: '16px', height: '16px', borderRadius: '4px', background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            fontSize: '9px', fontWeight: 800, flex: '0 0 auto',
          }}
        >
          ★
        </div>
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
        <WinCtrl glyph="─" fontSize="14px" onClick={winMinimize} />
        <WinCtrl glyph="▢" fontSize="11px" onClick={winToggleMaximize} />
        <WinCtrl glyph="✕" fontSize="13px" close onClick={winClose} />
      </div>
    </div>
  )
}
