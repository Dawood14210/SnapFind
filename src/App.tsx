import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Rules from './pages/Rules'
import Lobby from './pages/Lobby'
import PlayAreaEditor from './pages/PlayAreaEditor'
import Round from './pages/Round'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/rules" element={<Rules />} />
      <Route path="/room/:code" element={<Lobby />} />
      <Route path="/room/:code/area" element={<PlayAreaEditor />} />
      <Route path="/room/:code/round" element={<Round />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
