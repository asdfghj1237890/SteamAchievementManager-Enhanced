import type { CSSProperties } from 'react'
import { useLocation } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import { visibleSummaries } from '../lib/library'
import { useVirtualScroll, virtualRange } from '../lib/virtual'
import type { I18nKey } from '../i18n'
import type { GameSummary, TypeFilter } from '../types'
import Seg from './ui/Seg'
import Cover from './ui/Cover'

const TYPE_CHIPS: [TypeFilter, I18nKey][] = [
  ['all', 'type.all'], ['normal', 'type.normal'], ['demo', 'type.demo'], ['mod', 'type.mod'],
]

// Sentinel category-filter value for "in no category".
const UNCATEGORIZED = '__sam_uncategorized__'
const ROW_ITEM_HEIGHT = 55
const ROW_GAP = 3
const ROW_HEIGHT = ROW_ITEM_HEIGHT + ROW_GAP

function sidebarCover(hue: number): string {
  return (
    `repeating-linear-gradient(118deg, rgba(255,255,255,.08) 0 2px, transparent 2px 10px), ` +
    `linear-gradient(135deg, hsl(${hue} 56% 50%), hsl(${(hue + 32) % 360} 60% 37%))`
  )
}

export default function Sidebar() {
  const { games, state, t, set, selectGame, openLibrary, openSettings, refresh, showToast, completionFor } = useApp()
  const loc = useLocation()

  const routeMatch = loc.pathname.match(/^\/game\/([^/]+)/)
  const routeAppId = routeMatch ? decodeURIComponent(routeMatch[1]) : null
  const onLibrary = loc.pathname === '/'
  const onSettings = loc.pathname.startsWith('/settings')

  // Auto-hide empty type categories: only show a chip for a type you actually own,
  // and hide the whole row when everything is one type (then 全部 == that type).
  const presentTypes = new Set<string>(games.map((g) => g.type))
  const showTypeChips = presentTypes.size > 1
  const effectiveType: TypeFilter =
    state.typeFilter !== 'all' && !presentTypes.has(state.typeFilter) ? 'all' : state.typeFilter
  const visible = visibleSummaries(games, effectiveType, state.gameSearch)

  // The player's own Steam library categories (from sharedconfig.vdf) — filter on top.
  const catNames = [...new Set(Object.values(state.categories).flat())].sort((a, b) => a.localeCompare(b))
  const shown =
    state.categoryFilter === 'all'
      ? visible
      : state.categoryFilter === UNCATEGORIZED
        ? visible.filter((g) => (state.categories[g.appId] ?? []).length === 0)
        : visible.filter((g) => (state.categories[g.appId] ?? []).includes(state.categoryFilter))
  const virtual = useVirtualScroll()
  const rows = virtualRange(shown.length, ROW_HEIGHT, virtual.metrics.viewportHeight, virtual.metrics.scrollTop, 8)
  const visibleRows = shown.slice(rows.start, rows.end)

  const inputBase: CSSProperties = {
    flex: 1, border: 'none', background: 'transparent', color: 'var(--t1)', fontSize: '13px',
    outline: 'none', width: '100%',
  }

  // Open any app id. If it isn't in the scanned library, add a provisional row
  // (its real name fills in once the detail loads) so it shows up and the game
  // screen doesn't bounce it back to the library.
  const onAdd = () => {
    const v = state.addId.trim()
    if (!/^\d+$/.test(v)) {
      showToast(t('toast.invalidAppId'))
      return
    }
    set((s) => {
      if (s.games.some((g) => g.appId === v || g.id === v)) return { addId: '' }
      const summary: GameSummary = {
        appId: v, id: v, name: v, genre: '', type: 'normal', hue: (Number(v) * 47) % 360, manual: true,
      }
      return { addId: '', games: [...s.games, summary] }
    })
    selectGame(v)
  }

  const row = (g: GameSummary) => {
    const selected = routeAppId === g.appId
    const c = completionFor(g.appId)
    const pct = c?.pct ?? 0
    const rowStyle: CSSProperties = {
      display: 'flex', alignItems: 'center', gap: '11px', padding: '9px 10px', borderRadius: 'var(--radius)',
      cursor: 'pointer', height: ROW_ITEM_HEIGHT, boxSizing: 'border-box',
      border: '1px solid ' + (selected ? 'color-mix(in srgb, var(--accent) 45%, var(--bd))' : 'transparent'),
      background: selected ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'transparent',
      transition: 'background .15s',
    }
    const coverStyle: CSSProperties = {
      width: '80px', height: '37px', borderRadius: '5px', flex: '0 0 auto', position: 'relative',
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800,
      fontSize: '17px', color: 'rgba(255,255,255,.92)', textShadow: '0 1px 3px rgba(0,0,0,.45)',
      letterSpacing: '.5px', border: '1px solid rgba(255,255,255,.12)', background: sidebarCover(g.hue),
      fontFamily: "'IBM Plex Sans','Noto Sans TC',sans-serif",
    }
    const barStyle: CSSProperties = {
      width: pct + '%', height: '100%', borderRadius: '999px',
      background: selected ? 'var(--accent)' : 'var(--t3)', transition: 'width .3s',
    }
    return (
      <div key={g.id} style={rowStyle} onClick={() => selectGame(g.appId)}>
        <Cover appId={g.appId} style={coverStyle}>{g.name[0]}</Cover>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {g.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' }}>
            <div style={{ flex: 1, height: '4px', borderRadius: '999px', background: 'var(--s3)', overflow: 'hidden' }}>
              <div style={barStyle} />
            </div>
            <span style={{ fontSize: '10.5px', color: 'var(--t3)', fontFamily: 'var(--meta)', whiteSpace: 'nowrap' }}>
              {c ? `${c.earned} / ${c.total}` : '—'}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <aside
      style={{
        width: state.sidebarWidth, flex: '0 0 auto', display: 'flex', flexDirection: 'column',
        background: 'var(--s1)', borderRight: '1px solid var(--bd)', minHeight: 0,
      }}
    >
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--bds)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '11px' }}>
          <span
            onClick={openLibrary}
            style={{
              fontSize: '12px', fontWeight: 700, letterSpacing: '.4px', cursor: 'pointer',
              fontFamily: 'var(--meta)', color: onLibrary ? 'var(--accent)' : 'var(--t2)',
            }}
          >
            ⊞ {t('nav.library')}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--t3)', fontFamily: 'var(--meta)' }}>
            {t('sidebar.count', { visible: shown.length, total: games.length })}
          </span>
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 11px',
            borderRadius: 'var(--radius)', background: 'var(--s0)', border: '1px solid var(--bd)',
          }}
        >
          <span style={{ color: 'var(--t3)', fontSize: '13px' }}>⌕</span>
          <input
            value={state.gameSearch}
            onChange={(e) => set({ gameSearch: e.target.value })}
            placeholder={t('sidebar.searchGames')}
            style={inputBase}
          />
        </div>
        {showTypeChips && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
            {TYPE_CHIPS.filter(([k]) => k === 'all' || presentTypes.has(k)).map(([k, label]) => (
              <Seg
                key={k}
                active={effectiveType === k}
                onClick={() => set({ typeFilter: k })}
                style={{ padding: '5px 11px', fontSize: '12px', boxShadow: 'none' }}
              >
                {t(label)}
              </Seg>
            ))}
          </div>
        )}
        {catNames.length > 0 && (
          <select
            value={state.categoryFilter}
            onChange={(e) => set({ categoryFilter: e.target.value })}
            aria-label={t('sidebar.allCategories')}
            style={{
              marginTop: '10px', width: '100%', padding: '7px 10px', borderRadius: 'var(--radius)',
              border: '1px solid var(--bd)', background: 'var(--s0)', color: 'var(--t1)',
              fontSize: '12.5px', fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="all">{t('sidebar.allCategories')}</option>
            <option value={UNCATEGORIZED}>{t('sidebar.uncategorized')}</option>
            {catNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        ref={virtual.containerRef}
        onScroll={virtual.onScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '8px', minHeight: 0 }}
      >
        {state.gamesStatus === 'loading' && (
          <div style={{ padding: '16px 10px', fontSize: '12px', color: 'var(--t3)', fontFamily: 'var(--meta)' }}>{t('sidebar.loadingList')}</div>
        )}
        {state.gamesStatus === 'error' && (
          <div style={{ padding: '16px 10px', fontSize: '12px', color: 'var(--danger)' }}>{t('sidebar.listError')}</div>
        )}
        {shown.length > 0 && (
          <div style={{ height: rows.totalHeight, position: 'relative' }}>
            <div
              style={{
                position: 'absolute', left: 0, right: 0, top: 0,
                transform: `translateY(${rows.offsetY}px)`,
                display: 'flex', flexDirection: 'column', gap: ROW_GAP,
              }}
            >
              {visibleRows.map(row)}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '11px 14px', borderTop: '1px solid var(--bds)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '7px' }}>
          <input
            value={state.addId}
            onChange={(e) => set({ addId: e.target.value })}
            placeholder={t('sidebar.addPlaceholder')}
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--bd)',
              background: 'var(--s0)', color: 'var(--t1)', fontSize: '12.5px', outline: 'none', fontFamily: 'var(--meta)',
            }}
          />
          <button
            onClick={onAdd}
            style={{
              padding: '7px 13px', borderRadius: 'var(--radius)', border: '1px solid var(--bd)',
              background: 'var(--s2)', color: 'var(--t1)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ＋
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={refresh}
            style={{
              flex: 1, padding: '8px', borderRadius: 'var(--radius)', border: '1px solid var(--bd)',
              background: 'transparent', color: 'var(--t2)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ↻ {t('sidebar.refresh')}
          </button>
          <button
            onClick={() => (onSettings ? openLibrary() : openSettings())}
            style={{
              padding: '8px 12px', borderRadius: 'var(--radius)', flex: '0 0 auto',
              border: '1px solid ' + (onSettings ? 'color-mix(in srgb, var(--accent) 45%, var(--bd))' : 'var(--bd)'),
              background: onSettings ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
              color: onSettings ? 'var(--accent)' : 'var(--t2)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ⚙ {t('sidebar.settings')}
          </button>
        </div>
      </div>
    </aside>
  )
}
