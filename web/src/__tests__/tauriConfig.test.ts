import { describe, expect, it } from 'vitest'
import baseRaw from '../../src-tauri/tauri.conf.json?raw'
import macRaw from '../../src-tauri/tauri.macos.conf.json?raw'
import capabilityRaw from '../../src-tauri/capabilities/default.json?raw'
import cargoRaw from '../../src-tauri/Cargo.toml?raw'

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

// JSON Merge Patch (RFC 7396), the merge Tauri applies: objects merge key by key, null
// deletes, and anything else — arrays included — replaces the target.
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch
  const out: Json = isObject(target) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = mergePatch(out[k], v)
  }
  return out
}

describe('security settings', () => {
  const base: Json = JSON.parse(baseRaw)
  // What each platform actually runs with: Windows the base file, macOS the merged one.
  const effective: [string, Json][] = [
    ['windows', base],
    ['macos', mergePatch(base, JSON.parse(macRaw)) as Json],
  ]
  const capability: Json = JSON.parse(capabilityRaw)
  const permissions = capability.permissions as string[]

  it.each(effective)('binds the announced update version to the signature on %s', (_os, conf) => {
    // Without it the unsigned manifest can pair a new version number with an older,
    // validly signed package and roll the app back.
    const updater = (conf.plugins as { updater: Json }).updater
    expect(updater.requireSignedVersion).toBe(true)
  })

  it('requires an updater plugin that knows requireSignedVersion (2.12.0+)', () => {
    // Older plugins ignore the unknown key without complaint.
    const req = /^tauri-plugin-updater\s*=\s*(?:\{[^}\n]*?version\s*=\s*)?"[\^~=>\s]*(\d+)\.(\d+)/m.exec(cargoRaw)
    const [, major, minor] = (req ?? []).map(Number)
    expect([major, minor]).not.toContain(undefined)
    expect(major > 2 || (major === 2 && minor >= 12)).toBe(true)
  })

  it.each(effective)('closes the CSP directives that do not fall back to default-src on %s', (_os, conf) => {
    const csp = (conf.app as { security: { csp: string } }).security.csp
    const directives = csp.split(';').map((d) => d.trim())
    for (const name of ['object-src', 'base-uri', 'form-action', 'frame-ancestors']) {
      expect(directives).toContain(`${name} 'none'`)
    }
  })

  it('grants the updater and process plugins only the commands the frontend invokes', () => {
    // check() → updater|check, Update.downloadAndInstall() → updater|download_and_install,
    // relaunch() → process|restart (src/data/update.ts). The `default` sets add
    // download, install and exit, which nothing calls.
    expect(permissions).not.toContain('updater:default')
    expect(permissions).not.toContain('process:default')
    expect(permissions.filter((p) => !p.startsWith('core:')).sort()).toEqual([
      'process:allow-restart',
      'updater:allow-check',
      'updater:allow-download-and-install',
    ])
  })

  it('grants the window commands the title bar and the quit guard invoke', () => {
    // onCloseRequested makes Tauri hand the close to the JS side, which finishes it with
    // destroy() — a command core:window:default does not include.
    expect(permissions).toContain('core:default')
    expect(permissions.filter((p) => p.startsWith('core:window:')).sort()).toEqual([
      'core:window:allow-close',
      'core:window:allow-destroy',
      'core:window:allow-minimize',
      'core:window:allow-set-focus',
      'core:window:allow-show',
      'core:window:allow-start-dragging',
      'core:window:allow-toggle-maximize',
    ])
  })

  it('declares no remote capability', () => {
    // The vendored urlpattern shim (Cargo.toml [patch]) is only safe while no remote capability exists.
    expect(capability).not.toHaveProperty('remote')
  })
})
