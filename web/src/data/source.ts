import type { Game, GameCompletion, GameSummary } from '../types'

/** Changes to push for one game: achievementId -> unlocked, statId -> value. */
export interface GameChanges {
  achievements: Record<string, boolean>
  stats: Record<string, number>
}

export interface SaveResult {
  saved: number
}

/**
 * The single seam between the UI and whatever provides Steam data.
 *
 * - `MockSource` — bundled demo data (Phase 1).
 * - `TauriSource` — the local Steam client via Rust commands (Phase 2).
 *
 * `loadGame` returns a full `Game` (achievements + stats with their *current*
 * unlock/value state). Reverting unsaved edits ("reset") is a client-side store
 * action, so it is intentionally not part of this interface.
 */
export interface SamSource {
  /** Owned games for the library/sidebar (no achievements loaded). */
  listGames(): Promise<GameSummary[]>
  /** Full detail for one game, with current unlock state + stat values. */
  loadGame(appId: string): Promise<Game>
  /** Persist unlock/stat changes (writes to Steam in the Tauri source). */
  saveChanges(appId: string, changes: GameChanges): Promise<SaveResult>
  /**
   * Optional: per-game completion for filling the library/sidebar bars without
   * opening each game. The real source loads these lazily in the background.
   */
  loadProgress?(appId: string): Promise<GameCompletion>
}
