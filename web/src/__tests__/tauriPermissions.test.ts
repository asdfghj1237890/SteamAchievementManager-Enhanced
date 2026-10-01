// @vitest-environment jsdom
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router'
import type { InvokeArgs } from '@tauri-apps/api/core'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as appWindow from '../lib/appWindow'
import * as update from '../data/update'
import { AppProvider, useApp } from '../state/AppContext'

// Tauri rejects a plugin command the window's capability does not grant, and only in the
// running app: the close guard's destroy() went three releases without
// core:window:allow-destroy. This test runs the app's own Tauri-facing code against
// Tauri's mock IPC, records every command it sends, and holds the capability to them.
// Nothing is vi.mock'ed: the installed @tauri-apps JS picks the commands, so they follow
// a library upgrade by themselves.
//
// Its limit: only code that runs here is recorded.
// - lib/appWindow.ts, data/update.ts: every export is called (MODULES), new ones included.
// - state/AppContext.tsx: driven by hand in beforeAll, on these paths only: mount (the
//   version check, the close guard's listener), a close request with nothing unsaved, one
//   with an unsaved edit and the confirmed quit after it (the provider's own destroy()),
//   unmount. Saving, refreshing, navigating, installing an update: NOT run. Today those
//   reach Tauri only through data/update.ts and the data source. A test below pins the
//   file's own ways in (its @tauri-apps imports, its one getCurrentWindow() call, the
//   members used on `win`), so a new one fails until it is driven. A window handle kept
//   under another name, or passed on to another file, is not seen.

// Read from disk rather than with `?raw`: the coverage report takes a raw import of a
// src/ file for the file itself. (The node reference is explained in releaseManifest.test.ts.)
const web = `${import.meta.dirname}/../../`
const read = (path: string) => readFileSync(web + path, 'utf8')
/** Every script under src/ that is not a test: path from web/ → text. */
const sources = new Map(
  readdirSync(`${web}src`, { recursive: true, encoding: 'utf8' })
    .map((path) => `src/${path.replace(/\\/g, '/')}`)
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !/\/__tests__\/|\.test\./.test(path))
    .map((path): [string, string] => [path, read(path)]),
)
const sourcesWith = (text: RegExp) => [...sources].filter(([, source]) => text.test(source)).map(([path]) => path).sort()

// ---- recording ----

const sent: string[] = []
const count = (command: string) => sent.filter((c) => c === command).length
const listeners: { event: string; handler: number }[] = []
const resolved: Record<string, unknown> = {}
const RESPONSES: Record<string, unknown> = {
  'plugin:app|version': '1.0.0',
  // Update metadata, so check() hands back an Update and the install goes on.
  'plugin:updater|check': { rid: 1, currentVersion: '1.0.0', version: '1.0.1', rawJson: {} },
  latest_version: '1.0.1',
  updater_supported: true,
  list_games: [],
  game_categories: [],
  // What TauriSource.loadGame() reads: a game with one achievement, there to be edited.
  load_game: { app_id: 10, name: 'Game', stats: [], achievements: [{ id: 'a1', name: 'a1', desc: '', hidden: false,
    unlocked: false, unlock_time: 0, rarity: 0, icon: '', icon_gray: '', protected: false }] },
}
function respond(command: string, payload?: InvokeArgs): unknown {
  sent.push(command)
  if (command !== 'plugin:event|listen') return RESPONSES[command] ?? null
  // Tauri answers with the id to unlisten by. `handler` is the library's callback, as the
  // id the mock's transformCallback registered it under.
  const listener = payload as (typeof listeners)[number]
  listeners.push(listener)
  return listener.handler
}

/** For a step of beforeAll that stopped short: it fails there, before any comparison is made. */
const STALE = 'The fake responses in tauriPermissions.test.ts (RESPONSES, the steps of beforeAll) no longer take the '
  + 'app to the end of this path, so what it sends there is not recorded. Fix them, not the capability or the table.'

/** Calls every export of an app module, a wrapper added later too, and keeps what each resolved to. */
async function exercise(name: string, module: Record<string, unknown>, args: Record<string, unknown[]>) {
  for (const [key, fn] of Object.entries(module)) {
    const given = args[key] ?? []
    if (typeof fn !== 'function') {
      throw new Error(`${name} exports ${key}, which is not a function: tauriPermissions.test.ts calls every export `
        + 'of this file, so export a function, or keep the value in a file that does not import Tauri')
    }
    if (fn.length !== given.length) {
      throw new Error(`${name} exports ${key}, which is not a function of ${given.length} argument(s): say how to `
        + 'call it in ARGS of tauriPermissions.test.ts, so that the Tauri commands it sends are recorded')
    }
    try {
      resolved[key] = await fn(...given)
    } catch (cause) {
      throw Object.assign(new Error(`${name}: ${key}() threw under the fake IPC. ${STALE}`), { cause })
    }
  }
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
/** Resolves once `step` has made the app send `command` exactly once more. */
async function sendsOne(command: string, what: string, step: () => void) {
  await act(macrotask) // what earlier steps left under way is sent first, so that it is not counted for this one
  const before = count(command)
  act(step)
  await waitFor(() => expect(count(command) - before, `${what} did not send one ${command}. If the app now sends `
    + `another command at this step on purpose, expect that one here instead. Otherwise: ${STALE}`).toBe(1))
}

// Not in node_modules: Tauri's window plugin injects src/window/scripts/drag.js, which
// sends start_dragging on mousedown over an element with the attribute and
// internal_toggle_maximize on a double-click. Read from the tauri 2.11.6 crate.
const DRAG_REGION = ['plugin:window|start_dragging', 'plugin:window|internal_toggle_maximize']
const dragRegion = () => (sourcesWith(/data-tauri-drag-region/).length > 0 ? DRAG_REGION : [])

/** Every `plugin:` command the main window sends. The app's own commands (latest_version,
 *  list_games, …) are sent here too but left out: with no app manifest, no ACL governs them. */
const recorded = () => [...new Set([...sent.filter((c) => c.startsWith('plugin:')), ...dragRegion()])].sort()

/** Every export of these is called in beforeAll, with ARGS where it takes arguments. */
const MODULES: Record<string, Record<string, unknown>> = { 'src/lib/appWindow.ts': appWindow, 'src/data/update.ts': update }
const ARGS: Record<string, unknown[]> = { installLatestUpdate: [() => {}] }
/** Driven by hand in beforeAll, on the paths the header lists. */
const CONTEXT = 'src/state/AppContext.tsx'

const realFetch = globalThis.fetch
beforeAll(async () => {
  // exercise() calls exports written after this test, with only the IPC mocked: none may get to the network.
  globalThis.fetch = () => {
    throw new Error('fetch() called in tauriPermissions.test.ts, which mocks only the Tauri IPC: fake that request too')
  }
  mockWindows('main')
  mockIPC(respond) // not shouldMockEvents: the mock would answer plugin:event|* itself, unrecorded

  // CONTEXT, mounted as in the desktop shell: isTauri() is true under the mock, so its source is the real TauriSource.
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(HashRouter, null, createElement(AppProvider, null, children))
  const { result: app, unmount } = renderHook(useApp, { wrapper })
  const { event, handler } = await waitFor(() => {
    const guard = listeners.find((l) => l.event === 'tauri://close-requested')
    if (!guard) throw new Error('AppProvider registered no onCloseRequested listener: drive what it does now instead')
    return guard
  }, { timeout: 5000 }) // behind the provider's lazy import of the window API
  // What Tauri does when the user closes the window: run the registered callback.
  const { runCallback } = window.__TAURI_INTERNALS__ as { runCallback: (id: number, data: unknown) => void }
  const requestClose = () => runCallback(handler, { event, id: handler, payload: null })
  // Nothing is unsaved, so the library's own wrapper goes on to destroy the window.
  await sendsOne('plugin:window|destroy', 'a close request with nothing unsaved', requestClose)
  // With an unsaved edit the provider holds the close and asks. Confirming runs its own
  // win.destroy(), the call that shipped ungranted: counted apart from the wrapper's above.
  act(() => app.current.openGame('10'))
  await waitFor(() => expect(app.current.state.loaded['10'], `Game 10 did not load. ${STALE}`).toBeDefined())
  act(() => app.current.toggleAch('10', 'a1', false))
  act(requestClose)
  expect(app.current.confirm?.danger, `A close request with an unsaved edit raised no quit dialog. ${STALE}`).toBe(true)
  await sendsOne('plugin:window|destroy', 'confirming the quit', () => app.current.confirmResolve(true))
  await sendsOne('plugin:event|unlisten', 'unmounting the provider', unmount)
  for (const [path, module] of Object.entries(MODULES)) await exercise(path, module, ARGS)
  // check() → Update.downloadAndInstall() → relaunch(), each answered by `respond`. false: it found no update.
  expect(resolved.installLatestUpdate, `installLatestUpdate() stopped before installing. ${STALE}`).toBe(true)
})
afterAll(clearMocks)
afterAll(() => { globalThis.fetch = realFetch })

// ---- confinement: no Tauri call from code that is not run above ----

/** Each line of CONTEXT that names @tauri-apps: with its one getCurrentWindow() call, every way it has into Tauri. */
const CONTEXT_TAURI = [
  "import { getVersion } from '@tauri-apps/api/app'",
  "const { getCurrentWindow } = await import('@tauri-apps/api/window')",
]
/** Not exercised. Trusted to import nothing but invoke, for the app's own commands, and the two helpers
 *  beside it that send no command at all (read in core.js of @tauri-apps/api 2.11.1). */
const INVOKE_ONLY = ['src/components/ui/useCoverUrl.ts', 'src/data/tauriSource.ts']
const HARMLESS = '(?:invoke|convertFileSrc|isTauri)'
const INVOKE_IMPORT = new RegExp(`^import \\{ ${HARMLESS}(?:, ${HARMLESS})* \\} from ['"]@tauri-apps/api/core['"];?$`)
/** A quoted '@tauri-apps/…': what an import, static or dynamic, names. */
const TAURI_IMPORT = /['"`]@tauri-apps\//
/** A file's lines, trimmed, less those that send nothing: comment-only lines and `import type`. */
const code = (path: string) => (sources.get(path) ?? '').split('\n').map((line) => line.trim())
  .filter((line) => !/^(\/\/|\/?\*|import type\b)/.test(line))
const tauriLines = (path: string) => code(path).filter((line) => TAURI_IMPORT.test(line))

// ---- comparison ----

// Plugins built into Tauri, whose permissions carry a `core:` prefix (the sets core:default
// is made of); a @tauri-apps/plugin-* package talks to a plugin under its own name.
const CORE_PLUGINS = ['app', 'event', 'image', 'menu', 'path', 'resources', 'tray', 'webview', 'window']
/** `plugin:window|set_title` → `core:window:allow-set-title`. */
function permission(command: string): string {
  const [plugin, name] = command.replace(/^plugin:/, '').split('|')
  return `${CORE_PLUGINS.includes(plugin) ? 'core:' : ''}${plugin}:allow-${name.replace(/_/g, '-')}`
}

// What `core:default` adds, for the commands the frontend leans on it for. The sets
// themselves are build output (src-tauri/gen/schemas/acl-manifests.json, gitignored and
// absent in the Vitest CI job), so the entries are repeated here; each was checked
// against that file as generated by tauri 2.11.6. Anything else has to be listed in the
// capability itself.
const IN_CORE_DEFAULT = [
  'core:app:allow-version', // core:app:default
  'core:event:allow-listen', // core:event:default
  'core:event:allow-unlisten', // core:event:default
  'core:window:allow-internal-toggle-maximize', // core:window:default
]

/** One line per command whose permission `granted` does not include. */
function ungranted(commands: string[], granted: string[]): string[] {
  const allowed = new Set(granted.includes('core:default') ? [...granted, ...IN_CORE_DEFAULT] : granted)
  return commands.filter((c) => !allowed.has(permission(c))).map((c) => `${c} needs ${permission(c)}`)
}

/**
 * How the commands the Rust test `main_window_acl_…` asks Tauri's real ACL to allow differ
 * from `commands`. Rows are `("plugin:window|destroy", true),`, which rustfmt may spread
 * over several lines.
 */
function tableDrift(rust: string, commands: string[]): string[] {
  const table = (/const MAIN_WINDOW_ACL:[^=]*=\s*&\[([\s\S]*?)\];/.exec(rust)?.[1] ?? '')
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
  const rows = [...table.matchAll(/\(\s*"(plugin:[\w-]+\|\w+)"\s*,\s*(true|false)\s*,?\s*\)/g)]
  const count = (part: RegExp) => (table.match(part) ?? []).length
  // No table, or something in it that is not such a row: another string, another tuple.
  if (rows.length === 0 || rows.length !== count(/"[^"]*"/g) || rows.length !== count(/\(/g)) {
    throw new Error('MAIN_WINDOW_ACL in src-tauri/src/lib.rs has rows this test cannot read')
  }
  const allowed = rows.filter(([, , allow]) => allow === 'true').map(([, command]) => command)
  return [
    ...commands.filter((c) => !allowed.includes(c)).map((c) => `sent, but no true row in MAIN_WINDOW_ACL: ${c}`),
    ...allowed.filter((c) => !commands.includes(c)).map((c) => `a true row in MAIN_WINDOW_ACL, but never sent: ${c}`),
  ]
}

const capability: { permissions: string[] } = JSON.parse(read('src-tauri/capabilities/default.json'))
const GRANT = 'For each command sent: grant its permission in src-tauri/capabilities/default.json and add a true '
  + 'row to MAIN_WINDOW_ACL in src-tauri/src/lib.rs, or stop sending it.'

describe('main window capability', () => {
  it('is checked against every file that imports Tauri', () => {
    const importers = [...sources.keys()].filter((path) => tauriLines(path).length > 0).sort()
    expect(importers, 'A file that imports @tauri-apps has to be added to MODULES, where beforeAll calls its every '
      + 'export, or nothing checks the commands it sends; or, if it only uses invoke for the app\'s own commands, to '
      + 'INVOKE_ONLY. (One that no longer imports it: take it off the list. A type-only import is ignored only '
      + 'when written as a one-line `import type … from`.)')
      .toEqual([...Object.keys(MODULES), CONTEXT, ...INVOKE_ONLY].sort())
    for (const path of INVOKE_ONLY) {
      expect(tauriLines(path).filter((line) => !INVOKE_IMPORT.test(line)), `${path} is not exercised here, so `
        + 'it may import only invoke, convertFileSrc and isTauri (these two send no command), in one line, from '
        + '@tauri-apps/api/core. For anything else, call a function exported by a file in MODULES').toEqual([])
    }
    // invoke('plugin:…') would send a plugin command from code that never runs here.
    const byName = [...sources.keys()].filter((path) => code(path).some((line) => /['"`]plugin:/.test(line))).sort()
    expect(byName, 'A plugin command sent by name is recorded by nothing: call the library function instead, from '
      + 'a file in MODULES').toEqual([])
  })

  it('knows every way state/AppContext.tsx has into Tauri, as only some of its paths run here', () => {
    const text = code(CONTEXT).join('\n')
    const found = {
      imports: tauriLines(CONTEXT),
      getCurrentWindowCalls: text.split('getCurrentWindow(').length - 1,
      // The window is held as `win`; a member used on it behind a branch beforeAll does not take is recorded by nothing.
      onWin: [...new Set([...text.matchAll(/\bwin\.(\w+)/g)].map(([, member]) => member))],
    }
    expect(found, `${CONTEXT} reaches Tauri in a way this test does not know, and a path of that file beforeAll `
      + 'does not take is recorded by nothing. Drive the new call in beforeAll of this test and update what is '
      + 'expected here, or move it behind src/lib/appWindow.ts (whose exports are exercised automatically).')
      .toEqual({ imports: CONTEXT_TAURI, getCurrentWindowCalls: 1, onWin: ['onCloseRequested', 'destroy'] })
  })

  it('grants every plugin command the frontend sends', () => {
    expect(ungranted(recorded(), capability.permissions), GRANT).toEqual([])
  })

  it('is what the Rust test asks the real ACL to allow, command for command', () => {
    // The check above only reads default.json. The Rust test resolves it as Tauri does,
    // but asks about nothing its table does not list, so the table is held to what was sent.
    expect(tableDrift(read('src-tauri/src/lib.rs'), recorded()), `${GRANT} For a row never sent: first check that `
      + 'beforeAll of this test still runs the code that sends it (a response in RESPONSES that no longer fits ends '
      + 'a path early). Only if the app really no longer sends it: make the row false and drop its grant.').toEqual([])
  })
})

describe('the permission check itself', () => {
  it('fails for the capability as it shipped, without core:window:allow-destroy', () => {
    const shipped = capability.permissions.filter((p) => p !== 'core:window:allow-destroy')
    expect(ungranted(recorded(), shipped)).toContain('plugin:window|destroy needs core:window:allow-destroy')
  })

  it('reports a command nothing grants, of a core plugin or not', () => {
    const commands = ['plugin:event|listen', 'plugin:window|show', 'plugin:window|set_always_on_top', 'plugin:process|exit']
    expect(ungranted(commands, ['core:default', 'core:window:allow-show'])).toEqual([
      'plugin:window|set_always_on_top needs core:window:allow-set-always-on-top',
      'plugin:process|exit needs process:allow-exit',
    ])
    // IN_CORE_DEFAULT counts only where the capability lists core:default.
    expect(ungranted(commands, ['core:window:allow-show'])).toHaveLength(3)
  })

  it('reports a Rust table that has drifted, and throws on one it cannot read', () => {
    const table = (...rows: string[]) => ['const MAIN_WINDOW_ACL: &[(&str, bool)] = &[', ...rows, '];'].join('\n')
    const rust = table('// ("plugin:window|destroy", true),', '("plugin:window|show", true),', '(',
      '    "plugin:window|hide",', '    true,', '),', '("plugin:window|close", false),')
    expect(tableDrift(rust, ['plugin:window|show', 'plugin:window|hide'])).toEqual([])
    expect(tableDrift(rust, ['plugin:window|show', 'plugin:window|destroy'])).toEqual([
      'sent, but no true row in MAIN_WINDOW_ACL: plugin:window|destroy',
      'a true row in MAIN_WINDOW_ACL, but never sent: plugin:window|hide',
    ])
    expect(() => tableDrift('fn main() {}', [])).toThrow(/cannot read/)
    expect(() => tableDrift(table('("plugin:app|version", true),', '(HIDE, true),'), [])).toThrow(/cannot read/)
  })
})
