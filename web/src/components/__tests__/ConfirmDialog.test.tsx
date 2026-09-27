// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamSource } from '../../data/source'
import { AppProvider, useApp } from '../../state/AppContext'
import ConfirmDialog from '../ConfirmDialog'

const seam = vi.hoisted(() => ({ source: null as unknown }))
vi.mock('../../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data')>()
  return { ...original, isTauri: () => false, getSource: () => seam.source as SamSource }
})

class StubSource implements SamSource {
  async listGames() {
    return []
  }
  async loadGame(): Promise<never> {
    throw new Error('unused')
  }
  async saveChanges() {
    return { saved: 0, rejected: [] }
  }
}

type AppApi = ReturnType<typeof useApp>

/** Exposes requestConfirm/confirmResolve alongside the dialog under test, driven
 *  through the real AppContext rather than a standalone prop-driven stub. */
function Harness({ appRef }: { appRef: { current: AppApi | null } }) {
  const app = useApp()
  appRef.current = app
  return <ConfirmDialog />
}

function renderDialog() {
  seam.source = new StubSource()
  const appRef: { current: AppApi | null } = { current: null }
  render(
    <HashRouter>
      <AppProvider>
        <Harness appRef={appRef} />
      </AppProvider>
    </HashRouter>,
  )
  return appRef
}

/** Opens the confirmation with a fresh onConfirm spy and returns it. */
function open(appRef: { current: AppApi | null }) {
  const onConfirm = vi.fn()
  act(() => appRef.current!.requestConfirm({
    message: 'Reset all stats for this game?', confirmLabel: 'Reset', danger: true, onConfirm,
  }))
  return onConfirm
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/'
  })

  it('renders nothing when no confirmation is requested', () => {
    renderDialog()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('Escape dismisses without running onConfirm', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('clicking the overlay dismisses without running onConfirm', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef)
    const overlay = screen.getByRole('alertdialog').parentElement as HTMLElement

    await userEvent.click(overlay)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('the Cancel button dismisses without running onConfirm', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('the confirm button runs onConfirm and closes the dialog', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef)

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Enter runs onConfirm and closes the dialog', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef)

    await userEvent.keyboard('{Enter}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('ignores keys other than Escape/Enter', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef)

    await userEvent.keyboard('a')

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('clicking inside the card does not dismiss', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef)

    await userEvent.click(screen.getByText('Reset all stats for this game?'))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
