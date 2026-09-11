import { useApp } from '../state/AppContext'
import { useUpdateAction } from './ui/useUpdateAction'

export default function UpdateBanner() {
  const { state, t, dismissUpdate } = useApp()
  const { status, busy, buttonLabel, onClick } = useUpdateAction()
  const u = state.update
  if (!u || !u.isNew || u.latest === state.updateDismissed) return null
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 16px',
        background: 'var(--s3)', borderBottom: '1px solid var(--bd)',
        color: 'var(--t1)', fontSize: '13px',
      }}
    >
      <span role="status" aria-live="polite" style={{ flex: 1, minWidth: 0 }}>{status}</span>
      <button
        onClick={onClick}
        disabled={busy}
        data-testid="update-action"
        style={{
          padding: '4px 12px', borderRadius: '999px', border: '1px solid var(--bd)',
          background: 'var(--s1)', color: 'var(--t1)', fontSize: '12px', fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
        }}
      >
        {buttonLabel}
      </button>
      <button
        onClick={dismissUpdate}
        disabled={busy}
        aria-label={t('a11y.dismiss')}
        style={{
          border: 'none', background: 'transparent', color: 'var(--t3)',
          fontSize: '14px', cursor: busy ? 'wait' : 'pointer', lineHeight: 1, padding: '4px',
        }}
      >
        ✕
      </button>
    </div>
  )
}
