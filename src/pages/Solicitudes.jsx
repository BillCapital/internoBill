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
  { key: 'pending', label: 'Pendientes', ico: 'clock', tone: 'pend' },
  { key: 'manager_review', label: 'Por gerente', ico: 'key', tone: 'rev' },
  { key: 'approved', label: 'Aprobadas', ico: 'check', tone: 'appr' },
  { key: 'rejected', label: 'Rechazadas', ico: 'ban', tone: 'rej' },
  { key: 'delivered', label: 'Entregadas', ico: 'tray', tone: 'deliv' },
]
const cls = (k) => 's-' + ({ pending: 'pending', manager_review: 'pending', approved: 'approved', rejected: 'rejected', delivered: 'delivered' }[k])
const label = (k) => (ST.find((s) => s.key === k) || {}).label || k
const DEFAULT_DEPTS = ['Cobranza', 'Comercial', 'Operaciones', 'Producto', 'Gerencia']

export default function Solicitudes() {
  const { profile, canManageOrders, isAdmin } = useAuth()
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
  const [wMode, setWMode] = useState('catalogo')   // 'catalogo' | 'tec' (solicitud tecnológica conversable)
  const [tecView, setTecView] = useState('choose') // 'choose' | 'disponibles' | 'solicitar'
  const [availEquip, setAvailEquip] = useState(null) // equipos sin asignar
  const [availPeriph, setAvailPeriph] = useState(null) // periféricos con stock
  const [tecBusy, setTecBusy] = useState(false)
  const [attBusy, setAttBusy] = useState(false)
  const [glossOpen, setGlossOpen] = useState(false)
  const [availOpen, setAvailOpen] = useState({}) // carpetas de disponibilidad abiertas
  const [availSel, setAvailSel] = useState({})   // { key: label } equipos disponibles seleccionados
  // Tipos que NO se ofrecen para asignación individual desde disponibilidad
  const TEC_NO_ASIGNABLE = new Set(['Líneas telefónicas', 'Impresoras'])
  const toggleAvail = (key, label) => setAvailSel((s) => { const n = { ...s }; if (n[key]) delete n[key]; else n[key] = label; return n })
  const pedirSeleccionados = () => {
    const labels = Object.values(availSel)
    if (!labels.length) return
    setNote(`Solicito que me asignen los siguientes equipos disponibles:\n- ${labels.join('\n- ')}\n\nMotivo: `)
    setTecView('solicitar')
  }
  const sortEs = (a, b) => (a || '').localeCompare(b || '', 'es', { sensitivity: 'base' })
  // Traduce nombres de color en inglés al español (para etiquetas de equipos)
  const COLORS_ES = { black: 'Negro', white: 'Blanco', blue: 'Azul', green: 'Verde', red: 'Rojo', silver: 'Plata', gold: 'Dorado', gray: 'Gris', grey: 'Gris', pink: 'Rosa', purple: 'Morado', yellow: 'Amarillo', orange: 'Naranjo' }
  const esColor = (s) => (s || '').replace(/\b([A-Za-z]+)\b/g, (w) => COLORS_ES[w.toLowerCase()] || w)
  // Carpeta por TIPO de dispositivo (derivado del nombre del equipo)
  const tecTypeOf = (e) => {
    const s = `${e.name || ''} ${e.brand || ''} ${e.model || ''}`.toLowerCase()
    if (/l[ií]nea telef|\bsim\b|\bchip\b/.test(s)) return 'Líneas telefónicas'
    if (/celular|smartphone|tel[eé]fono|m[oó]vil/.test(s)) return 'Celulares'
    if (/notebook|laptop|port[aá]til/.test(s)) return 'Notebooks'
    if (/computador|desktop|torre|\bpc\b|all.?in.?one|mac\s?mini|imac/.test(s)) return 'Computadores'
    if (/impresora|printer|multifunc|toner|t[oó]ner/.test(s)) return 'Impresoras'
    if (/monitor|pantalla/.test(s)) return 'Monitores'
    if (/tablet|ipad/.test(s)) return 'Tablets'
    if (/audi[fó]|head|parlante|micr[oó]fono/.test(s)) return 'Audio'
    return e.section || 'Otros equipos'
  }

  const loadTecDisponibles = useCallback(async () => {
    setAvailEquip(null); setAvailPeriph(null)
    const [{ data: eq }, { data: ph }, { data: pa }] = await Promise.all([
      supabase.from('equipment').select('id,name,brand,model,serial_number,attributes,condition,equipment_sections(name)').is('user_id', null).is('returned_at', null),
      supabase.from('peripherals').select('id,name,model,total_qty'),
      supabase.from('peripheral_assignments').select('peripheral_id,qty'),
    ])
    const used = {}; (pa || []).forEach((a) => { used[a.peripheral_id] = (used[a.peripheral_id] || 0) + (a.qty || 0) })
    // Solo hardware asignable a una persona: se excluyen correos/cuentas/servicios/WiFi (por sección)
    const EXCLUDE = /correo|cuenta|mail|servicio|acceso|clave|contrase|wifi|wi-?fi|red inal|licencia/i
    const isBlank = (e) => !(`${e.brand || ''}${e.model || ''}${e.serial_number || ''}`).trim()
    setAvailEquip((eq || [])
      .map((e) => ({ ...e, section: e.equipment_sections?.name || 'Equipos' }))
      .filter((e) => !EXCLUDE.test(e.section) && !isBlank(e)))
    setAvailPeriph((ph || []).map((p) => ({ ...p, avail: Math.max(0, (p.total_qty || 0) - (used[p.id] || 0)) })).filter((p) => p.avail > 0))
  }, [])
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
      .select('id, status, kind, note, custom, department, needs_manager, l1_by, mgr_by, created_at, user_id, profiles!requests_user_id_fkey(full_name,email), request_items(quantity, inventory_items(name,stock)), request_products(id,product_url,name,image_url,price,currency,quantity,status,reject_reason), request_attachments(id,kind,url,name,mime,size,uploaded_by,created_at)')
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
  const [techApprovers, setTechApprovers] = useState([])   // aprobadores técnicos (flujo catálogo)
  const [hrApprovers, setHrApprovers] = useState([])       // RRHH (flujo tecnológico)
  const [itMgrs, setItMgrs] = useState([])                 // Gerente de TI (flujo tecnológico)
  const [approvals, setApprovals] = useState([])           // [{request_id, approver_id, decision}]
  const [deptMgrs, setDeptMgrs] = useState([])             // [{name, manager:{id,full_name,email}}]
  const [people, setPeople] = useState({})                 // { id: 'Nombre' } para resolver l1_by/mgr_by
  const loadMgr = useCallback(async () => {
    const [{ data: flagged }, { data: ap }, { data: dm }, { data: pp }] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email,is_tech_approver,is_hr,is_it_manager').eq('active', true),
      supabase.from('request_approvals').select('request_id, approver_id, decision, at'),
      supabase.from('departments').select('name, manager:manager_id(id,full_name,email)'),
      supabase.from('profiles').select('id,full_name,email'),
    ])
    const F = flagged || []
    setTechApprovers(F.filter((p) => p.is_tech_approver))
    setHrApprovers(F.filter((p) => p.is_hr))
    setItMgrs(F.filter((p) => p.is_it_manager))
    setApprovals(ap || [])
    setDeptMgrs(dm || [])
    setPeople(Object.fromEntries((pp || []).map((p) => [p.id, p.full_name || p.email])))
  }, [])
  const nameById = (id) => (id ? (people[id] || '—') : null)
  useEffect(() => { loadMgr() }, [loadMgr])
  // Gerente de área de un departamento (el guardado en la solicitud ya es el depto raíz)
  const deptManagerOf = (dept) => (deptMgrs.find((d) => d.name === dept)?.manager) || null
  // Conjunto de firmantes requeridos para una solicitud, des-duplicado por persona.
  // Tecnológica: RRHH + Gerente TI + encargado del área. Catálogo: aprobadores técnicos + encargado.
  const requiredSigners = (t) => {
    const base = t.kind === 'tec' ? [...hrApprovers, ...itMgrs] : [...techApprovers]
    const list = []
    const seen = new Set()
    for (const p of base) { if (p && p.id && !seen.has(p.id)) { seen.add(p.id); list.push(p) } }
    const m = deptManagerOf(t.department)
    if (m && m.id && !seen.has(m.id)) { seen.add(m.id); list.push(m) }
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
    setWMode('catalogo'); setTecView('choose'); setProducts([]); setPUrl(''); setPErr('')
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
    // Solicitud tecnológica: conversable, se aprueba por RRHH + Gerente TI + encargado del área
    if (wMode === 'tec') {
      if (note.trim().length < 5) return alertDialog('Describe qué necesitas (al menos unas palabras).')
      setTecBusy(true)
      try {
        await api('create_tech_request', { p_note: note.trim(), p_department: rootDeptOf(wDept || ownDept || '') })
        setNote(''); setWMode('catalogo'); setCreating(false); setStep(1); load(); loadMgr()
      } catch (e) { alertDialog(e.message) } finally { setTecBusy(false) }
      return
    }
    const items = Object.entries(cart).filter(([, q]) => q > 0).map(([id, quantity]) => ({ item_id: id, quantity }))
    if (!items.length && !custom.trim()) return alertDialog('Agrega al menos un artículo del catálogo o describe el insumo que necesitas.')
    if (note.trim().length < 10) return alertDialog('La justificación debe tener al menos 10 caracteres.')
    try {
      await api('create_request', { p_note: note.trim(), p_department: rootDeptOf(wDept || ownDept || ''), p_items: items, p_custom: custom.trim() || null, p_products: [] })
      setCart({}); setNote(''); setCustom(''); setWMode('catalogo'); setCreating(false); setStep(1); load()
    } catch (e) { alertDialog(e.message) }
  }

  // ---- Adjuntos de una solicitud tecnológica (links y archivos/cotizaciones) ----
  const addAttachLink = async (reqId) => {
    const url = await promptDialog('Pega el link (producto, tienda, etc.)', { title: 'Agregar link', placeholder: 'https://…' })
    if (url === null) return
    const u = url.trim(); if (!/^https?:\/\//i.test(u)) return alertDialog('El link debe empezar con http:// o https://')
    const name = (await promptDialog('Nombre o descripción del link (opcional)', { title: 'Nombre del link', placeholder: 'Ej: Monitor Samsung 27"' })) || u
    setAttBusy(true)
    try { await api('request_attach_add', { p_request: reqId, p_kind: 'link', p_url: u, p_name: name }) } catch (e) { alertDialog(e.message) } finally { setAttBusy(false); load() }
  }
  const uploadAttachFile = async (reqId, file) => {
    if (!file) return
    setAttBusy(true)
    try {
      const path = `${reqId}/${Date.now()}_${(file.name || 'archivo').replace(/[^\w.\-]+/g, '_')}`
      const { error: upErr } = await supabase.storage.from('cotizaciones').upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) throw upErr
      await api('request_attach_add', { p_request: reqId, p_kind: 'file', p_url: path, p_name: file.name, p_mime: file.type || '', p_size: file.size || 0 })
    } catch (e) { alertDialog(e.message || 'No se pudo subir el archivo.') } finally { setAttBusy(false); load() }
  }
  const openAttach = async (a) => {
    if (a.kind === 'link') { window.open(/^https?:\/\//i.test(a.url) ? a.url : 'https://' + a.url, '_blank'); return }
    const { data } = await supabase.storage.from('cotizaciones').createSignedUrl(a.url, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const delAttach = async (a) => {
    if (!(await confirmDialog(`¿Quitar "${a.name}"?`, { title: 'Quitar adjunto', danger: true, okText: 'Quitar' }))) return
    try { if (a.kind === 'file' && a.url) await supabase.storage.from('cotizaciones').remove([a.url]); await api('request_attach_delete', { p_id: a.id }) } catch (e) { alertDialog(e.message) } finally { load() }
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

  // La gestora de pedidos NO ve las solicitudes tecnológicas (salvo que sea firmante o dueña); admin sí.
  const canSee = (t) => t.kind !== 'tec' || isAdmin || t.user_id === profile?.id || myIsSigner(t)
  const visibleRows = rows.filter(canSee)
  const data = visibleRows.filter((t) => !status || t.status === status)
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
            </> : <span className={`wz-step on`}>2 · Descripción</span>}
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
            <button className={`req-mode-b ${wMode === 'tec' ? 'on' : ''}`} onClick={() => { setWMode('tec'); setTecView('choose') }}>
              <Icon n="cart" /> <span><strong>Producto tecnológico</strong><em>equipos y periféricos · aprueban RRHH, Gerente TI y tu jefe de área</em></span>
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

          {/* Apartado tecnológico: primero elige consultar disponibilidad o solicitar */}
          {wMode === 'tec' && !(canChooseDept && step === 1) && (
          <div className="tecbuild">
            <div className="tec-topbar">
              <span className="muted" style={{ fontSize: '.82rem' }}>¿Dudas con los términos técnicos?</span>
              <button type="button" className="btn-sm gloss-btn" onClick={() => setGlossOpen(true)}><Icon n="book" /> Ver glosario</button>
            </div>
            {tecView === 'choose' && (
              <div className="tec-choose">
                <button className="tec-opt" onClick={() => { setTecView('disponibles'); loadTecDisponibles() }}>
                  <span className="to-ico"><Icon n="box" /></span>
                  <span><strong>Consultar disponibilidad</strong><em>Revisa los equipos y periféricos ya disponibles para asignar.</em></span>
                </button>
                <button className="tec-opt" onClick={() => setTecView('solicitar')}>
                  <span className="to-ico"><Icon n="cart" /></span>
                  <span><strong>Realizar una solicitud</strong><em>Describe lo que necesitas; lo autorizan RRHH, el Gerente de TI y tu jefe de área.</em></span>
                </button>
              </div>
            )}

            {tecView === 'disponibles' && (
              <div className="tec-avail">
                <div className="row" style={{ marginBottom: '.5rem' }}>
                  <h3 style={{ fontSize: '1rem', margin: 0 }}>Disponibles para asignar</h3>
                  <button className="btn-sm" onClick={() => setTecView('choose')}>‹ Volver</button>
                </div>
                {availEquip === null
                  ? <div className="muted att-empty">Cargando disponibilidad…</div>
                  : (() => {
                    // Agrupa por TIPO de dispositivo (carpetas), alfabético. Periféricos en su carpeta.
                    const g = {}
                    availEquip.forEach((e) => {
                      const k = tecTypeOf(e)
                      if (TEC_NO_ASIGNABLE.has(k)) return
                      const label = esColor([e.name, e.brand, e.model].filter(Boolean).join(' ')) || 'Equipo'
                      const id = e.serial_number || e.attributes?.imei || e.attributes?.serie || ''
                      ;(g[k] = g[k] || []).push({ key: e.id, label, tag: id })
                    })
                    const folders = Object.entries(g).map(([name, items]) => ({ name, items: items.sort((a, b) => sortEs(a.label, b.label) || sortEs(a.tag, b.tag)) }))
                    if ((availPeriph || []).length) folders.push({ name: 'Periféricos', items: [...availPeriph].sort((a, b) => sortEs(a.name, b.name)).map((p) => ({ key: `p:${p.id}`, label: esColor(`${p.name}${p.model ? ` · ${p.model}` : ''}`), tag: `${p.avail} disp.` })) })
                    folders.sort((a, b) => sortEs(a.name, b.name))
                    if (folders.length === 0) return <div className="muted att-empty">No hay equipos ni periféricos disponibles por ahora.</div>
                    return (
                      <div className="av-folders">
                        {folders.map((f) => {
                          const on = !!availOpen[f.name]
                          return (
                            <div className={`av-folder ${on ? 'open' : ''}`} key={f.name}>
                              <button type="button" className="av-fhead" onClick={() => setAvailOpen((o) => ({ ...o, [f.name]: !o[f.name] }))}>
                                <Icon n="folder" /> <span className="af-name">{f.name}</span> <span className="af-count">{f.items.length}</span> <span className="af-chev">▾</span>
                              </button>
                              {on && <ul className="av-fitems">{f.items.map((it) => (
                                <li key={it.key} className={`av-pick ${availSel[it.key] ? 'on' : ''}`} onClick={() => toggleAvail(it.key, it.tag ? `${it.label} (${it.tag})` : it.label)}>
                                  <span className="av-box">{availSel[it.key] ? <Icon n="check" /> : null}</span>
                                  <span className="av-lbl">{it.label}{it.tag ? <span className="av-tag muted">{it.tag}</span> : null}</span>
                                </li>
                              ))}</ul>}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                <div className="tec-avail-cta">
                  {Object.keys(availSel).length > 0
                    ? <><span className="muted">{Object.keys(availSel).length} seleccionado(s)</span>
                        <span style={{ display: 'flex', gap: '.5rem' }}>
                          <button className="btn-sm" onClick={() => setAvailSel({})}>Limpiar</button>
                          <button className="btn btn-lime" onClick={pedirSeleccionados}>Solicitar asignación ({Object.keys(availSel).length})</button>
                        </span></>
                    : <><span className="muted">Marca los que necesites, o si no hay:</span>
                        <button className="btn btn-lime" onClick={() => setTecView('solicitar')}>Realizar una solicitud</button></>}
                </div>
              </div>
            )}

            {tecView === 'solicitar' && (
              <>
                <div className="tec-desc-head">
                  <div><div className="tec-desc-t">Describe qué necesitas</div>
                    <div className="tec-desc-s muted">Cuéntanos para qué lo necesitas y qué problema tienes; nosotros vemos la mejor opción.</div></div>
                  <button className="btn-sm tec-back" onClick={() => setTecView('choose')}>‹ Volver</button>
                </div>
                <textarea style={{ width: '100%', minHeight: 110 }} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Ej: Mi computador se pone muy lento con Chrome y varias pestañas de Google (Gmail, Sheets, Drive) abiertas; tiene poca RAM. Necesito ampliar la memoria o reemplazarlo." />
                <div className="tec-info">
                  <Icon n="key" /> <span>Al enviarla podrás <strong>adjuntar links y cotizaciones en PDF</strong> y conversar dentro de la solicitud. La autorizan <strong>RRHH, el Gerente de TI y el encargado de tu área</strong>; la gestora de pedidos no interviene.</span>
                </div>
              </>
            )}
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

          {/* Pie del asistente (catálogo): insumo no listado + justificación */}
          {wMode === 'catalogo' && (
          <div className="wz-foot">
            <label className="muted" style={{ display: 'block' }}>¿No encuentras el insumo en la lista? Descríbelo aquí <span className="muted">(opcional)</span></label>
            <textarea style={{ width: '100%', minHeight: 56 }} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Ej: Teclado mecánico compacto, 2 unidades. Se coordina por chat." />
            <label className="muted" style={{ display: 'block', marginTop: '.6rem' }}>Justificación (obligatoria)</label>
            <textarea style={{ width: '100%', minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Para qué necesitas estos insumos?" />
            <div style={{ marginTop: '.6rem', textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={submit}>Enviar solicitud</button>
            </div>
          </div>
          )}
          {wMode === 'tec' && tecView === 'solicitar' && !(canChooseDept && step === 1) && (
          <div style={{ marginTop: '.8rem', textAlign: 'right' }}>
            <button className="btn btn-primary" disabled={tecBusy} onClick={submit}>{tecBusy ? 'Enviando…' : 'Enviar solicitud'}</button>
          </div>
          )}
        </div>
      )}

      {!creating && loading && <SkeletonKpis n={6} />}
      {!creating && !loading && <div className="req-kpis">
        <button className={`rk k-all ${!status ? 'on' : ''}`} onClick={() => setStatus(null)}>
          <span className="rk-ico"><Icon n="box" /></span>
          <span className="rk-txt"><span className="rk-n">{visibleRows.filter((t) => t.status !== 'rejected').length}</span>
            <span className="rk-l">{canManageOrders ? 'En total' : 'Tus solicitudes'}</span></span>
        </button>
        {ST.map((s) => (
          <button key={s.key} className={`rk k-${s.tone} ${status === s.key ? 'on' : ''}`} onClick={() => setStatus(status === s.key ? null : s.key)}>
            <span className="rk-ico"><Icon n={s.ico} /></span>
            <span className="rk-txt"><span className="rk-n">{visibleRows.filter((t) => t.status === s.key).length}</span>
              <span className="rk-l">{s.label}</span></span>
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
              {/* Adjuntos (solicitud tecnológica): links y cotizaciones PDF, se guardan y se puede conversar */}
              {t.kind === 'tec' && (() => {
                const canAttach = t.user_id === profile?.id || isAdmin || myIsSigner(t)
                const atts = t.request_attachments || []
                const active = t.status !== 'rejected' && t.status !== 'delivered'
                return (
                <div className="att-box">
                  <div className="att-head"><span><Icon n="file" /> Links y cotizaciones</span>
                    {canAttach && active && (
                      <span className="att-add">
                        <button className="btn-sm" disabled={attBusy} onClick={() => addAttachLink(t.id)}><Icon n="cart" /> Link</button>
                        <label className="btn-sm att-upl">{attBusy ? 'Subiendo…' : <><Icon n="plus" /> Archivo</>}
                          <input type="file" accept=".pdf,image/*,application/pdf" hidden disabled={attBusy}
                            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadAttachFile(t.id, f) }} />
                        </label>
                      </span>
                    )}
                  </div>
                  {atts.length === 0
                    ? <div className="muted att-empty">Aún no hay links ni cotizaciones. Agrega el producto que necesitas o la cotización.</div>
                    : <ul className="att-list">
                        {atts.map((a) => (
                          <li key={a.id} className="att-item">
                            <span className="att-ico"><Icon n={a.kind === 'file' ? 'file' : 'cart'} /></span>
                            <button className="att-name" onClick={() => openAttach(a)} title="Abrir">{a.name}</button>
                            <span className="att-by muted">{nameById(a.uploaded_by)}</span>
                            {(a.uploaded_by === profile?.id || isAdmin) && active && <button className="att-x" title="Quitar" onClick={() => delAttach(a)}><Icon n="close" /></button>}
                          </li>
                        ))}
                      </ul>}
                </div>
                )
              })()}

              {/* Aviso de autorización requerida */}
              {t.needs_manager && requiredSigners(t).length > 0 && (t.status === 'pending' || t.status === 'manager_review') && (
                <div className="twokey-note"><Icon n="key" /> {t.kind === 'tec'
                  ? <>Requiere la autorización de <strong>{requiredSigners(t).map((a) => a.full_name || a.email).join(', ')}</strong> (RRHH, Gerente TI y encargado del área).</>
                  : <>Insumo tecnológico: requiere la aprobación de <strong>gestión de pedidos</strong> y luego la autorización de <strong>{requiredSigners(t).map((a) => a.full_name || a.email).join(', ')}</strong>.</>}</div>
              )}

              {/* Panel de firmas — vista total: quién autorizó, quién rechazó y quién falta.
                  Para gestión/admin queda visible en todo el ciclo (revisión, aprobada, rechazada);
                  para los propios firmantes se muestra mientras está en revisión. */}
              {t.needs_manager && requiredSigners(t).length > 0
                && (canManageOrders || myIsSigner(t) || isAdmin || t.user_id === profile?.id)
                && ['manager_review', 'approved', 'rejected', 'delivered'].includes(t.status) && (() => {
                const req = requiredSigners(t)
                const ok = req.filter((s) => decisionFor(t.id, s.id) === 'approve').length
                return (
                <div className="signers-panel">
                  <div className="sp-head"><span className="sp-title">Autorizaciones</span><span className="sp-count">{ok}/{req.length}</span></div>
                  <div className="sp-list">
                    {t.kind !== 'tec' && (
                    <div className="sp-row ok">
                      <span className="sp-ico"><Icon n="check" /></span>
                      <span className="sp-name">Aprobación de gestión{t.l1_by ? ` · ${nameById(t.l1_by)}` : ''}</span>
                      <span className="sp-state">Aprobada</span>
                    </div>
                    )}
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

      {/* Glosario de términos (ventana superpuesta) */}
      {glossOpen && (
        <div className="backdrop open" onClick={() => setGlossOpen(false)}>
          <div className="modal gloss-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gloss-head">
              <h3><Icon n="book" /> Glosario de términos</h3>
              <button className="btn-sm" type="button" onClick={() => setGlossOpen(false)}><Icon n="close" /> Cerrar</button>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>En palabras simples, para pedir lo que necesitas sin ser experto.</p>
            <dl className="gloss-list">
              <div className="g-item"><span className="g-ico"><Icon n="layers" /></span><div>
                <dt>RAM (MEMORIA)</dt>
                <dd>Es el espacio para trabajar, como tu escritorio. Si es poco, el computador se pone <strong>lento</strong> cuando abres muchas cosas a la vez (varias pestañas o programas).</dd></div></div>
              <div className="g-item"><span className="g-ico"><Icon n="save" /></span><div>
                <dt>ALMACENAMIENTO (DISCO / SSD)</dt>
                <dd>Es donde se <strong>guardan</strong> tus archivos y programas, como un cajón. El tipo “SSD” es más moderno y hace que todo abra mucho más rápido.</dd></div></div>
              <div className="g-item"><span className="g-ico"><Icon n="cpu" /></span><div>
                <dt>PROCESADOR (CPU)</dt>
                <dd>Es el <strong>motor</strong> del computador. Mientras más potente, más rápido hace las tareas.</dd></div></div>
              <div className="g-item"><span className="g-ico"><Icon n="image" /></span><div>
                <dt>TARJETA GRÁFICA (GPU)</dt>
                <dd>Sirve para juegos, diseño o editar videos. Para trabajar con <strong>Google, Chrome y planillas NO hace falta</strong> una especial.</dd></div></div>
              <div className="g-item"><span className="g-ico"><Icon n="monitor" /></span><div>
                <dt>PANTALLA / MONITOR</dt>
                <dd>Es la <strong>pantalla</strong> donde ves todo. A veces es una parte aparte del computador.</dd></div></div>
              <div className="g-item"><span className="g-ico"><Icon n="mouse" /></span><div>
                <dt>PERIFÉRICO</dt>
                <dd>Son los <strong>accesorios</strong> que se enchufan: mouse, teclado, audífonos, cámara.</dd></div></div>
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
