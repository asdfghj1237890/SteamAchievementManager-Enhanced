import { useEffect } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { useApp } from '../state/AppContext'
import GameHeader from './GameHeader'
import { ErrorPane, LoadingPane } from './Panes'

export default function GameScreen() {
  const { appId } = useParams()
  const { openGame, state, games, t } = useApp()

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

  return (
    <>
      <GameHeader />
      <Outlet />
    </>
  )
}
