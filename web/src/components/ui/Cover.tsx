import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
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

  useEffect(() => {
    setLoaded(false)
  }, [src, appId])

  return (
    <div style={style}>
      {!loaded && children}
      {isTauri() && src && (
        <img
          key={src}
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
            // opacity, not display:none — a boxless lazy image never intersects the
            // viewport, so it would never load and onLoad could never reveal it.
            opacity: loaded ? 1 : 0,
            transition: 'opacity .35s',
          }}
        />
      )}
    </div>
  )
}
