import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../../data'

// Fast path: the legacy CDN header works for most older games with no API call.
// Newer games serve art from unguessable content-hash URLs, so when this 404s we
// resolve the real URL via Steam's appdetails API (Rust `game_header`).
const fastUrls = (appId: string): string[] => [
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
]

// Resolved (API) header URLs cached per app id — session Map + localStorage, so the
// appdetails lookup happens at most once per game ever. '' marks a known-no-cover.
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
const remember = (appId: string, url: string) => {
  cache.set(appId, url)
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(cache)))
  } catch {
    // storage full / disabled — non-fatal
  }
}

export default function Cover({
  appId,
  style,
  children,
}: {
  appId: string
  style: CSSProperties
  children?: ReactNode
}) {
  const urls = fastUrls(appId)
  const [idx, setIdx] = useState(0)
  // undefined = still trying the fast paths; string = API result ('' means none).
  const [resolved, setResolved] = useState<string | undefined>(() =>
    cache.has(appId) ? cache.get(appId) : undefined,
  )
  const [loaded, setLoaded] = useState(false)

  // Once the fast paths are exhausted, ask Steam's appdetails API for the real URL.
  useEffect(() => {
    if (!isTauri() || resolved !== undefined || idx < urls.length) return
    let cancelled = false
    invoke<string>('game_header', { appId })
      .then((u) => {
        remember(appId, u)
        if (!cancelled) setResolved(u)
      })
      .catch(() => {
        remember(appId, '')
        if (!cancelled) setResolved('')
      })
    return () => {
      cancelled = true
    }
  }, [appId, idx, urls.length, resolved])

  const src = resolved !== undefined ? resolved || undefined : urls[idx]

  return (
    <div style={style}>
      {!loaded && children}
      {isTauri() && src && (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (resolved === undefined) setIdx((i) => i + 1)
            else {
              remember(appId, '')
              setResolved('')
            }
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: loaded ? 'block' : 'none',
          }}
        />
      )}
    </div>
  )
}
