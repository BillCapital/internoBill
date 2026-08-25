import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ActivityLog from '../components/ActivityLog'
import { Icon } from '../lib/icons'
import { SkeletonKpis, SkeletonRows } from '../components/Skeleton'

export default function Home() {
  const { profile, role, canManageOrders, canManageRooms, canManageInventory, isAdmin, isAreaManager } = useAuth()
  const nav = useNavigate()
  const first = (profile?.full_name || profile?.email || '').split(' ')[0]
  const canManage = canManageOrders || isAdmin

  // ¿El usuario es aprobador de tecnología (2ª llave)?
  const [isTech, setIsTech] = useState(false)
  // Conteos del panel
  const [req, setReq] = useState({ pending: 0, manager_review: 0, approved: 0, rejected: 0, delivered: 0, total: 0 })
  const [resPend, setResPend] = useState(0)
  const [equip, setEquip] = useState({ mant: 0, sin: 0 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!profile?.id) return
    const tasks = []
    // ¿soy aprobador de tecnología?
    tasks.push(supabase.from('profiles').select('is_tech_approver').eq('id', profile.id).single()
      .then(({ data }) => setIsTech(!!data?.is_tech_approver)).catch(() => {}))
    // Solicitudes (RLS: gestora/admin ven todas; aprobador tec. ve las tecnológicas)
    if (canManage || true) {
      tasks.push(supabase.from('requests').select('status').then(({ data }) => {
        const c = { pending: 0, manager_review: 0, approved: 0, rejected: 0, delivered: 0, total: 0 }
        ;(data || []).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; c.total++ })
        setReq(c)
      }).catch(() => {}))
    }
    if (canManageRooms) {
      tasks.push(supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        .then(({ count }) => setResPend(count || 0)).catch(() => {}))
    }
    if (canManageInventory) {
      tasks.push(supabase.from('equipment').select('condition').then(({ data }) => {
        let mant = 0, sin = 0
        ;(data || []).forEach((e) => { if (e.condition === 'En mantenimiento') mant++; if (e.condition === 'Sin asignar') sin++ })
        setEquip({ mant, sin })
      }).catch(() => {}))
    }
    await Promise.all(tasks)
    setLoading(false)
  }, [profile?.id, canManage, canManageRooms, canManageInventory])
  useEffect(() => { load() }, [load])

  // Tarjeta KPI reutilizable
  const Kpi = ({ ico, num, lbl, tone, to }) => (
    <button className={`kpi ${tone === 'warn' ? 'kpi-warn' : ''}`} onClick={() => to && nav(to)} style={{ cursor: to ? 'pointer' : 'default' }}>
      <div className="ico"><Icon n={ico} /></div>
      <div className="num" style={tone === 'warn' ? { color: 'var(--warn, #f5b13d)' } : undefined}>{num}</div>
      <div className="lbl">{lbl}</div>
    </button>
  )

  // Lista de "pendientes de acción"
  const todos = []
  if (canManageOrders && req.pending > 0) todos.push({ k: 'p', ico: 'clock', txt: `${req.pending} solicitud(es) por revisar`, to: '/solicitudes' })
  if ((isTech || isAdmin || isAreaManager) && req.manager_review > 0) todos.push({ k: 'm', ico: 'key', txt: `${req.manager_review} compra(s) esperando tu autorización`, to: '/solicitudes' })
  else if (canManageOrders && req.manager_review > 0) todos.push({ k: 'm2', ico: 'key', txt: `${req.manager_review} compra(s) esperando autorización`, to: '/solicitudes' })
  if (canManageOrders && req.approved > 0) todos.push({ k: 'a', ico: 'box', txt: `${req.approved} aprobada(s) por entregar`, to: '/solicitudes' })
  if (canManageRooms && resPend > 0) todos.push({ k: 'r', ico: 'calendar', txt: `${resPend} reserva(s) de sala por aceptar`, to: '/salas' })
  if (canManageInventory && equip.mant > 0) todos.push({ k: 'em', ico: 'wrench', txt: `${equip.mant} equipo(s) en mantenimiento`, to: '/inventario' })

  const opts = [
    ['/salas', 'calendar', 'Reservar sala', 'Agenda una sala'],
    ['/solicitudes', 'box', 'Solicitudes', canManageOrders ? 'Revisa y aprueba pedidos' : 'Pide insumos por chat'],
    ['/soporte', 'chat', 'Soporte', 'Conversa con TI'],
  ]

  const showPanel = canManage || isTech || canManageRooms || isAreaManager
  // Subtítulo según el rol
  const subtitle = isAdmin ? 'Resumen general del sistema interno.'
    : canManageOrders ? 'Tu área: gestión de solicitudes de insumos.'
    : isTech ? 'Autorizas las compras de insumos tecnológicos (2ª llave).'
    : isAreaManager ? 'Autorizas las compras de tu departamento.'
    : canManageRooms ? 'Tu área: reservas de salas.'
    : '¿Qué quieres hacer hoy?'

  return (
    <div>
      <div className="page-head">
        <h2>Bienvenido{first ? `, ${first}` : ''}</h2>
        <p className="muted">{subtitle}</p>
      </div>

      {/* Carga: silueta del panel mientras llegan los datos */}
      {loading && (
        <>
          <div className="muted" style={{ fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 .5rem .2rem' }}>{showPanel ? 'Pendiente por aprobar' : 'Mis solicitudes'}</div>
          {showPanel ? <SkeletonRows n={2} /> : <SkeletonKpis n={4} />}
        </>
      )}

      {/* Vista de usuario común: un resumen de SUS solicitudes (RLS ya devuelve solo las propias) */}
      {!loading && !showPanel && req.total > 0 && (
        <>
          <div className="muted" style={{ fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 .5rem .2rem' }}>Mis solicitudes</div>
          <div className="kpi-grid compact kpi-sm" style={{ marginBottom: '.4rem' }}>
            <Kpi ico="clock" num={req.pending} lbl="Pendientes" to="/solicitudes" />
            {req.manager_review > 0 && <Kpi ico="key" num={req.manager_review} lbl="En autorización" tone="warn" to="/solicitudes" />}
            <Kpi ico="check" num={req.approved} lbl="Aprobadas" to="/solicitudes" />
            <Kpi ico="download" num={req.delivered} lbl="Entregadas" to="/solicitudes" />
          </div>
        </>
      )}

      {!loading && showPanel && (
        <>
          {/* Pendientes de acción: el foco del inicio es lo que queda por aprobar/atender */}
          <div className="muted" style={{ fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 .5rem .2rem' }}>Pendiente por aprobar</div>
          {todos.length > 0 ? (
            <div className="conv" style={{ padding: '.9rem 1rem', marginBottom: '1rem', borderLeft: '3px solid var(--warn, #f5b13d)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                {todos.map((t) => (
                  <button key={t.k} onClick={() => nav(t.to)} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', background: 'transparent', border: '1px solid var(--line)', borderRadius: 10, padding: '.55rem .75rem', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
                    <span style={{ color: 'var(--warn, #f5b13d)', display: 'flex' }}><Icon n={t.ico} /></span>
                    <span style={{ flex: 1, fontSize: '.9rem' }}>{t.txt}</span>
                    <span className="muted" style={{ fontSize: '.8rem' }}>Ir ›</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="conv" style={{ padding: '1.1rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '.7rem' }}>
              <span style={{ color: 'var(--lime)', display: 'flex' }}><Icon n="checkCircle" size={26} /></span>
              <div><strong>Todo al día.</strong><div className="muted" style={{ fontSize: '.86rem' }}>No hay nada pendiente por aprobar ni atender.</div></div>
            </div>
          )}
        </>
      )}

      <div className="act-grid three" style={{ marginTop: showPanel ? '1.4rem' : 0 }}>
        {opts.map((o) => (
          <button key={o[0]} className="act-card" onClick={() => nav(o[0])}>
            <span className="ico"><Icon n={o[1]} /></span><strong>{o[2]}</strong><span className="muted">{o[3]}</span>
          </button>
        ))}
      </div>

      {canManage && <ActivityLog kinds={['Anuncio']} title="Registro de anuncios" />}
    </div>
  )
}
