import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { getSource, isTauri } from '../data'
import { loadGamesCache, saveGamesCache, saveSettings } from '../data/cache'
import { translate, type Translate } from '../i18n'
import type { GameChanges } from '../data/source'
import { reducer, makeInitialState, type Action, type AppState } from './store'
import { applyLoadedGame } from './applyLoadedGame'
import { applyPartialSave } from './applyPartialSave'
import { touchDetailCache } from './detailCache'
import { appIdKey, mergeFreshGames } from './gameListMerge'
import { getVersion } from '@tauri-apps/api/app'
import { fetchLatestVersion, openReleasesPage } from '../data/update'
import { isNewer } from '../lib/version'
import { rootCssVars, styleTokens, themeTokens } from '../lib/theme'
import {
  bulkApply, completionFlat, filteredAch, pendingCount, type BulkMode,
} from '../lib/achievements'
import type { Game, GameCompletion, GameSummary, StyleTokens, Tab, ThemeTokens } from '../types'

const TOAST_MS = 2300
const CACHE_WRITE_MS = 600
const PROGRESS_FLUSH_MS = 120
const PROGRESS_BATCH_SIZE = 24
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const sameRecord = <T,>(a: Record<string, T>, b: Record<string, T>): boolean => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return aKeys.length === bKeys.length && aKeys.every((k) => Object.is(a[k], b[k]))
}

/** A pending confirmation the {@link ConfirmDialog} renders; resolved via confirmResolve. */
export interface ConfirmRequest {
  message: string
  confirmLabel: string
  /** Style the confirm button as destructive (red). */
  danger?: boolean
  onConfirm: () => void
}

interface AppContextValue {
  state: AppState
  t: Translate
  T: ThemeTokens
  ST: StyleTokens
  rootVars: CSSProperties
  games: GameSummary[]
  activeGame: Game | null
  set: (a: Action) => void
  selectGame: (appId: string) => void
  openLibrary: () => void
  openSettings: () => void
  refresh: () => void
  gotoTab: (appId: string, tab: Tab) => void
  openGame: (appId: string) => void
  toggleAch: (appId: string, achId: string, isProtected: boolean) => void
  bulk: (mode: BulkMode) => void
  store: () => void
  setStat: (appId: string, id: string, raw: string) => void
  resetStats: () => void
  showToast: (msg: string) => void
  completionFor: (appId: string) => GameCompletion | undefined
  dismissUpdate: () => void
  openReleases: () => void
  /** The active confirmation request, or null when the modal is closed. */
  confirm: ConfirmRequest | null
  /** Open the confirmation modal with the given request. */
  requestConfirm: (req: ConfirmRequest) => void
  /** Resolve the open confirmation: true runs its onConfirm, false just closes it. */
  confirmResolve: (ok: boolean) => void
}

const Ctx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitialState)
  const navigate = useNavigate()
  const source = useMemo(() => getSource(), [])

  const stateRef = useRef(state)
  stateRef.current = state
  const toastTimer = useRef<number | undefined>(undefined)
  const cacheTimer = useRef<number | undefined>(undefined)
  const detailSeq = useRef(0)

  // Confirmation modal (bulk edits, stat reset, unsaved-changes guards). Kept in local
  // state rather than the reducer because the request carries a callback.
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const confirmRef = useRef<ConfirmRequest | null>(null)
  confirmRef.current = confirm
  const requestConfirm = useCallback((req: ConfirmRequest) => setConfirm(req), [])
  const confirmResolve = useCallback((ok: boolean) => {
    const req = confirmRef.current
    setConfirm(null)
    if (ok) req?.onConfirm()
  }, [])

  const set = useCallback((a: Action) => dispatch(a), [])

  const showToast = useCallback((msg: string) => {
    dispatch((s) => ({ toast: msg, toastSeq: s.toastSeq + 1 }))
  }, [])

  // Bound translator for the current language; tRef lets stable callbacks read
  // the latest translator without listing it as a dependency.
  const t = useMemo<Translate>(() => (key, params) => translate(state.lang, key, params), [state.lang])
  const tRef = useRef(t)
  tRef.current = t
  const gamesKey = useMemo(() => appIdKey(state.games), [state.games])

  useEffect(() => {
    if (state.toast == null) return
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => dispatch({ toast: null }), TOAST_MS)
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [state.toastSeq, state.toast])

  // ---- load the games list once (cache-first, then refresh) ----
  useEffect(() => {
    let cancelled = false
    const cached = isTauri() ? loadGamesCache() : null
    if (cached && cached.length) {
      dispatch({ games: cached, gamesStatus: 'ready' })
    } else {
      dispatch({ gamesStatus: 'loading', gamesError: null })
    }
    source
      .listGames()
      .then((fresh) => {
        if (cancelled) return
        dispatch((cur) => {
          return { games: mergeFreshGames(cur.games, fresh), gamesStatus: 'ready', gamesError: null }
        })
      })
      .catch((e) => {
        if (!cancelled && !(cached && cached.length)) {
          dispatch({ gamesStatus: 'error', gamesError: errMsg(e) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [source])

  // ---- load the player's own Steam library categories (real source only) ----
  useEffect(() => {
    const loadCategories = source.loadCategories?.bind(source)
    if (!loadCategories) return
    let cancelled = false
    loadCategories()
      .then((cats) => {
        if (!cancelled) dispatch({ categories: cats })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [source])

  // ---- persist the games list (with completions) for next launch ----
  useEffect(() => {
    if (!isTauri() || state.gamesStatus !== 'ready' || !state.games.length) return
    if (cacheTimer.current) window.clearTimeout(cacheTimer.current)
    const snapshot = state.games
    cacheTimer.current = window.setTimeout(() => {
      saveGamesCache(snapshot)
      cacheTimer.current = undefined
    }, CACHE_WRITE_MS)
    return () => {
      if (cacheTimer.current) {
        window.clearTimeout(cacheTimer.current)
        cacheTimer.current = undefined
      }
    }
  }, [state.games, state.gamesStatus])

  // ---- persist appearance settings (theme / window style / accent / width) ----
  useEffect(() => {
    saveSettings({
      theme: state.theme,
      sidebarWidth: state.sidebarWidth,
      lang: state.lang,
      dismissedVersion: state.updateDismissed ?? undefined,
    })
  }, [state.theme, state.sidebarWidth, state.lang, state.updateDismissed])

  // ---- check for a newer published version (real app only) ----
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void (async () => {
      try {
        const current = await getVersion()
        if (cancelled) return
        let update: AppState['update'] = null
        let updateStatus: AppState['updateStatus'] = 'ok'
        try {
          const latest = await fetchLatestVersion()
          update = { latest, isNew: isNewer(latest, current) }
        } catch {
          // offline / fetch failed — mark the check failed so the UI says so
          // instead of falsely reporting "up to date".
          updateStatus = 'error'
        }
        if (!cancelled) dispatch({ version: current, update, updateStatus })
      } catch {
        // getVersion failed — ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ---- warn before quitting with unsaved edits in any loaded game (Tauri only) ----
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const un = await win.onCloseRequested((event) => {
          const s = stateRef.current
          let pending = 0
          for (const id of Object.keys(s.loaded)) {
            const g = s.loaded[id]
            if (g) pending += pendingCount(g, s.achState, s.origAch, s.statState, s.origStat)
          }
          if (pending > 0) {
            event.preventDefault()
            setConfirm({
              message: tRef.current('confirm.quitMsg', { n: pending }),
              confirmLabel: tRef.current('confirm.quit'),
              danger: true,
              onConfirm: () => {
                void win.destroy()
              },
            })
          }
        })
        if (cancelled) un()
        else unlisten = un
      } catch {
        // window API unavailable (e.g. non-Tauri) — skip the guard
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // ---- background-load every game's completion (real source only) ----
  useEffect(() => {
    const loadProgress = source.loadProgress?.bind(source)
    if (state.gamesStatus !== 'ready' || !loadProgress) return
    let cancelled = false
    // Skip games whose detail is already loaded: their completion is derived live from
    // the loaded achievements (completionFor / applyLoadedGame), so overwriting it here
    // from the on-disk stats cache is what made the sidebar bar flicker between two
    // values. The on-disk read stays the source only for games not yet opened.
    const loadedDetail = stateRef.current.loaded
    const queue = stateRef.current.games.map((g) => g.appId).filter((id) => !loadedDetail[id])
    let idx = 0
    const LIMIT = 3
    const pending = new Map<string, GameCompletion | undefined>()
    let flushTimer: number | undefined

    const flush = () => {
      if (cancelled || pending.size === 0) return
      const updates = new Map(pending)
      pending.clear()
      dispatch((cur) => ({
        games: cur.games.map((g) =>
          updates.has(g.appId) ? { ...g, completion: updates.get(g.appId) } : g,
        ),
      }))
    }

    const scheduleFlush = () => {
      if (flushTimer !== undefined) return
      flushTimer = window.setTimeout(() => {
        flushTimer = undefined
        flush()
      }, PROGRESS_FLUSH_MS)
    }

    const recordProgress = (appId: string, completion: GameCompletion | undefined) => {
      pending.set(appId, completion)
      if (pending.size >= PROGRESS_BATCH_SIZE) {
        if (flushTimer !== undefined) {
          window.clearTimeout(flushTimer)
          flushTimer = undefined
        }
        flush()
      } else {
        scheduleFlush()
      }
    }

    let activeWorkers = Math.min(LIMIT, queue.length)
    if (activeWorkers === 0) return
    const worker = async () => {
      try {
        while (!cancelled && idx < queue.length) {
          const appId = queue[idx++]
          try {
            recordProgress(appId, await loadProgress(appId))
          } catch {
            // Missing/invalid local cache means we should not keep showing stale progress.
            recordProgress(appId, undefined)
          }
        }
      } finally {
        activeWorkers -= 1
        if (activeWorkers === 0) {
          if (flushTimer !== undefined) {
            window.clearTimeout(flushTimer)
            flushTimer = undefined
          }
          flush()
        }
      }
    }
    for (let i = 0; i < activeWorkers; i += 1) void worker()
    return () => {
      cancelled = true
      if (flushTimer !== undefined) window.clearTimeout(flushTimer)
    }
  }, [state.gamesStatus, source, gamesKey, state.progressRefreshSeq])

  // ---- lazily load + cache one game's detail ----
  const reloadGame = useCallback(
    (appId: string, mode: 'visible' | 'silent') => {
      const seq = detailSeq.current + 1
      detailSeq.current = seq
      const snapshot = stateRef.current
      const achSnapshot = { ...(snapshot.achState[appId] ?? {}) }
      const statSnapshot = { ...(snapshot.statState[appId] ?? {}) }

      if (mode === 'visible') {
        dispatch({ activeAppId: appId, detailStatus: 'loading', detailError: null })
      }

      source
        .loadGame(appId)
        .then((game) => {
          dispatch((cur) => {
            if (detailSeq.current !== seq) return {}
            if (
              mode === 'silent' &&
              (!sameRecord(cur.achState[appId] ?? {}, achSnapshot) ||
                !sameRecord(cur.statState[appId] ?? {}, statSnapshot))
            ) {
              return {}
            }
            return applyLoadedGame(cur, appId, game)
          })
        })
        .catch((e) => {
          if (detailSeq.current !== seq || mode === 'silent') return
          dispatch((cur) =>
            cur.activeAppId === appId ? { detailStatus: 'error', detailError: errMsg(e) } : {},
          )
        })
    },
    [source],
  )

  const openGame = useCallback(
    (appId: string) => {
      const s = stateRef.current
      const loaded = s.loaded[appId]
      if (loaded) {
        dispatch((cur) => {
          const patch: Partial<AppState> = { activeAppId: appId, detailStatus: 'ready', detailError: null }
          return { ...patch, ...touchDetailCache({ ...cur, ...patch }, appId) }
        })
        if (pendingCount(loaded, s.achState, s.origAch, s.statState, s.origStat) === 0) {
          reloadGame(appId, 'silent')
        }
        return
      }
      reloadGame(appId, 'visible')
    },
    [reloadGame],
  )

  // ---- navigation ----
  // Guard leaving the active game when it has unsaved edits: confirm first, and only
  // navigate if the user accepts. Switching to the same game or navigating with no
  // pending edits proceeds immediately.
  const guardLeave = useCallback(
    (proceed: () => void, targetAppId?: string) => {
      const s = stateRef.current
      const appId = s.activeAppId
      if (!appId || appId === targetAppId) {
        proceed()
        return
      }
      const game = s.loaded[appId]
      const pending = game
        ? pendingCount(game, s.achState, s.origAch, s.statState, s.origStat)
        : 0
      if (pending > 0) {
        setConfirm({
          message: tRef.current('confirm.leaveMsg', { n: pending }),
          confirmLabel: tRef.current('confirm.leave'),
          onConfirm: proceed,
        })
      } else {
        proceed()
      }
    },
    [],
  )
  const selectGame = useCallback(
    (appId: string) => guardLeave(() => navigate(`/game/${appId}`), appId),
    [navigate, guardLeave],
  )
  const openLibrary = useCallback(() => guardLeave(() => navigate('/')), [navigate, guardLeave])
  const openSettings = useCallback(() => guardLeave(() => navigate('/settings')), [navigate, guardLeave])

  const refresh = useCallback(() => {
    source
      .listGames()
      .then((fresh) => {
        dispatch((cur) => {
          const patch: Partial<AppState> = {
            games: mergeFreshGames(cur.games, fresh),
            gamesStatus: 'ready',
            progressRefreshSeq: cur.progressRefreshSeq + 1,
          }
          return patch
        })
      })
      .catch(() => {})
    // Categories can change in Steam between launches — re-read them on refresh too.
    source
      .loadCategories?.()
      .then((cats) => dispatch({ categories: cats }))
      .catch(() => {})
    const s = stateRef.current
    const appId = s.activeAppId
    const game = appId ? s.loaded[appId] : null
    if (appId && game && pendingCount(game, s.achState, s.origAch, s.statState, s.origStat) === 0) {
      reloadGame(appId, 'silent')
    }
    showToast(tRef.current('toast.refreshing'))
  }, [source, showToast, reloadGame])
  const gotoTab = useCallback(
    (appId: string, tab: Tab) => navigate(tab === 'stats' ? `/game/${appId}/stats` : `/game/${appId}`),
    [navigate],
  )

  // ---- edits on the active game's working state ----
  const toggleAch = useCallback(
    (appId: string, achId: string, isProtected: boolean) => {
      if (isProtected) {
        showToast(tRef.current('toast.protectedAch'))
        return
      }
      // Click toggles: first click checks (unlock), clicking again unchecks (lock).
      dispatch((s) => ({
        achState: { ...s.achState, [appId]: { ...s.achState[appId], [achId]: !s.achState[appId][achId] } },
      }))
    },
    [showToast],
  )

  const bulk = useCallback((mode: BulkMode) => {
    dispatch((s) => {
      const appId = s.activeAppId
      if (!appId) return {}
      const game = s.loaded[appId]
      if (!game) return {}
      const list = filteredAch(game, s.achState, s.origAch, s.filter, s.achSearch).filter((a) => !a.protected)
      const m = bulkApply(s.achState[appId] ?? {}, list, mode)
      return { achState: { ...s.achState, [appId]: m } }
    })
  }, [])

  const setStat = useCallback((appId: string, id: string, raw: string) => {
    const v = raw === '' ? 0 : Number(raw)
    if (Number.isNaN(v)) return
    // Integer stats must not receive a fractional value — Steam silently drops such a
    // write, which then looks like a rejected/partial save. Truncate to match what will
    // actually be committed. (Float stats and demo data with no isFloat flag pass through.)
    const stat = stateRef.current.loaded[appId]?.stats.find((s) => s.id === id)
    const value = stat?.isFloat === false ? Math.trunc(v) : v
    dispatch((s) => ({ statState: { ...s.statState, [appId]: { ...s.statState[appId], [id]: value } } }))
  }, [])

  const resetStats = useCallback(() => {
    const s = stateRef.current
    const appId = s.activeAppId
    if (!appId) return
    dispatch((cur) => ({ statState: { ...cur.statState, [appId]: { ...cur.origStat[appId] } } }))
    showToast(tRef.current('toast.statsReset'))
  }, [showToast])

  // ---- save (writes through the source) ----
  const store = useCallback(async () => {
    const s = stateRef.current
    const appId = s.activeAppId
    if (!appId) return
    const game = s.loaded[appId]
    if (!game) return
    const n = pendingCount(game, s.achState, s.origAch, s.statState, s.origStat)
    if (n === 0) {
      showToast(tRef.current('toast.nothingToSave'))
      return
    }
    const aw = s.achState[appId] ?? {}
    const ao = s.origAch[appId] ?? {}
    const sw = s.statState[appId] ?? {}
    const so = s.origStat[appId] ?? {}
    const changes: GameChanges = { achievements: {}, stats: {} }
    Object.keys(aw).forEach((k) => {
      if (aw[k] !== ao[k]) changes.achievements[k] = aw[k]
    })
    Object.keys(sw).forEach((k) => {
      if (sw[k] !== so[k]) changes.stats[k] = sw[k]
    })
    dispatch({ saving: true })
    try {
      const res = await source.saveChanges(appId, changes)
      if (res.rejected.length > 0) {
        // Steam refused some changes (schema-protected/unknown, or an invalid value).
        // Re-read ground truth so the UI never shows a rejected edit as saved — but keep
        // any edit the user made while the write/reload was in flight (it stays pending).
        // Keying off the explicit rejected list (not saved < n) avoids a false "partial
        // save" when a change was simply a no-op (Steam reports those as not-applied too).
        const fresh = await source.loadGame(appId)
        // `aw`/`sw` are the working maps captured at save start (immutable), so
        // applyPartialSave can tell a genuine in-flight edit from an untouched key.
        dispatch((cur) => applyPartialSave(cur, appId, fresh, { ach: aw, stat: sw }))
        showToast(tRef.current('toast.savedPartial', { saved: res.saved, total: n }))
      } else {
        dispatch((cur) => ({
          // Advance the saved baseline only for the values we actually sent, so an edit
          // made while the async write was in flight stays pending (not falsely "saved").
          origAch: { ...cur.origAch, [appId]: { ...(cur.origAch[appId] ?? {}), ...changes.achievements } },
          origStat: { ...cur.origStat, [appId]: { ...(cur.origStat[appId] ?? {}), ...changes.stats } },
          games: cur.games.map((g) =>
            g.appId === appId || g.id === appId
              ? { ...g, completion: completionFlat(game.achievements, cur.achState[appId] ?? {}) }
              : g,
          ),
        }))
        showToast(tRef.current('toast.saved', { n: res.saved }))
      }
    } catch (e) {
      showToast(tRef.current('toast.saveFailed', { msg: errMsg(e) }))
    } finally {
      dispatch({ saving: false })
    }
  }, [source, showToast])

  // O(1) completion lookup keyed by appId (and id) — avoids scanning the whole games
  // list on every visible row/card render, which the virtualized lists recompute on
  // each scroll. Rebuilt only when the games list changes.
  const completionMap = useMemo(() => {
    const m = new Map<string, GameCompletion | undefined>()
    for (const g of state.games) {
      m.set(g.appId, g.completion)
      if (g.id !== g.appId) m.set(g.id, g.completion)
    }
    return m
  }, [state.games])
  const completionMapRef = useRef(completionMap)
  completionMapRef.current = completionMap

  const completionFor = useCallback((appId: string): GameCompletion | undefined => {
    const s = stateRef.current
    if (s.activeAppId === appId && s.loaded[appId]) {
      return completionFlat(s.loaded[appId].achievements, s.achState[appId] ?? {})
    }
    return completionMapRef.current.get(appId)
  }, [])

  const dismissUpdate = useCallback(() => {
    dispatch((s) => (s.update ? { updateDismissed: s.update.latest } : {}))
  }, [])

  const openReleases = useCallback(() => {
    void openReleasesPage()
  }, [])

  const T = useMemo(() => themeTokens(state.theme), [state.theme])
  const ST = useMemo(() => styleTokens(), [])
  const rootVars = useMemo(() => rootCssVars(T, ST, state.accent), [T, ST, state.accent])
  const activeGame = state.activeAppId ? state.loaded[state.activeAppId] ?? null : null

  const value: AppContextValue = {
    state, t, T, ST, rootVars, games: state.games, activeGame,
    set, selectGame, openLibrary, openSettings, refresh, gotoTab, openGame,
    toggleAch, bulk, store, setStat, resetStats, showToast, completionFor,
    dismissUpdate, openReleases,
    confirm, requestConfirm, confirmResolve,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within <AppProvider>')
  return ctx
}
