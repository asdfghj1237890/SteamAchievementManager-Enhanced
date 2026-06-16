import type { CSSProperties } from 'react'
import { useApp } from '../state/AppContext'

const center: CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: '12px', color: 'var(--t3)', minHeight: 0, padding: '40px', textAlign: 'center',
}

export function LoadingPane({ label }: { label?: string }) {
  const { t } = useApp()
  return (
    <div style={center}>
      <div
        style={{
          width: '26px', height: '26px', borderRadius: '50%',
          border: '2.5px solid var(--bd)', borderTopColor: 'var(--accent)',
          animation: 'dcspin .7s linear infinite',
        }}
      />
      <div style={{ fontSize: '13px' }}>{label ?? t('common.loading')}</div>
    </div>
  )
}

export function ErrorPane({ msg, onRetry }: { msg?: string | null; onRetry?: () => void }) {
  const { t } = useApp()
  return (
    <div style={center}>
      <div style={{ fontSize: '30px', opacity: 0.6 }}>⚠</div>
      <div style={{ fontSize: '14px', color: 'var(--t2)' }}>{t('common.loadFailed')}</div>
      {msg && <div style={{ fontSize: '12px', fontFamily: 'var(--meta)' }}>{msg}</div>}
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: '6px', padding: '7px 14px', borderRadius: 'var(--radius)',
            border: '1px solid var(--bd)', background: 'var(--s2)', color: 'var(--t1)',
            fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}
