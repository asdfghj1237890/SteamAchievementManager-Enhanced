import { invoke } from '@tauri-apps/api/core'

/** GitHub Releases page (latest) — where update downloads live. */
export const RELEASES_URL =
  'https://github.com/asdfghj1237890/SteamAchievementManager-Enhanced/releases/latest'

/** Latest published version from the hosted latest.json (Tauri only). */
export async function fetchLatestVersion(): Promise<string> {
  return invoke<string>('latest_version')
}

/** Open an https URL in the default browser (Tauri only). */
export async function openUrl(url: string): Promise<void> {
  await invoke('open_url', { url })
}
