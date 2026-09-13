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

// The window is created hidden (tauri.conf.json `visible: false`) so the OS never
// shows WebView2's blank white page while the bundle loads. AppLayout calls this
// after its first commit, so the first frame the user sees is the painted shell.
// lib.rs has a timed fallback in case the frontend never gets here.
export async function winShow(): Promise<void> {
  if (!isTauri()) return
  const win = await current()
  await win.show()
  await win.setFocus()
}
