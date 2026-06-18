import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { completion, filteredAch, pendingCount, type BulkMode } from '../lib/achievements'
import { enrichAchievement } from '../lib/achievementView'
import type { I18nKey } from '../i18n'
import type { AchFilter, AchSort, ViewMode } from '../types'
import Seg from './ui/Seg'
import AchIcon from './ui/AchIcon'

const VIEW_BTNS: [ViewMode, I18nKey][] = [['grid', 'view.grid'], ['list', 'view.list']]
const BULK_BTNS: [BulkMode, I18nKey][] = [['unlock', 'bulk.unlock'], ['lock', 'bulk.lock'], ['invert', 'bulk.invert']]
const SORT_OPTS: [AchSort, I18nKey][] = [
  ['default', 'sort.default'], ['rarity', 'sort.rarity'], ['common', 'sort.common'],
  ['name', 'sort.name'], ['unlock', 'sort.unlock'],
]

export default function Achievements() {
  const { state, t, activeGame: g, set, bulk, store, toggleAch } = useApp()
  if (!g) return null

  const { total } = completion(g, state.achState)
  const filtered = filteredAch(g, state.achState, state.origAch, state.filter, state.achSearch, state.sort)
  const savedMap = state.origAch[g.id] ?? {}
  const views = filtered.map((a) => enrichAchievement(g, a, t, !!savedMap[a.id]))
  const pending = pendingCount(g, state.achState, state.origAch, state.statState, state.origStat)

  // Counts reflect the SAVED partition, matching what each filter actually shows.
  const savedUnlockedCount = g.achievements.reduce(
    (n, a) => n + ((a.id in savedMap ? savedMap[a.id] : a.unlocked) ? 1 : 0),
    0,
  )
  const FILTER_BTNS: [AchFilter, string][] = [
    ['all', t('filter.all', { n: total })],
    ['unlocked', t('filter.unlocked', { n: savedUnlockedCount })],
    ['locked', t('filter.locked', { n: total - savedUnlockedCount })],
  ]

  const storeStyle: CSSProperties = {
    padding: '8px 18px', borderRadius: 'var(--radius)',
    border: '1px solid ' + (pending > 0 ? 'var(--accent)' : 'var(--bd)'),
    background: pending > 0 ? 'var(--accent)' : 'var(--s2)', color: pending > 0 ? '#fff' : 'var(--t3)',
    cursor: pending > 0 ? 'pointer' : 'default', fontSize: '13px', fontWeight: 700, fontFamily: 'inherit',
    boxShadow: pending > 0 ? '0 4px 14px -4px var(--accent)' : 'none', transition: 'all .15s',
  }

  return (
    <>
      {/* toolbar — pinned just below the sticky tab bar */}
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'sticky', top: 'var(--tabbar-h, 40px)', zIndex: 4, background: 'var(--s0)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 11px', borderRadius: 'var(--radius)', background: 'var(--s2)', border: '1px solid var(--bd)', minWidth: '180px' }}>
          <span style={{ color: 'var(--t3)', fontSize: '13px' }}>⌕</span>
          <input
            value={state.achSearch}
            onChange={(e) => set({ achSearch: e.target.value })}
            placeholder={t('ach.search')}
            style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--t1)', fontSize: '13px', outline: 'none', width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {FILTER_BTNS.map(([k, label]) => (
            <Seg key={k} active={state.filter === k} onClick={() => set({ filter: k })} style={{ padding: '6px 12px', boxShadow: 'none' }}>
              {label}
            </Seg>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ color: 'var(--t3)', fontSize: '14px' }} aria-hidden>⇅</span>
          <select
            value={state.sort}
            onChange={(e) => set({ sort: e.target.value as AchSort })}
            title={t('ach.sortBy')}
            aria-label={t('ach.sortBy')}
            style={{
              padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--bd)',
              background: 'var(--s2)', color: 'var(--t1)', fontSize: '12.5px', fontFamily: 'inherit',
              cursor: 'pointer', outline: 'none',
            }}
          >
            {SORT_OPTS.map(([k, key]) => (
              <option key={k} value={k}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: '6px' }}>
          {BULK_BTNS.map(([mode, label]) => (
            <Seg key={mode} onClick={() => bulk(mode)} style={{ padding: '7px 12px', color: 'var(--t1)' }}>
              {t(label)}
            </Seg>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {VIEW_BTNS.map(([k, label]) => (
            <Seg key={k} active={state.view === k} onClick={() => set({ view: k })} style={{ padding: '6px 13px', boxShadow: 'none' }}>
              {t(label)}
            </Seg>
          ))}
        </div>
        <button onClick={store} style={storeStyle}>
          {pending > 0 ? t('ach.saveN', { n: pending }) : t('ach.save')}
        </button>
      </div>

      {/* content */}
      <div style={{ padding: '0 22px 22px' }}>
        {state.view === 'grid' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(var(--cardmin,224px),1fr))', gap: 'var(--gap,12px)' }}>
            {views.map((ach) => (
              <div key={ach.id} style={ach.cardStyle}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <AchIcon url={ach.iconUrl} style={ach.iconGrid} letter={ach.icon} />
                  <div style={{ flex: 1, minWidth: 0, paddingTop: '1px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)', lineHeight: 1.25 }}>{ach.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--t2)', marginTop: '4px', lineHeight: 1.4, textWrap: 'pretty' } as CSSProperties}>
                      {ach.desc}
                    </div>
                  </div>
                  <div style={ach.checkStyle} onClick={() => toggleAch(g.id, ach.id, ach.protected)}>
                    {ach.check}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 8px', marginTop: 'auto' }}>
                  <span style={ach.stateStyle}>{ach.stateText}</span>
                  {ach.showBadge && <span style={ach.badgeStyle}>{ach.badgeText}</span>}
                  <span style={{ marginLeft: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap', fontSize: '11px', color: 'var(--t3)', fontFamily: 'var(--meta)' }}>{ach.rarityText}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {state.view === 'list' && (
          <div style={{ border: '1px solid var(--bd)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--s2)' }}>
            {views.map((ach) => (
              <div key={ach.id} style={ach.rowStyle} onClick={() => toggleAch(g.id, ach.id, ach.protected)}>
                <div style={ach.checkStyle}>{ach.check}</div>
                <AchIcon url={ach.iconUrl} style={ach.iconList} letter={ach.icon} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ach.name}</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ach.desc}</div>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--t3)', fontFamily: 'var(--meta)', minWidth: '78px', textAlign: 'right', flex: '0 0 auto', whiteSpace: 'nowrap' }}>{ach.rarityText}</span>
                <span style={ach.stateStyle}>{ach.stateText}</span>
              </div>
            ))}
          </div>
        )}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--t3)' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px', opacity: 0.5 }}>⌕</div>
            <div style={{ fontSize: '14px' }}>{t('ach.empty')}</div>
          </div>
        )}
        <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--t3)', fontFamily: 'var(--meta)', marginTop: '16px' }}>
          {t('ach.showing', { n: filtered.length, total })}
        </div>
      </div>
    </>
  )
}
