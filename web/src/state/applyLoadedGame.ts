import { completionFlat } from '../lib/achievements'
import type { Game } from '../types'
import type { AppState } from './store'

/**
 * Merge a freshly-loaded game's detail into app state.
 *
 * Alongside caching the in-memory detail (loaded / achState / statState / origAch /
 * origStat), this records the game's *completion* on its library-list entry. The
 * games-cache effect persists that, so a game you've opened keeps its progress bar on the
 * next launch instead of reloading — and the background progress loader skips it.
 */
export function applyLoadedGame(state: AppState, appId: string, game: Game): Partial<AppState> {
  const ach: Record<string, boolean> = {}
  const st: Record<string, number> = {}
  game.achievements.forEach((a) => {
    ach[a.id] = a.unlocked
  })
  game.stats.forEach((x) => {
    st[x.id] = x.value
  })

  const completion = completionFlat(game.achievements, ach)
  const patch: Partial<AppState> = {
    loaded: { ...state.loaded, [appId]: game },
    achState: { ...state.achState, [appId]: ach },
    statState: { ...state.statState, [appId]: st },
    origAch: { ...state.origAch, [appId]: { ...ach } },
    origStat: { ...state.origStat, [appId]: { ...st } },
    // Sync the real name and record the viewed completion on the list row. Matching by
    // appId or id covers add-by-id rows. Persisted by the games-cache effect, so the bar
    // shows instantly next launch and the background loader skips this game.
    games: state.games.map((g) =>
      g.appId === appId || g.id === appId ? { ...g, name: game.name || g.name, completion } : g,
    ),
  }

  if (state.activeAppId === appId) {
    patch.detailStatus = 'ready'
    patch.detailError = null
  }

  return patch
}
