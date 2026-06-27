import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { averagePct, visibleSummaries } from '../lib/library'
import { coverGradient } from '../lib/styles'
import { useHover } from '../lib/useHover'
import { useVirtualScroll, virtualGridRange } from '../lib/virtual'
import type { GameSummary } from '../types'
import { ErrorPane, LoadingPane } from './Panes'
import Cover from './ui/Cover'

const CARD_MIN_WIDTH = 232
const CARD_HEIGHT = 214
const GRID_GAP = 16
const HORIZONTAL_PADDING = 48

function LibraryCard({ g }: { g: GameSummary }) {
  const { t, selectGame, completionFor } = useApp()
  const { hover, hoverProps } = useHover()
  const c = completionFor(g.appId)
  const pct = c?.pct ?? 0

  const cardStyle: CSSProperties = {
    display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)', overflow: 'hidden',
    border: '1px solid ' + (hover ? 'color-mix(in srgb, var(--accent) 42%, var(--bd))' : 'var(--bd)'),
    background: 'var(--s2)', cursor: 'pointer', boxShadow: 'var(--elev)',
    transition: 'border-color .15s, transform .15s', transform: hover ? 'translateY(-2px)' : 'none',
    height: CARD_HEIGHT, boxSizing: 'border-box',
  }
  const capsuleStyle: CSSProperties = {
    height: '108px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'rgba(255,255,255,.92)', fontSize: '38px', fontWeight: 800, letterSpacing: '1px',
    textShadow: '0 2px 8px rgba(0,0,0,.45)', position: 'relative',
    fontFamily: "'IBM Plex Sans','Noto Sans TC',sans-serif", background: coverGradient(g.hue),
  }
  const fillStyle: CSSProperties = {
    width: pct + '%', height: '100%', borderRadius: '999px',
    background: 'linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 50%, var(--good)))',
    transition: 'width .3s',
  }

  return (
    <div style={cardStyle} onClick={() => selectGame(g.appId)} {...hoverProps}>
      <Cover appId={g.appId} style={capsuleStyle}>
        {g.name[0]}
        <span style={{ position: 'absolute', bottom: '7px', right: '10px', fontSize: '8.5px', letterSpacing: '1px', fontFamily: 'var(--meta)', color: 'rgba(255,255,255,.5)' }}>
          {t('common.placeholder')}
        </span>
      </Cover>
      <div style={{ padding: '12px 14px 14px' }}>
        <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {g.name}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--t3)', marginTop: '3px' }}>{g.genre}</div>
        <div style={{ height: '5px', borderRadius: '999px', background: 'var(--s3)', overflow: 'hidden', margin: '12px 0 8px' }}>
          <div style={fillStyle} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--meta)', color: 'var(--t1)' }}>{pct}%</span>
          <span style={{ fontSize: '11px', color: 'var(--t3)', fontFamily: 'var(--meta)' }}>
            {c ? t('lib.achCount', { earned: c.earned, total: c.total }) : t('lib.achievements')}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Library() {
  const { games, state, t } = useApp()
  const virtual = useVirtualScroll()

  if (state.gamesStatus === 'loading' || state.gamesStatus === 'idle') {
    return <LoadingPane label={t('lib.loading')} />
  }
  if (state.gamesStatus === 'error') {
    return <ErrorPane msg={state.gamesError} />
  }

  const visible = visibleSummaries(games, state.typeFilter, state.gameSearch)
  const libAvg = averagePct(visible)
  const grid = virtualGridRange(
    visible.length,
    Math.max(0, virtual.metrics.viewportWidth - HORIZONTAL_PADDING),
    CARD_MIN_WIDTH,
    CARD_HEIGHT,
    GRID_GAP,
    virtual.metrics.viewportHeight,
    virtual.metrics.scrollTop,
    3,
  )
  const visibleCards = visible.slice(grid.start, grid.end)

  return (
    <div
      ref={virtual.containerRef}
      onScroll={virtual.onScroll}
      style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 26px', minHeight: 0 }}
    >
      <div style={{ marginBottom: '18px' }}>
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, letterSpacing: '-.3px', color: 'var(--t1)' }}>{t('nav.library')}</h2>
        <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--t2)' }}>
          {t('lib.subtitle', { n: visible.length, avg: libAvg })}
        </p>
      </div>
      {visible.length > 0 ? (
        <div style={{ height: grid.totalHeight, position: 'relative' }}>
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              transform: `translateY(${grid.offsetY}px)`,
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill,minmax(${CARD_MIN_WIDTH}px,1fr))`,
              gap: GRID_GAP,
            }}
          >
            {visibleCards.map((g) => (
              <LibraryCard key={g.id} g={g} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--t3)' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.5 }}>⌕</div>
          <div style={{ fontSize: '14px' }}>{t('lib.empty')}</div>
        </div>
      )}
    </div>
  )
}
