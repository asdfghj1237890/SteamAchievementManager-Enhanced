import { MockSource } from './mockSource'
import { TauriSource } from './tauriSource'
import type { SamSource } from './source'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

/** True when running inside the Tauri desktop shell (Phase 2). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let instance: SamSource | null = null

/**
 * Resolve the active data source.
 * Phase 2 will return a `TauriSource` when {@link isTauri} is true; for now the
 * bundled demo source backs both the web build and the Tauri shell.
 */
export function getSource(): SamSource {
  if (instance) return instance
  // Inside the Tauri desktop shell → real local Steam; otherwise the demo source
  // so the plain web build keeps working.
  instance = isTauri() ? new TauriSource() : new MockSource()
  return instance
}
