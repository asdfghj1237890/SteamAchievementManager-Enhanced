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
