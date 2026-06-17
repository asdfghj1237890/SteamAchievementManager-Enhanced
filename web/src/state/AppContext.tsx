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
import { rootCssVars, styleTokens, themeTokens } from '../lib/theme'
import {
  bulkApply, completionFlat, filteredAch, pendingCount, type BulkMode,
} from '../lib/achievements'
import type { Game, GameCompletion, GameSummary, StyleTokens, Tab, ThemeTokens } from '../types'

const TOAST_MS = 2300
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

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
}

const Ctx = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitialState)
  const navigate = useNavigate()
  const source = useMemo(() => getSource(), [])

  const stateRef = useRef(state)
  stateRef.current = state
  const toastTimer = useRef<number | undefined>(undefined)

  const set = useCallback((a: Action) => dispatch(a), [])

  const showToast = useCallback((msg: string) => {
    dispatch((s) => ({ toast: msg, toastSeq: s.toastSeq + 1 }))
  }, [])

  // Bound translator for the current language; tRef lets stable callbacks read
  // the latest translator without listing it as a dependency.
  const t = useMemo<Translate>(() => (key, params) => translate(state.lang, key, params), [state.lang])
  const tRef = useRef(t)
  tRef.current = t

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
          // keep already-known completions while the list refreshes
          const prev = new Map(cur.games.map((g) => [g.appId, g.completion]))
          const merged = fresh.map((g) => ({ ...g, completion: g.completion ?? prev.get(g.appId) }))
          return { games: merged, gamesStatus: 'ready', gamesError: null }
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
    })
  }, [state.theme, state.sidebarWidth, state.lang])

  // ---- background-load every game's completion (real source only) ----
  useEffect(() => {
    const loadProgress = source.loadProgress?.bind(source)
    if (state.gamesStatus !== 'ready' || !loadProgress) return
    let cancelled = false
    const queue = stateRef.current.games.filter((g) => !g.completion).map((g) => g.appId)
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
          // ignore per-game failures; that game just keeps its "—"
        }
      }
    }
    for (let i = 0; i < LIMIT; i += 1) void worker()
    return () => {
      cancelled = true
    }
  }, [state.gamesStatus, source])

  // ---- lazily load + cache one game's detail ----
  const openGame = useCallback(
    (appId: string) => {
      const s = stateRef.current
      if (s.loaded[appId]) {
        if (s.activeAppId !== appId || s.detailStatus !== 'ready') {
          dispatch({ activeAppId: appId, detailStatus: 'ready', detailError: null })
        }
        return
      }
      dispatch({ activeAppId: appId, detailStatus: 'loading', detailError: null })
      source
        .loadGame(appId)
        .then((game) => {
          dispatch((cur) => applyLoadedGame(cur, appId, game))
        })
        .catch((e) => {
          dispatch((cur) =>
            cur.activeAppId === appId ? { detailStatus: 'error', detailError: errMsg(e) } : {},
          )
        })
    },
    [source],
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
          const prev = new Map(cur.games.map((g) => [g.appId, g.completion]))
          const patch: Partial<AppState> = {
            games: fresh.map((g) => ({ ...g, completion: g.completion ?? prev.get(g.appId) })),
            gamesStatus: 'ready',
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
    showToast(tRef.current('toast.refreshing'))
  }, [source, showToast])
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
      dispatch((cur) => ({
        origAch: { ...cur.origAch, [appId]: { ...cur.achState[appId] } },
        origStat: { ...cur.origStat, [appId]: { ...cur.statState[appId] } },
        games: cur.games.map((g) =>
          g.appId === appId || g.id === appId
            ? { ...g, completion: completionFlat(game.achievements, cur.achState[appId] ?? {}) }
            : g,
        ),
      }))
      showToast(tRef.current('toast.saved', { n: res.saved }))
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

  const T = useMemo(() => themeTokens(state.theme), [state.theme])
  const ST = useMemo(() => styleTokens(), [])
  const rootVars = useMemo(() => rootCssVars(T, ST, state.accent), [T, ST, state.accent])
  const activeGame = state.activeAppId ? state.loaded[state.activeAppId] ?? null : null

  const value: AppContextValue = {
    state, t, T, ST, rootVars, games: state.games, activeGame,
    set, selectGame, openLibrary, openSettings, refresh, gotoTab, openGame,
    toggleAch, bulk, store, setStat, resetStats, showToast, completionFor,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within <AppProvider>')
  return ctx
}
