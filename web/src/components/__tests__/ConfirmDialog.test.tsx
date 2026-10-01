// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
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
 *  through the real AppContext rather than a standalone prop-driven stub. The
 *  "Bulk action" button stands in for a page control behind the modal: something
 *  focusable outside the dialog that can also open it from the keyboard. The
 *  "Quick action" field opens the same request from its own Enter keydown, the way
 *  the sidebar's add-by-App-ID box does. */
function Harness({ appRef, onBulk }: { appRef: { current: AppApi | null }; onBulk: () => void }) {
  const app = useApp()
  appRef.current = app
  const ask = () => app.requestConfirm({
    message: 'Apply this bulk action?', confirmLabel: 'Unlock all', onConfirm: onBulk,
  })
  return (
    <>
      <button onClick={ask}>Bulk action</button>
      <input
        aria-label="Quick action"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ask()
          }
        }}
      />
      <ConfirmDialog />
    </>
  )
}

function renderDialog(onBulk: () => void = () => {}) {
  seam.source = new StubSource()
  const appRef: { current: AppApi | null } = { current: null }
  render(
    <HashRouter>
      <AppProvider>
        <Harness appRef={appRef} onBulk={onBulk} />
      </AppProvider>
    </HashRouter>,
  )
  return appRef
}

/** Opens the confirmation with a fresh onConfirm spy and returns it. */
function open(appRef: { current: AppApi | null }, danger = true) {
  const onConfirm = vi.fn()
  act(() => appRef.current!.requestConfirm({
    message: 'Reset all stats for this game?', confirmLabel: 'Reset', danger, onConfirm,
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

  it('a danger request starts with focus on Cancel', () => {
    const appRef = renderDialog()
    open(appRef, true)

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('a non-danger request starts with focus on the confirm button', () => {
    const appRef = renderDialog()
    open(appRef, false)

    expect(screen.getByRole('button', { name: 'Reset' })).toHaveFocus()
  })

  it('Enter on the focused confirm button runs onConfirm and closes the dialog', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef, false)

    await userEvent.keyboard('{Enter}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Enter on the focused Cancel button dismisses without running onConfirm', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef, true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await userEvent.keyboard('{Enter}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Enter does nothing while neither button has focus', async () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef, false)
    act(() => (document.activeElement as HTMLElement).blur())
    expect(document.body).toHaveFocus()

    await userEvent.keyboard('{Enter}')

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('an auto-repeated Enter is swallowed, a fresh press is left to the button', () => {
    const appRef = renderDialog()
    const onConfirm = open(appRef, false)
    const confirmBtn = screen.getByRole('button', { name: 'Reset' })

    // fireEvent returns false when the event's default action was prevented.
    expect(fireEvent.keyDown(confirmBtn, { key: 'Enter', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(confirmBtn, { key: 'Enter' })).toBe(true)

    // Neither keydown resolves the dialog by itself; only the button's click does.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('an Enter held on the action that opened the dialog does not confirm it', async () => {
    const onBulk = vi.fn()
    renderDialog(onBulk)
    screen.getByRole('button', { name: 'Bulk action' }).focus()

    // First keydown clicks "Bulk action" and opens the dialog with its confirm button
    // focused; the two auto-repeats that follow land on that button.
    await userEvent.keyboard('{Enter>3/}')

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock all' })).toHaveFocus()
    expect(onBulk).not.toHaveBeenCalled()

    // Releasing and pressing again is a deliberate confirmation.
    await userEvent.keyboard('{Enter}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onBulk).toHaveBeenCalledTimes(1)
  })

  it('an Enter keydown in a field that opens the dialog does not confirm it', async () => {
    const onBulk = vi.fn()
    renderDialog(onBulk)
    screen.getByRole('textbox', { name: 'Quick action' }).focus()

    // The dialog focuses its confirm button while the keydown is still being handled.
    // The field prevented that keydown, so no keypress follows to activate the button.
    await userEvent.keyboard('{Enter}')

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock all' })).toHaveFocus()
    expect(onBulk).not.toHaveBeenCalled()
  })

  it('Tab and Shift+Tab cycle between the two buttons without leaving the dialog', async () => {
    const appRef = renderDialog()
    open(appRef, true)
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
    const confirmBtn = screen.getByRole('button', { name: 'Reset' })
    expect(cancelBtn).toHaveFocus()

    await userEvent.tab()
    expect(confirmBtn).toHaveFocus()
    // Wraps to Cancel rather than escaping to "Bulk action" behind the modal.
    await userEvent.tab()
    expect(cancelBtn).toHaveFocus()

    await userEvent.tab({ shift: true })
    expect(confirmBtn).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(cancelBtn).toHaveFocus()
  })

  it('Tab pulls focus back into the dialog when it is outside', async () => {
    const appRef = renderDialog()
    open(appRef, true)
    const outside = screen.getByRole('button', { name: 'Bulk action' })

    outside.focus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    outside.focus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveFocus()
  })

  it('ignores keys it does not handle', async () => {
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
