import { useEffect, type CSSProperties } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router'
import { useApp } from '../state/AppContext'
import { useVirtualScroll } from '../lib/virtual'
import { GameScrollProvider } from './GameScroll'
import GameHeader from './GameHeader'
import { ErrorPane, LoadingPane } from './Panes'

export default function GameScreen() {
  const { appId } = useParams()
  const { openGame, state, games, t } = useApp()
  const scroll = useVirtualScroll()

  useEffect(() => {
    if (appId) openGame(appId)
  }, [appId, openGame])

  // Unknown appId once the list is loaded → bounce to the library.
  if (appId && state.gamesStatus === 'ready' && !games.some((g) => g.appId === appId || g.id === appId)) {
    return <Navigate to="/" replace />
  }

  if (appId && state.activeAppId === appId && state.detailStatus === 'error') {
    return <ErrorPane msg={state.detailError} onRetry={() => openGame(appId)} />
  }

  const ready =
    !!appId && state.activeAppId === appId && state.detailStatus === 'ready' && !!state.loaded[appId]

  if (!ready) {
    return <LoadingPane label={t('game.loading')} />
  }

  // One scroll container for the whole game screen: the hero banner scrolls away while
  // the tab bar (and each tab's toolbar) stay pinned via position:sticky. --tabbar-h is
  // the pinned tab-bar height, reused as the toolbar's sticky offset.
  return (
    <GameScrollProvider value={scroll}>
      <div
        ref={scroll.containerRef}
        onScroll={scroll.onScroll}
        className="dc-page"
        style={{ flex: 1, overflowY: 'auto', minHeight: 0, '--tabbar-h': '40px' } as CSSProperties}
      >
        <GameHeader />
        <TabOutlet />
      </div>
    </GameScrollProvider>
  )
}

// The tab content (achievements ↔ stats) gets its own enter transition: keyed on the
// tab so a switch remounts the wrapper, and its own component so only it re-renders
// on location change (GameScreen and GameHeader stay out of it).
function TabOutlet() {
  const { pathname } = useLocation()
  return (
    <div key={pathname.endsWith('/stats') ? 'stats' : 'achievements'} className="dc-swap">
      <Outlet />
    </div>
  )
}
