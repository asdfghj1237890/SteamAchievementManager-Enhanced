import { describe, expect, it } from 'vitest'
import { applyLoadedGame } from '../applyLoadedGame'
import { makeInitialState, type AppState } from '../store'
import type { Achievement, Game, GameSummary } from '../../types'

const ach = (id: string, unlocked: boolean): Achievement => ({
  id, name: id, desc: '', rarity: 0, unlocked, hidden: false, protected: false, points: 0,
})

const summary = (appId: string, over: Partial<GameSummary> = {}): GameSummary => ({
  appId, id: appId, name: `Game ${appId}`, genre: '', type: 'normal', hue: 0, ...over,
})

const loadedGame = (appId: string, achievements: Achievement[], over: Partial<Game> = {}): Game => ({
  id: appId, appId, name: `Game ${appId}`, genre: '', type: 'normal', hue: 0,
  y: 2024, m: 1, last: '', achievements, stats: [], ...over,
})

const baseState = (games: GameSummary[], over: Partial<AppState> = {}): AppState => ({
  ...makeInitialState(), games, gamesStatus: 'ready', ...over,
})

describe('applyLoadedGame', () => {
  it('writes completion derived from unlocked achievements into the list entry', () => {
    const state = baseState([summary('10'), summary('20')])
    const game = loadedGame('10', [ach('a', true), ach('b', true), ach('c', false)])

    const patch = applyLoadedGame(state, '10', game)

    const entry = patch.games!.find((g) => g.appId === '10')!
    expect(entry.completion).toEqual({ earned: 2, total: 3, pct: 67 })
  })

  it('syncs the real name onto the placeholder list row', () => {
    const state = baseState([summary('10', { name: '10' })])
    const game = loadedGame('10', [], { name: 'Real Name' })

    const patch = applyLoadedGame(state, '10', game)

    expect(patch.games!.find((g) => g.appId === '10')!.name).toBe('Real Name')
  })

  it('caches the detail maps for the loaded game', () => {
    const state = baseState([summary('10')])
    const game = loadedGame('10', [ach('a', true)], {
      stats: [{ id: 's', name: 's', value: 5, extra: '', protected: false }],
    })

    const patch = applyLoadedGame(state, '10', game)

    expect(patch.loaded!['10']).toBe(game)
    expect(patch.achState!['10']).toEqual({ a: true })
    expect(patch.statState!['10']).toEqual({ s: 5 })
    expect(patch.origAch!['10']).toEqual({ a: true })
    expect(patch.origStat!['10']).toEqual({ s: 5 })
  })

  it('leaves other games untouched', () => {
    const other = summary('20', { completion: { earned: 1, total: 1, pct: 100 } })
    const state = baseState([summary('10'), other])
    const game = loadedGame('10', [ach('a', true)])

    const patch = applyLoadedGame(state, '10', game)

    expect(patch.games!.find((g) => g.appId === '20')).toEqual(other)
  })

  it('marks the detail ready only when the game is the active one', () => {
    const games = [summary('10')]
    const game = loadedGame('10', [ach('a', true)])

    const inactive = applyLoadedGame(baseState(games, { activeAppId: null }), '10', game)
    expect(inactive.detailStatus).toBeUndefined()

    const active = applyLoadedGame(baseState(games, { activeAppId: '10' }), '10', game)
    expect(active.detailStatus).toBe('ready')
    expect(active.detailError).toBeNull()
  })

  it('stores 0/0 completion for a game with no achievements', () => {
    const state = baseState([summary('10')])
    const game = loadedGame('10', [])

    const patch = applyLoadedGame(state, '10', game)

    expect(patch.games!.find((g) => g.appId === '10')!.completion).toEqual({ earned: 0, total: 0, pct: 0 })
  })
})
