// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const win = vi.hoisted(() => {
  const unlisten = vi.fn()
  return {
    show: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    unlisten,
    onCloseRequested: vi.fn(async (_handler: () => void): Promise<() => void> => unlisten),
    destroy: vi.fn(async () => {}),
  }
})
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))

import { winDestroy, winOnCloseRequested, winShow } from '../appWindow'

type TauriGlobal = { __TAURI_INTERNALS__?: unknown }

afterEach(() => {
  delete (window as unknown as TauriGlobal).__TAURI_INTERNALS__
})

describe('winShow', () => {
  it('is a no-op on the web build', async () => {
    await winShow()
    expect(win.show).not.toHaveBeenCalled()
    expect(win.setFocus).not.toHaveBeenCalled()
  })

  it('shows and focuses the hidden window in the Tauri shell', async () => {
    ;(window as unknown as TauriGlobal).__TAURI_INTERNALS__ = {}
    await winShow()
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.setFocus).toHaveBeenCalledTimes(1)
  })
})

describe('winOnCloseRequested', () => {
  it('registers nothing on the web build, and still resolves to a function to call', async () => {
    const unlisten = await winOnCloseRequested(() => {})
    expect(win.onCloseRequested).not.toHaveBeenCalled()
    unlisten()
    expect(win.unlisten).not.toHaveBeenCalled()
  })

  it('registers the handler on the window in the Tauri shell and resolves to its unlisten', async () => {
    ;(window as unknown as TauriGlobal).__TAURI_INTERNALS__ = {}
    const handler = () => {}
    const unlisten = await winOnCloseRequested(handler)
    expect(win.onCloseRequested).toHaveBeenCalledTimes(1)
    expect(win.onCloseRequested).toHaveBeenCalledWith(handler)
    expect(unlisten).toBe(win.unlisten)
  })
})

describe('winDestroy', () => {
  it('is a no-op on the web build', async () => {
    await winDestroy()
    expect(win.destroy).not.toHaveBeenCalled()
  })

  it('destroys the window in the Tauri shell', async () => {
    ;(window as unknown as TauriGlobal).__TAURI_INTERNALS__ = {}
    await winDestroy()
    expect(win.destroy).toHaveBeenCalledTimes(1)
  })
})
