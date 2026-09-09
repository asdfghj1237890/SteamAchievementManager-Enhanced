import { describe, expect, it } from 'vitest'
import { progressIdsToRequest } from '../progressBatch'
import type { Game, GameSummary } from '../../types'

const summary = (appId: string): GameSummary => ({
  appId, id: appId, name: appId, genre: '', type: 'normal', hue: 0,
})

describe('progressIdsToRequest', () => {
  const games = [summary('10'), summary('20'), summary('30'), summary('40')]

  it('skips games with loaded detail and games already requested', () => {
    const loaded = { '20': {} as Game }
    const requested = new Set(['30'])
    expect(progressIdsToRequest(games, loaded, requested)).toEqual(['10', '40'])
  })

  it('requests everything after a refresh cleared the requested set', () => {
    expect(progressIdsToRequest(games, {}, new Set())).toEqual(['10', '20', '30', '40'])
  })

  it('returns nothing when every game is covered', () => {
    const requested = new Set(['10', '20', '30', '40'])
    expect(progressIdsToRequest(games, {}, requested)).toEqual([])
  })
})
