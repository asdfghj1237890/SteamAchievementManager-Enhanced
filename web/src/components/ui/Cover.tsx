import { useState, type CSSProperties, type ReactNode } from 'react'
import { isTauri } from '../../data'

// Real Steam header art; falls back to the gradient placeholder on error or in
// the web/demo build (fictional app ids have no CDN image).
const coverUrl = (appId: string) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`

export default function Cover({
  appId,
  style,
  children,
}: {
  appId: string
  style: CSSProperties
  children?: ReactNode
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div style={style}>
      {!loaded && children}
      {isTauri() && (
        <img
          src={coverUrl(appId)}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
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
