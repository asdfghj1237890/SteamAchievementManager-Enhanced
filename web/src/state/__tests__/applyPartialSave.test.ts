import { describe, expect, it } from 'vitest'
import { applyPartialSave, type SaveSnapshot } from '../applyPartialSave'
import { makeInitialState } from '../store'
import type { Achievement, Game } from '../../types'

const ach = (id: string, unlocked: boolean): Achievement => ({
  id, name: id, desc: '', rarity: 0, unlocked, hidden: false, protected: false, points: 0,
})

const game = (achievements: Achievement[]): Game => ({
  id: 'app1', name: 'Game', genre: '', type: 'normal', hue: 0,
  appId: 'app1', y: 0, m: 0, last: '', achievements, stats: [],
})

describe('applyPartialSave', () => {
  it('keeps an edit made while the partial-save reload was in flight', () => {
    const appId = 'app1'
    // At save start A was about to be sent (true) and B was untouched (false).
    // The user turned on B while the write/reload was in flight.
    const snapshot: SaveSnapshot = { ach: { A: true, B: false }, stat: {} }
    const state = {
      ...makeInitialState(),
      activeAppId: appId,
      loaded: { [appId]: game([ach('A', true), ach('B', false)]) },
      achState: { [appId]: { A: true, B: true } },
      statState: { [appId]: {} },
      origAch: { [appId]: { A: false, B: false } },
      origStat: { [appId]: {} },
      games: [],
    }
    // Ground truth re-read after the save: A saved, B still locked.
    const fresh = game([ach('A', true), ach('B', false)])

    const patch = applyPartialSave(state, appId, fresh, snapshot)

    // B must survive the reload (not clobbered by ground truth); A reflects the save.
    expect(patch.achState![appId]).toEqual({ A: true, B: true })
    // Baseline advances to ground truth, so B still reads as a pending edit.
    expect(patch.origAch![appId]).toEqual({ A: true, B: false })
  })

  it('reverts a rejected change the user did not re-touch', () => {
    const appId = 'app1'
    // We sent C=true but Steam rejected it; the user has not touched C since.
    const snapshot: SaveSnapshot = { ach: { C: true }, stat: {} }
    const state = {
      ...makeInitialState(),
      activeAppId: appId,
      loaded: { [appId]: game([ach('C', false)]) },
      achState: { [appId]: { C: true } },
      statState: { [appId]: {} },
      origAch: { [appId]: { C: false } },
      origStat: { [appId]: {} },
      games: [],
    }
    const fresh = game([ach('C', false)])

    const patch = applyPartialSave(state, appId, fresh, snapshot)

    // C snaps back to ground truth (a rejected edit is never shown as saved/pending).
    expect(patch.achState![appId]).toEqual({ C: false })
    expect(patch.origAch![appId]).toEqual({ C: false })
  })

  it('keeps the fresh value for an untouched key that Steam changed during the save', () => {
    const appId = 'app1'
    // We only sent A. D was not in this save and the user never touched it, but
    // the game unlocked D while the write/reload was in flight.
    const snapshot: SaveSnapshot = { ach: { A: true, D: false }, stat: {} }
    const state = {
      ...makeInitialState(),
      activeAppId: appId,
      loaded: { [appId]: game([ach('A', true), ach('D', false)]) },
      achState: { [appId]: { A: true, D: false } },
      statState: { [appId]: {} },
      origAch: { [appId]: { A: false, D: false } },
      origStat: { [appId]: {} },
      games: [],
    }
    // Ground truth: A saved, and D legitimately unlocked during the save window.
    const fresh = game([ach('A', true), ach('D', true)])

    const patch = applyPartialSave(state, appId, fresh, snapshot)

    // D must keep Steam's fresh value (true), not revert to the stale live false.
    expect(patch.achState![appId].D).toBe(true)
  })

  it('keeps an in-flight stat edit but reverts a rejected one', () => {
    const appId = 'app1'
    // At save start kills was about to be sent (100) and deaths untouched (0).
    // deaths was edited to 7 after the save began; kills was rejected by Steam.
    const snapshot: SaveSnapshot = { ach: {}, stat: { kills: 100, deaths: 0 } }
    const state = {
      ...makeInitialState(),
      activeAppId: appId,
      loaded: { [appId]: game([]) },
      achState: { [appId]: {} },
      statState: { [appId]: { kills: 100, deaths: 7 } },
      origAch: { [appId]: {} },
      origStat: { [appId]: { kills: 50, deaths: 0 } },
      games: [],
    }
    const fresh: Game = {
      ...game([]),
      stats: [
        { id: 'kills', name: 'kills', value: 50, extra: '', protected: false },
        { id: 'deaths', name: 'deaths', value: 0, extra: '', protected: false },
      ],
    }

    const patch = applyPartialSave(state, appId, fresh, snapshot)

    // kills reverts to ground truth (50); deaths keeps the post-save edit (7).
    expect(patch.statState![appId]).toEqual({ kills: 50, deaths: 7 })
  })
})
