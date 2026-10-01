import type { CloseRequestedEvent } from '@tauri-apps/api/window'
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

// For AppProvider's unsaved-changes guard. `handler` runs when the user closes the
// window; unless it calls preventDefault(), Tauri then destroys the window by itself.
// Resolves to the function that stops listening.
export async function winOnCloseRequested(
  handler: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<() => void> {
  if (!isTauri()) return () => {}
  return (await current()).onCloseRequested(handler)
}

// Closes the window without asking again: winClose() raises another close request,
// which the guard would hold a second time.
export async function winDestroy(): Promise<void> {
  if (!isTauri()) return
  await (await current()).destroy()
}
