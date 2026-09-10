import { describe, expect, it } from 'vitest'
import { MockSource } from '../mockSource'
import { GAMES } from '../games'
import { LARGE_SCALE, scaledAppId, scaledIndex, scaledName } from '../mockScale'

const src = () => new MockSource(0) // no artificial latency in tests

describe('MockSource.loadCategories', () => {
  it('ships a few demo categories so the sidebar filter is exercisable', async () => {
    const cats = await src().loadCategories()
    expect(cats['487120']).toEqual(['Favorites', 'Racing'])
    expect(Object.keys(cats).every((id) => GAMES.some((g) => g.appId === id))).toBe(true)
  })
})

describe('MockSource at scale', () => {
  const scale = { games: 120, achievements: 40, stats: 6 }

  it('lists a synthetic library of the requested size with seeded completion', async () => {
    const games = await new MockSource(0, scale).listGames()
    expect(games).toHaveLength(120)
    expect(games[1]).toMatchObject({ appId: scaledAppId(1), name: scaledName(1) })
    expect(games[1].completion?.total).toBe(40)
    expect(scaledIndex(scaledAppId(119), scale)).toBe(119)
    expect(scaledIndex(scaledAppId(120), scale)).toBeNull()
    expect(scaledIndex('487120', scale)).toBeNull()
  })

  it('generates a game on first load, deterministically, and round-trips a save', async () => {
    const s = new MockSource(0, scale)
    const id = scaledAppId(7)
    const first = await s.loadGame(id)
    const again = await s.loadGame(id)
    expect(first.achievements).toHaveLength(40)
    expect(first.stats).toHaveLength(6)
    expect(again).toEqual(first)
    // The seeded unlock pattern matches the summary's completion.
    const summary = (await s.listGames()).find((g) => g.appId === id)!
    expect(summary.completion?.earned).toBe(first.achievements.filter((a) => a.unlocked).length)

    const locked = first.achievements.find((a) => !a.unlocked && !a.protected)!
    await s.saveChanges(id, { achievements: { [locked.id]: true }, stats: {} })
    expect((await s.loadGame(id)).achievements.find((a) => a.id === locked.id)?.unlocked).toBe(true)
    expect((await s.listGames()).find((g) => g.appId === id)?.completion?.earned).toBe(
      summary.completion!.earned + 1,
    )
    await expect(s.loadGame('487120')).rejects.toThrow()
    expect(await s.loadCategories()).toEqual({})
  })

  it('exposes the large preset the web build reaches through ?mock=large', () => {
    expect(LARGE_SCALE).toEqual({ games: 2000, achievements: 500, stats: 40 })
  })
})

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
