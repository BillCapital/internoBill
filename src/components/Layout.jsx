import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { confirmDialog, alertDialog } from '../lib/ui'

import { Icon } from '../lib/icons'
import ProfilePrompt from './ProfilePrompt'

const ROLE_LABEL = { user: 'Usuario', pedidos: 'Gestora de pedidos', admin: 'Administrador', mic: 'Mic', sistema: 'Cuentas de servicio',
  presidente_directorio: 'Presidente Directorio', gerente_general: 'Gerente General', gerente_riesgo: 'Gerente de Riesgo',
  gerente_cobranza: 'Gerente de Cobranzas', gerente_legal: 'Gerente Legal', gerente_admin_finanzas: 'Gerente de Administración y Finanzas',
  gerente_financiacion: 'Gerente de Financiación y Mercado de Capitales', gerente_ti: 'Gerente TI',
  gerente_producto: 'Gerente de Productos', gerente_comercial: 'Gerente Comercial y Marketing' }
const KIND_ICON = { ok: 'check', bad: 'ban', msg: 'chat', info: 'bell' }
const initials = (n) => (n || '?').split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase()
// Íconos de línea del menú lateral (rediseño 2026)
const NAV_ICONS = {
  home: <svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>,
  calendar: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>,
  box: <svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>,
  book: <svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2Z" /><path d="M8 3v18" /></svg>,
  chat: <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2Z" /></svg>,
  inbox: <svg viewBox="0 0 24 24"><path d="M3 12h5l2 3h4l2-3h5" /><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" /></svg>,
  grid: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  users: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.5-3.3 3-5 5.5-5s5 1.7 5.5 5" /><path d="M17 8.5a3 3 0 0 1 0 5" /><path d="M18.5 20c-.2-2-1-3.4-2.3-4.3" /></svg>,
  lock: <svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  logout: <svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h11" /></svg>,
  gastos: <svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>,
  mail: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>,
}
// Íconos de línea de la barra superior (rediseño 2026)
const TOP_ICONS = {
  menu: <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
  moon: <svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" /></svg>,
  sun: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  bell: <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>,
  megaphone: <svg viewBox="0 0 24 24"><path d="M5 21V4" /><path d="M5 4.5h12.5l-2.4 3.75L17.5 12H5" /></svg>,
}
const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return 'recién'; if (s < 3600) return `hace ${Math.floor(s / 60)} min`; if (s < 86400) return `hace ${Math.floor(s / 3600)} h`; return `hace ${Math.floor(s / 86400)} d` }

export default function Layout() {
  const { user, profile, role, roleLabel, isAdmin, canManageOrders, canManageRooms, canManageSupplies, canManageInventory, canManageUsers,
    canViewSupplies, canViewInventory, canViewUsers, canViewLists, canViewExpenses, signOut } = useAuth()
  const nav = useNavigate()
  // Barra lateral abierta por defecto en escritorio; colapsada en móvil.
  const [collapsed, setCollapsed] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 760 : false))
  // Tema recordado entre recargas (se guarda en el navegador)
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('bc-theme') || 'dark' } catch { return 'dark' } })
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

  useEffect(() => { document.body.classList.toggle('light', theme === 'light'); try { localStorage.setItem('bc-theme', theme) } catch { /* noop */ } }, [theme])
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
    { to: '/', end: true, icon: 'home', label: 'Inicio' },
    { to: '/salas', icon: 'calendar', label: 'Salas', pill: counts.sal },
    { to: '/solicitudes', icon: 'box', label: 'Solicitudes', pill: counts.sol },
    { to: '/manuales', icon: 'book', label: 'Manuales' },
    { to: '/soporte', icon: 'chat', label: 'Soporte' },
  ]
  // Basta con poder VER el apartado para que salga en el menú
  const adminMenu = [
    ...(canViewSupplies ? [{ to: '/insumos', icon: 'inbox', label: 'Insumos' }] : []),
    ...(canViewInventory ? [{ to: '/inventario', icon: 'grid', label: 'Inventario' }] : []),
    ...(canViewUsers ? [{ to: '/usuarios', icon: 'users', label: 'Usuarios' }] : []),
    ...(canViewLists ? [{ to: '/listas', icon: 'mail', label: 'Listas' }] : []),
    ...(isAdmin ? [{ to: '/roles', icon: 'lock', label: 'Accesos' }] : []),
    ...(canViewExpenses ? [{ to: '/gastos', icon: 'gastos', label: 'Gastos' }] : []),
  ]
  const closeIfMobile = () => { if (window.innerWidth <= 760) setCollapsed(true) }
  const MenuLink = (m) => (
    <NavLink key={m.to} to={m.to} end={m.end} onClick={closeIfMobile}
      className={({ isActive }) => `menu-item${isActive ? ' active' : ''}`} style={{ textDecoration: 'none' }}>
      <span className="mi">{NAV_ICONS[m.icon] || m.icon}</span><span className="mlbl">{m.label}</span>
      {m.pill ? <span className="pill">{m.pill}</span> : null}
    </NavLink>
  )

  const goNotif = (n) => { setNotifOpen(false); dismiss(n); if (n.link) nav(n.link) }

  return (
    <div className="app" style={{ display: 'block' }}>
      <div className="topbar"><div className="topbar-inner">
        <div className="brand">
          <button className="hamb" title="Menú" onClick={() => setCollapsed((c) => !c)}>{TOP_ICONS.menu}</button>
          <img className="brand-logo" src="/logo.png" alt="BillCapital" width="34" height="34" /><span className="brand-name">Billcapital</span>
        </div>
        <div className="top-right">
          <button className="iconbtn" title="Modo claro / oscuro" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>{theme === 'dark' ? TOP_ICONS.moon : TOP_ICONS.sun}</button>
          <div className="notif-wrap" ref={notifRef}>
            <button className="iconbtn" title="Notificaciones" onClick={() => { setAnnOpen(false); setNotifOpen((v) => !v); if (!notifOpen) loadNotifs() }}>
              {TOP_ICONS.bell}{notifs.length > 0 && <span className="notif-dot">{notifs.length}</span>}
            </button>
            {notifOpen && (
              <div className="notif-panel">
                <div className="notif-head"><span>Notificaciones</span>{notifs.length > 0 && <button className="notif-all" onClick={markAll}>Marcar todas</button>}</div>
                {notifs.length === 0
                  ? <div className="notif-empty">Sin novedades por ahora.</div>
                  : notifs.map((n) => (
                    <div key={n.id} className="notif-item">
                      <span className="ni"><Icon n={KIND_ICON[n.kind] || 'bell'} /></span>
                      <button className="notif-body" onClick={() => goNotif(n)}>
                        <strong>{n.title}</strong>{n.body ? <><br /><span className="muted">{n.body}</span></> : null}
                        {n.created_at ? <><br /><span className="notif-time">{ago(n.created_at)}</span></> : null}
                      </button>
                      {!n.computed && <button className="notif-x" title="Terminar" onClick={() => dismiss(n)}><Icon n="check" /></button>}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="notif-wrap" ref={annRef}>
            <button className="iconbtn" title="Anuncios" onClick={() => { setNotifOpen(false); setAnnOpen((v) => !v); if (!annOpen) loadAnns() }}>{TOP_ICONS.megaphone}</button>
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
                      <span className="ni"><Icon n="megaphone" /></span>
                      <div className="notif-body">
                        <strong>{a.title}</strong>{a.body ? <><br /><span className="muted">{a.body}</span></> : null}
                        <br /><span className="notif-time">{a.author_name} · {ago(a.created_at)}</span>
                      </div>
                      {canManageAnn && <button className="notif-x" title="Eliminar" style={{ color: 'var(--danger)' }} onClick={() => delAnn(a.id)}><Icon n="close" /></button>}
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
            <button className="menu-item logout" onClick={() => signOut()}><span className="mi">{NAV_ICONS.logout}</span><span className="mlbl">Cerrar sesión</span></button>
          </div>
        </aside>
        <main className="content">
          <Suspense fallback={<div className="content-loader"><span className="sk sk-line" style={{ width: '40%', height: '1.4rem' }} /><div style={{ marginTop: '1rem' }}><span className="sk sk-line" style={{ width: '70%' }} /></div></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <ProfilePrompt />
    </div>
  )
}
