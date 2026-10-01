// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameChanges, SamSource, SaveResult } from '../../data/source'
import type { Achievement, Game, GameCompletion, GameSummary, Stat } from '../../types'
import type { DownloadEvent } from '../../lib/updater'

/** The source the provider picks up, swapped per test through the mocked data seam. */
const seam = vi.hoisted(() => ({ source: null as unknown }))
vi.mock('../../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data')>()
  return { ...original, isTauri: () => false, getSource: () => seam.source as SamSource }
})

/** The in-app updater is Tauri-only (plugin-updater/plugin-process); mock the whole
 *  seam so installUpdate's own logic can be driven without a real Tauri runtime. */
const updateApi = vi.hoisted(() => ({
  fetchLatestVersion: vi.fn(async (): Promise<string> => '0.0.0'),
  installLatestUpdate: vi.fn(async (_onEvent: (event: DownloadEvent) => void): Promise<boolean> => true),
  openReleasesPage: vi.fn(async (): Promise<void> => {}),
  updaterSupported: vi.fn(async (): Promise<boolean> => false),
}))
vi.mock('../../data/update', () => updateApi)

import { AppProvider, useApp } from '../AppContext'

/** In-memory SamSource that records every call and can hold a save open. */
class FakeSource implements SamSource {
  listGamesCalls = 0
  loadGameCalls: string[] = []
  saveCalls: [string, GameChanges][] = []
  progressCalls: string[][] = []
  saveResult: SaveResult = { saved: 1, rejected: [] }
  /** When set, a saveChanges call made while it is set rejects with it. */
  saveError: Error | null = null
  /** When set, loadGame rejects with it. */
  loadGameError: Error | null = null
  /** When true, loadGame stays pending until releaseLoad() is called. */
  holdLoad = false
  releaseLoad: (() => void) | null = null
  /** When true, saveChanges stays pending until releaseSave() is called. */
  holdSave = false
  releaseSave: (() => void) | null = null
  /** Every held save, oldest first (releaseSave is the newest). */
  heldSaves: (() => void)[] = []

  constructor(
    public games: GameSummary[],
    /** What Steam "has": tests replace an entry to change the next loadGame result. */
    readonly details: Record<string, Game>,
    private readonly progress: Record<string, GameCompletion> = {},
  ) {}

  async listGames(): Promise<GameSummary[]> {
    this.listGamesCalls += 1
    return this.games
  }

  async loadGame(appId: string): Promise<Game> {
    this.loadGameCalls.push(appId)
    if (this.holdLoad) await new Promise<void>((resolve) => { this.releaseLoad = resolve })
    if (this.loadGameError) throw this.loadGameError
    const game = this.details[appId]
    if (!game) throw new Error(`no detail for ${appId}`)
    return structuredClone(game)
  }

  saveChanges(appId: string, changes: GameChanges): Promise<SaveResult> {
    this.saveCalls.push([appId, structuredClone(changes)])
    const error = this.saveError
    return new Promise((resolve, reject) => {
      const finish = () => (error ? reject(error) : resolve(this.saveResult))
      if (this.holdSave) {
        this.releaseSave = finish
        this.heldSaves.push(finish)
      } else finish()
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
const stat = (id: string, value: number): Stat => ({ id, name: id, value, extra: '', protected: false })
const game = (appId: string, achievements: Achievement[], stats: Stat[] = []): Game => ({
  id: appId, appId, name: `Game ${appId}`, genre: '', type: 'normal', hue: 0,
  y: 2024, m: 1, last: '', achievements, stats,
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
/** A whole macrotask: every promise chain already under way has run to its end. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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

  // A save that throws (or times out) may still have written something, so the
  // provider re-reads the game instead of assuming Steam is unchanged.
  describe('a failed save', () => {
    it('re-reads the game and rebases the baseline, keeping unwritten edits pending', async () => {
      const src = new FakeSource([summary('10')], {
        '10': game(
          '10',
          [ach('a1', false), ach('a2', false), ach('a3', false)],
          [stat('kills', 5), stat('deaths', 1)],
        ),
      })
      const { result } = setup(src)
      act(() => result.current.openGame('10'))
      await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())

      act(() => result.current.toggleAch('10', 'a1', false))
      act(() => result.current.toggleAch('10', 'a2', false))
      act(() => result.current.setStat('10', 'kills', '9'))
      // Steam took a1 before the write died; a2 and kills never landed. a3 and deaths
      // changed outside the app in the meantime.
      src.saveError = new Error('worker timed out')
      src.details['10'] = game(
        '10',
        [ach('a1', true), ach('a2', false), ach('a3', true)],
        [stat('kills', 5), stat('deaths', 2)],
      )
      await act(async () => {
        await result.current.store()
      })

      expect(src.saveCalls).toEqual([['10', { achievements: { a1: true, a2: true }, stats: { kills: 9 } }]])
      expect(src.loadGameCalls).toEqual(['10', '10'])
      expect(result.current.state.toast).toBe('Write failed: worker timed out')
      expect(result.current.state.saving).toBe(false)
      // The baseline is what Steam actually has now.
      expect(result.current.state.origAch['10']).toEqual({ a1: true, a2: false, a3: true })
      expect(result.current.state.origStat['10']).toEqual({ kills: 5, deaths: 2 })
      // a1 was written (no longer pending); a2 and kills are still pending edits, and
      // the untouched a3/deaths follow Steam instead of becoming phantom edits.
      expect(result.current.state.achState['10']).toEqual({ a1: true, a2: true, a3: true })
      expect(result.current.state.statState['10']).toEqual({ kills: 9, deaths: 2 })
      expect(result.current.state.games[0].completion).toEqual(done(2, 3))
    })

    it('keeps edits made while the failing save was in flight', async () => {
      const src = new FakeSource([summary('10')], {
        '10': game('10', [ach('a1', false), ach('a2', false), ach('a3', false)]),
      })
      src.saveError = new Error('boom')
      src.holdSave = true
      const { result } = setup(src)
      act(() => result.current.openGame('10'))
      await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())

      act(() => result.current.toggleAch('10', 'a1', false))
      act(() => {
        void result.current.store()
      })
      await waitFor(() => expect(src.saveCalls).toHaveLength(1))

      // While the write is in flight the user undoes a1 and turns a2 on; Steam had
      // already applied the a1 unlock before the save failed.
      act(() => result.current.toggleAch('10', 'a1', false))
      act(() => result.current.toggleAch('10', 'a2', false))
      src.details['10'] = game('10', [ach('a1', true), ach('a2', false), ach('a3', false)])
      await act(async () => {
        src.releaseSave?.()
      })
      await waitFor(() =>
        expect(result.current.state.origAch['10']).toEqual({ a1: true, a2: false, a3: false }),
      )

      expect(src.loadGameCalls).toEqual(['10', '10'])
      expect(result.current.state.saving).toBe(false)
      // Both in-flight edits survive and read as pending against the new baseline.
      expect(result.current.state.achState['10']).toEqual({ a1: false, a2: true, a3: false })
    })

    it('keeps Save held until the re-read has rebased the baseline', async () => {
      const src = new FakeSource([summary('10')], { '10': game('10', [ach('a1', false), ach('a2', false)]) })
      const { result } = setup(src)
      act(() => result.current.openGame('10'))
      await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())

      act(() => result.current.toggleAch('10', 'a1', false))
      src.saveError = new Error('worker timed out')
      src.holdLoad = true
      act(() => {
        void result.current.store()
      })
      await waitFor(() => expect(src.loadGameCalls).toEqual(['10', '10']))
      await waitFor(() => expect(result.current.state.toast).toBe('Write failed: worker timed out'))

      // The failure is reported, but the baseline is still the pre-save one: a retry
      // now would diff against it, so Save stays held while the re-read is out.
      await act(async () => {
        await macrotask()
      })
      expect(result.current.state.saving).toBe(true)
      expect(result.current.state.origAch['10']).toEqual({ a1: false, a2: false })

      // Steam had taken a1 before the write died.
      src.details['10'] = game('10', [ach('a1', true), ach('a2', false)])
      await act(async () => {
        src.releaseLoad?.()
      })
      await waitFor(() => expect(result.current.state.saving).toBe(false))
      expect(result.current.state.origAch['10']).toEqual({ a1: true, a2: false })
    })

    it('keeps the current state, without throwing, when the re-read fails too', async () => {
      const src = new FakeSource([summary('10')], { '10': game('10', [ach('a1', false), ach('a2', false)]) })
      const { result } = setup(src)
      act(() => result.current.openGame('10'))
      await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())
      const loadedBefore = result.current.state.loaded['10']

      act(() => result.current.toggleAch('10', 'a1', false))
      src.saveError = new Error('boom')
      src.loadGameError = new Error('Steam is not running')
      await act(async () => {
        await expect(result.current.store()).resolves.toBeUndefined()
      })

      expect(src.loadGameCalls).toEqual(['10', '10'])
      expect(result.current.state.toast).toBe('Write failed: boom')
      expect(result.current.state.saving).toBe(false)
      expect(result.current.state.detailStatus).toBe('ready')
      expect(result.current.state.loaded['10']).toBe(loadedBefore)
      // The edit is still there and still pending.
      expect(result.current.state.achState['10']).toEqual({ a1: true, a2: false })
      expect(result.current.state.origAch['10']).toEqual({ a1: false, a2: false })
    })

    it('rebases only the saved game when the user has switched to another one', async () => {
      const src = new FakeSource([summary('10'), summary('20')], {
        '10': game('10', [ach('a1', false), ach('a2', false)]),
        '20': game('20', [ach('b1', true)]),
      })
      src.saveError = new Error('boom')
      src.holdSave = true
      const { result } = setup(src)
      act(() => result.current.openGame('10'))
      await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())

      act(() => result.current.toggleAch('10', 'a1', false))
      act(() => {
        void result.current.store()
      })
      await waitFor(() => expect(src.saveCalls).toHaveLength(1))
      act(() => result.current.openGame('20'))
      await waitFor(() => expect(result.current.state.loaded['20']).toBeDefined())

      src.details['10'] = game('10', [ach('a1', true), ach('a2', false)])
      await act(async () => {
        src.releaseSave?.()
      })
      await waitFor(() => expect(result.current.state.origAch['10']).toEqual({ a1: true, a2: false }))

      expect(src.loadGameCalls).toEqual(['10', '20', '10'])
      expect(result.current.state.saving).toBe(false)
      expect(result.current.state.achState['10']).toEqual({ a1: true, a2: false })
      // The game now on screen is untouched.
      expect(result.current.state.activeAppId).toBe('20')
      expect(result.current.state.detailStatus).toBe('ready')
      expect(result.current.state.achState['20']).toEqual({ b1: true })
      expect(result.current.state.origAch['20']).toEqual({ b1: true })
    })

    it('does not bring back a game that left the detail cache during the re-read', async () => {
      const src = new FakeSource([summary('10')], { '10': game('10', [ach('a1', false)]) })
      src.saveError = new Error('boom')
      src.holdSave = true
      const { result } = setup(src)
      act(() => result.current.openGame('10'))
      await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())

      act(() => result.current.toggleAch('10', 'a1', false))
      act(() => {
        void result.current.store()
      })
      await waitFor(() => expect(src.saveCalls).toHaveLength(1))
      // Stand-in for a detail-cache eviction while the save is in flight.
      act(() => result.current.set({ loaded: {}, achState: {}, statState: {}, origAch: {}, origStat: {} }))
      await act(async () => {
        src.releaseSave?.()
        await macrotask()
      })

      expect(src.loadGameCalls).toEqual(['10', '10'])
      expect(result.current.state.saving).toBe(false)
      expect(result.current.state.loaded['10']).toBeUndefined()
      expect(result.current.state.origAch['10']).toBeUndefined()
    })

    it('skips the re-read once a newer save has started', async () => {
      const src = new FakeSource([summary('10')], { '10': game('10', [ach('a1', false), ach('a2', false)]) })
      src.holdSave = true
      const { result } = setup(src)
      act(() => result.current.openGame('10'))
      await waitFor(() => expect(result.current.state.loaded['10']).toBeDefined())

      // First save will fail; a second one starts before the first settles.
      src.saveError = new Error('boom')
      act(() => result.current.toggleAch('10', 'a1', false))
      act(() => {
        void result.current.store()
      })
      await waitFor(() => expect(src.saveCalls).toHaveLength(1))
      src.saveError = null
      src.saveResult = { saved: 2, rejected: [] }
      act(() => result.current.toggleAch('10', 'a2', false))
      act(() => {
        void result.current.store()
      })
      await waitFor(() => expect(src.saveCalls).toHaveLength(2))

      await act(async () => {
        src.heldSaves[0]()
      })
      await waitFor(() => expect(result.current.state.toast).toBe('Write failed: boom'))
      await settle()
      // No stale re-read: the newer save owns the outcome.
      expect(src.loadGameCalls).toEqual(['10'])
      expect(result.current.state.origAch['10']).toEqual({ a1: false, a2: false })

      await act(async () => {
        src.heldSaves[1]()
      })
      await waitFor(() => expect(result.current.state.origAch['10']).toEqual({ a1: true, a2: true }))
      expect(src.loadGameCalls).toEqual(['10'])
      expect(result.current.state.toast).toBe('Wrote 2 changes to Steam')
    })
  })

  describe('installUpdate', () => {
    beforeEach(() => {
      updateApi.fetchLatestVersion.mockReset().mockResolvedValue('0.0.0')
      updateApi.installLatestUpdate.mockReset().mockResolvedValue(true)
      updateApi.openReleasesPage.mockReset().mockResolvedValue(undefined)
      updateApi.updaterSupported.mockReset().mockResolvedValue(false)
    })

    it('applies download progress events onto updateInstall as they arrive', () => {
      updateApi.installLatestUpdate.mockImplementation(async (onEvent) => {
        onEvent({ event: 'Started', data: { contentLength: 1000 } })
        onEvent({ event: 'Progress', data: { chunkLength: 400 } })
        return true
      })
      const { result } = setup(new FakeSource([], {}))

      act(() => result.current.installUpdate())

      expect(result.current.state.updateInstall).toEqual({ phase: 'downloading', received: 400, total: 1000 })
      expect(updateApi.installLatestUpdate).toHaveBeenCalledTimes(1)
    })

    it('reports a phase of installing once the download finishes, then leaves state alone on a successful relaunch', async () => {
      updateApi.installLatestUpdate.mockImplementation(async (onEvent) => {
        onEvent({ event: 'Started', data: {} })
        onEvent({ event: 'Finished' })
        return true
      })
      const { result } = setup(new FakeSource([], {}))

      act(() => result.current.installUpdate())
      expect(result.current.state.updateInstall.phase).toBe('installing')
      await settle()
      // A successful install ends in a relaunch (handled inside the mocked module) — the
      // resolved `true` leaves updateInstall as the caller last reported it, no error.
      expect(result.current.state.updateInstall.phase).toBe('installing')
    })

    it('marks the install failed with the no-package message when nothing is available for this platform', async () => {
      updateApi.installLatestUpdate.mockResolvedValue(false)
      const { result } = setup(new FakeSource([], {}))

      act(() => result.current.installUpdate())
      await waitFor(() => expect(result.current.state.updateInstall.phase).toBe('error'))

      expect(result.current.state.updateInstall).toEqual({
        phase: 'error', received: 0, total: null, error: 'No update package for this platform',
      })
    })

    it('marks the install failed with the error message when the download/install rejects', async () => {
      updateApi.installLatestUpdate.mockRejectedValue(new Error('network down'))
      const { result } = setup(new FakeSource([], {}))

      act(() => result.current.installUpdate())
      await waitFor(() => expect(result.current.state.updateInstall.phase).toBe('error'))

      expect(result.current.state.updateInstall).toEqual({
        phase: 'error', received: 0, total: null, error: 'network down',
      })
    })

    it('is a no-op while an install is already in flight', async () => {
      let resolveInstall: (v: boolean) => void = () => {}
      updateApi.installLatestUpdate.mockImplementation(
        () => new Promise((resolve) => { resolveInstall = resolve }),
      )
      const { result } = setup(new FakeSource([], {}))

      act(() => result.current.installUpdate())
      expect(result.current.state.updateInstall.phase).toBe('downloading')
      act(() => result.current.installUpdate())
      expect(updateApi.installLatestUpdate).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveInstall(true)
        await Promise.resolve()
      })
    })
  })
})
