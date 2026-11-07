import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Rules from './pages/Rules'
import Lobby from './pages/Lobby'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/rules" element={<Rules />} />
      <Route path="/room/:code" element={<Lobby />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
