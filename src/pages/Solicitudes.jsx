import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Chat from '../components/Chat'
import ActivityLog from '../components/ActivityLog'
import { confirmDialog, promptDialog, alertDialog, viewImage } from '../lib/ui'
import { loadDepts, rootDeptOf } from '../lib/depts'

const ST = [
  { key: 'pending', label: 'Pendientes', ico: '🕓' },
  { key: 'manager_review', label: 'Por gerente', ico: '🔑' },
  { key: 'approved', label: 'Aprobadas', ico: '✅' },
  { key: 'rejected', label: 'Rechazadas', ico: '✖️' }, { key: 'delivered', label: 'Entregadas', ico: '📦' },
]
const cls = (k) => 's-' + ({ pending: 'pending', manager_review: 'pending', approved: 'approved', rejected: 'rejected', delivered: 'delivered' }[k])
const label = (k) => (ST.find((s) => s.key === k) || {}).label || k
const DEFAULT_DEPTS = ['Cobranza', 'Comercial', 'Operaciones', 'Producto', 'Gerencia']

export default function Solicitudes() {
  const { profile, canManageOrders, isSuper } = useAuth()
  const [rows, setRows] = useState([])
  const [catalog, setCatalog] = useState([])
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const [cart, setCart] = useState({})
  const [note, setNote] = useState('')
  const [custom, setCustom] = useState('')
  const [step, setStep] = useState(1)
  const [wDept, setWDept] = useState('')
  const [wSection, setWSection] = useState('')
  // Departamentos de nivel superior (las solicitudes son "desde el departamento":
  // los subdepartamentos —Riesgo, Tesorería, Legal— se agrupan bajo su padre).
  const [topDepts, setTopDepts] = useState(DEFAULT_DEPTS)

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests')
      .select('id, status, note, custom, department, needs_manager, l1_by, mgr_by, created_at, user_id, profiles!requests_user_id_fkey(full_name,email), request_items(quantity, inventory_items(name,stock))')
      .order('created_at', { ascending: false })
    setRows(data ?? [])
  }, [])
  const loadCat = useCallback(async () => {
    const { data } = await supabase.from('inventory_items').select('id,name,category,stock,departments,is_active,image_url').eq('is_active', true).order('category').order('name')
    setCatalog(data ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { loadCat() }, [loadCat])
  // Carga los departamentos desde la BD; deja solo los de nivel superior (padres).
  // rootDeptOf() ya queda alimentado por loadDepts() para resolver subdepto -> padre.
  useEffect(() => { (async () => {
    const tree = await loadDepts()
    const roots = tree.filter((d) => (d.depth || 0) === 0).map((d) => d.name)
    if (roots.length) setTopDepts(roots)
  })() }, [])

  // Aprobadores de tecnología: para insumos tecnológicos, TODOS ellos deben firmar la 2ª llave.
  const [techApprovers, setTechApprovers] = useState([])   // [{id, full_name, email}]
  const [approvals, setApprovals] = useState([])           // [{request_id, approver_id, decision}]
  const loadMgr = useCallback(async () => {
    const [{ data: ta }, { data: ap }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email').eq('is_tech_approver', true).eq('active', true),
      supabase.from('request_approvals').select('request_id, approver_id, decision'),
    ])
    setTechApprovers(ta || [])
    setApprovals(ap || [])
  }, [])
  useEffect(() => { loadMgr() }, [loadMgr])
  const myIsTech = techApprovers.some((a) => a.id === profile?.id)
  const hasTechApprovers = techApprovers.length > 0
  const signedFor = (reqId) => approvals.filter((a) => a.request_id === reqId && a.decision === 'approve').map((a) => a.approver_id)
  const iSigned = (reqId) => signedFor(reqId).includes(profile?.id)

  // Paso 1 arranca en el departamento propio (usuarios) o a elección (gestora/admin)
  const canChooseDept = canManageOrders
  // El departamento del usuario se resuelve a su departamento raíz (un subdepto pide "desde" su padre).
  const ownDept = rootDeptOf(profile?.department || '')
  const startWizard = () => {
    setCreating((v) => !v); setStep(1); setCart({}); setNote(''); setCustom(''); setWSection('')
    setWDept(canChooseDept ? '' : ownDept)
    if (!canChooseDept && ownDept) setStep(2)
  }

  // Insumos disponibles para un departamento: solo los asignados explícitamente a ese depto
  const availFor = (dept) => catalog.filter((i) => Array.isArray(i.departments) && i.departments.includes(dept))
  const sectionsFor = (dept) => [...new Set(availFor(dept).map((i) => i.category))]
  const itemsFor = (dept, section) => availFor(dept).filter((i) => i.category === section)

  const cartList = Object.entries(cart).filter(([, q]) => q > 0)
    .map(([id, qty]) => ({ item: catalog.find((i) => i.id === id), qty })).filter((x) => x.item)
  const cartCount = cartList.reduce((a, x) => a + x.qty, 0)
  const setQty = (id, q, max) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(q, max)) }))
  const submit = async () => {
    const items = Object.entries(cart).filter(([, q]) => q > 0).map(([id, quantity]) => ({ item_id: id, quantity }))
    if (!items.length && !custom.trim()) return alertDialog('Agrega al menos un artículo del catálogo o describe el insumo que necesitas.')
    if (note.trim().length < 10) return alertDialog('La justificación debe tener al menos 10 caracteres.')
    try {
      await api('create_request', { p_note: note.trim(), p_department: rootDeptOf(wDept || ownDept || ''), p_items: items, p_custom: custom.trim() || null })
      setCart({}); setNote(''); setCustom(''); setCreating(false); setStep(1); load()
    } catch (e) { alertDialog(e.message) }
  }
  // Acción: refleja el nuevo estado al instante y reconcilia en segundo plano.
  // optStatus permite forzar el estado optimista (ej: 1er V°B° -> "manager_review").
  const act = (action, p_id, extra = {}, optStatus = null) => {
    const map = { approve_request: 'approved', reject_request: 'rejected', deliver_request: 'delivered',
      tech_approve_request: 'approved', tech_reject_request: 'rejected' }
    const next = optStatus || map[action]
    setRows((rs) => action === 'request_delete'
      ? rs.filter((r) => r.id !== p_id)
      : (next ? rs.map((r) => (r.id === p_id ? { ...r, status: next } : r)) : rs))
    ;(async () => { try { await api(action, { p_id, ...extra }) } catch (e) { alertDialog(e.message) } finally { load(); loadMgr() } })()
  }

  const data = rows.filter((t) => !status || t.status === status)
  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>{canManageOrders ? 'Solicitudes de insumos · gestión' : 'Solicitar insumos'}</h2>
          <p className="muted">{canManageOrders ? 'Revisa, aprueba o rechaza. El stock se descuenta al aprobar.' : 'Elige artículos y coordina por chat.'}</p></div>
        <button className="btn btn-lime" onClick={startWizard}>＋ Nueva solicitud</button>
      </div></div>

      {creating && (
        <div className="conv wizard" style={{ padding: '1rem' }}>
          <div className="wz-steps">
            <span className={`wz-step ${step === 1 ? 'on' : ''} ${step > 1 ? 'done' : ''}`}>1 · Departamento{wDept ? `: ${wDept}` : ''}</span>
            <span className={`wz-step ${step === 2 ? 'on' : ''} ${step > 2 ? 'done' : ''}`}>2 · Sección{wSection ? `: ${wSection}` : ''}</span>
            <span className={`wz-step ${step === 3 ? 'on' : ''}`}>3 · Artículos</span>
            <div className="wz-actions">
              <button className="btn btn-primary btn-sm" onClick={submit}>Enviar solicitud</button>
              <button className="btn btn-sm" onClick={() => { setCreating(false); setStep(1) }}>Cancelar</button>
            </div>
          </div>

          {/* Carrito del pedido */}
          <div className="cart-box">
            <div className="cart-head"><span>🛒 Tu pedido</span><span className="cart-count">{cartCount} art.</span></div>
            {cartList.length === 0
              ? <div className="muted" style={{ fontSize: '.85rem' }}>Aún no has agregado artículos. Elige la sección y suma lo que necesites.</div>
              : <ul className="cart-list">
                  {cartList.map(({ item, qty }) => (
                    <li key={item.id}><span>{qty} × {item.name}</span>
                      <button className="cart-x" title="Quitar" onClick={() => setQty(item.id, 0, item.stock)}>✕</button></li>
                  ))}
                </ul>}
          </div>

          {step === 1 && (
            <div>
              <h3 style={{ fontSize: '1rem' }}>¿Para qué departamento es la solicitud?</h3>
              {canChooseDept ? (
                <div className="kpi-grid compact">
                  {topDepts.map((d) => (
                    <button key={d} className={`kpi ${wDept === d ? 'active' : ''}`} onClick={() => { if (d !== wDept) setCart({}); setWDept(d); setWSection(''); setStep(2) }}>
                      <div className="ico">🏢</div><div className="lbl">{d}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">La solicitud se registra a nombre de <strong>{ownDept || '—'}</strong>{profile?.department && profile.department !== ownDept ? <> (tu subdepartamento: {profile.department})</> : null}.</p>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="row" style={{ marginBottom: '.5rem' }}>
                <h3 style={{ fontSize: '1rem', margin: 0 }}>Sección de insumos</h3>
                {canChooseDept && <button className="btn-sm" onClick={() => setStep(1)}>‹ Cambiar departamento</button>}
              </div>
              {sectionsFor(wDept).length === 0
                ? <div className="empty">No hay insumos disponibles para {wDept}.</div>
                : <div className="kpi-grid compact">
                  {sectionsFor(wDept).map((s) => (
                    <button key={s} className={`kpi ${wSection === s ? 'active' : ''}`} onClick={() => { setWSection(s); setStep(3) }}>
                      <div className="ico">📁</div><div className="num">{itemsFor(wDept, s).length}</div><div className="lbl">{s}</div>
                    </button>
                  ))}
                </div>}
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="row" style={{ marginBottom: '.5rem' }}>
                <h3 style={{ fontSize: '1rem', margin: 0 }}>{wSection} · para {wDept}</h3>
                <button className="btn-sm" onClick={() => setStep(2)}>‹ Cambiar sección</button>
              </div>
              {itemsFor(wDept, wSection).map((i) => (
                <div className="cat-row prod-row" key={i.id}>
                  <div className="prod-info">
                    {i.image_url ? <img className="prod-thumb" src={i.image_url} alt="" onClick={() => viewImage(i.image_url)} /> : <div className="prod-ph">📦</div>}
                    <div><strong>{i.name}</strong><br /><span className="muted">stock {i.stock}</span></div>
                  </div>
                  <div className="qc">
                    <button type="button" onClick={() => setQty(i.id, (cart[i.id] || 0) - 1, i.stock)}>−</button>
                    <span>{cart[i.id] || 0}</span>
                    <button type="button" onClick={() => setQty(i.id, (cart[i.id] || 0) + 1, i.stock)}>+</button>
                  </div>
                </div>
              ))}
              {Object.values(cart).some((q) => q > 0) && (
                <p className="muted" style={{ marginTop: '.5rem' }}>Puedes seguir agregando de otras secciones antes de enviar.
                  {' '}<button className="btn-sm" onClick={() => setStep(2)}>＋ Otra sección</button></p>
              )}
            </div>
          )}

          {/* Pie del asistente: insumo no listado + justificación (siempre visible) */}
          <div className="wz-foot">
            <label className="muted" style={{ display: 'block' }}>¿No encuentras el insumo en la lista? Descríbelo aquí <span className="muted">(opcional)</span></label>
            <textarea style={{ width: '100%', minHeight: 56 }} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Ej: Teclado mecánico compacto, 2 unidades. Se coordina por chat." />
            <label className="muted" style={{ display: 'block', marginTop: '.6rem' }}>Justificación (obligatoria)</label>
            <textarea style={{ width: '100%', minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Para qué necesitas estos insumos?" />
            <div style={{ marginTop: '.6rem', textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={submit}>Enviar solicitud</button>
            </div>
          </div>
        </div>
      )}

      {!creating && <div className="kpi-grid compact">
        <button className="kpi kpi-all" onClick={() => setStatus(null)}>
          <span className="ico" style={{ fontSize: '1.3rem' }}>📦</span>
          <div><div className="num">{rows.length}</div><div className="lbl">{canManageOrders ? 'Solicitudes en total' : 'Tus solicitudes'}</div></div>
        </button>
        {ST.map((s) => (
          <button key={s.key} className={`kpi ${status === s.key ? 'active' : ''}`} onClick={() => setStatus(status === s.key ? null : s.key)}>
            <div className="ico">{s.ico}</div><div className="num">{rows.filter((t) => t.status === s.key).length}</div><div className="lbl">{s.label}</div>
          </button>
        ))}
      </div>}

      {!creating && data.length === 0 && <div className="conv"><div className="empty">No hay solicitudes.</div></div>}
      {!creating && data.map((t) => (
        <div className={`conv ${open === t.id ? 'open' : ''}`} key={t.id}>
          <button className="cv-head" onClick={() => setOpen(open === t.id ? null : t.id)}>
            <span className="ico">💬</span>
            <span className="t"><strong>Solicitud #{String(t.id).slice(0, 8)}</strong><br />
              <span className="prev">{canManageOrders && (t.profiles?.full_name || t.profiles?.email) ? (t.profiles.full_name || t.profiles.email) + ' · ' : ''}{t.note}</span></span>
            <span className={`badge ${cls(t.status)}`}>{label(t.status)}</span><span className="chev">▾</span>
          </button>
          {open === t.id && (
            <div className="cv-body">
              <div className="reqsum"><strong>Pedido</strong> · {t.department}
                <ul>{(t.request_items || []).map((li, i) => <li key={i}>{li.quantity} × {li.inventory_items?.name} <span className="muted">(stock: {li.inventory_items?.stock})</span></li>)}
                  {t.custom ? <li>{t.custom}</li> : null}</ul>
              </div>
              {/* Aviso de doble aprobación cuando la solicitud incluye insumos tecnológicos */}
              {t.needs_manager && hasTechApprovers && (t.status === 'pending' || t.status === 'manager_review') && (
                <div className="twokey-note">🔑 Insumo tecnológico: requiere el visto bueno de <strong>gestión de pedidos</strong> y luego la autorización de <strong>todos los gerentes de tecnología</strong> ({techApprovers.map((a) => a.full_name || a.email).join(' y ')}).</div>
              )}

              {/* Progreso de firmas de tecnología */}
              {t.status === 'manager_review' && (
                <div className="muted" style={{ fontSize: '.8rem', margin: '.2rem 0 .5rem' }}>
                  Autorizaciones de tecnología: {techApprovers.map((a) => <span key={a.id} style={{ marginRight: '.6rem' }}>{signedFor(t.id).includes(a.id) ? '✔' : '⏳'} {a.full_name || a.email}</span>)}
                </div>
              )}

              <Chat type="request" id={t.id} locked={t.status === 'rejected' || t.status === 'delivered'} />

              {/* 1ª llave: gestora / administración */}
              {canManageOrders && t.status === 'pending' && (() => {
                const toTech = t.needs_manager && hasTechApprovers
                return (
                <div className="adm-actions">
                  <button className="btn btn-lime" onClick={async () => {
                    const msg = toTech
                      ? `¿Dar el visto bueno de gestión? Pasará a los gerentes de tecnología (${techApprovers.length}) para autorizar la compra; el stock se descuenta cuando todos autoricen.`
                      : '¿Aprobar la solicitud? Se descontará el stock.'
                    if (await confirmDialog(msg, { title: toTech ? 'Visto bueno de gestión' : 'Aprobar solicitud', okText: toTech ? 'Dar visto bueno' : 'Aprobar' }))
                      act('approve_request', t.id, {}, toTech ? 'manager_review' : 'approved')
                  }}>{toTech ? 'Dar V°B° de gestión' : 'Aprobar'}</button>
                  <button className="btn btn-danger" onClick={async () => { const r = await promptDialog('Motivo del rechazo', { title: 'Rechazar solicitud', placeholder: 'Explica por qué se rechaza…' }); if (r !== null) act('reject_request', t.id, { p_reason: r || '' }) }}>Rechazar</button>
                </div>
                )
              })()}

              {/* 2ª llave: gerentes de tecnología (deben firmar todos) */}
              {t.status === 'manager_review' && myIsTech && !iSigned(t.id) && (
                <div className="adm-actions">
                  <button className="btn btn-lime" onClick={async () => {
                    const willComplete = (signedFor(t.id).length + 1) >= techApprovers.length
                    if (await confirmDialog(willComplete ? '¿Autorizar la compra tecnológica? Con tu firma queda aprobada y se descuenta el stock.' : '¿Autorizar la compra tecnológica? Aún faltará la firma de otro gerente para completarla.', { title: 'Autorizar compra tecnológica', okText: 'Autorizar' })) {
                      setApprovals((prev) => [...prev, { request_id: t.id, approver_id: profile.id, decision: 'approve' }])
                      act('tech_approve_request', t.id, {}, willComplete ? 'approved' : 'manager_review')
                    }
                  }}>✔ Autorizar compra</button>
                  <button className="btn btn-danger" onClick={async () => { const r = await promptDialog('Motivo del rechazo', { title: 'Rechazar compra', placeholder: 'Explica por qué se rechaza…' }); if (r !== null) act('tech_reject_request', t.id, { p_reason: r || '' }, 'rejected') }}>Rechazar</button>
                </div>
              )}
              {t.status === 'manager_review' && myIsTech && iSigned(t.id) && (
                <div className="muted" style={{ fontSize: '.85rem' }}>Ya diste tu autorización. Falta la firma del resto de gerentes de tecnología.</div>
              )}
              {canManageOrders && t.status === 'manager_review' && !myIsTech && (
                <div className="muted" style={{ fontSize: '.85rem' }}>Esperando la autorización de los gerentes de tecnología.</div>
              )}

              {canManageOrders && t.status === 'approved' && (
                <div className="adm-actions"><button className="btn btn-primary" onClick={async () => { if (await confirmDialog('¿Marcar la solicitud como entregada?', { title: 'Marcar entregada', okText: 'Marcar' })) act('deliver_request', t.id) }}>Marcar entregada</button></div>
              )}
              {isSuper && t.status === 'rejected' && (
                <div className="adm-actions"><button className="btn btn-danger" onClick={async () => { if (await confirmDialog('¿Eliminar esta solicitud rechazada por completo? Esta acción no se puede deshacer.', { title: 'Eliminar solicitud', danger: true, okText: 'Eliminar' })) act('request_delete', t.id) }}>🗑 Eliminar solicitud</button></div>
              )}
            </div>
          )}
        </div>
      ))}

      {canManageOrders && <ActivityLog kinds={['Solicitud']} title="Registro de solicitudes" />}
    </div>
  )
}
