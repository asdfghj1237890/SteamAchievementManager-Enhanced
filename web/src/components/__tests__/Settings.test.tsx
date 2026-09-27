// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { HashRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamSource } from '../../data/source'
import { AppProvider, useApp } from '../../state/AppContext'
import Settings from '../Settings'

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

function Harness({ appRef }: { appRef: { current: AppApi | null } }) {
  const app = useApp()
  appRef.current = app
  return <Settings />
}

function renderSettings() {
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

describe('Settings update section', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/settings'
  })

  it('shows nothing before a version check has resolved (updateStatus idle)', () => {
    renderSettings()
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument()
    expect(screen.queryByText('Update check failed')).not.toBeInTheDocument()
  })

  it('shows "Up to date" once a successful check finds nothing newer', () => {
    const appRef = renderSettings()
    act(() => appRef.current!.set({ updateStatus: 'ok', update: { latest: '1.0.0', isNew: false } }))
    expect(screen.getByText('Up to date')).toBeInTheDocument()
  })

  it('shows a check-failed message when the version check errored', () => {
    const appRef = renderSettings()
    act(() => appRef.current!.set({ updateStatus: 'error' }))
    expect(screen.getByText('Update check failed')).toBeInTheDocument()
  })

  it('shows the install action with status and label when an update is available', () => {
    const appRef = renderSettings()
    act(() => appRef.current!.set({
      updateStatus: 'ok',
      update: { latest: '2.0.1', isNew: true },
      updaterSupported: true,
    }))
    expect(
      screen.getByRole('button', { name: 'New version 2.0.1 available · Update now' }),
    ).toBeInTheDocument()
  })

  it('falls back to the download label when this build cannot self-update', () => {
    const appRef = renderSettings()
    act(() => appRef.current!.set({
      updateStatus: 'ok',
      update: { latest: '2.0.1', isNew: true },
      updaterSupported: false,
    }))
    expect(
      screen.getByRole('button', { name: 'New version 2.0.1 available · Download' }),
    ).toBeInTheDocument()
  })
})
