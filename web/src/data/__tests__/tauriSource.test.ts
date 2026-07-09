import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { TauriSource } from '../tauriSource'

describe('TauriSource IPC contract', () => {
  beforeEach(() => invoke.mockReset())

  it('maps and sorts owned games while normalizing unknown types', async () => {
    invoke.mockResolvedValueOnce([
      { app_id: 20, name: '', type: 'tool' },
      { app_id: 10, name: 'Alpha', type: 'demo' },
      { app_id: 30, name: 'Mod Z', type: 'mod' },
    ])

    const games = await new TauriSource().listGames()

    expect(invoke).toHaveBeenCalledWith('list_games', { appIds: expect.any(Array) })
    expect(games.map(({ appId, name, type }) => ({ appId, name, type }))).toEqual([
      { appId: '20', name: '20', type: 'normal' },
      { appId: '10', name: 'Alpha', type: 'demo' },
      { appId: '30', name: 'Mod Z', type: 'mod' },
    ])
  })

  it('maps a game detail response without trusting optional display names', async () => {
    invoke.mockResolvedValueOnce({
      app_id: 42,
      name: 'Test Game',
      achievements: [{
        id: 'ACH_1', name: '', desc: 'Desc', hidden: true, unlocked: true,
        unlock_time: 123, rarity: 12.6, icon: 'on.png', icon_gray: 'off.png', protected: false,
      }],
      stats: [{
        id: 'STAT_1', name: 'Wins', value: 7, is_float: false,
        protected: true, increment_only: true,
      }],
    })

    const game = await new TauriSource().loadGame('42')

    expect(invoke).toHaveBeenCalledWith('load_game', { appId: '42' })
    expect(game.achievements[0]).toMatchObject({
      id: 'ACH_1', name: 'ACH_1', rarity: 13, unlocked: true, hidden: true,
      icon: 'on.png', iconGray: 'off.png', unlockTime: 123,
    })
    expect(game.stats[0]).toMatchObject({
      id: 'STAT_1', value: 7, protected: true, extra: 'increment_only',
    })
  })

  it('filters invalid app ids before the batch progress IPC call', async () => {
    invoke.mockResolvedValueOnce([
      { app_id: 7, earned: 2, total: 3 },
      { app_id: 9, earned: 0, total: 0 },
    ])

    const progress = await new TauriSource().loadProgressBatch([
      '7', '0', '-1', '1.5', 'nope', '4294967296', '9',
    ])

    expect(invoke).toHaveBeenCalledWith('game_progress_many', { appIds: [7, 9] })
    expect(progress).toEqual({
      '7': { earned: 2, total: 3, pct: 67 },
      '9': { earned: 0, total: 0, pct: 0 },
    })
  })

  it('forwards save changes and maps categories', async () => {
    invoke
      .mockResolvedValueOnce({ saved: 2 })
      .mockResolvedValueOnce([{ app_id: 42, categories: ['Favorites'] }])
    const source = new TauriSource()
    const changes = { achievements: { ACH_1: true }, stats: { STAT_1: 8 } }

    await expect(source.saveChanges('42', changes)).resolves.toEqual({ saved: 2 })
    await expect(source.loadCategories()).resolves.toEqual({ '42': ['Favorites'] })
    expect(invoke).toHaveBeenNthCalledWith(1, 'save_changes', { appId: '42', changes })
    expect(invoke).toHaveBeenNthCalledWith(2, 'game_categories')
  })
})
