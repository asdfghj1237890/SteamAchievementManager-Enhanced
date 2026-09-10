import { GAMES } from './games'
import { scaledGame, scaledIndex, scaledSummaries, type MockScale } from './mockScale'
import { completionFlat } from '../lib/achievements'
import type { GameChanges, SamSource, SaveResult } from './source'
import type { Game, GameSummary } from '../types'

/**
 * Demo "player categories" (the real source reads them from the Steam client) so
 * the sidebar's category filter has something to show in the web build.
 */
const DEMO_CATEGORIES: Record<string, string[]> = {
  '487120': ['Favorites', 'Racing'],
  '533700': ['Racing'],
  '503310': ['Favorites'],
  '451780': ['Backlog'],
}

/**
 * In-memory demo source. Holds a per-game "persisted" state (seeded from the
 * bundled data) so saves round-trip within a session, mirroring how the real
 * Steam source behaves: loadGame returns the saved state, saveChanges writes it.
 *
 * With a `scale`, the 16-game demo is replaced by a synthetic library of that size
 * (see `mockScale.ts`); games are generated the first time they are loaded.
 */
export class MockSource implements SamSource {
  private ach: Record<string, Record<string, boolean>> = {}
  private stat: Record<string, Record<string, number>> = {}
  private readonly generated = new Map<string, Game>()

  constructor(
    private readonly latency = 180,
    private readonly scale: MockScale | null = null,
  ) {
    if (!scale) GAMES.forEach((g) => this.seed(g))
  }

  private seed(g: Game): void {
    this.ach[g.id] = {}
    this.stat[g.id] = {}
    g.achievements.forEach((a) => {
      this.ach[g.id][a.id] = a.unlocked
    })
    g.stats.forEach((s) => {
      this.stat[g.id][s.id] = s.value
    })
  }

  private game(appId: string): Game | undefined {
    if (!this.scale) return GAMES.find((x) => x.id === appId || x.appId === appId)
    const index = scaledIndex(appId, this.scale)
    if (index === null) return undefined
    let g = this.generated.get(appId)
    if (!g) {
      g = scaledGame(index, this.scale)
      this.generated.set(appId, g)
      this.seed(g)
    }
    return g
  }

  private delay(): Promise<void> {
    return this.latency > 0
      ? new Promise((resolve) => setTimeout(resolve, this.latency))
      : Promise.resolve()
  }

  async listGames(): Promise<GameSummary[]> {
    await this.delay()
    if (this.scale) {
      // Summaries carry the seeded completion; a game that has been loaded (and
      // possibly saved) reports its live state instead.
      return scaledSummaries(this.scale).map((s) => {
        const g = this.generated.get(s.appId)
        return g ? { ...s, completion: completionFlat(g.achievements, this.ach[g.id]) } : s
      })
    }
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
    const g = this.game(appId)
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
    // The mock persists every change it is given, so nothing is ever rejected.
    return { saved, rejected: [] }
  }

  async loadCategories(): Promise<Record<string, string[]>> {
    await this.delay()
    return this.scale ? {} : { ...DEMO_CATEGORIES }
  }
}
