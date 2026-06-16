import { isTauri } from '../data'

// Window controls for the custom (decorations-less) title bar. No-ops on the web
// build; in the Tauri shell they drive the real OS window.
async function current() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export async function winMinimize(): Promise<void> {
  if (!isTauri()) return
  await (await current()).minimize()
}

export async function winToggleMaximize(): Promise<void> {
  if (!isTauri()) return
  await (await current()).toggleMaximize()
}

export async function winClose(): Promise<void> {
  if (!isTauri()) return
  await (await current()).close()
}
