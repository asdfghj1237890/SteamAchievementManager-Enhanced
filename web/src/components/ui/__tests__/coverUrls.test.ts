import { describe, expect, it } from 'vitest'
import { coverFastUrls } from '../coverUrls'

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
})
