// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
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

describe('App UI integration', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/'
  })

  it('covers the core library, game, edit, stats, and settings journey', async () => {
    const user = userEvent.setup()
    render(<HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></HashRouter>)

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    const separator = screen.getByRole('separator')
    separator.focus()
    await user.keyboard('{ArrowRight}')
    expect(separator).toHaveAttribute('aria-valuenow', '288')
    const gameSearch = screen.getByRole('textbox', { name: 'Search games…' })
    await user.type(gameSearch, 'Nebula Drift')
    expect(screen.getByTestId('library-game-487120')).toBeInTheDocument()
    expect(screen.queryByTestId('library-game-503310')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('library-game-487120'))
    expect(await screen.findByRole('heading', { name: 'Nebula Drift' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search achievements…' })).toBeInTheDocument()

    const unlockedAchievement = screen.getByRole('button', { name: /Maiden Voyage: Unlocked/ })
    await user.click(unlockedAchievement)
    expect(screen.getByRole('button', { name: /Maiden Voyage: Pending lock/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes (1)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Statistics' }))
    expect(await screen.findByText('Total Races')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enable value editing' }))
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)

    await user.click(screen.getByTestId('settings-toggle'))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Light/ }))
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('sam-settings-v1') ?? '{}')).toMatchObject({
        lang: 'en-US', theme: 'light',
      })
    })
  })
})
