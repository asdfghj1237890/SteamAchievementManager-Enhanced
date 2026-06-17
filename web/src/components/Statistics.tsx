import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'
import { segBase } from '../lib/styles'

export default function Statistics() {
  const { state, t, activeGame: g, set, setStat, resetStats, showToast } = useApp()
  if (!g) return null

  const sw = state.statState[g.id] ?? {}
  const so = state.origStat[g.id] ?? {}
  const statMod = g.stats.filter((s) => sw[s.id] !== so[s.id]).length

  const editToggleStyle: CSSProperties = state.statsEditing
    ? { ...segBase, padding: '8px 15px', background: 'color-mix(in srgb, var(--accent) 16%, transparent)', borderColor: 'var(--accent)', color: 'var(--accent)' }
    : { ...segBase, padding: '8px 15px', color: 'var(--t1)' }
  const resetStyle: CSSProperties = {
    ...segBase, padding: '8px 15px', color: 'var(--danger)',
    borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--bd))',
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: '0 0 auto' }}>
        <button onClick={() => set((s) => ({ statsEditing: !s.statsEditing }))} style={editToggleStyle}>
          {state.statsEditing ? '✓ ' + t('stats.editOn') : t('stats.editOff')}
        </button>
        <span style={{ fontSize: '12px', color: 'var(--t3)', fontFamily: 'var(--meta)' }}>
          {statMod > 0 ? t('stats.modifiedN', { n: statMod }) : t('stats.notModified')}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={resetStats} style={resetStyle}>
          ↺ {t('stats.resetAll')}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 22px 22px', minHeight: 0 }}>
        <div style={{ border: '1px solid var(--bd)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--s2)' }}>
          <div
            style={{
              display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.1fr', gap: '12px', padding: '11px 16px',
              background: 'var(--s1)', borderBottom: '1px solid var(--bd)', fontSize: '11px', fontWeight: 700,
              letterSpacing: '.5px', color: 'var(--t3)', fontFamily: 'var(--meta)',
            }}
          >
            <span>{t('stats.colName')}</span>
            <span>{t('stats.colValue')}</span>
            <span>{t('stats.colNote')}</span>
          </div>
          {g.stats.map((s) => {
            const cur = sw[s.id]
            const editable = state.statsEditing && !s.protected
            const modified = cur !== so[s.id]
            const rowStyle: CSSProperties = {
              display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.1fr', alignItems: 'center', gap: '12px',
              padding: '11px 16px', borderBottom: '1px solid var(--bds)',
              background: modified ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
            }
            const inputStyle: CSSProperties = {
              width: '120px', padding: '6px 9px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)',
              background: 'var(--s0)', color: 'var(--t1)', fontFamily: 'var(--meta)', fontSize: '13px', outline: 'none',
            }
            const valStyle: CSSProperties = {
              fontFamily: 'var(--meta)', fontSize: '13.5px', color: s.protected ? 'var(--t3)' : 'var(--t1)',
            }
            return (
              <div key={s.id} style={rowStyle}>
                <span style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--t1)' }}>{s.name}</span>
                <span>
                  {editable ? (
                    <input
                      value={String(cur)}
                      onChange={(e) => setStat(g.id, s.id, e.target.value)}
                      onBlur={() => {
                        // increment-only stats can only go up — revert an illegal decrease.
                        const floor = so[s.id] ?? 0
                        if (s.extra === 'increment_only' && Number(cur) < floor) {
                          setStat(g.id, s.id, String(floor))
                          showToast(t('toast.incrementOnly'))
                        }
                      }}
                      style={inputStyle}
                    />
                  ) : (
                    <span style={valStyle}>{Number(cur).toLocaleString()}</span>
                  )}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  {s.extra === 'increment_only' ? t('stats.incrementOnly') : s.extra}
                  {s.protected && (
                    <span
                      style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '999px',
                        background: 'color-mix(in srgb, var(--danger) 13%, transparent)', color: 'var(--danger)',
                        fontFamily: 'var(--meta)',
                      }}
                    >
                      {t('badge.protected')}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
        <p style={{ fontSize: '11.5px', color: 'var(--t3)', marginTop: '14px', lineHeight: 1.6 }}>
          {t('stats.footer')}
        </p>
      </div>
    </div>
  )
}
