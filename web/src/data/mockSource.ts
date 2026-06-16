import { GAMES } from './games'
import { completionFlat } from '../lib/achievements'
import type { GameChanges, SamSource, SaveResult } from './source'
import type { Game, GameSummary } from '../types'

/**
 * In-memory demo source. Holds a per-game "persisted" state (seeded from the
 * bundled data) so saves round-trip within a session, mirroring how the real
 * Steam source behaves: loadGame returns the saved state, saveChanges writes it.
 */
export class MockSource implements SamSource {
  private ach: Record<string, Record<string, boolean>> = {}
  private stat: Record<string, Record<string, number>> = {}

  constructor(private readonly latency = 180) {
    GAMES.forEach((g) => {
      this.ach[g.id] = {}
      this.stat[g.id] = {}
      g.achievements.forEach((a) => {
        this.ach[g.id][a.id] = a.unlocked
      })
      g.stats.forEach((s) => {
        this.stat[g.id][s.id] = s.value
      })
    })
  }

  private delay(): Promise<void> {
    return this.latency > 0
      ? new Promise((resolve) => setTimeout(resolve, this.latency))
      : Promise.resolve()
  }

  async listGames(): Promise<GameSummary[]> {
    await this.delay()
    return GAMES.map((g) => ({
      appId: g.appId,
      id: g.id,
      name: g.name,
      genre: g.genre,
      type: g.type,
      hue: g.hue,
      completion: completionFlat(g.achievements, this.ach[g.id]),
    }))
  }

  async loadGame(appId: string): Promise<Game> {
    await this.delay()
    const g = GAMES.find((x) => x.id === appId || x.appId === appId)
    if (!g) throw new Error(`Game not found: ${appId}`)
    return {
      ...g,
      achievements: g.achievements.map((a) => ({ ...a, unlocked: !!this.ach[g.id][a.id] })),
      stats: g.stats.map((s) => ({ ...s, value: this.stat[g.id][s.id] })),
    }
  }

  async saveChanges(appId: string, changes: GameChanges): Promise<SaveResult> {
    await this.delay()
    const a = (this.ach[appId] ??= {})
    const s = (this.stat[appId] ??= {})
    let saved = 0
    for (const [k, v] of Object.entries(changes.achievements)) {
      if (a[k] !== v) {
        a[k] = v
        saved++
      }
    }
    for (const [k, v] of Object.entries(changes.stats)) {
      if (s[k] !== v) {
        s[k] = v
        saved++
      }
    }
    return { saved }
  }
}
