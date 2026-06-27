import { pendingCount } from '../lib/achievements'
import type { AppState } from './store'

export const DETAIL_CACHE_LIMIT = 5

const omitKey = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record }
  delete next[key]
  return next
}

export function touchDetailCache(
  state: AppState,
  appId: string,
  limit = DETAIL_CACHE_LIMIT,
): Partial<AppState> {
  const order = [...state.detailOrder.filter((id) => id !== appId), appId].filter((id) => state.loaded[id])
  const evict = new Set<string>()

  for (const id of order) {
    if (order.length - evict.size <= limit) break
    const game = state.loaded[id]
    if (!game || id === state.activeAppId) continue
    if (pendingCount(game, state.achState, state.origAch, state.statState, state.origStat) > 0) continue
    evict.add(id)
  }

  const detailOrder = order.filter((id) => !evict.has(id))
  if (evict.size === 0) return { detailOrder }

  let loaded = state.loaded
  let achState = state.achState
  let statState = state.statState
  let origAch = state.origAch
  let origStat = state.origStat

  for (const id of evict) {
    loaded = omitKey(loaded, id)
    achState = omitKey(achState, id)
    statState = omitKey(statState, id)
    origAch = omitKey(origAch, id)
    origStat = omitKey(origStat, id)
  }

  return { loaded, detailOrder, achState, statState, origAch, origStat }
}
