import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from './state/AppContext'
import AppLayout from './components/AppLayout'
import Library from './components/Library'
import GameScreen from './components/GameScreen'
import Achievements from './components/Achievements'
import Statistics from './components/Statistics'
import Settings from './components/Settings'

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Library />} />
          <Route path="game/:appId" element={<GameScreen />}>
            <Route index element={<Achievements />} />
            <Route path="stats" element={<Statistics />} />
          </Route>
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  )
}
