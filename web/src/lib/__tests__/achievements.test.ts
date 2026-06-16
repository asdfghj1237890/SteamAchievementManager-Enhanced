import { describe, expect, it } from 'vitest'
import {
  bulkApply, completion, completionFlat, filteredAch, pendingCount, points, workingAch,
} from '../achievements'
import { averagePct, visibleSummaries } from '../library'
import { makeInitialState } from '../../state/store'
import type { AchState, Game, GameSummary, StatState } from '../../types'

const game: Game = {
  id: 'gx', name: 'Test Game', genre: 'demo-genre', type: 'normal', hue: 200, appId: 'gx', y: 2024, m: 1, last: 'x',
  achievements: [
    { id: 'a0', name: 'Alpha', desc: 'the first one', rarity: 50, unlocked: true, hidden: false, protected: false, points: 50 },
    { id: 'a1', name: 'Beta', desc: 'the second one', rarity: 20, unlocked: false, hidden: false, protected: false, points: 80 },
    { id: 'a2', name: 'Gamma', desc: 'a secret thing', rarity: 5, unlocked: false, hidden: true, protected: false, points: 95 },
    { id: 'a3', name: 'Delta', desc: 'leaderboard locked', rarity: 2, unlocked: false, hidden: false, protected: true, points: 98 },
  ],
  stats: [
    { id: 'st0', name: 'S0', value: 10, extra: '', protected: false },
    { id: 'st1', name: 'S1', value: 20, extra: '', protected: true },
  ],
}

const ach = (overrides: Record<string, boolean> = {}): AchState => ({
  gx: { a0: true, a1: false, a2: false, a3: false, ...overrides },
})
const stat = (overrides: Record<string, number> = {}): StatState => ({
  gx: { st0: 10, st1: 20, ...overrides },
})

describe('workingAch', () => {
  it('applies the live unlock overrides over the base achievements', () => {
    const w = workingAch(game, ach({ a1: true }))
    expect(w.find((a) => a.id === 'a1')?.unlocked).toBe(true)
    expect(w.find((a) => a.id === 'a2')?.unlocked).toBe(false)
  })
})

describe('filteredAch', () => {
  it('filters by the saved unlock state', () => {
    expect(filteredAch(game, ach(), ach(), 'unlocked', '').map((a) => a.id)).toEqual(['a0'])
    expect(filteredAch(game, ach(), ach(), 'locked', '').map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
  })
  it('keeps a toggled row in its saved partition (does not vanish mid-edit)', () => {
    // a1 is saved-locked but unlocked in the working state → it stays under 'locked'
    const r = filteredAch(game, ach({ a1: true }), ach(), 'locked', '')
    expect(r.map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
    expect(r.find((a) => a.id === 'a1')?.unlocked).toBe(true)
  })
  it('matches the search query against name and description', () => {
    expect(filteredAch(game, ach(), ach(), 'all', 'beta').map((a) => a.id)).toEqual(['a1'])
    expect(filteredAch(game, ach(), ach(), 'all', 'secret').map((a) => a.id)).toEqual(['a2'])
    expect(filteredAch(game, ach(), ach(), 'all', 'nope')).toHaveLength(0)
  })
})

describe('completion / completionFlat / points', () => {
  it('computes earned / total / pct (keyed)', () => {
    expect(completion(game, ach())).toEqual({ earned: 1, total: 4, pct: 25 })
    expect(completion(game, ach({ a1: true, a2: true }))).toEqual({ earned: 3, total: 4, pct: 75 })
  })
  it('computes the same from a flat map', () => {
    expect(completionFlat(game.achievements, { a0: true, a1: true })).toEqual({ earned: 2, total: 4, pct: 50 })
    expect(completionFlat(game.achievements, {})).toEqual({ earned: 0, total: 4, pct: 0 })
  })
  it('sums points over unlocked achievements', () => {
    expect(points(game, ach())).toEqual({ earned: 50, total: 323 })
  })
})

describe('bulkApply', () => {
  it('unlocks / locks / inverts the supplied list only', () => {
    const list = game.achievements.filter((a) => !a.protected)
    expect(bulkApply(ach().gx, list, 'unlock')).toMatchObject({ a0: true, a1: true, a2: true })
    expect(bulkApply(ach().gx, list, 'lock')).toMatchObject({ a0: false, a1: false, a2: false })
    expect(bulkApply(ach().gx, list, 'invert')).toMatchObject({ a0: false, a1: true, a2: true })
  })
})

describe('pendingCount', () => {
  it('counts changed achievements and stats against the saved snapshot', () => {
    const orig = ach()
    const origStat = stat()
    expect(pendingCount(game, orig, orig, origStat, origStat)).toBe(0)
    expect(pendingCount(game, ach({ a1: true }), orig, origStat, origStat)).toBe(1)
    expect(pendingCount(game, ach({ a1: true }), orig, stat({ st0: 99 }), origStat)).toBe(2)
  })
})

describe('library summary helpers', () => {
  const summaries: GameSummary[] = [
    { appId: '1', id: '1', name: 'Alpha', genre: 'g', type: 'normal', hue: 1, completion: { earned: 1, total: 2, pct: 50 } },
    { appId: '2', id: '2', name: 'Beta demo', genre: 'g', type: 'demo', hue: 2, completion: { earned: 0, total: 2, pct: 0 } },
    { appId: '3', id: '3', name: 'Gamma', genre: 'g', type: 'mod', hue: 3, completion: { earned: 2, total: 2, pct: 100 } },
  ]
  it('filters by type and by case-insensitive name', () => {
    expect(visibleSummaries(summaries, 'demo', '').map((g) => g.id)).toEqual(['2'])
    expect(visibleSummaries(summaries, 'all', 'ALPHA').map((g) => g.id)).toEqual(['1'])
    expect(visibleSummaries(summaries, 'all', '')).toHaveLength(3)
  })
  it('averages completion across reporting games', () => {
    expect(averagePct(summaries)).toBe(50)
    expect(averagePct([])).toBe(0)
  })
})

describe('makeInitialState', () => {
  it('starts idle with no data loaded', () => {
    const s = makeInitialState()
    expect(s.gamesStatus).toBe('idle')
    expect(s.games).toEqual([])
    expect(s.activeAppId).toBeNull()
    expect(s.theme).toBe('dark')
    expect(s.loaded).toEqual({})
  })
})
