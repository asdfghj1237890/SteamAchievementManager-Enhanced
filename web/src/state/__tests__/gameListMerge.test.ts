import { describe, expect, it } from 'vitest'
import { appIdKey, mergeFreshGames } from '../gameListMerge'
import type { GameSummary } from '../../types'

const game = (appId: string, over: Partial<GameSummary> = {}): GameSummary => ({
  appId,
  id: appId,
  name: `Game ${appId}`,
  genre: '',
  type: 'normal',
  hue: 0,
  ...over,
})

describe('mergeFreshGames', () => {
  it('keeps cached completion while the background progress refresh catches up', () => {
    const current = [game('10', { completion: { earned: 1, total: 2, pct: 50 } })]
    const fresh = [game('10', { name: 'Fresh Name' })]

    expect(mergeFreshGames(current, fresh)).toEqual([
      game('10', { name: 'Fresh Name', completion: { earned: 1, total: 2, pct: 50 } }),
    ])
  })

  it('preserves manually added app ids that are absent from the scan', () => {
    const current = [game('10'), game('999', { name: '999', manual: true })]
    const fresh = [game('10', { name: 'Fresh Name' })]

    expect(mergeFreshGames(current, fresh).map((g) => [g.appId, g.manual ?? false])).toEqual([
      ['999', true],
      ['10', false],
    ])
  })

  it('lets a real scan row replace a previous manual row', () => {
    const current = [game('10', { manual: true, name: '10' })]
    const fresh = [game('10', { name: 'Real Name' })]

    expect(mergeFreshGames(current, fresh)).toEqual([game('10', { name: 'Real Name' })])
  })
})

describe('appIdKey', () => {
  it('is stable across completion/name-only changes', () => {
    expect(appIdKey([game('2'), game('1')])).toBe('1|2')
    expect(appIdKey([game('1', { completion: { earned: 0, total: 1, pct: 0 } }), game('2')])).toBe('1|2')
  })
})
