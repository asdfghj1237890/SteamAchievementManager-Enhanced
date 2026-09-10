import type { Achievement, Game, GameSummary, Stat } from '../types'

/**
 * Synthetic library for scale testing (`?mock=large` in the web build, see
 * `getSource`). The bundled demo has 16 games with a dozen achievements each, which
 * cannot show whether virtualization, memoization, or the completion loader hold up
 * at the size of a real Steam library. Everything here is deterministic — the same
 * index always yields the same game — and achievements are generated per game on
 * demand, so 2,000 games × 500 achievements never sit in memory at once.
 */
export interface MockScale {
  games: number
  achievements: number
  stats: number
}

export const LARGE_SCALE: MockScale = { games: 2000, achievements: 500, stats: 40 }

const APP_ID_BASE = 9_000_000

/** Small deterministic PRNG so rarities and unlock patterns look plausible but never change. */
function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x1_0000_0000
  }
}

export const scaledAppId = (index: number): string => String(APP_ID_BASE + index)
export const scaledName = (index: number): string => `Synthetic Game ${String(index).padStart(4, '0')}`

/** Unlock pattern shared by the summary (completion) and the detail (achievements). */
const unlocked = (index: number, achievementIndex: number): boolean =>
  (index * 7 + achievementIndex * 13) % 5 === 0

export function scaledSummaries(scale: MockScale): GameSummary[] {
  const list: GameSummary[] = []
  for (let i = 0; i < scale.games; i++) {
    let earned = 0
    for (let a = 0; a < scale.achievements; a++) if (unlocked(i, a)) earned++
    list.push({
      appId: scaledAppId(i),
      id: scaledAppId(i),
      name: scaledName(i),
      genre: 'Synthetic',
      type: i % 50 === 0 ? 'demo' : 'normal',
      hue: (i * 47) % 360,
      completion: {
        earned,
        total: scale.achievements,
        pct: scale.achievements ? Math.round((earned / scale.achievements) * 100) : 0,
      },
    })
  }
  return list
}

export function scaledGame(index: number, scale: MockScale): Game {
  const rand = seeded(index + 1)
  const id = scaledAppId(index)
  const achievements: Achievement[] = []
  for (let a = 0; a < scale.achievements; a++) {
    const rarity = Math.round(rand() * 95 + 2)
    achievements.push({
      id: `${id}_a${a}`,
      name: `Achievement ${String(a).padStart(3, '0')}`,
      desc: `Synthetic objective number ${a} of ${scale.achievements}`,
      rarity,
      unlocked: unlocked(index, a),
      hidden: a % 17 === 0,
      protected: a % 29 === 0,
      points: 100 - rarity,
      unlockTime: unlocked(index, a) ? 1_700_000_000 + a * 3600 : undefined,
    })
  }
  const stats: Stat[] = []
  for (let s = 0; s < scale.stats; s++) {
    stats.push({
      id: `st${s}`,
      name: `Stat ${s}`,
      value: Math.round(rand() * 10_000),
      extra: s % 4 === 0 ? 'increment_only' : '',
      protected: s % 9 === 0,
      isFloat: s % 3 === 0,
    })
  }
  return {
    id,
    appId: id,
    name: scaledName(index),
    genre: 'Synthetic',
    type: index % 50 === 0 ? 'demo' : 'normal',
    hue: (index * 47) % 360,
    y: 2025,
    m: 1,
    last: '2025/01/01',
    achievements,
    stats,
  }
}

/** The game index behind a synthetic app id, or null for anything else. */
export function scaledIndex(appId: string, scale: MockScale): number | null {
  const n = Number(appId) - APP_ID_BASE
  return Number.isInteger(n) && n >= 0 && n < scale.games ? n : null
}
