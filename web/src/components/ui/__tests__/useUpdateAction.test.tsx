// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { HashRouter } from 'react-router'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamSource } from '../../../data/source'
import { AppProvider, useApp } from '../../../state/AppContext'
import { useUpdateAction } from '../useUpdateAction'

/** The source the provider picks up, swapped through the mocked data seam. */
const seam = vi.hoisted(() => ({ source: null as unknown }))
vi.mock('../../../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../data')>()
  return { ...original, isTauri: () => false, getSource: () => seam.source as SamSource }
})

/** In-app update seam (Tauri-only); unused here since these tests never click a
 *  button, but AppContext imports it at module scope so it must resolve safely. */
vi.mock('../../../data/update', () => ({
  fetchLatestVersion: vi.fn(async () => '0.0.0'),
  installLatestUpdate: vi.fn(async () => true),
  openReleasesPage: vi.fn(async () => {}),
  updaterSupported: vi.fn(async () => false),
}))

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

function setup() {
  seam.source = new StubSource()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HashRouter>
      <AppProvider>{children}</AppProvider>
    </HashRouter>
  )
  return renderHook(() => ({ app: useApp(), action: useUpdateAction() }), { wrapper })
}

describe('useUpdateAction', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    window.location.hash = '#/'
  })

  it('offers the in-app install when this build can update itself', () => {
    const { result } = setup()
    act(() => result.current.app.set({ update: { latest: '2.0.0', isNew: true }, updaterSupported: true }))

    expect(result.current.action.status).toBe('New version 2.0.0 available')
    expect(result.current.action.canInstall).toBe(true)
    expect(result.current.action.buttonLabel).toBe('Update now')
    expect(result.current.action.busy).toBe(false)
    expect(result.current.action.onClick).toBe(result.current.app.installUpdate)
  })

  it('falls back to the Releases page when this build cannot update itself', () => {
    const { result } = setup()
    act(() => result.current.app.set({ update: { latest: '2.0.0', isNew: true }, updaterSupported: false }))

    expect(result.current.action.canInstall).toBe(false)
    expect(result.current.action.buttonLabel).toBe('Download')
    expect(result.current.action.onClick).toBe(result.current.app.openReleases)
  })

  it('shows a downloading status with percentage while busy', () => {
    const { result } = setup()
    act(() => result.current.app.set({
      updaterSupported: true,
      updateInstall: { phase: 'downloading', received: 250, total: 1000 },
    }))

    expect(result.current.action.status).toBe('Downloading update… 25%')
    expect(result.current.action.busy).toBe(true)
    // Still supported and not yet failed, so the in-app action stays offered.
    expect(result.current.action.canInstall).toBe(true)
  })

  it('omits the percentage while the download size is not yet known', () => {
    const { result } = setup()
    act(() => result.current.app.set({
      updaterSupported: true,
      updateInstall: { phase: 'downloading', received: 0, total: null },
    }))

    expect(result.current.action.status).toBe('Downloading update… ')
  })

  it('shows an installing status while busy with no known percentage', () => {
    const { result } = setup()
    act(() => result.current.app.set({
      updaterSupported: true,
      updateInstall: { phase: 'installing', received: 1000, total: 1000 },
    }))

    expect(result.current.action.status).toBe('Installing update…')
    expect(result.current.action.busy).toBe(true)
  })

  it('shows the failure message and disables the in-app action once an install errors', () => {
    const { result } = setup()
    act(() => result.current.app.set({
      updaterSupported: true,
      updateInstall: { phase: 'error', received: 0, total: null, error: 'boom' },
    }))

    expect(result.current.action.status).toBe('Update failed: boom')
    expect(result.current.action.busy).toBe(false)
    // The error phase disables the in-app action even though the platform supports it.
    expect(result.current.action.canInstall).toBe(false)
    expect(result.current.action.buttonLabel).toBe('Download')
    expect(result.current.action.onClick).toBe(result.current.app.openReleases)
  })

  it('falls back to an empty message when the error phase carries no error text', () => {
    const { result } = setup()
    act(() => result.current.app.set({
      updaterSupported: true,
      updateInstall: { phase: 'error', received: 0, total: null },
    }))

    expect(result.current.action.status).toBe('Update failed: ')
  })
})
