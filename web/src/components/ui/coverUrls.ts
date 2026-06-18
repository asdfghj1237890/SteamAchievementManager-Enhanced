// Steam cover-art URL resolution, kept free of React/localStorage so it unit-tests
// cleanly in the node env. The hook in useCoverUrl.ts layers the API fallback + cache
// on top of these guessable CDN paths.

export type CoverVariant = 'capsule' | 'hero'

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

export interface CoverResolutionState {
  key: string
  idx: number
  resolved: string | undefined
}

export const coverKey = (appId: string, variant: CoverVariant): string => `${variant}:${appId}`

export const coverStateForKey = (
  state: CoverResolutionState | undefined,
  appId: string,
  variant: CoverVariant,
  cached: string | undefined,
): CoverResolutionState => {
  const key = coverKey(appId, variant)
  return state?.key === key ? state : { key, idx: 0, resolved: cached }
}

/**
 * Guessable CDN URLs to try, in priority order, before asking the appdetails API.
 * - `capsule` (library grid): the legacy 460×215 header works for most older games.
 * - `hero` (detail banner): the wide ~1920×620 hero art, falling back to the header.
 */
export const coverFastUrls = (appId: string, variant: CoverVariant): string[] =>
  variant === 'hero'
    ? [`${CDN}/${appId}/library_hero.jpg`, `${CDN}/${appId}/header.jpg`]
    : [`${CDN}/${appId}/header.jpg`]
