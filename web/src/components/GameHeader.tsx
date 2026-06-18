import { useState, type CSSProperties } from 'react'
import { useLocation } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import { completion, points } from '../lib/achievements'
import { isTauri } from '../data'
import type { I18nKey } from '../i18n'
import type { Tab } from '../types'
import Seg from './ui/Seg'
import { useCoverUrl } from './ui/useCoverUrl'

const TABS: [Tab, I18nKey][] = [['ach', 'tab.ach'], ['stats', 'tab.stats']]

export default function GameHeader() {
  const { state, t, activeGame, gotoTab, openLibrary } = useApp()
  const loc = useLocation()
  const { src: heroSrc, onError: onHeroError } = useCoverUrl(activeGame?.appId ?? '', 'hero')
  const [heroLoaded, setHeroLoaded] = useState(false)
  if (!activeGame) return null

  const g = activeGame
  const currentTab: Tab = loc.pathname.endsWith('/stats') ? 'stats' : 'ach'
  const dark = state.theme !== 'light'
  const { earned, total, pct } = completion(g, state.achState)
  const pts = points(g, state.achState)
  // Real Steam hero art replaces the gradient placeholder once it has loaded.
  const showArt = isTauri() && !!heroSrc && heroLoaded

  const bannerStyle: CSSProperties = {
    position: 'relative', borderRadius: 'var(--radius-lg)', padding: '20px 22px', overflow: 'hidden',
    color: '#fff',
    // Tall, hero-ish ratio so cover crops the wide art only slightly; content anchored to the bottom.
    aspectRatio: '16 / 5', maxHeight: '320px', minHeight: '168px',
    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    background:
      `repeating-linear-gradient(125deg, rgba(255,255,255,.05) 0 2px, transparent 2px 17px), ` +
      `linear-gradient(118deg, hsl(${g.hue} 42% ${dark ? 20 : 30}%), hsl(${(g.hue + 42) % 360} 46% ${dark ? 30 : 44}%))`,
  }
  const barStyle: CSSProperties = {
    width: pct + '%', height: '100%', borderRadius: '999px',
    background: 'linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 45%, var(--good)))',
    transition: 'width .35s',
  }

  return (
    <>
      <div style={{ padding: '18px 22px 0' }}>
        <Seg onClick={openLibrary} style={{ padding: '6px 12px', color: 'var(--t2)', marginBottom: '12px' }}>
          ← {t('nav.library')}
        </Seg>
      </div>
      <div style={{ padding: '0 22px' }}>
        <div style={bannerStyle}>
          {isTauri() && heroSrc && (
            <img
              key={heroSrc}
              src={heroSrc}
              alt=""
              draggable={false}
              onLoad={() => setHeroLoaded(true)}
              onError={onHeroError}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                objectPosition: 'center 35%', zIndex: 0, opacity: heroLoaded ? 1 : 0, transition: 'opacity .35s',
              }}
            />
          )}
          {showArt && (
            <div
              style={{
                position: 'absolute', inset: 0, zIndex: 0,
                background:
                  'linear-gradient(0deg, rgba(0,0,0,.82) 0%, rgba(0,0,0,.5) 20%, rgba(0,0,0,.12) 46%, transparent 72%), ' +
                  'linear-gradient(90deg, rgba(0,0,0,.35), transparent 38%)',
              }}
            />
          )}
          {!showArt && (
            <div style={{ position: 'absolute', top: '10px', right: '14px', zIndex: 1, fontSize: '9.5px', letterSpacing: '1px', fontFamily: 'var(--meta)', color: 'rgba(255,255,255,.45)' }}>
              {t('game.coverPlaceholder')}
            </div>
          )}
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: '26px', fontWeight: 700, letterSpacing: '-.4px', textShadow: '0 2px 12px rgba(0,0,0,.4)' }}>
                {g.name}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '7px', fontSize: '12px', opacity: 0.92 }}>
                {g.genre && <span style={{ fontWeight: 600 }}>{g.genre}</span>}
                <span style={{ fontFamily: 'var(--meta)', opacity: 0.8 }}>APP ID {g.appId}</span>
                {g.last && <span style={{ opacity: 0.8 }}>{t('game.lastPlayed')} {g.last}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
              <div style={{ fontSize: '30px', fontWeight: 800, lineHeight: 1, letterSpacing: '-.5px', fontFamily: 'var(--meta)' }}>{pct}%</div>
              <div style={{ fontSize: '11.5px', opacity: 0.9, marginTop: '5px' }}>
                {t('game.achPts', { earned, total, pts: pts.earned.toLocaleString(), ptsTotal: pts.total.toLocaleString() })}
              </div>
            </div>
          </div>
          <div style={{ position: 'relative', zIndex: 1, marginTop: '15px', height: '7px', borderRadius: '999px', background: 'rgba(0,0,0,.28)', overflow: 'hidden' }}>
            <div style={barStyle} />
          </div>
        </div>
      </div>
      {/* Tab bar stays pinned to the top of the scroll area as the banner scrolls away. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--s0)', display: 'flex', alignItems: 'flex-end', height: 'var(--tabbar-h, 40px)', marginTop: '6px', borderBottom: '1px solid var(--bd)', padding: '0 22px' }}>
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => gotoTab(g.appId, k)}
            style={{
              padding: '9px 4px', marginRight: '22px', background: 'transparent', border: 'none',
              cursor: 'pointer', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
              color: currentTab === k ? 'var(--t1)' : 'var(--t3)',
              borderBottom: '2px solid ' + (currentTab === k ? 'var(--accent)' : 'transparent'),
              transition: 'color .15s',
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </>
  )
}
