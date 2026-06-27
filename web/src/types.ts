// Shared domain + UI types for the Achievement Manager port.

export type Theme = 'dark' | 'light'
export type Platform = 'mac' | 'windows'
export type Screen = 'library' | 'game' | 'settings'
export type ViewMode = 'grid' | 'list'
export type Tab = 'ach' | 'stats'
export type AchFilter = 'all' | 'unlocked' | 'locked'
/** Achievement ordering: default (Steam order), rarity % (rare/common), name, or unlock time. */
export type AchSort = 'default' | 'rarity' | 'common' | 'name' | 'unlock'
export type GameType = 'normal' | 'demo' | 'mod'
export type TypeFilter = 'all' | GameType

export interface Achievement {
  id: string
  name: string
  desc: string
  /** Percentage of players who own it (lower = rarer). */
  rarity: number
  unlocked: boolean
  hidden: boolean
  protected: boolean
  /** Derived points weight (100 - rarity). */
  points: number
  /** Steam icon file names (real source only; empty for demo data). */
  icon?: string
  iconGray?: string
  /** Real unlock time (unix seconds), real source only. */
  unlockTime?: number
}

export interface Stat {
  id: string
  name: string
  value: number
  extra: string
  protected: boolean
}

export interface Game {
  id: string
  name: string
  genre: string
  type: GameType
  /** Base hue used to synthesize the striped cover placeholder. */
  hue: number
  appId: string
  y: number
  m: number
  last: string
  achievements: Achievement[]
  stats: Stat[]
}

/** gameId -> achievementId -> unlocked */
export type AchState = Record<string, Record<string, boolean>>
/** gameId -> statId -> value */
export type StatState = Record<string, Record<string, number>>

export interface ThemeTokens {
  appBg: string
  win: string
  s0: string
  s1: string
  s2: string
  s3: string
  bd: string
  bds: string
  t1: string
  t2: string
  t3: string
  good: string
  danger: string
  shadow: string
}

export interface StyleTokens {
  radius: string
  radiusLg: string
  cardpad: string
  gap: string
  cardmin: string
  meta: string
  elev: string
}

export interface GameCompletion {
  earned: number
  total: number
  pct: number
}

/** Lightweight game entry for the library/sidebar (no achievements/stats loaded yet). */
export interface GameSummary {
  /** Steam App ID. */
  appId: string
  /** Stable key (equals appId in our data). */
  id: string
  name: string
  genre: string
  type: GameType
  hue: number
  /** Optional — a real Steam source may omit/lazy-load this. */
  completion?: GameCompletion
  /** Added explicitly by App ID and preserved across library refreshes. */
  manual?: boolean
}
