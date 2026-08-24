import { useEffect, useState, useCallback, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { confirmDialog, alertDialog } from '../lib/ui'

const ROLE_LABEL = { user: 'Usuario', pedidos: 'Gestora de pedidos', admin: 'Administrador' }
const KIND_ICON = { ok: '✅', bad: '⛔', msg: '💬', info: '🔔' }
const initials = (n) => (n || '?').split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase()
const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'recién'; if (s < 3600) return `hace ${Math.floor(s / 60)} min`; if (s < 86400) return `hace ${Math.floor(s / 3600)} h`; return `hace ${Math.floor(s / 86400)} d` }

export default function Layout() {
  const { user, profile, role, roleLabel, isAdmin, canManageOrders, canManageRooms, canManageSupplies, canManageInventory, canManageUsers, signOut } = useAuth()
  const nav = useNavigate()
  const [collapsed, setCollapsed] = useState(true)
  const [theme, setTheme] = useState('dark')
  const [counts, setCounts] = useState({ sol: 0, sal: 0 })
  const [notifs, setNotifs] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef(null)
  const [anns, setAnns] = useState([])
  const [annOpen, setAnnOpen] = useState(false)
  const [annForm, setAnnForm] = useState(null) // {title, body} cuando se crea
  const annRef = useRef(null)
  const canManageAnn = canManageOrders || isAdmin

  const loadAnns = useCallback(async () => {
    const { data } = await supabase.from('announcements').select('id,title,body,author_name,created_at').order('created_at', { ascending: false }).limit(30)
    setAnns(data ?? [])
  }, [])
  useEffect(() => { loadAnns() }, [loadAnns])
  const publishAnn = async () => {
    if (!(annForm.title || '').trim()) return alertDialog('Ponle un título al anuncio.')
    try { await api('announcement_create', { p_title: annForm.title.trim(), p_body: (annForm.body || '').trim() }); setAnnForm(null); await loadAnns() } catch (e) { alertDialog(e.message) }
  }
  const delAnn = async (id) => {
    if (!(await confirmDialog('¿Eliminar este anuncio?', { title: 'Eliminar anuncio', danger: true, okText: 'Eliminar' }))) return
    try { await api('announcement_delete', { p_id: id }); await loadAnns() } catch (e) { alertDialog(e.message) }
  }

  useEffect(() => { document.body.classList.toggle('light', theme === 'light'); return () => document.body.classList.remove('light') }, [theme])
  useEffect(() => { document.body.classList.toggle('sb-collapsed', collapsed); return () => document.body.classList.remove('sb-collapsed') }, [collapsed])

  const loadNotifs = useCallback(async () => {
    if (!user) return
    const [{ data: real }, { count: sol }, { count: sal }] = await Promise.all([
      supabase.from('notifications').select('id,title,body,link,kind,created_at').is('read_at', null).order('created_at', { ascending: false }).limit(40),
      canManageOrders ? supabase.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
      canManageRooms ? supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
    ])
    // Pendientes por atender (gestora/admin) como aviso no descartable
    const pend = []
    if (canManageOrders && sol) pend.push({ id: 'c-sol', computed: true, kind: 'info', title: `${sol} solicitud(es) por revisar`, body: '', link: '/solicitudes' })
    if (canManageRooms && sal) pend.push({ id: 'c-sal', computed: true, kind: 'info', title: `${sal} reserva(s) por aceptar`, body: '', link: '/salas' })
    setNotifs([...pend, ...(real ?? [])])
    setCounts({ sol: sol ?? 0, sal: sal ?? 0 })
  }, [user, canManageOrders, canManageRooms])
  useEffect(() => { loadNotifs() }, [loadNotifs])
  // refresco periódico de notificaciones
  useEffect(() => { const t = setInterval(loadNotifs, 30000); return () => clearInterval(t) }, [loadNotifs])

  const dismiss = async (n) => { if (n.computed) return; try { await api('mark_notification_read', { p_id: n.id }) } catch (e) { /* noop */ } setNotifs((l) => l.filter((x) => x.id !== n.id)) }
  const markAll = async () => { try { await api('mark_all_notifications_read', {}) } catch (e) { /* noop */ } setNotifs((l) => l.filter((x) => x.computed)) }

  useEffect(() => {
    const onClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
      if (annRef.current && !annRef.current.contains(e.target)) setAnnOpen(false)
    }
    document.addEventListener('click', onClick); return () => document.removeEventListener('click', onClick)
  }, [])

  const name = profile?.full_name || profile?.email || '—'
  // Sección de usuario (todos) y sección de administración (según permisos)
  const userMenu = [
    { to: '/', end: true, icon: '🏠', label: 'Inicio' },
    { to: '/salas', icon: '📅', label: 'Salas', pill: counts.sal },
    { to: '/solicitudes', icon: '📦', label: 'Solicitudes', pill: counts.sol },
    { to: '/manuales', icon: '📚', label: 'Manuales' },
    { to: '/soporte', icon: '💬', label: 'Soporte' },
  ]
  const adminMenu = [
    ...(canManageSupplies ? [{ to: '/insumos', icon: '📥', label: 'Insumos' }] : []),
    ...(canManageInventory ? [{ to: '/inventario', icon: '🗂️', label: 'Inventario' }] : []),
    ...(canManageUsers ? [{ to: '/usuarios', icon: '👥', label: 'Usuarios' }] : []),
    ...(canManageUsers ? [{ to: '/roles', icon: '🔐', label: 'Accesos' }] : []),
  ]
  const closeIfMobile = () => { if (window.innerWidth <= 760) setCollapsed(true) }
  const MenuLink = (m) => (
    <NavLink key={m.to} to={m.to} end={m.end} onClick={closeIfMobile}
      className={({ isActive }) => `menu-item${isActive ? ' active' : ''}`} style={{ textDecoration: 'none' }}>
      <span className="mi">{m.icon}</span><span className="mlbl">{m.label}</span>
      {m.pill ? <span className="pill">{m.pill}</span> : null}
    </NavLink>
  )

  const goNotif = (n) => { setNotifOpen(false); dismiss(n); if (n.link) nav(n.link) }

  return (
    <div className="app" style={{ display: 'block' }}>
      <div className="topbar"><div className="topbar-inner">
        <div className="brand">
          <button className="hamb" title="Menú" onClick={() => setCollapsed((c) => !c)}>☰</button>
          <span className="brand-mark">B</span><span className="brand-name">Billcapital</span>
        </div>
        <div className="top-right">
          <button className="iconbtn" title="Modo claro / oscuro" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>{theme === 'dark' ? '🌙' : '☀️'}</button>
          <div className="notif-wrap" ref={notifRef}>
            <button className="iconbtn" title="Notificaciones" onClick={() => { setAnnOpen(false); setNotifOpen((v) => !v); if (!notifOpen) loadNotifs() }}>
              🔔{notifs.length > 0 && <span className="notif-dot">{notifs.length}</span>}
            </button>
            {notifOpen && (
              <div className="notif-panel">
                <div className="notif-head"><span>Notificaciones</span>{notifs.length > 0 && <button className="notif-all" onClick={markAll}>Marcar todas</button>}</div>
                {notifs.length === 0
                  ? <div className="notif-empty">Sin novedades por ahora.</div>
                  : notifs.map((n) => (
                    <div key={n.id} className="notif-item">
                      <span className="ni">{KIND_ICON[n.kind] || '🔔'}</span>
                      <button className="notif-body" onClick={() => goNotif(n)}>
                        <strong>{n.title}</strong>{n.body ? <><br /><span className="muted">{n.body}</span></> : null}
                        {n.created_at ? <><br /><span className="notif-time">{ago(n.created_at)}</span></> : null}
                      </button>
                      {!n.computed && <button className="notif-x" title="Terminar" onClick={() => dismiss(n)}>✓</button>}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="notif-wrap" ref={annRef}>
            <button className="iconbtn" title="Anuncios" onClick={() => { setNotifOpen(false); setAnnOpen((v) => !v); if (!annOpen) loadAnns() }}>📣</button>
            {annOpen && (
              <div className="notif-panel">
                <div className="notif-head"><span>Anuncios</span>{canManageAnn && <button className="notif-all" onClick={() => setAnnForm(annForm ? null : { title: '', body: '' })}>{annForm ? 'Cerrar' : '＋ Nuevo'}</button>}</div>
                {canManageAnn && annForm && (
                  <div className="ann-form" style={{ margin: '.2rem .2rem .5rem' }}>
                    <input placeholder="Título" value={annForm.title} onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })} />
                    <textarea placeholder="Mensaje (opcional)" value={annForm.body} onChange={(e) => setAnnForm({ ...annForm, body: e.target.value })} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary btn-sm" onClick={publishAnn}>Publicar</button></div>
                  </div>
                )}
                {anns.length === 0
                  ? <div className="notif-empty">No hay anuncios.</div>
                  : anns.map((a) => (
                    <div key={a.id} className="notif-item">
                      <span className="ni">📌</span>
                      <div className="notif-body">
                        <strong>{a.title}</strong>{a.body ? <><br /><span className="muted">{a.body}</span></> : null}
                        <br /><span className="notif-time">{a.author_name} · {ago(a.created_at)}</span>
                      </div>
                      {canManageAnn && <button className="notif-x" title="Eliminar" style={{ color: 'var(--danger)' }} onClick={() => delAnn(a.id)}>✕</button>}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <span className={`role-badge ${role}`}>{roleLabel || ROLE_LABEL[role] || role}</span>
        </div>
      </div></div>

      <div className="layout" style={{ display: 'flex' }}>
        <div className="sb-backdrop" onClick={() => setCollapsed(true)} />
        <aside className="sidebar">
          <button className="side-user" onClick={() => { nav('/perfil'); closeIfMobile() }} title="Ver mi perfil">
            {profile?.avatar_url ? <img className="avatar-img" src={profile.avatar_url} alt="" /> : <div className="avatar">{initials(name)}</div>}
            <div><div className="nm">{name}</div><div className="rl">{roleLabel || ROLE_LABEL[role]}{role === 'user' && profile?.department ? ` · ${profile.department}` : ''}</div></div>
            <span className="arrow">›</span>
          </button>
          <div id="menu">
            <div className="menu-line"></div>
            <div className="menu-group">Mi espacio</div>
            {userMenu.map(MenuLink)}
            {adminMenu.length > 0 && <>
              <div className="menu-group">Administración</div>
              {adminMenu.map(MenuLink)}
            </>}
          </div>
          <div className="side-foot"><div className="menu-line"></div>
            <button className="menu-item logout" onClick={() => signOut()}><span className="mi">↩️</span><span className="mlbl">Cerrar sesión</span></button>
          </div>
        </aside>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  )
}
