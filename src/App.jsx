import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'

// Carga diferida de páginas: cada una se descarga solo cuando se visita (menor carga inicial)
const Home = lazy(() => import('./pages/Home'))
const Rooms = lazy(() => import('./pages/Rooms'))
const Solicitudes = lazy(() => import('./pages/Solicitudes'))
const Soporte = lazy(() => import('./pages/Soporte'))
const Manuales = lazy(() => import('./pages/Manuales'))
const Inventario = lazy(() => import('./pages/Inventario'))
const EquipoDetalle = lazy(() => import('./pages/EquipoDetalle'))
const EquipoMobile = lazy(() => import('./pages/EquipoMobile'))
const Insumos = lazy(() => import('./pages/Insumos'))
const Usuarios = lazy(() => import('./pages/Usuarios'))
const Roles = lazy(() => import('./pages/Roles'))
const Perfil = lazy(() => import('./pages/Perfil'))

function Protected({ children, need }) {
  const auth = useAuth()
  const { user, loading } = auth
  if (loading) return <div className="page-loader">Cargando…</div>
  if (!user) return <Navigate to="/login" replace />
  const map = {
    supplies: auth.canManageSupplies, inventory: auth.canManageInventory,
    users: auth.canManageUsers, orders: auth.canManageOrders, rooms: auth.canManageRooms,
  }
  if (need && !map[need]) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Suspense fallback={<div className="page-loader">Cargando…</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Vista móvil (a la que apunta el QR): sin barra lateral */}
        <Route path="/m/equipo/:id" element={<EquipoMobile />} />
        <Route path="/" element={<Protected><Layout /></Protected>}>
          <Route index element={<Home />} />
          <Route path="salas" element={<Rooms />} />
          <Route path="solicitudes" element={<Solicitudes />} />
          <Route path="soporte" element={<Soporte />} />
          <Route path="manuales" element={<Manuales />} />
          <Route path="insumos" element={<Protected need="supplies"><Insumos /></Protected>} />
          <Route path="inventario" element={<Protected need="inventory"><Inventario /></Protected>} />
          <Route path="equipo/:id" element={<Protected need="inventory"><EquipoDetalle /></Protected>} />
          <Route path="usuarios" element={<Protected need="users"><Usuarios /></Protected>} />
          <Route path="roles" element={<Protected need="users"><Roles /></Protected>} />
          <Route path="perfil" element={<Perfil />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
