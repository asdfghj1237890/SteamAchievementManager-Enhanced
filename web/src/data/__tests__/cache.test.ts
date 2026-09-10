// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadGamesCache, loadSettings, saveGamesCache, saveSettings } from '../cache'
import type { GameSummary } from '../../types'

const summary = (appId: string): GameSummary => ({
  appId, id: appId, name: `Game ${appId}`, genre: '', type: 'normal', hue: 0,
  completion: { earned: 1, total: 2, pct: 50 },
})

describe('games cache', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips the list with its completions', () => {
    saveGamesCache([summary('10'), summary('20')])
    expect(loadGamesCache()).toEqual([summary('10'), summary('20')])
  })

  it('treats a missing, corrupt, or non-list cache as absent', () => {
    expect(loadGamesCache()).toBeNull()
    localStorage.setItem('sam-games-cache-v1', '{not json')
    expect(loadGamesCache()).toBeNull()
    localStorage.setItem('sam-games-cache-v1', JSON.stringify({ appId: '10' }))
    expect(loadGamesCache()).toBeNull()
  })

  it('survives storage that throws (quota / disabled)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveGamesCache([summary('10')])).not.toThrow()
    expect(() => saveSettings({ theme: 'light' })).not.toThrow()
  })
})

describe('settings', () => {
  it('round-trips the persisted appearance settings', () => {
    saveSettings({ theme: 'light', sidebarWidth: 300, lang: 'en-US', dismissedVersion: '1.2.0' })
    expect(loadSettings()).toEqual({ theme: 'light', sidebarWidth: 300, lang: 'en-US', dismissedVersion: '1.2.0' })
  })

  it('falls back to empty settings when nothing or garbage is stored', () => {
    expect(loadSettings()).toEqual({})
    localStorage.setItem('sam-settings-v1', 'garbage')
    expect(loadSettings()).toEqual({})
  })
})
