// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockSource } from '../data/mockSource'

vi.mock('../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data')>()
  return {
    ...original,
    isTauri: () => false,
    getSource: () => new MockSource(0),
  }
})

import App from '../App'

/** Mount the whole app at a route with deterministic English / dark settings. */
function renderApp(hash = '#/') {
  window.location.hash = hash
  const user = userEvent.setup()
  render(<HashRouter><App /></HashRouter>)
  return user
}

describe('App UI integration', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
  })

  it('resizes the sidebar from the keyboard', async () => {
    const user = renderApp()
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    const separator = screen.getByRole('separator')
    separator.focus()
    await user.keyboard('{ArrowRight}')
    expect(separator).toHaveAttribute('aria-valuenow', '288')
    await user.keyboard('{Home}')
    expect(separator).toHaveAttribute('aria-valuenow', '220')
  })

  it('filters the library by name and opens the matching game', async () => {
    const user = renderApp()
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search games…' }), 'Nebula Drift')
    expect(screen.getByTestId('library-game-487120')).toBeInTheDocument()
    expect(screen.queryByTestId('library-game-503310')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('library-game-487120'))
    expect(await screen.findByRole('heading', { name: 'Nebula Drift' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search achievements…' })).toBeInTheDocument()
  })

  it('toggles an achievement and counts it as an unsaved change', async () => {
    const user = renderApp('#/game/487120')
    expect(await screen.findByRole('heading', { name: 'Nebula Drift' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Maiden Voyage: Unlocked/ }))
    expect(screen.getByRole('button', { name: /Maiden Voyage: Pending lock/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes (1)' })).toBeInTheDocument()
    // Toggling back clears the pending change.
    await user.click(screen.getByRole('button', { name: /Maiden Voyage: Pending lock/ }))
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('enables stat editing on the statistics tab', async () => {
    const user = renderApp('#/game/487120/stats')
    expect(await screen.findByText('Total Races')).toBeInTheDocument()
    expect(screen.queryAllByRole('textbox', { name: 'Total Races' })).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Enable value editing' }))
    expect(screen.getByRole('textbox', { name: 'Total Races' })).toBeInTheDocument()
  })

  it('guards leaving a game with unsaved edits, then persists the chosen theme', async () => {
    const user = renderApp('#/game/487120')
    expect(await screen.findByRole('heading', { name: 'Nebula Drift' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Maiden Voyage: Unlocked/ }))

    // Leaving with a pending change asks first; Leave proceeds to Settings.
    await user.click(screen.getByTestId('settings-toggle'))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Leave' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Light/ }))
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('sam-settings-v1') ?? '{}')).toMatchObject({
        lang: 'en-US', theme: 'light',
      })
    })
  })
})
