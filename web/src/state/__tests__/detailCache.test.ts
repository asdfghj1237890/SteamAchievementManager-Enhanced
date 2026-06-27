import { describe, expect, it } from 'vitest'
import { touchDetailCache } from '../detailCache'
import { makeInitialState, type AppState } from '../store'
import type { Achievement, Game } from '../../types'

const ach = (id: string, unlocked: boolean): Achievement => ({
  id, name: id, desc: '', rarity: 0, unlocked, hidden: false, protected: false, points: 0,
})

const game = (appId: string): Game => ({
  id: appId, appId, name: `Game ${appId}`, genre: '', type: 'normal', hue: 0,
  y: 2024, m: 1, last: '', achievements: [ach('a', false)], stats: [],
})

const stateWithLoaded = (ids: string[], over: Partial<AppState> = {}): AppState => {
  const loaded: Record<string, Game> = {}
  const achState: AppState['achState'] = {}
  const statState: AppState['statState'] = {}
  const origAch: AppState['origAch'] = {}
  const origStat: AppState['origStat'] = {}
  for (const id of ids) {
    loaded[id] = game(id)
    achState[id] = { a: false }
    statState[id] = {}
    origAch[id] = { a: false }
    origStat[id] = {}
  }
  return {
    ...makeInitialState(),
    loaded,
    detailOrder: ids,
    achState,
    statState,
    origAch,
    origStat,
    ...over,
  }
}

describe('touchDetailCache', () => {
  it('evicts the oldest clean detail when the cache exceeds the limit', () => {
    const state = stateWithLoaded(['1', '2', '3', '4'])

    const patch = touchDetailCache(state, '4', 3)

    expect(patch.detailOrder).toEqual(['2', '3', '4'])
    expect(patch.loaded!['1']).toBeUndefined()
    expect(patch.loaded!['2']).toBeDefined()
  })

  it('touches an existing detail as most recently used', () => {
    const state = stateWithLoaded(['1', '2', '3'])

    const patch = touchDetailCache(state, '1', 3)

    expect(patch.detailOrder).toEqual(['2', '3', '1'])
    expect(patch.loaded).toBeUndefined()
  })

  it('keeps pending edits even when the cache stays over limit', () => {
    const state = stateWithLoaded(['1', '2', '3'], {
      achState: { '1': { a: true }, '2': { a: false }, '3': { a: false } },
      activeAppId: '3',
    })

    const patch = touchDetailCache(state, '3', 1)

    expect(patch.detailOrder).toEqual(['1', '3'])
    expect(patch.loaded!['1']).toBeDefined()
    expect(patch.loaded!['2']).toBeUndefined()
    expect(patch.loaded!['3']).toBeDefined()
  })
})
