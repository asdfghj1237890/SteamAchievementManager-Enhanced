import { describe, expect, it } from 'vitest'
import baseRaw from '../../src-tauri/tauri.conf.json?raw'
import macRaw from '../../src-tauri/tauri.macos.conf.json?raw'

// Tauri merges tauri.macos.conf.json over tauri.conf.json with JSON Merge Patch, which
// replaces arrays wholesale — so the macOS file has to repeat the whole main-window
// object. Only the window-chrome keys may differ; everything else must stay in step.
type Json = Record<string, unknown>
const windows = (conf: Json) => (conf.app as { windows: Json[] }).windows
const MAC_CHROME = ['decorations', 'titleBarStyle', 'hiddenTitle']
const withoutChrome = (win: Json) => Object.fromEntries(Object.entries(win).filter(([k]) => !MAC_CHROME.includes(k)))

describe('tauri.macos.conf.json', () => {
  const base: Json = JSON.parse(baseRaw)
  const mac: Json = JSON.parse(macRaw)

  it('overrides nothing but the main window', () => {
    expect(Object.keys(mac).filter((k) => k !== '$schema')).toEqual(['app'])
    expect(Object.keys(mac.app as Json)).toEqual(['windows'])
  })

  it('keeps every window setting except the chrome in step with tauri.conf.json', () => {
    expect(windows(mac).map(withoutChrome)).toEqual(windows(base).map(withoutChrome))
  })

  it('gives macOS the native, overlaid title bar (real traffic lights and corners)', () => {
    expect(windows(base)[0]).toMatchObject({ decorations: false })
    expect(windows(mac)[0]).toMatchObject({ decorations: true, titleBarStyle: 'Overlay', hiddenTitle: true })
  })
})
