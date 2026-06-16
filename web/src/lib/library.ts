import type { GameSummary, TypeFilter } from '../types'

/** Sidebar/library list after the type filter + name search are applied. */
export function visibleSummaries(
  games: GameSummary[],
  typeFilter: TypeFilter,
  gameSearch: string,
): GameSummary[] {
  const tq = gameSearch.trim().toLowerCase()
  return games.filter((x) => {
    if (typeFilter !== 'all' && x.type !== typeFilter) return false
    if (tq && x.name.toLowerCase().indexOf(tq) < 0) return false
    return true
  })
}

/** Average completion across the games that report it. */
export const averagePct = (list: GameSummary[]): number => {
  const withPct = list.filter((g) => g.completion)
  return withPct.length
    ? Math.round(withPct.reduce((a, g) => a + g.completion!.pct, 0) / withPct.length)
    : 0
}
