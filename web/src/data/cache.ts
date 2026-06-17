import type { Lang } from '../i18n'
import type { GameSummary, Theme } from '../types'

// Persisted games list (with completions) so repeat launches show instantly,
// then refresh in the background. Tauri's webview localStorage survives restarts.
const KEY = 'sam-games-cache-v1'

export interface PersistedSettings {
  theme?: Theme
  sidebarWidth?: number
  lang?: Lang
  dismissedVersion?: string
}
const SETTINGS_KEY = 'sam-settings-v1'

export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? (JSON.parse(raw) as PersistedSettings) : {}
  } catch {
    return {}
  }
}

export function saveSettings(s: PersistedSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // storage full / disabled — non-fatal
  }
}

export function loadGamesCache(): GameSummary[] | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return Array.isArray(data) ? (data as GameSummary[]) : null
  } catch {
    return null
  }
}

export function saveGamesCache(games: GameSummary[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(games))
  } catch {
    // storage full / disabled — non-fatal
  }
}
