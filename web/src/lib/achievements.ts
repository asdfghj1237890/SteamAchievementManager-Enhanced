import type { Achievement, AchFilter, AchSort, AchState, Game, StatState } from '../types'

/** Apply the live unlock overrides on top of a game's base achievements. */
export const workingAch = (g: Game, achState: AchState): Achievement[] => {
  const w = achState[g.id] ?? {}
  return g.achievements.map((a) => ({ ...a, unlocked: !!w[a.id] }))
}

/** Reorder a list by the chosen key (returns a new array; 'default' keeps order). */
export const sortAch = (list: Achievement[], sort: AchSort): Achievement[] => {
  if (sort === 'default') return list
  const out = [...list]
  if (sort === 'rarity') out.sort((a, b) => a.rarity - b.rarity) // rarest (lowest %) first
  else if (sort === 'common') out.sort((a, b) => b.rarity - a.rarity) // most common (highest %) first
  else if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'unlock') out.sort((a, b) => (b.unlockTime ?? 0) - (a.unlockTime ?? 0)) // newest first
  return out
}

/** Achievements after the active filter + search query, then the chosen ordering. */
export const filteredAch = (
  g: Game,
  achState: AchState,
  origAch: AchState,
  filter: AchFilter,
  search: string,
  sort: AchSort = 'default',
): Achievement[] => {
  const w = achState[g.id] ?? {}
  const o = origAch[g.id] ?? {}
  const q = search.trim().toLowerCase()
  // Partition by the SAVED (committed) unlock state, not the live working state,
  // so toggling a row never makes it vanish from the current filter mid-edit.
  // The working state is still applied for display (the row's check reflects it).
  const list = g.achievements
    .filter((a) => {
      const saved = a.id in o ? o[a.id] : a.unlocked
      if (filter === 'unlocked' && !saved) return false
      if (filter === 'locked' && saved) return false
      if (q && a.name.toLowerCase().indexOf(q) < 0 && a.desc.toLowerCase().indexOf(q) < 0) return false
      return true
    })
    .map((a) => ({ ...a, unlocked: !!w[a.id] }))
  return sortAch(list, sort)
}

/** Number of unsaved changes (achievements + stats) for a game vs. the last saved snapshot. */
export const pendingCount = (
  g: Game,
  achState: AchState,
  origAch: AchState,
  statState: StatState,
  origStat: StatState,
): number => {
  let n = 0
  const aw = achState[g.id] ?? {}
  const ao = origAch[g.id] ?? {}
  Object.keys(aw).forEach((k) => {
    if (aw[k] !== ao[k]) n++
  })
  const sw = statState[g.id] ?? {}
  const so = origStat[g.id] ?? {}
  Object.keys(sw).forEach((k) => {
    if (sw[k] !== so[k]) n++
  })
  return n
}

export interface Completion {
  earned: number
  total: number
  pct: number
}

/** Earned / total / percentage for a game under the current unlock state. */
export const completion = (g: Game, achState: AchState): Completion => {
  const w = workingAch(g, achState)
  const earned = w.filter((a) => a.unlocked).length
  const total = w.length
  const pct = total ? Math.round((earned / total) * 100) : 0
  return { earned, total, pct }
}

/** Completion from a flat achievementId -> unlocked map (used for summaries + live overrides). */
export const completionFlat = (
  achievements: Achievement[],
  working: Record<string, boolean>,
): Completion => {
  const earned = achievements.reduce((n, a) => n + (working[a.id] ? 1 : 0), 0)
  const total = achievements.length
  return { earned, total, pct: total ? Math.round((earned / total) * 100) : 0 }
}

/** Points earned / total for a game (used in the detail banner). */
export const points = (g: Game, achState: AchState): { earned: number; total: number } => {
  const w = workingAch(g, achState)
  return {
    earned: w.filter((a) => a.unlocked).reduce((s, a) => s + a.points, 0),
    total: w.reduce((s, a) => s + a.points, 0),
  }
}

export type BulkMode = 'unlock' | 'lock' | 'invert'

/** Pure helper: apply a bulk operation to a game's unlock map for the given (non-protected) list. */
export const bulkApply = (
  current: Record<string, boolean>,
  list: Achievement[],
  mode: BulkMode,
): Record<string, boolean> => {
  const m = { ...current }
  list.forEach((a) => {
    m[a.id] = mode === 'unlock' ? true : mode === 'lock' ? false : !m[a.id]
  })
  return m
}
