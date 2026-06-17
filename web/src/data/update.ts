import { invoke } from '@tauri-apps/api/core'

/** Latest published version from the hosted latest.json (Tauri only). */
export async function fetchLatestVersion(): Promise<string> {
  return invoke<string>('latest_version')
}

/** Open the GitHub Releases page in the default browser (Tauri only). The URL is
 *  fixed in Rust — no renderer-supplied input — so there is no shell-injection seam. */
export async function openReleasesPage(): Promise<void> {
  await invoke('open_releases')
}
