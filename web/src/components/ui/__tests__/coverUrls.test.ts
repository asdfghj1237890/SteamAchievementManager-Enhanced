import { describe, expect, it } from 'vitest'
import { coverFastUrls, coverStateForKey } from '../coverUrls'

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

describe('coverFastUrls', () => {
  it('capsule variant resolves to the legacy header image only', () => {
    expect(coverFastUrls('261640', 'capsule')).toEqual([`${CDN}/261640/header.jpg`])
  })

  it('hero variant tries the wide hero image before falling back to the header', () => {
    expect(coverFastUrls('261640', 'hero')).toEqual([
      `${CDN}/261640/library_hero.jpg`,
      `${CDN}/261640/header.jpg`,
    ])
  })

  it('resets resolution state when the app id changes', () => {
    const previous = { key: 'hero:10', idx: 2, resolved: 'https://cdn.example/old.jpg' }

    expect(coverStateForKey(previous, '20', 'hero', undefined)).toEqual({
      key: 'hero:20',
      idx: 0,
      resolved: undefined,
    })
  })
})
