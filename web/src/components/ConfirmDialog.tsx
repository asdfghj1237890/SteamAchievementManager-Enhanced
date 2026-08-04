import { useEffect, useRef, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'

/**
 * App-wide confirmation modal. Driven by the `confirm` request in AppContext:
 * `requestConfirm({ message, confirmLabel, danger?, onConfirm })` opens it, and the
 * user's choice runs `confirmResolve(true|false)`. Enter confirms, Esc / overlay
 * click / Cancel dismisses. Used for bulk edits, stat reset, and the unsaved-changes
 * guards on navigation and app close.
 */
export default function ConfirmDialog() {
  const { confirm, confirmResolve, t } = useApp()
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (confirm) confirmBtnRef.current?.focus()
  }, [confirm])

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') confirmResolve(false)
      else if (e.key === 'Enter') confirmResolve(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, confirmResolve])

  if (!confirm) return null

  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: '24px',
    background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(2px)',
  }
  const card: CSSProperties = {
    width: 'min(420px, 100%)', background: 'var(--s1)', border: '1px solid var(--bd)',
    borderRadius: 'var(--radius-lg)', boxShadow: 'var(--elev)', padding: '22px', color: 'var(--t1)',
  }
  const btnBase: CSSProperties = {
    padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--bd)',
  }
  const accent = confirm.danger ? 'var(--danger)' : 'var(--accent)'

  return (
    <div style={overlay} role="presentation" onClick={() => confirmResolve(false)}>
      <div style={card} role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: '14px', lineHeight: 1.6 }}>{confirm.message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button
            style={{ ...btnBase, background: 'var(--s2)', color: 'var(--t2)' }}
            onClick={() => confirmResolve(false)}
          >
            {t('confirm.cancel')}
          </button>
          <button
            ref={confirmBtnRef}
            style={{ ...btnBase, background: accent, borderColor: accent, color: '#fff' }}
            onClick={() => confirmResolve(true)}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
