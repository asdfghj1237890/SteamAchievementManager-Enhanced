// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HashRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamSource } from '../../data/source'
import type { Game } from '../../types'
import { AppProvider, useApp } from '../../state/AppContext'
import TitleBar from '../TitleBar'

/** Toggle both isTauri() and the platform-detecting navigator.userAgent per test. */
const dataSeam = vi.hoisted(() => ({ source: null as unknown, tauri: false }))
vi.mock('../../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data')>()
  return { ...original, isTauri: () => dataSeam.tauri, getSource: () => dataSeam.source as SamSource }
})

const updateApi = vi.hoisted(() => ({
  fetchLatestVersion: vi.fn(async () => '0.0.0'),
  installLatestUpdate: vi.fn(async () => true),
  openReleasesPage: vi.fn(async () => {}),
  updaterSupported: vi.fn(async () => false),
}))
vi.mock('../../data/update', () => updateApi)

const winApi = vi.hoisted(() => ({
  winMinimize: vi.fn(async () => {}),
  winToggleMaximize: vi.fn(async () => {}),
  winClose: vi.fn(async () => {}),
  winShow: vi.fn(async () => {}),
}))
vi.mock('../../lib/appWindow', () => winApi)

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

const nebulaDrift: Game = {
  id: '487120', appId: '487120', name: 'Nebula Drift', genre: '', type: 'normal', hue: 0,
  y: 2024, m: 1, last: '', achievements: [], stats: [],
}

type AppApi = ReturnType<typeof useApp>

function Harness({ appRef }: { appRef: { current: AppApi | null } }) {
  const app = useApp()
  appRef.current = app
  return <TitleBar />
}

function renderTitleBar(hash: string) {
  window.location.hash = hash
  dataSeam.source = new StubSource()
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

describe('TitleBar', () => {
  beforeEach(() => {
    localStorage.setItem('sam-settings-v1', JSON.stringify({ lang: 'en-US', theme: 'dark' }))
    dataSeam.tauri = false
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the library title at the root route', () => {
    renderTitleBar('#/')
    expect(screen.getByText('Achievement Manager — Library')).toBeInTheDocument()
  })

  it('shows the settings title on the settings route', () => {
    renderTitleBar('#/settings')
    expect(screen.getByText('Achievement Manager — Settings')).toBeInTheDocument()
  })

  it("shows the game's name once its detail is loaded on a game route", () => {
    const appRef = renderTitleBar('#/game/487120')
    act(() => appRef.current!.set({ activeAppId: '487120', loaded: { 487120: nebulaDrift } }))
    expect(screen.getByText('Achievement Manager — Nebula Drift')).toBeInTheDocument()
  })

  describe('on Windows', () => {
    it('renders minimize/maximize/close controls wired to appWindow', async () => {
      const user = userEvent.setup()
      renderTitleBar('#/')

      await user.click(screen.getByRole('button', { name: 'Minimize' }))
      expect(winApi.winMinimize).toHaveBeenCalledTimes(1)
      await user.click(screen.getByRole('button', { name: 'Maximize' }))
      expect(winApi.winToggleMaximize).toHaveBeenCalledTimes(1)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(winApi.winClose).toHaveBeenCalledTimes(1)
    })

    it('renders no traffic-light stand-ins (those are a macOS-only affordance)', () => {
      // Note: the control icons are themselves `<svg aria-hidden>`, so the stand-in
      // wrapper (a `<div aria-hidden>`) is checked specifically rather than any
      // aria-hidden node.
      renderTitleBar('#/')
      expect(document.querySelector('div[aria-hidden]')).toBeNull()
    })
  })

  describe('on macOS', () => {
    beforeEach(() => {
      vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      )
    })

    it('renders aria-hidden traffic-light stand-ins in the web demo (isTauri() false)', () => {
      dataSeam.tauri = false
      renderTitleBar('#/')
      expect(screen.getByText('Achievement Manager — Library')).toBeInTheDocument()
      expect(document.querySelector('div[aria-hidden]')).not.toBeNull()
      // No Windows-style minimize/maximize/close controls on the mac branch.
      expect(screen.queryByRole('button', { name: 'Minimize' })).not.toBeInTheDocument()
    })

    it('renders no stand-ins inside Tauri — the OS draws the real traffic lights', () => {
      dataSeam.tauri = true
      renderTitleBar('#/')
      expect(screen.getByText('Achievement Manager — Library')).toBeInTheDocument()
      expect(document.querySelector('div[aria-hidden]')).toBeNull()
    })
  })
})
