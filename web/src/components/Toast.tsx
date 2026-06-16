import { useApp } from '../state/AppContext'

export default function Toast() {
  const { state } = useApp()
  if (!state.toast) return null
  return (
    <div
      key={state.toastSeq}
      style={{
        position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)',
        background: 'var(--s3)', color: 'var(--t1)', padding: '12px 22px', borderRadius: '999px',
        border: '1px solid var(--bd)', boxShadow: '0 12px 32px -8px rgba(0,0,0,.5)', fontSize: '13px',
        fontWeight: 600, zIndex: 50, animation: 'toastIn .25s ease',
      }}
    >
      {state.toast}
    </div>
  )
}
