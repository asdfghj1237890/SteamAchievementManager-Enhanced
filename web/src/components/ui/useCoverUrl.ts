import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../data'
import { coverFastUrls, type CoverVariant } from './coverUrls'

// Resolved (appdetails API) URLs cached per `${variant}:${appId}` — session Map +
// localStorage — so the lookup happens at most once per game/variant ever. '' marks a
// known-no-cover. Namespacing by variant keeps a capsule-cached header from pre-empting
// the hero variant's library_hero attempt.
const CACHE_KEY = 'sam-header-cache-v1'
const cache = new Map<string, string>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')) as [string, string][]
    } catch {
      return []
    }
  })(),
)
const keyOf = (appId: string, variant: CoverVariant) => `${variant}:${appId}`
const remember = (appId: string, variant: CoverVariant, url: string) => {
  cache.set(keyOf(appId, variant), url)
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(cache)))
  } catch {
    // storage full / disabled — non-fatal
  }
}

/**
 * Resolves a game's cover-art `<img>` src: walks the guessable CDN paths, then falls back
 * to Steam's appdetails API (`game_header`), caching the API result. Returns the current
 * `src` (`undefined` = still trying / no cover) and an `onError` that advances the chain.
 * Callers own the `loaded`/render state so the same resolution drives different layouts.
 */
export function useCoverUrl(appId: string, variant: CoverVariant) {
  const urls = coverFastUrls(appId, variant)
  const key = keyOf(appId, variant)
  const [idx, setIdx] = useState(0)
  // undefined = still trying the fast paths; string = API result ('' means none).
  const [resolved, setResolved] = useState<string | undefined>(() =>
    cache.has(key) ? cache.get(key) : undefined,
  )

  // Once the fast paths are exhausted, ask Steam's appdetails API for the real URL.
  useEffect(() => {
    if (!isTauri() || resolved !== undefined || idx < urls.length) return
    let cancelled = false
    invoke<string>('game_header', { appId })
      .then((u) => {
        remember(appId, variant, u)
        if (!cancelled) setResolved(u)
      })
      .catch(() => {
        remember(appId, variant, '')
        if (!cancelled) setResolved('')
      })
    return () => {
      cancelled = true
    }
  }, [appId, variant, idx, urls.length, resolved])

  const src = resolved !== undefined ? resolved || undefined : urls[idx]
  const onError = () => {
    if (resolved === undefined) setIdx((i) => i + 1)
    else {
      remember(appId, variant, '')
      setResolved('')
    }
  }

  return { src, onError }
}
