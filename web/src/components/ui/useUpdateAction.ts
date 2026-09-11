import { useApp } from '../../state/AppContext'
import { installBusy, progressPct } from '../../lib/updater'

/**
 * One source of truth for the update controls (banner + Settings): what the status
 * line says and what the button does. The in-app install is offered only when this
 * install can update itself (NSIS install on Windows, .app bundle on macOS) and the
 * last attempt did not fail; otherwise the button opens the Releases page.
 */
export function useUpdateAction() {
  const { state, t, installUpdate, openReleases } = useApp()
  const latest = state.update?.latest ?? ''
  const install = state.updateInstall
  const busy = installBusy(install)
  const canInstall = state.updaterSupported && install.phase !== 'error'

  let status = t('update.available', { version: latest })
  if (install.phase === 'downloading') {
    const pct = progressPct(install)
    status = t('update.downloading', { pct: pct === null ? '' : `${pct}%` })
  } else if (install.phase === 'installing') {
    status = t('update.installing')
  } else if (install.phase === 'error') {
    status = t('update.installFailed', { msg: install.error ?? '' })
  }

  return {
    status,
    busy,
    canInstall,
    buttonLabel: canInstall ? t('update.install') : t('update.download'),
    onClick: canInstall ? installUpdate : openReleases,
  }
}
