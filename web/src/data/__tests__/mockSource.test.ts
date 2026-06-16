import { describe, expect, it } from 'vitest'
import { MockSource } from '../mockSource'
import { GAMES } from '../games'

const src = () => new MockSource(0) // no artificial latency in tests

describe('MockSource.listGames', () => {
  it('returns a summary per game with completion', async () => {
    const games = await src().listGames()
    expect(games).toHaveLength(GAMES.length)
    const first = games[0]
    expect(first.appId).toBe(GAMES[0].appId)
    expect(first.completion).toBeDefined()
    expect(first.completion!.total).toBe(GAMES[0].achievements.length)
  })
})

describe('MockSource.loadGame', () => {
  it('returns full detail with current state', async () => {
    const g = await src().loadGame(GAMES[0].appId)
    expect(g.name).toBe(GAMES[0].name)
    expect(g.achievements).toHaveLength(GAMES[0].achievements.length)
    expect(g.stats).toHaveLength(GAMES[0].stats.length)
  })
  it('rejects an unknown appId', async () => {
    await expect(src().loadGame('does-not-exist')).rejects.toThrow()
  })
})

describe('MockSource.saveChanges', () => {
  it('persists unlock + stat changes and reports the count', async () => {
    const s = new MockSource(0)
    const appId = GAMES[0].appId
    const ach0 = GAMES[0].achievements[0]
    const stat0 = GAMES[0].stats[0]

    const res = await s.saveChanges(appId, {
      achievements: { [ach0.id]: !ach0.unlocked },
      stats: { [stat0.id]: stat0.value + 5 },
    })
    expect(res.saved).toBe(2)

    // round-trips through loadGame
    const reloaded = await s.loadGame(appId)
    expect(reloaded.achievements.find((a) => a.id === ach0.id)?.unlocked).toBe(!ach0.unlocked)
    expect(reloaded.stats.find((x) => x.id === stat0.id)?.value).toBe(stat0.value + 5)

    // and is reflected in the summary completion
    const summary = (await s.listGames()).find((g) => g.appId === appId)!
    const expectedEarned = GAMES[0].achievements.filter((a, i) =>
      i === 0 ? !ach0.unlocked : a.unlocked,
    ).length
    expect(summary.completion!.earned).toBe(expectedEarned)
  })

  it('counts only actual changes', async () => {
    const s = new MockSource(0)
    const appId = GAMES[0].appId
    const ach0 = GAMES[0].achievements[0]
    // same value as current → no change
    const res = await s.saveChanges(appId, { achievements: { [ach0.id]: ach0.unlocked }, stats: {} })
    expect(res.saved).toBe(0)
  })
})
