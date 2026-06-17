import { applyLoadedGame } from './applyLoadedGame'
import type { Game } from '../types'
import type { AppState } from './store'

/** The working ach/stat maps for one game, captured when a save begins. */
export interface SaveSnapshot {
  ach: Record<string, boolean>
  stat: Record<string, number>
}

/**
 * Merge a freshly re-read game after a *partial* save — Steam committed fewer
 * changes than we sent, so some were rejected and we re-read ground truth.
 *
 * Like {@link applyLoadedGame} this advances the saved baseline (origAch /
 * origStat) and cached detail to the freshly-read ground truth, so a rejected
 * edit is never shown as saved. Unlike it, this preserves edits the user made
 * *after* the save began: a key is kept from the live state only when its live
 * value diverges from `snapshot` (the working state captured at save start).
 *
 * Everything else takes the freshly-read ground truth — accepted changes,
 * rejected changes the user did not re-touch, untouched keys, and keys Steam
 * itself changed during the reload (e.g. an achievement the game unlocked while
 * the write was in flight). Comparing against the snapshot rather than the sent
 * payload is what stops a stale untouched value from being resurrected as a
 * pending edit.
 */
export function applyPartialSave(
  state: AppState,
  appId: string,
  game: Game,
  snapshot: SaveSnapshot,
): Partial<AppState> {
  const base = applyLoadedGame(state, appId, game)

  const mergedAch = { ...base.achState![appId] }
  const liveAch = state.achState[appId] ?? {}
  Object.keys(liveAch).forEach((k) => {
    if (liveAch[k] !== snapshot.ach[k]) mergedAch[k] = liveAch[k]
  })

  const mergedStat = { ...base.statState![appId] }
  const liveStat = state.statState[appId] ?? {}
  Object.keys(liveStat).forEach((k) => {
    if (liveStat[k] !== snapshot.stat[k]) mergedStat[k] = liveStat[k]
  })

  return {
    ...base,
    achState: { ...base.achState, [appId]: mergedAch },
    statState: { ...base.statState, [appId]: mergedStat },
  }
}
