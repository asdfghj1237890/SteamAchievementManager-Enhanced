// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameChanges, SamSource, SaveResult } from '../../data/source'
import type { Achievement, Game, GameCompletion, GameSummary } from '../../types'

/** The source the provider picks up, swapped per test through the mocked data seam. */
const seam = vi.hoisted(() => ({ source: null as unknown }))
vi.mock('../../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data')>()
  return { ...original, isTauri: () => false, getSource: () => seam.source as SamSource }
})

import { AppProvider, useApp } from '../AppContext'

/** In-memory SamSource that records every call and can hold a save open. */
class FakeSource implements SamSource {
  listGamesCalls = 0
  loadGameCalls: string[] = []
  saveCalls: [string, GameChanges][] = []
  progressCalls: string[][] = []
  saveResult: SaveResult = { saved: 1, rejected: [] }
  /** When true, saveChanges stays pending until releaseSave() is called. */
  holdSave = false
  releaseSave: (() => void) | null = null

  constructor(
    public games: GameSummary[],
    private readonly details: Record<string, Game>,
    private readonly progress: Record<string, GameCompletion> = {},
  ) {}

  async listGames(): Promise<GameSummary[]> {
    this.listGamesCalls += 1
    return this.games
  }

  async loadGame(appId: string): Promise<Game> {
    this.loadGameCalls.push(appId)
    const game = this.details[appId]
    if (!game) throw new Error(`no detail for ${appId}`)
    return structuredClone(game)
  }

  saveChanges(appId: string, changes: GameChanges): Promise<SaveResult> {
    this.saveCalls.push([appId, structuredClone(changes)])
    return new Promise((resolve) => {
      const finish = () => resolve(this.saveResult)
      if (this.holdSave) this.releaseSave = finish
      else finish()
    })
  }

  async loadProgressBatch(appIds: string[]): Promise<Record<string, GameCompletion>> {
    this.progressCalls.push([...appIds])
    const out: Record<string, GameCompletion> = {}
    for (const id of appIds) if (this.progress[id]) out[id] = this.progress[id]
    return out
  }
}

const summary = (appId: string): GameSummary => ({
  appId, id: appId, name: `Game ${appId}`, genre: '', type: 'normal', hue: 0,
})
const ach = (id: string, unlocked: boolean): Achievement => ({
  id, name: id, desc: '', rarity: 0, unlocked, hidden: false, protected: false, points: 0,
})
const game = (appId: string, achievements: Achievement[]): Game => ({
  id: appId, appId, name: `Game ${appId}`, genre: '', type: 'normal', hue: 0,
  y: 2024, m: 1, last: '', achievements, stats: [],
})
const done = (earned: number, total: number): GameCompletion => ({
  earned, total, pct: Math.round((earned / total) * 100),
})

function setup(source: FakeSource) {
  seam.source = source
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HashRouter>
      <AppProvider>{children}</AppProvider>
    </HashRouter>
  )
  return renderHook(() => useApp(), { wrapper })
}

/** Let pending promises and their dispatches settle. */
const settle = () => act(async () => { await Promise.resolve() })

describe('AppProvider', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/'
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('batches on-disk completion for new games only, and for everything again on Refresh', async () => {
    const src = new FakeSource(
      [summary('10'), summary('20')],
      { '10': game('10', [ach('a1', true), ach('a2', false)]) },
      { '10': done(1, 2), '20': done(3, 4) },
    )
    const { result } = setup(src)

    await waitFor(() => expect(src.progressCalls).toEqual([['10', '20']]))
    await waitFor(() =>
      expect(result.current.state.games.find((g) => g.appId === '20')?.completion).toEqual(done(3, 4)),
    )

    // Adding one App ID re-runs the loader, but only the newcomer is read from disk.
    act(() => result.current.set((s) => ({ games: [...s.games, summary('30')] })))
    await waitFor(() => expect(src.progressCalls).toHaveLength(2))
    expect(src.progressCalls[1]).toEqual(['30'])

    // Refresh rescans the library and forgets what was requested: everything again.
    act(() => result.current.refresh())
    await waitFor(() => expect(src.listGamesCalls).toBe(2))
    await waitFor(() => expect(src.progressCalls).toHaveLength(3))
    expect([...src.progressCalls[2]].sort()).toEqual(['10', '20'])
  })

  it('skips the silent reload when a loaded game is revisited within the TTL', async () => {
    const src = new FakeSource([summary('10')], { '10': game('10', [ach('a1', true)]) })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const { result } = setup(src)

    act(() => result.current.openGame('10'))
    await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())
    expect(src.loadGameCalls).toEqual(['10'])

    // Coming straight back: the cached detail is trusted, no worker round trip.
    act(() => result.current.openGame('10'))
    await settle()
    expect(src.loadGameCalls).toEqual(['10'])

    // Past the TTL the silent re-read happens again.
    now.mockReturnValue(1_000_000 + 61_000)
    act(() => result.current.openGame('10'))
    await waitFor(() => expect(src.loadGameCalls).toEqual(['10', '10']))
  })

  it('saves only the diff and advances the baseline for what was sent', async () => {
    const src = new FakeSource([summary('10')], { '10': game('10', [ach('a1', false), ach('a2', false)]) })
    const { result } = setup(src)
    act(() => result.current.openGame('10'))
    await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())

    act(() => result.current.toggleAch('10', 'a1', false))
    act(() => {
      void result.current.store()
    })
    await waitFor(() => expect(result.current.state.saving).toBe(false))

    expect(src.saveCalls).toEqual([['10', { achievements: { a1: true }, stats: {} }]])
    expect(result.current.state.origAch['10']).toEqual({ a1: true, a2: false })
    expect(result.current.state.toast).toBe('Wrote 1 changes to Steam')
    expect(result.current.state.games[0].completion).toEqual(done(1, 2))
  })

  it('keeps an edit made while a partial save was in flight, and reverts the rejected one', async () => {
    const src = new FakeSource([summary('10')], { '10': game('10', [ach('a1', false), ach('a2', false)]) })
    src.saveResult = { saved: 0, rejected: ['a1'] }
    src.holdSave = true
    const { result } = setup(src)
    act(() => result.current.openGame('10'))
    await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())

    act(() => result.current.toggleAch('10', 'a1', false))
    act(() => {
      void result.current.store()
    })
    await waitFor(() => expect(src.saveCalls).toHaveLength(1))
    expect(result.current.state.saving).toBe(true)

    // The user keeps editing while Steam is still writing.
    act(() => result.current.toggleAch('10', 'a2', false))
    await act(async () => {
      src.releaseSave?.()
    })
    await waitFor(() => expect(result.current.state.saving).toBe(false))

    // Ground truth was re-read once; a1 (rejected) shows Steam's value, a2 stays pending.
    expect(src.loadGameCalls).toEqual(['10', '10'])
    expect(result.current.state.achState['10']).toEqual({ a1: false, a2: true })
    expect(result.current.state.origAch['10']).toEqual({ a1: false, a2: false })
  })
})
