import { createContext, useContext, type ReactNode } from 'react'
import type { useVirtualScroll } from '../lib/virtual'

type GameScrollValue = ReturnType<typeof useVirtualScroll>

const GameScrollContext = createContext<GameScrollValue | null>(null)

export function GameScrollProvider({
  value,
  children,
}: {
  value: GameScrollValue
  children: ReactNode
}) {
  return <GameScrollContext.Provider value={value}>{children}</GameScrollContext.Provider>
}

export function useGameScroll(): GameScrollValue {
  const value = useContext(GameScrollContext)
  if (!value) throw new Error('useGameScroll must be used inside GameScrollProvider')
  return value
}
