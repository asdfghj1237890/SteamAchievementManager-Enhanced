import type {
  AchFilter, AchState, Game, GameSummary, Platform, StatState, Theme, TypeFilter, ViewMode,
} from '../types'
import { DEFAULT_ACCENT } from '../lib/theme'
import { detectLang, type Lang } from '../i18n'
import { loadSettings } from '../data/cache'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Game-list width bounds (px). */
export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 520
export const clampSidebar = (w: number): number =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))

export interface AppState {
  // appearance + preferences
  theme: Theme
  platform: Platform
  accent: string
  lang: Lang
  view: ViewMode
  filter: AchFilter
  achSearch: string
  gameSearch: string
  typeFilter: TypeFilter
  statsEditing: boolean
  addId: string
  /** Game-list (sidebar) width in px; drag-resizable, persisted in settings. */
  sidebarWidth: number

  // games list (loaded once)
  gamesStatus: LoadStatus
  games: GameSummary[]
  gamesError: string | null

  // active game detail (loaded lazily, cached by appId)
  activeAppId: string | null
  detailStatus: LoadStatus
  detailError: string | null
  loaded: Record<string, Game>
  achState: AchState
  statState: StatState
  /** Last-saved snapshots used to compute pending changes. */
  origAch: AchState
  origStat: StatState

  toast: string | null
  toastSeq: number
}

/** setState-style action: a partial patch or an updater that derives one from current state. */
export type Action = Partial<AppState> | ((s: AppState) => Partial<AppState>)

export function reducer(s: AppState, a: Action): AppState {
  const patch = typeof a === 'function' ? a(s) : a
  return { ...s, ...patch }
}

/** Default the window chrome to the host OS (the Settings panel can still switch it). */
function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'windows'
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mac' : 'windows'
}

export function makeInitialState(): AppState {
  const saved = loadSettings()
  return {
    theme: saved.theme ?? 'dark',
    platform: saved.platform ?? detectPlatform(),
    accent: saved.accent ?? DEFAULT_ACCENT,
    lang: saved.lang ?? detectLang(),
    view: 'grid',
    filter: 'all',
    achSearch: '',
    gameSearch: '',
    typeFilter: 'all',
    statsEditing: false,
    addId: '',
    sidebarWidth: clampSidebar(saved.sidebarWidth ?? 280),

    gamesStatus: 'idle',
    games: [],
    gamesError: null,

    activeAppId: null,
    detailStatus: 'idle',
    detailError: null,
    loaded: {},
    achState: {},
    statState: {},
    origAch: {},
    origStat: {},

    toast: null,
    toastSeq: 0,
  }
}
