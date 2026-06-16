import { useState, type CSSProperties } from 'react'

// Real Steam achievement icon over the colored fallback tile (shown until/unless
// the image loads). Demo achievements have no url → the tile + letter remain.
export default function AchIcon({
  url,
  style,
  letter,
}: {
  url?: string
  style: CSSProperties
  letter: string
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div style={{ ...style, position: 'relative', overflow: 'hidden' }}>
      {!loaded && letter}
      {url && (
        <img
          src={url}
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
