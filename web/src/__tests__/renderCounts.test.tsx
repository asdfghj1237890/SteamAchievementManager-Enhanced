// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockSource } from '../data/mockSource'

/**
 * Render-count guards for the memoization on the hot paths. Each guarded component
 * calls exactly one of the wrapped helpers/hooks on every render, so counting those
 * calls counts renders — deterministic, no timing involved:
 *   SidebarRow + LibraryCard → activate() (one call per row/card render) and their
 *   <Cover> → useCoverUrl('capsule');  GameHeader → useCoverUrl('hero');
 *   Achievements → useGameScroll.
 */
const renders = vi.hoisted(() => ({ activate: 0, capsule: 0, hero: 0, gameScroll: 0 }))

vi.mock('../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data')>()
  return { ...original, isTauri: () => false, getSource: () => new MockSource(0) }
})
vi.mock('../lib/a11y', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/a11y')>()
  return {
    ...original,
    activate: (fn: () => void) => {
      renders.activate += 1
      return original.activate(fn)
    },
  }
})
vi.mock('../components/ui/useCoverUrl', async (importOriginal) => {
  const original = await importOriginal<typeof import('../components/ui/useCoverUrl')>()
  return {
    ...original,
    useCoverUrl: (appId: string, variant: Parameters<typeof original.useCoverUrl>[1]) => {
      if (variant === 'hero') renders.hero += 1
      else renders.capsule += 1
      return original.useCoverUrl(appId, variant)
    },
  }
})
vi.mock('../components/GameScroll', async (importOriginal) => {
  const original = await importOriginal<typeof import('../components/GameScroll')>()
  return {
    ...original,
    useGameScroll: () => {
      renders.gameScroll += 1
      return original.useGameScroll()
    },
  }
})

import App from '../App'

type Snapshot = typeof renders
const snapshot = (): Snapshot => ({ ...renders })
/** Library route: rows + cards (activate) and the covers they own (capsule). */
const leafDelta = (before: Snapshot) => ({
  rowsAndCards: renders.activate - before.activate,
  covers: renders.capsule - before.capsule,
})
const gameDelta = (before: Snapshot) => ({
  gameHeader: renders.hero - before.hero,
  achievements: renders.gameScroll - before.gameScroll,
})

/** jsdom has no layout: pretend every scroll container is this big. */
const LAYOUT = { clientHeight: 4000, clientWidth: 1600 }

describe('render counts on the hot paths', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/'
    // Tall + wide containers mount every demo game at once, so the deltas below measure
    // re-renders of already-mounted leaves, never legitimate mounts as a filter narrows
    // the virtual window.
    for (const [key, value] of Object.entries(LAYOUT)) {
      Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value })
    }
  })
  afterEach(() => {
    for (const key of Object.keys(LAYOUT)) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
    }
  })

  it('does not re-render library cards or sidebar rows for unrelated state changes', async () => {
    const user = userEvent.setup()
    render(<HashRouter><App /></HashRouter>)
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    const cards = screen.getAllByTestId(/^library-game-/).length
    expect(cards).toBeGreaterThan(1)
    expect(screen.getAllByTestId(/^sidebar-game-/)).toHaveLength(cards)
    expect(renders.activate).toBeGreaterThan(0)

    // Typing an App ID into the add box changes state.addId — nothing a card or row reads.
    const mounted = snapshot()
    const addInput = document.querySelector('aside input[aria-invalid="false"]') as HTMLInputElement
    await user.type(addInput, '12')
    expect(leafDelta(mounted)).toEqual({ rowsAndCards: 0, covers: 0 })

    // Filtering re-renders the lists, but the surviving card and row get identical props.
    const beforeSearch = snapshot()
    await user.type(screen.getByRole('textbox', { name: 'Search games…' }), 'Nebula Drift')
    expect(screen.getAllByTestId(/^library-game-/)).toHaveLength(1)
    expect(leafDelta(beforeSearch)).toEqual({ rowsAndCards: 0, covers: 0 })
  })

  it('keeps the game header out of scroll re-renders and skips no-op scroll ticks', async () => {
    const user = userEvent.setup()
    render(<HashRouter><App /></HashRouter>)
    // The sidebar lists every game; the virtualized library grid may not show this one.
    await user.click(await screen.findByTestId('sidebar-game-487120'))
    expect(await screen.findByRole('heading', { name: 'Nebula Drift' })).toBeInTheDocument()
    const container = document.querySelector('main > div') as HTMLDivElement
    expect(container).not.toBeNull()

    // jsdom has no layout, so give the container a real scroll offset before the event.
    Object.defineProperty(container, 'scrollTop', { value: 120, configurable: true, writable: true })
    const beforeScroll = snapshot()
    fireEvent.scroll(container)
    // The list needs the new metrics (one render); the header does not depend on scroll.
    expect(gameDelta(beforeScroll)).toEqual({ gameHeader: 0, achievements: 1 })

    // Same offset again → identical metrics → useVirtualScroll bails out, nothing renders.
    const beforeRepeat = snapshot()
    fireEvent.scroll(container)
    expect(gameDelta(beforeRepeat)).toEqual({ gameHeader: 0, achievements: 0 })
  })
})
