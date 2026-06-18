// Steam cover-art URL resolution, kept free of React/localStorage so it unit-tests
// cleanly in the node env. The hook in useCoverUrl.ts layers the API fallback + cache
// on top of these guessable CDN paths.

export type CoverVariant = 'capsule' | 'hero'

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

/**
 * Guessable CDN URLs to try, in priority order, before asking the appdetails API.
 * - `capsule` (library grid): the legacy 460×215 header works for most older games.
 * - `hero` (detail banner): the wide ~1920×620 hero art, falling back to the header.
 */
export const coverFastUrls = (appId: string, variant: CoverVariant): string[] =>
  variant === 'hero'
    ? [`${CDN}/${appId}/library_hero.jpg`, `${CDN}/${appId}/header.jpg`]
    : [`${CDN}/${appId}/header.jpg`]
