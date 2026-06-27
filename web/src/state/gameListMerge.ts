import type { GameSummary } from '../types'

/** Merge a freshly scanned Steam library with cached/manual rows. */
export function mergeFreshGames(current: GameSummary[], fresh: GameSummary[]): GameSummary[] {
  const previous = new Map(current.map((g) => [g.appId, g]))
  const freshIds = new Set(fresh.map((g) => g.appId))

  const merged = fresh.map((g) => {
    const old = previous.get(g.appId)
    return { ...g, completion: g.completion ?? old?.completion }
  })

  const manual = current
    .filter((g) => g.manual && !freshIds.has(g.appId))
    .map((g) => ({ ...g }))

  return [...merged, ...manual].sort((a, b) => a.name.localeCompare(b.name))
}

export function appIdKey(games: GameSummary[]): string {
  return games.map((g) => g.appId).sort().join('|')
}
