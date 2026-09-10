import { MockSource } from './mockSource'
import { LARGE_SCALE, type MockScale } from './mockScale'
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

/**
 * `?mock=large` on the web build swaps the 16-game demo for a synthetic 2,000-game,
 * 500-achievement library — the scale a real Steam account can reach — for the
 * `@perf` browser check and manual profiling. Never applies inside Tauri.
 */
function mockScaleFromUrl(): MockScale | null {
  if (typeof window === 'undefined') return null
  try {
    return new URLSearchParams(window.location.search).get('mock') === 'large' ? LARGE_SCALE : null
  } catch {
    return null
  }
}

let instance: SamSource | null = null

/**
 * Resolve the active data source: the local Steam client inside the Tauri desktop
 * shell, otherwise the bundled demo source so the plain web build keeps working.
 */
export function getSource(): SamSource {
  if (instance) return instance
  instance = isTauri() ? new TauriSource() : new MockSource(undefined, mockScaleFromUrl())
  return instance
}
