// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamSource } from '../../data/source'
import { AppProvider, useApp } from '../../state/AppContext'
import UpdateBanner from '../UpdateBanner'

const seam = vi.hoisted(() => ({ source: null as unknown }))
vi.mock('../../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data')>()
  return { ...original, isTauri: () => false, getSource: () => seam.source as SamSource }
})

const updateApi = vi.hoisted(() => ({
  fetchLatestVersion: vi.fn(async () => '0.0.0'),
  installLatestUpdate: vi.fn(async () => true),
  openReleasesPage: vi.fn(async () => {}),
  updaterSupported: vi.fn(async () => false),
}))
vi.mock('../../data/update', () => updateApi)

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

/** Exposes the live AppContext value alongside the component under test, so a test
 *  can drive state directly (`appRef.current.set(...)`) without a full check flow. */
function Harness({ appRef }: { appRef: { current: AppApi | null } }) {
  const app = useApp()
  appRef.current = app
  return <UpdateBanner />
}

function renderBanner() {
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

describe('UpdateBanner', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/'
    updateApi.openReleasesPage.mockClear()
  })

  it('renders nothing without a pending update', () => {
    renderBanner()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders nothing once the update is dismissed', () => {
    const appRef = renderBanner()
    act(() => appRef.current!.set({ update: { latest: '2.0.1', isNew: true } }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => appRef.current!.set({ updateDismissed: '2.0.1' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the banner for a new version and dismisses it via the close button', async () => {
    const user = userEvent.setup()
    const appRef = renderBanner()
    act(() => appRef.current!.set({ update: { latest: '2.0.1', isNew: true } }))

    expect(screen.getByRole('status')).toHaveTextContent('New version 2.0.1 available')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens the Releases page when this build cannot self-update', async () => {
    const user = userEvent.setup()
    const appRef = renderBanner()
    act(() => appRef.current!.set({ update: { latest: '2.0.1', isNew: true }, updaterSupported: false }))

    await user.click(screen.getByRole('button', { name: 'Download' }))
    expect(updateApi.openReleasesPage).toHaveBeenCalledTimes(1)
  })

  it('disables both the action and dismiss buttons while an install is in progress', () => {
    const appRef = renderBanner()
    act(() => appRef.current!.set({
      update: { latest: '2.0.1', isNew: true },
      updaterSupported: true,
      updateInstall: { phase: 'downloading', received: 100, total: 200 },
    }))

    expect(screen.getByRole('status')).toHaveTextContent('Downloading update… 50%')
    expect(screen.getByRole('button', { name: 'Update now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
  })
})
