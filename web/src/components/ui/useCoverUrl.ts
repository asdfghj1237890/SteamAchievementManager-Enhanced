import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../data'
import {
  coverFastUrls, coverKey, coverStateForKey, type CoverResolutionState, type CoverVariant,
} from './coverUrls'

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
const remember = (appId: string, variant: CoverVariant, url: string) => {
  cache.set(coverKey(appId, variant), url)
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
  const key = coverKey(appId, variant)
  const cached = cache.has(key) ? cache.get(key) : undefined
  const [state, setState] = useState<CoverResolutionState>(() =>
    coverStateForKey(undefined, appId, variant, cached),
  )
  const current = coverStateForKey(state, appId, variant, cached)
  const { idx, resolved } = current

  useEffect(() => {
    setState((cur) => coverStateForKey(cur, appId, variant, cache.has(key) ? cache.get(key) : undefined))
  }, [appId, variant, key])

  // Once the fast paths are exhausted, ask Steam's appdetails API for the real URL.
  useEffect(() => {
    if (!isTauri() || resolved !== undefined || idx < urls.length) return
    let cancelled = false
    invoke<string>('game_header', { appId })
      .then((u) => {
        remember(appId, variant, u)
        if (!cancelled) {
          setState((cur) => ({ ...coverStateForKey(cur, appId, variant, undefined), resolved: u }))
        }
      })
      .catch(() => {
        remember(appId, variant, '')
        if (!cancelled) {
          setState((cur) => ({ ...coverStateForKey(cur, appId, variant, undefined), resolved: '' }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [appId, variant, idx, urls.length, resolved])

  const src = resolved !== undefined ? resolved || undefined : urls[idx]
  const onError = () => {
    setState((cur) => {
      const next = coverStateForKey(cur, appId, variant, cache.has(key) ? cache.get(key) : undefined)
      if (next.resolved === undefined) return { ...next, idx: next.idx + 1 }
      remember(appId, variant, '')
      return { ...next, resolved: '' }
    })
  }

  return { src, onError }
}
