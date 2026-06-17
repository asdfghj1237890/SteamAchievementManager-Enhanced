import { useApp } from '../state/AppContext'

export default function UpdateBanner() {
  const { state, t, dismissUpdate, openReleases } = useApp()
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
      <span style={{ flex: 1, minWidth: 0 }}>{t('update.available', { version: u.latest })}</span>
      <button
        onClick={openReleases}
        style={{
          padding: '4px 12px', borderRadius: '999px', border: '1px solid var(--bd)',
          background: 'var(--s1)', color: 'var(--t1)', fontSize: '12px', fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {t('update.download')}
      </button>
      <button
        onClick={dismissUpdate}
        aria-label="dismiss"
        style={{
          border: 'none', background: 'transparent', color: 'var(--t3)',
          fontSize: '14px', cursor: 'pointer', lineHeight: 1, padding: '4px',
        }}
      >
        ✕
      </button>
    </div>
  )
}
