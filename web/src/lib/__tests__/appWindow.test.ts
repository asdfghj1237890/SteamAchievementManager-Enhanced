// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const win = vi.hoisted(() => ({
  show: vi.fn(async () => {}),
  setFocus: vi.fn(async () => {}),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }))

import { winShow } from '../appWindow'

type TauriGlobal = { __TAURI_INTERNALS__?: unknown }

describe('winShow', () => {
  afterEach(() => {
    delete (window as unknown as TauriGlobal).__TAURI_INTERNALS__
  })

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
