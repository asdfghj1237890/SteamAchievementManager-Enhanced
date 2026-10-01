import { useEffect, useRef, type CSSProperties } from 'react'
import { useApp } from '../state/AppContext'

/**
 * App-wide confirmation modal. Driven by the `confirm` request in AppContext:
 * `requestConfirm({ message, confirmLabel, danger?, onConfirm })` opens it, and the
 * user's choice runs `confirmResolve(true|false)`. Esc / overlay click / Cancel
 * dismisses. Enter is not handled globally: it only activates the focused button
 * (Cancel by default for `danger` requests, the confirm button otherwise), and Tab
 * is trapped between the two buttons. Used for bulk edits, stat reset, and the
 * unsaved-changes guards on navigation and app close.
 */
export default function ConfirmDialog() {
  const { confirm, confirmResolve, t } = useApp()
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!confirm) return
    // Destructive requests start on Cancel, so a reflexive Enter / Space is harmless.
    const initial = confirm.danger ? cancelBtnRef.current : confirmBtnRef.current
    initial?.focus()
  }, [confirm])

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') confirmResolve(false)
      // Enter only acts through the focused button's own activation. Swallow auto-repeat
      // so a key still held from the action that opened the dialog cannot press it.
      else if (e.key === 'Enter' && e.repeat) e.preventDefault()
      else if (e.key === 'Tab') {
        // Focus trap: cycle between the two buttons, wherever focus currently is.
        e.preventDefault()
        const cancel = cancelBtnRef.current
        const ok = confirmBtnRef.current
        const active = document.activeElement
        const next = e.shiftKey ? (active === ok ? cancel : ok) : (active === cancel ? ok : cancel)
        next?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, confirmResolve])

  if (!confirm) return null

  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: '24px',
    background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(2px)',
    animation: 'dcFadeIn var(--m-fast) ease-out both',
  }
  const card: CSSProperties = {
    width: 'min(420px, 100%)', background: 'var(--s1)', border: '1px solid var(--bd)',
    borderRadius: 'var(--radius-lg)', boxShadow: 'var(--elev)', padding: '22px', color: 'var(--t1)',
    animation: 'dcScaleIn var(--m-base) var(--m-ease) both',
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
            ref={cancelBtnRef}
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
