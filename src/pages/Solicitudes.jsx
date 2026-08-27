import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Chat from '../components/Chat'
import ActivityLog from '../components/ActivityLog'
import { confirmDialog, promptDialog, alertDialog, viewImage } from '../lib/ui'
import { loadDepts, rootDeptOf, NON_REQUESTING_DEPTS } from '../lib/depts'
import { fetchLinkPreview, fmtMoney } from '../lib/linkPreview'
import { Icon } from '../lib/icons'
import { SkeletonKpis, SkeletonRows } from '../components/Skeleton'

const ST = [
  { key: 'pending', label: 'Pendientes', ico: 'clock' },
  { key: 'manager_review', label: 'Por gerente', ico: 'key' },
  { key: 'approved', label: 'Aprobadas', ico: 'check' },
  { key: 'rejected', label: 'Rechazadas', ico: 'ban' }, { key: 'delivered', label: 'Entregadas', ico: 'box' },
]
const cls = (k) => 's-' + ({ pending: 'pending', manager_review: 'pending', approved: 'approved', rejected: 'rejected', delivered: 'delivered' }[k])
const label = (k) => (ST.find((s) => s.key === k) || {}).label || k
const DEFAULT_DEPTS = ['Cobranza', 'Comercial', 'Operaciones', 'Producto', 'Gerencia']

export default function Solicitudes() {
  const { profile, canManageOrders } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
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
  const [wMode, setWMode] = useState('catalogo')   // 'catalogo' | 'link' (producto tecnológico por link)
  const [products, setProducts] = useState([])      // productos con link agregados
  const [pUrl, setPUrl] = useState('')              // URL en edición
  const [pBusy, setPBusy] = useState(false)         // trayendo datos del link
  const [pErr, setPErr] = useState('')

  const addProductFromLink = async () => {
    const url = pUrl.trim()
    if (!/^https?:\/\//i.test(url)) return setPErr('Pega un link que empiece con http:// o https://')
    setPErr(''); setPBusy(true)
    const r = await fetchLinkPreview(url)
    setPBusy(false)
    // Aunque falle la lectura, agregamos la tarjeta para que complete a mano
    setProducts((ps) => [...ps, {
      product_url: url,
      name: (r && r.ok && r.title) ? r.title : '',
      image_url: (r && r.ok && r.image) ? r.image : '',
      price: (r && r.ok && r.price != null) ? r.price : '',
      currency: (r && r.currency) || 'CLP',
      quantity: 1,
      site: (r && r.site) || '',
      autofailed: !(r && r.ok),
    }])
    setPUrl('')
    if (r && !r.ok && r.error) setPErr(r.error)
  }
  const setProd = (i, k, v) => setProducts((ps) => ps.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)))
  const removeProd = (i) => setProducts((ps) => ps.filter((_, idx) => idx !== i))
  // Departamentos de nivel superior (las solicitudes son "desde el departamento":
  // los subdepartamentos —Riesgo, Tesorería, Legal— se agrupan bajo su padre).
  const [topDepts, setTopDepts] = useState(DEFAULT_DEPTS)

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests')
      .select('id, status, note, custom, department, needs_manager, l1_by, mgr_by, created_at, user_id, profiles!requests_user_id_fkey(full_name,email), request_items(quantity, inventory_items(name,stock)), request_products(id,product_url,name,image_url,price,currency,quantity,status,reject_reason)')
      .order('created_at', { ascending: false })
    setRows(data ?? [])
    setLoading(false)
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
      .filter((n) => !NON_REQUESTING_DEPTS.includes(n))
    if (roots.length) setTopDepts(roots)
  })() }, [])

  // Firmantes de una compra tecnológica: aprobadores de tecnología (TI+RRHH) + gerente del área que pide.
  // El conjunto se des-duplica por persona (ej. Juan es RRHH y gerente de Operaciones = 1 firma).
  const [techApprovers, setTechApprovers] = useState([])   // [{id, full_name, email}]
  const [approvals, setApprovals] = useState([])           // [{request_id, approver_id, decision}]
  const [deptMgrs, setDeptMgrs] = useState([])             // [{name, manager:{id,full_name,email}}]
  const [people, setPeople] = useState({})                 // { id: 'Nombre' } para resolver l1_by/mgr_by
  const loadMgr = useCallback(async () => {
    const [{ data: ta }, { data: ap }, { data: dm }, { data: pp }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email').eq('is_tech_approver', true).eq('active', true),
      supabase.from('request_approvals').select('request_id, approver_id, decision, at'),
      supabase.from('departments').select('name, manager:manager_id(id,full_name,email)'),
      supabase.from('profiles').select('id,full_name,email'),
    ])
    setTechApprovers(ta || [])
    setApprovals(ap || [])
    setDeptMgrs(dm || [])
    setPeople(Object.fromEntries((pp || []).map((p) => [p.id, p.full_name || p.email])))
  }, [])
  const nameById = (id) => (id ? (people[id] || '—') : null)
  useEffect(() => { loadMgr() }, [loadMgr])
  // Gerente de área de un departamento (el guardado en la solicitud ya es el depto raíz)
  const deptManagerOf = (dept) => (deptMgrs.find((d) => d.name === dept)?.manager) || null
  // Conjunto de firmantes requeridos para una solicitud, des-duplicado por persona
  const requiredSigners = (t) => {
    const list = [...techApprovers]
    const m = deptManagerOf(t.department)
    if (m && m.id && !list.some((x) => x.id === m.id)) list.push(m)
    return list
  }
  const myIsSigner = (t) => requiredSigners(t).some((s) => s.id === profile?.id)
  const signedFor = (reqId) => approvals.filter((a) => a.request_id === reqId && a.decision === 'approve').map((a) => a.approver_id)
  const iSigned = (reqId) => signedFor(reqId).includes(profile?.id)
  // Decisión de un firmante concreto sobre una solicitud: 'approve' | 'reject' | null (pendiente)
  const decisionFor = (reqId, approverId) => (approvals.find((a) => a.request_id === reqId && a.approver_id === approverId) || {}).decision || null

  // Paso 1 arranca en el departamento propio (usuarios) o a elección (gestora/admin)
  const canChooseDept = canManageOrders
  // El departamento del usuario se resuelve a su departamento raíz (un subdepto pide "desde" su padre).
  const ownDept = rootDeptOf(profile?.department || '')
  const startWizard = () => {
    setCreating((v) => !v); setStep(1); setCart({}); setNote(''); setCustom(''); setWSection('')
    setWMode('catalogo'); setProducts([]); setPUrl(''); setPErr('')
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
    const isLink = wMode === 'link'
    const items = isLink ? [] : Object.entries(cart).filter(([, q]) => q > 0).map(([id, quantity]) => ({ item_id: id, quantity }))
    const prods = isLink ? products.filter((p) => (p.name || '').trim() || (p.product_url || '').trim()) : []
    if (isLink) {
      if (!prods.length) return alertDialog('Agrega al menos un producto (pega el link y trae sus datos).')
      if (prods.some((p) => !(p.name || '').trim())) return alertDialog('Cada producto necesita un nombre. Complétalo si no se detectó del link.')
    } else if (!items.length && !custom.trim()) {
      return alertDialog('Agrega al menos un artículo del catálogo o describe el insumo que necesitas.')
    }
    if (note.trim().length < 10) return alertDialog('La justificación debe tener al menos 10 caracteres.')
    const p_products = prods.map((p) => ({
      product_url: (p.product_url || '').trim(), name: (p.name || '').trim(),
      image_url: (p.image_url || '').trim(), price: p.price === '' || p.price == null ? null : Number(p.price),
      currency: p.currency || 'CLP', quantity: Math.max(1, Number(p.quantity) || 1),
    }))
    try {
      await api('create_request', { p_note: note.trim(), p_department: rootDeptOf(wDept || ownDept || ''), p_items: items, p_custom: (!isLink && custom.trim()) || null, p_products })
      setCart({}); setNote(''); setCustom(''); setProducts([]); setWMode('catalogo'); setCreating(false); setStep(1); load()
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

  // Gestión decide un producto (con link) por separado: aprobar / rechazar con motivo
  const decideProduct = async (prodId, approve) => {
    let reason = ''
    if (!approve) { const r = await promptDialog('Motivo del rechazo', { title: 'Rechazar producto', placeholder: 'Ej: hay una alternativa más barata…' }); if (r === null) return; reason = r || '' }
    else if (!(await confirmDialog('¿Aprobar este producto?', { title: 'Aprobar producto', okText: 'Aprobar' }))) return
    setRows((rs) => rs.map((r) => ({ ...r, request_products: (r.request_products || []).map((p) => (p.id === prodId ? { ...p, status: approve ? 'approved' : 'rejected', reject_reason: approve ? null : reason } : p)) })))
    try { await api('request_product_decide', { p_id: prodId, p_approve: approve, p_reason: reason }) } catch (e) { alertDialog(e.message) } finally { load() }
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
            {wMode === 'catalogo' ? <>
              <span className={`wz-step ${step === 2 ? 'on' : ''} ${step > 2 ? 'done' : ''}`}>2 · Sección{wSection ? `: ${wSection}` : ''}</span>
              <span className={`wz-step ${step === 3 ? 'on' : ''}`}>3 · Artículos</span>
            </> : <span className={`wz-step on`}>2 · Productos{products.length ? `: ${products.length}` : ''}</span>}
            <div className="wz-actions">
              <button className="btn btn-primary btn-sm" onClick={submit}>Enviar solicitud</button>
              <button className="btn btn-sm" onClick={() => { setCreating(false); setStep(1) }}>Cancelar</button>
            </div>
          </div>

          {/* Tipo de solicitud: catálogo general o producto tecnológico por link */}
          <div className="req-mode">
            <button className={`req-mode-b ${wMode === 'catalogo' ? 'on' : ''}`} onClick={() => setWMode('catalogo')}>
              <Icon n="box" /> <span><strong>Del catálogo</strong><em>insumos generales</em></span>
            </button>
            <button className={`req-mode-b ${wMode === 'link' ? 'on' : ''}`} onClick={() => setWMode('link')}>
              <Icon n="cart" /> <span><strong>Producto tecnológico</strong><em>pega el link · pantallas, computadores…</em></span>
            </button>
          </div>

          {/* Carrito del pedido (solo catálogo) */}
          {wMode === 'catalogo' && (
          <div className="cart-box">
            <div className="cart-head"><span><Icon n="cart" /> Tu pedido</span><span className="cart-count">{cartCount} art.</span></div>
            {cartList.length === 0
              ? <div className="muted" style={{ fontSize: '.85rem' }}>Aún no has agregado artículos. Elige la sección y suma lo que necesites.</div>
              : <ul className="cart-list">
                  {cartList.map(({ item, qty }) => (
                    <li key={item.id}><span>{qty} × {item.name}</span>
                      <button className="cart-x" title="Quitar" onClick={() => setQty(item.id, 0, item.stock)}><Icon n="close" /></button></li>
                  ))}
                </ul>}
          </div>
          )}

          {/* Constructor de productos por link (tecnológico) */}
          {wMode === 'link' && (
          <div className="prodbuild">
            <label className="pb-label">Pega el link del producto que quieres</label>
            <div className="pb-add">
              <input type="url" placeholder="https://www.tienda.cl/producto/…" value={pUrl}
                onChange={(e) => { setPUrl(e.target.value); setPErr('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProductFromLink() } }} />
              <button className="btn btn-lime" disabled={pBusy} onClick={addProductFromLink}>
                {pBusy ? 'Trayendo…' : <><Icon n="plus" /> Agregar</>}
              </button>
            </div>
            {pErr && <div className="pb-err"><Icon n="alert" /> {pErr}</div>}
            <p className="muted" style={{ fontSize: '.78rem', margin: '.2rem 0 .6rem' }}>Traemos nombre, imagen y precio del link automáticamente. Si algo no se detecta, lo puedes completar a mano.</p>

            {products.length === 0
              ? <div className="muted" style={{ fontSize: '.85rem' }}>Aún no agregas productos. Pega un link y presiona Agregar.</div>
              : <div className="pb-list">
                  {products.map((p, i) => (
                    <div className="pb-card" key={i}>
                      <div className="pb-thumb">{p.image_url
                        ? <img src={p.image_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                        : <span className="pb-ph"><Icon n="box" /></span>}</div>
                      <div className="pb-fields">
                        <input className="pb-name" placeholder="Nombre del producto" value={p.name} onChange={(e) => setProd(i, 'name', e.target.value)} />
                        <div className="pb-row2">
                          <label>Precio<input type="number" min="0" value={p.price} onChange={(e) => setProd(i, 'price', e.target.value)} placeholder="—" /></label>
                          <label>Cant.<input type="number" min="1" value={p.quantity} onChange={(e) => setProd(i, 'quantity', e.target.value)} /></label>
                          {p.product_url && <a className="pb-link" href={p.product_url} target="_blank" rel="noreferrer"><Icon n="cart" /> Ver</a>}
                        </div>
                        {p.autofailed && <span className="pb-warn">No se detectaron datos del link — complétalos.</span>}
                        {p.site && !p.autofailed && <span className="pb-site">{p.site}</span>}
                      </div>
                      <button className="cart-x" title="Quitar" onClick={() => removeProd(i)}><Icon n="close" /></button>
                    </div>
                  ))}
                </div>}
          </div>
          )}

          {step === 1 && (
            <div>
              <h3 style={{ fontSize: '1rem' }}>¿Para qué departamento es la solicitud?</h3>
              {canChooseDept ? (
                <div className="kpi-grid compact">
                  {topDepts.map((d) => (
                    <button key={d} className={`kpi ${wDept === d ? 'active' : ''}`} onClick={() => { if (d !== wDept) setCart({}); setWDept(d); setWSection(''); setStep(2) }}>
                      <div className="ico"><Icon n="building" /></div><div className="lbl">{d}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">La solicitud se registra a nombre de <strong>{ownDept || '—'}</strong>{profile?.department && profile.department !== ownDept ? <> (tu subdepartamento: {profile.department})</> : null}.</p>
              )}
            </div>
          )}

          {wMode === 'catalogo' && step === 2 && (
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
                      <div className="ico"><Icon n="folder" /></div><div className="num">{itemsFor(wDept, s).length}</div><div className="lbl">{s}</div>
                    </button>
                  ))}
                </div>}
            </div>
          )}

          {wMode === 'catalogo' && step === 3 && (
            <div>
              <div className="row" style={{ marginBottom: '.5rem' }}>
                <h3 style={{ fontSize: '1rem', margin: 0 }}>{wSection} · para {wDept}</h3>
                <button className="btn-sm" onClick={() => setStep(2)}>‹ Cambiar sección</button>
              </div>
              {itemsFor(wDept, wSection).map((i) => (
                <div className="cat-row prod-row" key={i.id}>
                  <div className="prod-info">
                    {i.image_url ? <img className="prod-thumb" src={i.image_url} alt="" loading="lazy" decoding="async" onClick={() => viewImage(i.image_url)} /> : <div className="prod-ph"><Icon n="box" /></div>}
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
            {wMode === 'catalogo' && <>
              <label className="muted" style={{ display: 'block' }}>¿No encuentras el insumo en la lista? Descríbelo aquí <span className="muted">(opcional)</span></label>
              <textarea style={{ width: '100%', minHeight: 56 }} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Ej: Teclado mecánico compacto, 2 unidades. Se coordina por chat." />
            </>}
            <label className="muted" style={{ display: 'block', marginTop: '.6rem' }}>Justificación (obligatoria)</label>
            <textarea style={{ width: '100%', minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Para qué necesitas estos insumos?" />
            <div style={{ marginTop: '.6rem', textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={submit}>Enviar solicitud</button>
            </div>
          </div>
        </div>
      )}

      {!creating && loading && <SkeletonKpis n={6} />}
      {!creating && !loading && <div className="kpi-grid compact">
        <button className={`kpi ${!status ? 'active' : ''}`} onClick={() => setStatus(null)}>
          <div className="ico"><Icon n="box" /></div>
          <div className="num">{rows.filter((t) => t.status !== 'rejected').length}</div>
          <div className="lbl">{canManageOrders ? 'En total' : 'Tus solicitudes'}</div>
        </button>
        {ST.map((s) => (
          <button key={s.key} className={`kpi ${status === s.key ? 'active' : ''}`} onClick={() => setStatus(status === s.key ? null : s.key)}>
            <div className="ico"><Icon n={s.ico} /></div><div className="num">{rows.filter((t) => t.status === s.key).length}</div><div className="lbl">{s.label}</div>
          </button>
        ))}
      </div>}

      {!creating && loading && <SkeletonRows n={3} />}
      {!creating && !loading && data.length === 0 && <div className="conv"><div className="empty">No hay solicitudes.</div></div>}
      {!creating && data.map((t) => (
        <div className={`conv ${open === t.id ? 'open' : ''}`} key={t.id}>
          <button className="cv-head" onClick={() => setOpen(open === t.id ? null : t.id)}>
            <span className="ico"><Icon n="box" /></span>
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

              {/* Productos con link (tecnológicos): tarjeta con vista previa + decisión por producto */}
              {(t.request_products || []).length > 0 && (
                <div className="rp-cards">
                  {(t.request_products || []).map((p) => (
                    <div className={`rp-card ${p.status}`} key={p.id}>
                      <div className="rp-thumb">{p.image_url
                        ? <img src={p.image_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} onClick={() => viewImage(p.image_url)} />
                        : <span className="rp-ph"><Icon n="box" /></span>}</div>
                      <div className="rp-info">
                        <strong>{p.quantity} × {p.name}</strong>
                        <div className="rp-meta">
                          {p.price != null ? <span className="rp-price">{fmtMoney(p.price, p.currency)}{p.quantity > 1 ? <span className="muted"> c/u</span> : null}</span> : <span className="muted">sin precio</span>}
                          {p.product_url ? <a className="rp-link" href={/^https?:\/\//i.test(p.product_url) ? p.product_url : 'https://' + p.product_url} target="_blank" rel="noreferrer"><Icon n="cart" /> Ver producto</a> : null}
                        </div>
                        {p.status === 'rejected' && p.reject_reason ? <div className="rp-reason"><Icon n="ban" /> {p.reject_reason}</div> : null}
                      </div>
                      <div className="rp-side">
                        <span className={`rp-badge ${p.status}`}>{p.status === 'approved' ? 'Aprobado' : p.status === 'rejected' ? 'Rechazado' : 'Pendiente'}</span>
                        {canManageOrders && p.status === 'pending' && (t.status === 'pending' || t.status === 'manager_review') && (
                          <div className="rp-actions">
                            <button className="btn-sm btn-lime" onClick={() => decideProduct(p.id, true)}><Icon n="check" /></button>
                            <button className="btn-sm btn-danger" onClick={() => decideProduct(p.id, false)}><Icon n="ban" /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* Aviso de doble aprobación cuando la solicitud incluye insumos tecnológicos */}
              {t.needs_manager && requiredSigners(t).length > 0 && (t.status === 'pending' || t.status === 'manager_review') && (
                <div className="twokey-note"><Icon n="key" /> Insumo tecnológico: requiere la aprobación de <strong>gestión de pedidos</strong> y luego la autorización de <strong>{requiredSigners(t).map((a) => a.full_name || a.email).join(', ')}</strong>.</div>
              )}

              {/* Panel de firmas — vista total: quién autorizó, quién rechazó y quién falta.
                  Para gestión/admin queda visible en todo el ciclo (revisión, aprobada, rechazada);
                  para los propios firmantes se muestra mientras está en revisión. */}
              {t.needs_manager && requiredSigners(t).length > 0
                && (canManageOrders || myIsSigner(t))
                && ['manager_review', 'approved', 'rejected', 'delivered'].includes(t.status) && (() => {
                const req = requiredSigners(t)
                const ok = req.filter((s) => decisionFor(t.id, s.id) === 'approve').length
                return (
                <div className="signers-panel">
                  <div className="sp-head"><span className="sp-title">Autorizaciones</span><span className="sp-count">{ok}/{req.length}</span></div>
                  <div className="sp-list">
                    <div className="sp-row ok">
                      <span className="sp-ico"><Icon n="check" /></span>
                      <span className="sp-name">Aprobación de gestión{t.l1_by ? ` · ${nameById(t.l1_by)}` : ''}</span>
                      <span className="sp-state">Aprobada</span>
                    </div>
                    {req.map((a) => {
                      const dec = decisionFor(t.id, a.id)
                      const st = dec === 'approve' ? 'ok' : dec === 'reject' ? 'bad' : 'wait'
                      return (
                        <div key={a.id} className={`sp-row ${st}`}>
                          <span className="sp-ico"><Icon n={dec === 'approve' ? 'check' : dec === 'reject' ? 'ban' : 'clock'} /></span>
                          <span className="sp-name">{a.full_name || a.email}</span>
                          <span className="sp-state">{dec === 'approve' ? 'Autorizó' : dec === 'reject' ? 'Rechazó' : 'Pendiente'}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
                )
              })()}

              <Chat type="request" id={t.id} locked={t.status === 'rejected' || t.status === 'delivered'} />

              {/* 1ª llave: gestora / administración */}
              {canManageOrders && t.status === 'pending' && (() => {
                const toTech = t.needs_manager && requiredSigners(t).length > 0
                return (
                <div className="adm-actions">
                  <button className="btn btn-lime" onClick={async () => {
                    const msg = toTech
                      ? `¿Dar la aprobación de gestión? Pasará a los firmantes (${requiredSigners(t).length}: ${requiredSigners(t).map((a) => a.full_name || a.email).join(', ')}) para autorizar la compra; el stock se descuenta cuando todos autoricen.`
                      : '¿Aprobar la solicitud? Se descontará el stock.'
                    if (await confirmDialog(msg, { title: toTech ? 'Aprobación de gestión' : 'Aprobar solicitud', okText: toTech ? 'Dar aprobación' : 'Aprobar' }))
                      act('approve_request', t.id, {}, toTech ? 'manager_review' : 'approved')
                  }}>{toTech ? 'Dar aprobación' : 'Aprobar'}</button>
                  <button className="btn btn-danger" onClick={async () => { const r = await promptDialog('Motivo del rechazo', { title: 'Rechazar solicitud', placeholder: 'Explica por qué se rechaza…' }); if (r !== null) act('reject_request', t.id, { p_reason: r || '' }) }}>Rechazar</button>
                </div>
                )
              })()}

              {/* Firma (2ª/3ª llave): gerente de área + tecnología, todos deben firmar */}
              {t.status === 'manager_review' && myIsSigner(t) && !iSigned(t.id) && (
                <div className="adm-actions">
                  <button className="btn btn-lime" onClick={async () => {
                    const signedReq = signedFor(t.id).filter((id) => requiredSigners(t).some((s) => s.id === id)).length
                    const willComplete = (signedReq + 1) >= requiredSigners(t).length
                    if (await confirmDialog(willComplete ? '¿Autorizar la compra? Con tu firma queda aprobada y se descuenta el stock.' : '¿Autorizar la compra? Aún faltará la firma de otro autorizador para completarla.', { title: 'Autorizar compra', okText: 'Autorizar' })) {
                      setApprovals((prev) => [...prev, { request_id: t.id, approver_id: profile.id, decision: 'approve' }])
                      act('tech_approve_request', t.id, {}, willComplete ? 'approved' : 'manager_review')
                    }
                  }}><Icon n="check" /> Autorizar compra</button>
                  <button className="btn btn-danger" onClick={async () => { const r = await promptDialog('Motivo del rechazo', { title: 'Rechazar compra', placeholder: 'Explica por qué se rechaza…' }); if (r !== null) act('tech_reject_request', t.id, { p_reason: r || '' }, 'rejected') }}>Rechazar</button>
                </div>
              )}
              {t.status === 'manager_review' && myIsSigner(t) && iSigned(t.id) && (
                <div className="muted" style={{ fontSize: '.85rem' }}>Ya diste tu autorización. Falta la firma del resto de autorizadores.</div>
              )}
              {canManageOrders && t.status === 'manager_review' && !myIsSigner(t) && (
                <div className="muted" style={{ fontSize: '.85rem' }}>Esperando la autorización de los firmantes (gerente de área y tecnología).</div>
              )}

              {canManageOrders && t.status === 'approved' && (
                <div className="adm-actions"><button className="btn btn-primary" onClick={async () => { if (await confirmDialog('¿Marcar la solicitud como entregada?', { title: 'Marcar entregada', okText: 'Marcar' })) act('deliver_request', t.id) }}>Marcar entregada</button></div>
              )}
              {t.status === 'rejected' && (
                <div className="muted" style={{ fontSize: '.82rem' }}>Solicitud rechazada · ticket cerrado.</div>
              )}
            </div>
          )}
        </div>
      ))}

      {canManageOrders && <ActivityLog kinds={['Solicitud']} title="Registro de solicitudes" />}
    </div>
  )
}
