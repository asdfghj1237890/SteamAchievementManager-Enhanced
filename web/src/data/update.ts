import { invoke } from '@tauri-apps/api/core'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import type { DownloadEvent } from '../lib/updater'

/** Latest published version from the signed release manifest (Tauri only). */
export async function fetchLatestVersion(): Promise<string> {
  return invoke<string>('latest_version')
}

/** Open the GitHub Releases page in the default browser (Tauri only). The URL is
 *  fixed in Rust — no renderer-supplied input — so there is no shell-injection seam. */
export async function openReleasesPage(): Promise<void> {
  await invoke('open_releases')
}

/**
 * True when this install can update itself in place: an NSIS install on Windows or
 * the .app bundle on macOS. A portable .exe cannot, and is offered the download link.
 */
export async function updaterSupported(): Promise<boolean> {
  return invoke<boolean>('updater_supported')
}

/**
 * Download, verify, and install the latest release, then relaunch. The updater plugin
 * fetches the manifest from the fixed endpoint in tauri.conf.json and checks the
 * package's minisign signature against the public key compiled into the app; anything
 * that does not verify is refused before it touches the disk. Resolves false when the
 * manifest has no newer package for this platform.
 */
export async function installLatestUpdate(onEvent: (event: DownloadEvent) => void): Promise<boolean> {
  const update = await check()
  if (!update) return false
  await update.downloadAndInstall(onEvent)
  // Windows hands over to the installer and exits by itself; macOS needs the relaunch.
  await relaunch()
  return true
}
