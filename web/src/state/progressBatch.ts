import type { Game, GameSummary } from '../types'

/**
 * App ids whose completion still has to be read from Steam's on-disk cache: games with
 * no loaded detail (a loaded game derives its completion live from its achievements)
 * that were not already requested since the last explicit refresh.
 *
 * The completion loader re-runs whenever the game list's id set changes. Without this
 * filter, adding one App ID (or a fresh scan turning up two new games) re-read every
 * schema file in the library; with it, only the newcomers are batched.
 */
export function progressIdsToRequest(
  games: GameSummary[],
  loaded: Record<string, Game>,
  requested: ReadonlySet<string>,
): string[] {
  return games.map((g) => g.appId).filter((id) => !loaded[id] && !requested.has(id))
}
