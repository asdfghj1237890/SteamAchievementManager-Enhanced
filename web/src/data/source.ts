import type { Game, GameCompletion, GameSummary } from '../types'

/** Changes to push for one game: achievementId -> unlocked, statId -> value. */
export interface GameChanges {
  achievements: Record<string, boolean>
  stats: Record<string, number>
}

export interface SaveResult {
  saved: number
  /**
   * Ids that were not written: a schema-protected/unknown achievement, a
   * protected/unknown stat, a stat value that failed validation, a stat whose current
   * value could not be read, or a set/clear call Steam itself refused. Every
   * requested change is either counted in `saved` or listed here, so an empty list
   * means every requested change was accepted; the UI keys a partial save off this.
   */
  rejected: string[]
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
  /** Optional batch completion read for filling library/sidebar bars. Missing app
   * ids are represented by absent keys and shown as unavailable by the UI. */
  loadProgressBatch?(appIds: string[]): Promise<Record<string, GameCompletion>>
  /**
   * Optional: the user's own Steam library categories, keyed by app id. Used to
   * filter the sidebar by the player's own organization (real source only).
   */
  loadCategories?(): Promise<Record<string, string[]>>
}
