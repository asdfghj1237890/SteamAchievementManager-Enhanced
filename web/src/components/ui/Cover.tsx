import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { isTauri } from '../../data'
import { useCoverUrl } from './useCoverUrl'

// Library capsule: the resolved cover art replaces the placeholder `children` once it
// loads. URL resolution + caching lives in useCoverUrl; this component just renders it.
export default function Cover({
  appId,
  style,
  children,
}: {
  appId: string
  style: CSSProperties
  children?: ReactNode
}) {
  const { src, onError } = useCoverUrl(appId, 'capsule')
  const [loaded, setLoaded] = useState(false)

  // Reset to the placeholder when the resolved URL changes (e.g. this row is reused
  // for another game as the virtualized list scrolls). Done during render rather than
  // via a key/effect so the <img> element is reused — the browser keeps its decoded
  // image cache instead of re-decoding from scratch, which was causing scroll flicker.
  const shownSrc = useRef(src)
  if (shownSrc.current !== src) {
    shownSrc.current = src
    setLoaded(false)
  }

  return (
    <div style={style}>
      {!loaded && children}
      {isTauri() && src && (
        <img
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={onError}
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
