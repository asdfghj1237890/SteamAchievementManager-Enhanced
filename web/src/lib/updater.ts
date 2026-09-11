/** Progress of an in-app update, reduced from the updater plugin's download events. */
export type InstallPhase = 'idle' | 'downloading' | 'installing' | 'error'

export interface InstallProgress {
  phase: InstallPhase
  /** Bytes received so far. */
  received: number
  /** Total bytes, or null while the server has not said. */
  total: number | null
  /** Message for the error phase. */
  error?: string
}

/** The updater plugin's download callback events (mirrors @tauri-apps/plugin-updater). */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

export const IDLE_INSTALL: InstallProgress = { phase: 'idle', received: 0, total: null }

export function applyDownloadEvent(progress: InstallProgress, event: DownloadEvent): InstallProgress {
  switch (event.event) {
    case 'Started':
      return { phase: 'downloading', received: 0, total: event.data.contentLength ?? null }
    case 'Progress':
      return { ...progress, phase: 'downloading', received: progress.received + event.data.chunkLength }
    case 'Finished':
      return { ...progress, phase: 'installing' }
  }
}

/** Whole-number percentage, or null while the total is unknown. */
export function progressPct(progress: InstallProgress): number | null {
  if (progress.total === null || progress.total <= 0) return null
  return Math.min(100, Math.floor((progress.received / progress.total) * 100))
}

export const installBusy = (progress: InstallProgress): boolean =>
  progress.phase === 'downloading' || progress.phase === 'installing'
