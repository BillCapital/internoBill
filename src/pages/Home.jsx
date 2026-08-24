import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ActivityLog from '../components/ActivityLog'

export default function Home() {
  const { profile, role, canManageOrders, isAdmin } = useAuth()
  const nav = useNavigate()
  const first = (profile?.full_name || profile?.email || '').split(' ')[0]
  const canManage = canManageOrders || isAdmin

  const opts = [
    ['/salas', '📅', 'Reservar sala', 'Agenda una sala'],
    ['/solicitudes', '📦', 'Solicitudes', canManageOrders ? 'Revisa y aprueba pedidos' : 'Pide insumos por chat'],
    ['/soporte', '💬', 'Soporte', 'Conversa con TI'],
  ]

  return (
    <div>
      <div className="page-head">
        <h2>Bienvenido{first ? `, ${first}` : ''}</h2>
        <p className="muted">{role === 'admin' ? 'Resumen general del sistema interno.' : role === 'pedidos' ? 'Tu área: gestión de solicitudes de insumos.' : '¿Qué quieres hacer hoy?'}</p>
      </div>

      <div className="act-grid three">
        {opts.map((o) => (
          <button key={o[0]} className="act-card" onClick={() => nav(o[0])}>
            <span className="ico">{o[1]}</span><strong>{o[2]}</strong><span className="muted">{o[3]}</span>
          </button>
        ))}
      </div>

      {canManage && <ActivityLog kinds={['Anuncio']} title="Registro de anuncios" />}
    </div>
  )
}
