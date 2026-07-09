import { invoke } from '@tauri-apps/api/core'
import { STEAM_APP_IDS } from './steamAppIds'
import type { GameChanges, SamSource, SaveResult } from './source'
import type { Achievement, Game, GameCompletion, GameSummary, GameType, Stat } from '../types'

interface RawOwnedGame {
  app_id: number
  name: string
  type: string
}

const mapType = (t: string): GameType => (t === 'demo' || t === 'mod' ? t : 'normal')

interface RawAchievement {
  id: string
  name: string
  desc: string
  hidden: boolean
  unlocked: boolean
  unlock_time: number
  rarity: number
  icon: string
  icon_gray: string
  protected: boolean
}

interface RawStat {
  id: string
  name: string
  value: number
  is_float: boolean
  protected: boolean
  increment_only: boolean
}

interface RawGameStats {
  app_id: number
  name: string
  achievements: RawAchievement[]
  stats: RawStat[]
}

interface RawProgress {
  app_id: number
  earned: number
  total: number
}

/** Stable cover hue derived from the app id (no genre/hue from the apps interface). */
const hueFor = (appId: number): number => (appId * 47) % 360

/**
 * Real Steam source (Phase 2), backed by the Rust `steam-core` layer via Tauri
 * commands: owned-games list in-process, per-game achievement read/write through
 * a self-spawned worker process (the app's Steam context per game).
 */
export class TauriSource implements SamSource {
  async listGames(): Promise<GameSummary[]> {
    const owned = await invoke<RawOwnedGame[]>('list_games', { appIds: STEAM_APP_IDS })
    return owned
      .map((g): GameSummary => ({
        appId: String(g.app_id),
        id: String(g.app_id),
        name: g.name || String(g.app_id),
        genre: '',
        type: mapType(g.type),
        hue: hueFor(g.app_id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async loadGame(appId: string): Promise<Game> {
    const g = await invoke<RawGameStats>('load_game', { appId })
    const achievements: Achievement[] = g.achievements.map((a) => ({
      id: a.id,
      name: a.name || a.id,
      desc: a.desc,
      rarity: Math.round(a.rarity),
      unlocked: a.unlocked,
      hidden: a.hidden,
      protected: a.protected,
      points: 0,
      icon: a.icon,
      iconGray: a.icon_gray,
      unlockTime: a.unlock_time,
    }))
    return {
      id: String(g.app_id),
      appId: String(g.app_id),
      name: g.name,
      genre: '',
      type: 'normal',
      hue: hueFor(g.app_id),
      y: 2024,
      m: 1,
      last: '',
      achievements,
      stats: g.stats.map(
        (s): Stat => ({
          id: s.id,
          name: s.name,
          value: s.value,
          extra: s.increment_only ? 'increment_only' : '',
          protected: s.protected,
        }),
      ),
    }
  }

  async saveChanges(appId: string, changes: GameChanges): Promise<SaveResult> {
    const r = await invoke<{ saved: number }>('save_changes', { appId, changes })
    return { saved: r.saved }
  }

  async loadProgressBatch(appIds: string[]): Promise<Record<string, GameCompletion>> {
    const numericAppIds = appIds
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0 && id <= 0xffff_ffff)
    const rows = await invoke<RawProgress[]>('game_progress_many', { appIds: numericAppIds })
    const progress: Record<string, GameCompletion> = {}
    for (const row of rows) {
      progress[String(row.app_id)] = {
        earned: row.earned,
        total: row.total,
        pct: row.total ? Math.round((row.earned / row.total) * 100) : 0,
      }
    }
    return progress
  }

  async loadCategories(): Promise<Record<string, string[]>> {
    const raw = await invoke<{ app_id: number; categories: string[] }[]>('game_categories')
    const map: Record<string, string[]> = {}
    for (const e of raw) map[String(e.app_id)] = e.categories
    return map
  }
}
