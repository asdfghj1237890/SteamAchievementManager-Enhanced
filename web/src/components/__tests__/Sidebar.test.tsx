// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamSource } from '../../data/source'
import type { Game, GameSummary } from '../../types'
import { AppProvider, useApp } from '../../state/AppContext'
import ConfirmDialog from '../ConfirmDialog'
import Sidebar from '../Sidebar'

const seam = vi.hoisted(() => ({ source: null as unknown }))
vi.mock('../../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data')>()
  return { ...original, isTauri: () => false, getSource: () => seam.source as SamSource }
})

const SUMMARY: GameSummary = { appId: '10', id: '10', name: 'Game 10', genre: '', type: 'normal', hue: 0 }
const GAME: Game = {
  ...SUMMARY, y: 2024, m: 1, last: '', stats: [],
  achievements: [
    { id: 'a1', name: 'a1', desc: '', rarity: 0, unlocked: false, hidden: false, protected: false, points: 0 },
  ],
}

class StubSource implements SamSource {
  async listGames() {
    return [SUMMARY]
  }
  async loadGame() {
    return structuredClone(GAME)
  }
  async saveChanges() {
    return { saved: 0, rejected: [] }
  }
}

type AppApi = ReturnType<typeof useApp>

/** The sidebar and the confirmation modal on the real AppContext. The ref stands in
 *  for the game screen: it opens game 10 and makes edits on it. */
function Harness({ appRef }: { appRef: { current: AppApi | null } }) {
  appRef.current = useApp()
  return (
    <>
      <Sidebar />
      <ConfirmDialog />
    </>
  )
}

/** Mounts on game 10's route with that game loaded as the active one. */
async function renderSidebar() {
  seam.source = new StubSource()
  const appRef: { current: AppApi | null } = { current: null }
  render(
    <HashRouter>
      <AppProvider>
        <Harness appRef={appRef} />
      </AppProvider>
    </HashRouter>,
  )
  act(() => appRef.current!.openGame('10'))
  await waitFor(() => expect(appRef.current!.state.loaded['10']).toBeDefined())
  return appRef
}

describe('Sidebar add by App ID', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/game/10'
  })

  it('Enter opens the added game when nothing is unsaved', async () => {
    await renderSidebar()
    const user = userEvent.setup()

    await user.type(screen.getByRole('textbox', { name: 'Add by App ID…' }), '20')
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#/game/20')
    expect(screen.getByTestId('sidebar-game-20')).toBeInTheDocument()
  })

  it('the Enter that raises the unsaved-changes guard does not also accept it', async () => {
    const appRef = await renderSidebar()
    act(() => appRef.current!.toggleAch('10', 'a1', false))
    const user = userEvent.setup()

    await user.type(screen.getByRole('textbox', { name: 'Add by App ID…' }), '20')
    await user.keyboard('{Enter}')

    // The guard takes focus on "Leave" while that keydown is still being handled; the
    // same key press must not go on to activate it.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave' })).toHaveFocus()
    expect(window.location.hash).toBe('#/game/10')

    // A second, deliberate press is the confirmation.
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#/game/20')
  })
})
