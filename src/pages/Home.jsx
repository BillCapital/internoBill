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
      tasks.push(supabase.from('requests').select('status, created_at').then(({ data }) => {
        const c = { pending: 0, manager_review: 0, approved: 0, rejected: 0, delivered: 0, total: 0, oldPending: null, oldReview: null }
        ;(data || []).forEach((r) => {
          c[r.status] = (c[r.status] || 0) + 1; c.total++
          if (r.status === 'pending' && (!c.oldPending || r.created_at < c.oldPending)) c.oldPending = r.created_at
          if (r.status === 'manager_review' && (!c.oldReview || r.created_at < c.oldReview)) c.oldReview = r.created_at
        })
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

  // Saludo según la hora (hora local del navegador)
  const hr = new Date().getHours()
  const hi = hr < 12 ? 'Buenos días' : hr < 20 ? 'Buenas tardes' : 'Buenas noches'
  // "hace X" para dar contexto de urgencia a la tarjeta
  const agoTxt = (iso) => {
    if (!iso) return ''
    const ms = Date.now() - new Date(iso).getTime()
    const d = Math.floor(ms / 86400000)
    if (d >= 1) return `la más antigua hace ${d} día${d > 1 ? 's' : ''}`
    const h = Math.floor(ms / 3600000)
    if (h >= 1) return `la más antigua hace ${h} h`
    return 'la más antigua hace minutos'
  }

  // Lista de "pendientes de acción" — cada uno se muestra como tarjeta con número, color por urgencia y contexto
  const todos = []
  if (canManageOrders && req.pending > 0) todos.push({ k: 'p', ico: 'clock', n: req.pending, txt: 'Solicitud(es) por revisar', sub: agoTxt(req.oldPending), tone: 'warn', to: '/solicitudes' })
  if ((isTech || isAdmin || isAreaManager) && req.manager_review > 0) todos.push({ k: 'm', ico: 'key', n: req.manager_review, txt: 'Compra(s) esperando tu autorización', sub: agoTxt(req.oldReview), tone: 'warn', to: '/solicitudes' })
  else if (canManageOrders && req.manager_review > 0) todos.push({ k: 'm2', ico: 'key', n: req.manager_review, txt: 'Compra(s) esperando autorización', sub: agoTxt(req.oldReview), tone: 'info', to: '/solicitudes' })
  if (canManageOrders && req.approved > 0) todos.push({ k: 'a', ico: 'box', n: req.approved, txt: 'Aprobada(s) por entregar', sub: 'listas para coordinar entrega', tone: 'ok', to: '/solicitudes' })
  if (canManageRooms && resPend > 0) todos.push({ k: 'r', ico: 'calendar', n: resPend, txt: 'Reserva(s) de sala por aceptar', sub: '', tone: 'info', to: '/salas' })
  if (canManageInventory && equip.mant > 0) todos.push({ k: 'em', ico: 'wrench', n: equip.mant, txt: 'Equipo(s) en mantenimiento', sub: '', tone: '', to: '/inventario' })
  // Prioridad: lo que requiere tu acción (ámbar) primero, luego en curso (azul), luego listo (verde) y neutro
  const toneRank = { warn: 0, info: 1, ok: 2, '': 3 }
  todos.sort((a, b) => (toneRank[a.tone] ?? 3) - (toneRank[b.tone] ?? 3))
  // Resumen: total de pendientes y cuántos requieren acción del usuario (ámbar)
  const totalPend = todos.reduce((s, t) => s + t.n, 0)
  const needAction = todos.filter((t) => t.tone === 'warn').reduce((s, t) => s + t.n, 0)

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
        <h2>{hi}{first ? `, ${first}` : ''}</h2>
        <p className="muted">{subtitle}</p>
      </div>

      {/* Carga: silueta del panel de pendientes mientras llegan los datos (solo para roles con panel) */}
      {loading && showPanel && (
        <>
          <div className="muted" style={{ fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 .5rem .2rem' }}>Pendiente por aprobar</div>
          <SkeletonRows n={2} />
        </>
      )}

      {!loading && showPanel && (
        <>
          {/* Pendientes de acción: el foco del inicio es lo que queda por aprobar/atender */}
          <div className="todo-head">
            <span className="th-eyebrow">Pendiente por aprobar</span>
            {todos.length > 0 && (
              <span className="th-summary">{totalPend} pendiente{totalPend !== 1 ? 's' : ''}{needAction > 0 && <> · <b>{needAction} requiere{needAction !== 1 ? 'n' : ''} tu acción</b></>}</span>
            )}
          </div>
          {todos.length > 0 ? (
            <div className="todo-cards">
              {todos.map((t) => (
                <button key={t.k} className={`todo-card ${t.tone || ''}`} onClick={() => nav(t.to)}>
                  <span className="tc-ic"><Icon n={t.ico} /></span>
                  <span className="tc-body"><span className="tc-n">{t.n}</span><span className="tc-t">{t.txt}</span>{t.sub ? <span className="tc-sub">{t.sub}</span> : null}</span>
                  <span className="tc-go">›</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="conv" style={{ padding: '1.1rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '.7rem' }}>
              <span style={{ color: 'var(--lime)', display: 'flex' }}><Icon n="checkCircle" size={26} /></span>
              <div><strong>Todo al día.</strong><div className="muted" style={{ fontSize: '.86rem' }}>No hay nada pendiente por aprobar ni atender.</div></div>
            </div>
          )}
        </>
      )}

      {showPanel && <div className="th-eyebrow" style={{ margin: '1.4rem 0 .5rem .2rem' }}>Acciones rápidas</div>}
      <div className={`act-grid three ${showPanel ? 'compact' : ''}`} style={{ marginTop: showPanel ? 0 : 0 }}>
        {opts.map((o) => (
          <button key={o[0]} className="act-card" onClick={() => nav(o[0])}>
            <span className="ico"><Icon n={o[1]} /></span><strong>{o[2]}</strong>{!showPanel && <span className="muted">{o[3]}</span>}
          </button>
        ))}
      </div>

      {canManage && <ActivityLog kinds={['Anuncio']} title="Registro de anuncios" />}
    </div>
  )
}
