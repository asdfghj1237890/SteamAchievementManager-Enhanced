import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
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
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const sameRecord = <T,>(a: Record<string, T>, b: Record<string, T>): boolean => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return aKeys.length === bKeys.length && aKeys.every((k) => Object.is(a[k], b[k]))
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
}

const Ctx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitialState)
  const navigate = useNavigate()
  const source = useMemo(() => getSource(), [])

  const stateRef = useRef(state)
  stateRef.current = state
  const toastTimer = useRef<number | undefined>(undefined)
  const detailSeq = useRef(0)

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
    if (isTauri() && state.gamesStatus === 'ready' && state.games.length) {
      saveGamesCache(state.games)
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

  // ---- background-load every game's completion (real source only) ----
  useEffect(() => {
    const loadProgress = source.loadProgress?.bind(source)
    if (state.gamesStatus !== 'ready' || !loadProgress) return
    let cancelled = false
    const queue = stateRef.current.games.map((g) => g.appId)
    let idx = 0
    const LIMIT = 3
    const worker = async () => {
      while (!cancelled && idx < queue.length) {
        const appId = queue[idx++]
        try {
          const completion = await loadProgress(appId)
          if (!cancelled) {
            dispatch((cur) => ({
              games: cur.games.map((g) => (g.appId === appId ? { ...g, completion } : g)),
            }))
          }
        } catch {
          // Missing/invalid local cache means we should not keep showing stale progress.
          if (!cancelled) {
            dispatch((cur) => ({
              games: cur.games.map((g) => (g.appId === appId ? { ...g, completion: undefined } : g)),
            }))
          }
        }
      }
    }
    for (let i = 0; i < LIMIT; i += 1) void worker()
    return () => {
      cancelled = true
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
        if (s.activeAppId !== appId || s.detailStatus !== 'ready') {
          dispatch({ activeAppId: appId, detailStatus: 'ready', detailError: null })
        }
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
  const selectGame = useCallback((appId: string) => navigate(`/game/${appId}`), [navigate])
  const openLibrary = useCallback(() => navigate('/'), [navigate])
  const openSettings = useCallback(() => navigate('/settings'), [navigate])

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
    dispatch((s) => ({ statState: { ...s.statState, [appId]: { ...s.statState[appId], [id]: v } } }))
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
    try {
      const res = await source.saveChanges(appId, changes)
      if (res.saved < n) {
        // Steam committed fewer changes than we sent (e.g. one was rejected). Re-read
        // ground truth so the UI never shows a rejected edit as saved — but keep any
        // edit the user made while the write/reload was in flight (it stays pending).
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
    }
  }, [source, showToast])

  const completionFor = useCallback((appId: string): GameCompletion | undefined => {
    const s = stateRef.current
    if (s.activeAppId === appId && s.loaded[appId]) {
      return completionFlat(s.loaded[appId].achievements, s.achState[appId] ?? {})
    }
    return s.games.find((g) => g.appId === appId || g.id === appId)?.completion
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
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within <AppProvider>')
  return ctx
}
