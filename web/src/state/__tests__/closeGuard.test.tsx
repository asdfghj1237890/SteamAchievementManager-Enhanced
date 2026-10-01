// @vitest-environment jsdom
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamSource, SaveResult } from '../../data/source'
import type { Achievement, Game, GameSummary, Stat } from '../../types'

/** The source the provider picks up, and whether it believes it runs in the desktop shell. */
const seam = vi.hoisted(() => ({ source: null as unknown, tauri: false }))
vi.mock('../../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data')>()
  return { ...original, isTauri: () => seam.tauri, getSource: () => seam.source as SamSource }
})

const updateApi = vi.hoisted(() => ({
  fetchLatestVersion: vi.fn(async () => '0.0.0'),
  installLatestUpdate: vi.fn(async () => true),
  openReleasesPage: vi.fn(async () => {}),
  updaterSupported: vi.fn(async () => false),
}))
vi.mock('../../data/update', () => updateApi)

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>

/** Stand-in for the Tauri window. The handler the provider registers stays readable as
 *  onCloseRequested's first argument. Unlike the real wrapper, this one does not call
 *  destroy() itself after a handler that left the event alone. */
const win = vi.hoisted(() => {
  const unlisten = vi.fn()
  return {
    unlisten,
    destroy: vi.fn(async () => {}),
    onCloseRequested: vi.fn(async (_handler: CloseHandler): Promise<() => void> => unlisten),
  }
})
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))

import { AppProvider, useApp } from '../AppContext'
import ConfirmDialog from '../../components/ConfirmDialog'

class FakeSource implements SamSource {
  constructor(private readonly details: Record<string, Game>) {}

  async listGames(): Promise<GameSummary[]> {
    return []
  }

  async loadGame(appId: string): Promise<Game> {
    return structuredClone(this.details[appId])
  }

  async saveChanges(): Promise<SaveResult> {
    return { saved: 0, rejected: [] }
  }
}

const ach = (id: string, unlocked: boolean): Achievement => ({
  id, name: id, desc: '', rarity: 0, unlocked, hidden: false, protected: false, points: 0,
})
const stat = (id: string, value: number): Stat => ({ id, name: id, value, extra: '', protected: false })
const game = (appId: string, achievements: Achievement[], stats: Stat[] = []): Game => ({
  id: appId, appId, name: `Game ${appId}`, genre: '', type: 'normal', hue: 0,
  y: 2024, m: 1, last: '', achievements, stats,
})

type App = { current: ReturnType<typeof useApp> }

function setup(tauri: boolean, details: Record<string, Game> = {}) {
  seam.tauri = tauri
  seam.source = new FakeSource(details)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HashRouter>
      <AppProvider>
        {children}
        <ConfirmDialog />
      </AppProvider>
    </HashRouter>
  )
  return renderHook(() => useApp(), { wrapper })
}

/** A whole macrotask: every promise chain already under way has run to its end. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Desktop provider whose close listener is registered and held for cleanup. */
async function setupDesktop(details: Record<string, Game> = {}) {
  const view = setup(true, details)
  await waitFor(() => expect(win.onCloseRequested).toHaveBeenCalledTimes(1))
  await act(macrotask)
  return view
}

async function openGame(result: App, appId: string) {
  act(() => result.current.openGame(appId))
  await waitFor(() => expect(result.current.state.loaded[appId]).toBeDefined())
}

/** What Tauri does when the user closes the window: run the registered handler. */
async function requestClose() {
  const event = { preventDefault: vi.fn() }
  await act(async () => {
    await win.onCloseRequested.mock.calls[0][0](event)
  })
  return event
}

/** Desktop provider with game 10 open and two edits on it: one achievement, one stat. */
async function setupWithEdits() {
  const view = await setupDesktop({ '10': game('10', [ach('a1', false)], [stat('kills', 5)]) })
  await openGame(view.result, '10')
  act(() => view.result.current.toggleAch('10', 'a1', false))
  act(() => view.result.current.setStat('10', 'kills', '9'))
  return view
}

describe('window close guard', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/'
    vi.clearAllMocks()
  })

  it('registers no close listener outside the desktop shell', async () => {
    setup(false)
    // Outlast the provider's lazy import of the window API, so "never" is not "not yet".
    await act(async () => {
      await vi.dynamicImportSettled()
      await macrotask()
    })

    expect(win.onCloseRequested).not.toHaveBeenCalled()
  })

  it('lets the close through when the loaded game has no unsaved edits', async () => {
    const { result } = await setupDesktop({ '10': game('10', [ach('a1', false)]) })
    await openGame(result, '10')

    const event = await requestClose()

    // Not prevented: the real Tauri wrapper then destroys the window by itself.
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(result.current.confirm).toBeNull()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('holds the close and asks first when a game has unsaved edits', async () => {
    const { result } = await setupWithEdits()

    const event = await requestClose()

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(result.current.confirm).toMatchObject({
      message: 'You have 2 unsaved change(s). Quit anyway?', confirmLabel: 'Quit', danger: true,
    })
    expect(screen.getByRole('alertdialog')).toHaveTextContent('You have 2 unsaved change(s). Quit anyway?')
    expect(win.destroy).not.toHaveBeenCalled()
  })

  it('destroys the window once the user confirms quitting', async () => {
    await setupWithEdits()
    await requestClose()

    await userEvent.click(screen.getByRole('button', { name: 'Quit' }))

    expect(win.destroy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps the window open, edits intact, when the user cancels', async () => {
    const { result } = await setupWithEdits()
    await requestClose()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(win.destroy).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(result.current.state.achState['10']).toEqual({ a1: true })
    expect(result.current.state.statState['10']).toEqual({ kills: 9 })
  })

  it('counts unsaved edits across every loaded game, not just the one on screen', async () => {
    const { result } = await setupDesktop({
      '10': game('10', [ach('a1', false)]),
      '20': game('20', [ach('b1', false)], [stat('kills', 5)]),
    })
    await openGame(result, '10')
    act(() => result.current.toggleAch('10', 'a1', false))
    await openGame(result, '20')
    act(() => result.current.toggleAch('20', 'b1', false))
    act(() => result.current.setStat('20', 'kills', '9'))

    await requestClose()

    expect(result.current.state.activeAppId).toBe('20')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('You have 3 unsaved change(s). Quit anyway?')
  })

  it('stops listening when the provider unmounts', async () => {
    const { unmount } = await setupDesktop()
    expect(win.unlisten).not.toHaveBeenCalled()

    unmount()

    expect(win.unlisten).toHaveBeenCalledTimes(1)
  })

  it('stops listening as soon as a registration still in flight at unmount completes', async () => {
    let finish: (unlisten: () => void) => void = () => {}
    win.onCloseRequested.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const { unmount } = setup(true)
    await waitFor(() => expect(win.onCloseRequested).toHaveBeenCalledTimes(1))

    // Nothing to unlisten yet: Tauri has not handed the function back.
    unmount()
    expect(win.unlisten).not.toHaveBeenCalled()

    finish(win.unlisten)
    await macrotask()
    expect(win.unlisten).toHaveBeenCalledTimes(1)
  })
})
