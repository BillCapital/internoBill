import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { confirmDialog, alertDialog, viewImage } from '../lib/ui'
import { fileToResizedDataURL, readClipboardImage } from '../lib/img'
import ImagePicker from '../components/ImagePicker'
import { loadDeptNames, DEFAULT_DEPTS, deptIndentLabel } from '../lib/depts'
import { Icon } from '../lib/icons'

// Campos sensibles (contraseñas / PIN): se muestran enmascarados con opción de revelar
const isSecretField = (f) => /pass|contrasen|clave/i.test(f.key || '') || f.key === 'pin' || /contrase|pin\b/i.test(f.label || '')
function SecretField({ value, disabled, placeholder, onChange }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input type={show ? 'text' : 'password'} autoComplete="off" value={value} disabled={disabled} placeholder={placeholder}
        onChange={onChange} style={{ paddingRight: '2.1rem' }} />
      <button type="button" className="pass-eye" title={show ? 'Ocultar' : 'Ver'} onClick={() => setShow((s) => !s)}
        style={{ position: 'absolute', right: '.55rem', top: '50%', transform: 'translateY(-50%)' }}><Icon n={show ? 'eyeOff' : 'eye'} /></button>
    </div>
  )
}
// Versión de solo lectura (enmascarada con botón para revelar)
function SecretRead({ value }) {
  const [show, setShow] = useState(false)
  if (!value || value === '—') return <span className="muted">—</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
      <span style={{ fontFamily: 'monospace', letterSpacing: show ? 0 : '.12em' }}>{show ? value : '••••••••'}</span>
      <button type="button" className="pass-eye" title={show ? 'Ocultar' : 'Ver'} onClick={() => setShow((s) => !s)}><Icon n={show ? 'eyeOff' : 'eye'} /></button>
    </span>
  )
}

const fmt = (iso) => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const fmtD = (d) => new Date(d + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
const EVENTS = ['Mantenimiento', 'Limpieza', 'Apertura / Revisión', 'Reparación', 'Instalación', 'Actualización', 'Reasignación', 'Cambio de estado', 'Alta', 'Nota']
const STAT_ICON = { 'Mantenimiento': 'wrench', 'Limpieza': 'refresh', 'Apertura / Revisión': 'search', 'Reparación': 'wrench', 'Instalación': 'box', 'Actualización': 'upload', 'Reasignación': 'refresh', 'Cambio de estado': 'tag', 'Alta': 'plus', 'Nota': 'edit' }
// Tipos que no se muestran como tarjeta ni como opción manual (autogenerados o cubiertos por otro)
const HIDDEN_TYPES = ['Cambio de estado', 'Alta', 'Apertura / Revisión']
const MANUAL_EVENTS = EVENTS.filter((t) => !HIDDEN_TYPES.includes(t))
const AV = ['', 'Activo', 'Inactivo', 'No aplica']
const CONDS = ['Bueno', 'Regular', 'Sin asignar', 'En mantenimiento', 'De baja']
const LOCS = ['CM', 'Remoto', 'CM/Remoto']
const BRANDS = ['HP', 'Lenovo', 'Apple', 'Dell', 'Asus', 'Acer', 'Microsoft', 'Samsung', 'Huawei', 'LG', 'MSI', 'Brother', 'Epson', 'Canon', 'Xiaomi', 'Otra']
// Software estándar: habilitado/no + lista de cuentas (Adobe no lleva cuentas)
const SW_APPS = [
  { key: 'm365', label: 'Microsoft 365', accounts: true },
  { key: 'outlook', label: 'Outlook', accounts: true },
  { key: 'teams', label: 'Teams', accounts: true },
  { key: 'onedrive', label: 'OneDrive', accounts: true },
  { key: 'adobe', label: 'Adobe PDF', accounts: false },
]
const WD = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do']
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
// YYYY-MM-DD en horario local (sin desfase UTC)
const isoLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
const todayISO = () => isoLocal(new Date())
const daysLeft = (d) => Math.round((new Date(d + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000)
const splitLines = (s) => (s || '').split('\n').map((x) => x.trim()).filter(Boolean)

// Derivan la ficha y el software iniciales desde el equipo (para comparar y detectar cambios)
const deriveFk = (eq) => ({
  id: eq.id, name: eq.name || '', brand: eq.brand || '', model: eq.model || '', serial_number: eq.serial_number || '',
  location: eq.location || '', condition: eq.condition || 'Bueno', image_url: eq.image_url || '',
  assigned_to_name: eq.assigned_to_name || '', assigned_to_email: eq.assigned_to_email || '', attributes: { ...(eq.attributes || {}) },
})
const deriveSw = (eq) => {
  const saved = eq.attributes?.sw_apps
  let apps = {}
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) apps = { ...saved }
  else apps = { m365: { on: true, accounts: [] }, outlook: { on: true, accounts: splitLines(eq.attributes?.sw_outlook) }, teams: { on: true, accounts: splitLines(eq.attributes?.sw_teams) }, onedrive: { on: true, accounts: [] }, adobe: { on: true } }
  SW_APPS.forEach((a) => { if (!apps[a.key]) apps[a.key] = a.accounts ? { on: false, accounts: [] } : { on: false } })
  return { antivirus: eq.antivirus || '', apps }
}
const savePayload = (f, sw) => ({ ...f, antivirus: sw.antivirus, attributes: { ...(f.attributes || {}), sw_apps: sw.apps } })

// Selector de cuentas: chips + elegir usuario existente + agregar otro manualmente
// Carrusel de fotos: una visible, flechas ‹ › y swipe (deslizar) en móvil
function PhotoCarousel({ photos, editable, onRemove }) {
  const ref = useRef(null)
  const [i, setI] = useState(0)
  if (!photos.length) return null
  const go = (dir) => {
    const el = ref.current; if (!el) return
    const n = Math.min(photos.length - 1, Math.max(0, i + dir))
    setI(n); el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' })
  }
  const onScroll = () => { const el = ref.current; if (el) setI(Math.round(el.scrollLeft / el.clientWidth)) }
  return (
    <div className="carousel">
      {photos.length > 1 && <button type="button" className="car-nav left" onClick={() => go(-1)} disabled={i === 0}>‹</button>}
      <div className="car-track" ref={ref} onScroll={onScroll}>
        {photos.map((src, k) => (
          <div className="car-slide" key={k}>
            <img src={src} alt="" onClick={() => viewImage(src)} />
            {editable && k === 0 && <span className="photo-cover">Portada</span>}
            {editable && <button type="button" className="car-del" title="Quitar" onClick={() => onRemove(k)}><Icon n="close" /></button>}
          </div>
        ))}
      </div>
      {photos.length > 1 && <button type="button" className="car-nav right" onClick={() => go(1)} disabled={i >= photos.length - 1}>›</button>}
      {photos.length > 1 && <div className="car-dots">{photos.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>}
    </div>
  )
}

function AcctPicker({ value, onChange, users, placeholder, owner }) {
  const [ext, setExt] = useState('')
  const add = (v) => { const t = (v || '').trim(); if (!t) return; if (!value.includes(t)) onChange([...value, t]) }
  // El propietario del dispositivo se sugiere primero
  const opts = []
  if (owner?.email && !value.includes(owner.email)) opts.push({ id: 'owner', email: owner.email, label: `Propietario · ${owner.name || owner.email} — ${owner.email}` })
  users.filter((u) => u.email && !value.includes(u.email) && u.email !== owner?.email)
    .forEach((u) => opts.push({ id: u.id, email: u.email, label: `${u.full_name || 'Sin nombre'} — ${u.email}` }))
  return (
    <div className="acct-picker">
      {value.length > 0 && (
        <div className="chips">
          {value.map((v) => (
            <span className="chip" key={v}>{v}<button type="button" title="Quitar" onClick={() => onChange(value.filter((x) => x !== v))}><Icon n="close" /></button></span>
          ))}
        </div>
      )}
      <div className="acct-row">
        <select value="" onChange={(e) => { if (e.target.value) add(e.target.value) }}>
          <option value="">＋ Elegir usuario…</option>
          {opts.map((o) => <option key={o.id} value={o.email}>{o.label}</option>)}
        </select>
        <input placeholder={placeholder || 'Agregar otro…'} value={ext}
          onChange={(e) => setExt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(ext); setExt('') } }} />
        <button type="button" className="btn-sm" onClick={() => { add(ext); setExt('') }}>Agregar</button>
      </div>
    </div>
  )
}

export default function EquipoDetalle() {
  const { id } = useParams()
  const nav = useNavigate()
  const { canManageInventory } = useAuth()
  const [eq, setEq] = useState(null)
  const [DEPTS, setDEPTS] = useState(DEFAULT_DEPTS)
  useEffect(() => { loadDeptNames().then(setDEPTS) }, [])
  const [section, setSection] = useState(null)
  const [events, setEvents] = useState([])
  const [sched, setSched] = useState([])
  const [form, setForm] = useState({ event_type: 'Mantenimiento', note: '', images: [] })
  const [mForm, setMForm] = useState({ date: '', event_type: 'Mantenimiento', note: '' })
  const [editEv, setEditEv] = useState(null) // entrada de bitácora en edición
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [openCal, setOpenCal] = useState(false)
  const [openBita, setOpenBita] = useState(false)
  const [openSoft, setOpenSoft] = useState(true)
  const [openSec, setOpenSec] = useState({ ident: false, det: false, asig: false, soft: false }) // secciones plegables (cerradas por defecto)
  const [swForm, setSwForm] = useState({ antivirus: '', apps: {} })
  const [savingSw, setSavingSw] = useState(false)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [fk, setFk] = useState(null)              // ficha en edición (todo desde Detalle)
  const [savingFk, setSavingFk] = useState(false)
  const [assignMode, setAssignMode] = useState('user')
  const [manualAssign, setManualAssign] = useState(false)

  const load = useCallback(async () => {
    const { data: e } = await supabase.from('equipment').select('*').eq('id', id).single()
    setEq(e || null)
    if (e?.section_id) { const { data: s } = await supabase.from('equipment_sections').select('name,icon,fields,assign_to').eq('id', e.section_id).single(); setSection(s || null) }
    const { data: ev } = await supabase.from('equipment_events').select('id,at,actor_name,event_type,note,images').eq('equipment_id', id).order('at', { ascending: false })
    setEvents(ev ?? [])
    const { data: sc } = await supabase.from('equipment_maintenance').select('id,scheduled_for,event_type,note,status,created_by_name').eq('equipment_id', id).eq('status', 'programado').order('scheduled_for', { ascending: true })
    setSched(sc ?? [])
    const { data: us } = await supabase.from('profiles').select('id,full_name,email,app_access').order('full_name')
    // Excluir cuentas solo-organización (sin acceso): no deben aparecer para asignar
    setUsers((us ?? []).filter((u) => u.app_access !== false))
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])
  // Sincroniza el formulario de software cuando carga el equipo (migra del formato viejo)
  useEffect(() => {
    if (!eq) return
    setSwForm(deriveSw(eq))
  }, [eq])
  const setApp = (key, patch) => setSwForm((f) => ({ ...f, apps: { ...f.apps, [key]: { ...(f.apps[key] || {}), ...patch } } }))
  // Sincroniza la ficha editable
  useEffect(() => {
    if (!eq) return
    setFk(deriveFk(eq))
    setManualAssign(false)
    setAssignMode(eq.assigned_to_email ? 'user' : (section?.assign_to === 'department' ? 'department' : 'user'))
  }, [eq, section])

  // ¿Hay cambios sin guardar? (compara la ficha+software actual con la inicial del equipo)
  const dirty = useMemo(() => {
    if (!eq || !fk) return false
    return JSON.stringify(savePayload(fk, swForm)) !== JSON.stringify(savePayload(deriveFk(eq), deriveSw(eq)))
  }, [eq, fk, swForm])

  const setFkAttr = (k, v) => setFk((f) => ({ ...f, attributes: { ...(f.attributes || {}), [k]: v } }))
  // Fotos del dispositivo (varias). La primera se usa como portada (image_url) para listados y QR.
  const fkPhotos = () => (fk?.attributes?.photos && fk.attributes.photos.length) ? fk.attributes.photos : (fk?.image_url ? [fk.image_url] : [])
  const setPhotos = (arr) => setFk((f) => ({ ...f, image_url: arr[0] || '', attributes: { ...(f.attributes || {}), photos: arr } }))
  // Encabezado plegable de sección de la ficha
  const subHead = (k, label) => (
    <button type="button" className="det-sub det-toggle" onClick={() => setOpenSec((s) => ({ ...s, [k]: !s[k] }))}>
      <span>{label}</span><span className="chev">{openSec[k] ? '▾' : '▸'}</span>
    </button>
  )
  // Guardado unificado: ficha + software en un solo botón
  const saveAll = async () => {
    if (!(fk.name || '').trim()) return alertDialog('Indica el tipo/nombre del equipo.')
    setSavingFk(true)
    try {
      await api('equipment_upsert', { p: savePayload(fk, swForm) }); alertDialog('Cambios guardados.'); load()
    } catch (e) { alertDialog(e.message) } finally { setSavingFk(false) }
  }

  const saveSoftware = async () => {
    setSavingSw(true)
    try {
      const p = {
        id: eq.id, name: eq.name, antivirus: swForm.antivirus,
        attributes: { ...(eq.attributes || {}), sw_empresa: swForm.empresa.trim(), sw_outlook: swForm.outlook.join('\n'), sw_teams: swForm.teams.join('\n') },
      }
      await api('equipment_upsert', { p }); load()
    } catch (e) { alertDialog(e.message) } finally { setSavingSw(false) }
  }

  const addEvent = async () => {
    if (!form.note.trim() && form.images.length === 0 && !(await confirmDialog('¿Agregar sin nota?'))) return
    const snap = { event_type: form.event_type, note: form.note.trim(), images: form.images }
    // Optimista: la entrada aparece de inmediato y se reconcilia al recargar
    setEvents((es) => [{ id: 'tmp-' + Math.random().toString(36).slice(2), at: new Date().toISOString(), actor_name: 'Guardando…', ...snap }, ...es])
    setForm({ event_type: 'Mantenimiento', note: '', images: [] })
    try { await api('equipment_event_add', { p_equipment: id, p_type: snap.event_type, p_note: snap.note, p_images: snap.images }) } catch (e) { alertDialog(e.message) } finally { load() }
  }
  const addFormImages = async (files) => {
    for (const f of Array.from(files)) {
      try { const url = await fileToResizedDataURL(f); setForm((fm) => ({ ...fm, images: [...fm.images, url] })) } catch (er) { alertDialog(er.message) }
    }
  }
  // Pega una imagen del portapapeles hacia una lista de fotos (bitácora)
  const pasteImagesInto = async (addFn) => {
    try { const blob = await readClipboardImage(); await addFn([blob]) } catch (e) { alertDialog(e.message) }
  }
  const delEvent = async (evId) => {
    if (!(await confirmDialog('¿Eliminar esta entrada de la bitácora?', { title: 'Eliminar registro', danger: true, okText: 'Eliminar' }))) return
    setEvents((es) => es.filter((x) => x.id !== evId))
    try { await api('equipment_event_delete', { p_id: evId }) } catch (e) { alertDialog(e.message) } finally { load() }
  }
  // Edición de una entrada de bitácora (texto, tipo y fotos)
  const openEditEv = (ev) => setEditEv({ id: ev.id, event_type: ev.event_type, note: ev.note || '', images: Array.isArray(ev.images) ? [...ev.images] : [] })
  const addEditImages = async (files) => {
    for (const f of Array.from(files)) {
      try { const url = await fileToResizedDataURL(f); setEditEv((e) => ({ ...e, images: [...e.images, url] })) } catch (er) { alertDialog(er.message) }
    }
  }
  const saveEditEv = async () => {
    const ev = editEv
    setEvents((es) => es.map((x) => (x.id === ev.id ? { ...x, event_type: ev.event_type, note: ev.note.trim(), images: ev.images } : x)))
    setEditEv(null)
    try { await api('equipment_event_update', { p_id: ev.id, p_type: ev.event_type, p_note: ev.note.trim(), p_images: ev.images }) } catch (e) { alertDialog(e.message) } finally { load() }
  }
  const addMaint = async () => {
    if (!mForm.date) return alertDialog('Elige una fecha en el calendario.')
    if (mForm.date < todayISO()) return alertDialog('La fecha debe ser hoy o futura.')
    const snap = { ...mForm }
    setMForm({ date: '', event_type: 'Mantenimiento', note: '' })
    try { await api('equipment_maint_add', { p_equipment: id, p_type: snap.event_type, p_note: snap.note.trim(), p_date: snap.date }) } catch (e) { alertDialog(e.message) } finally { load() }
  }
  const completeMaint = async (mId) => {
    if (!(await confirmDialog('¿Marcar este mantenimiento como realizado? Quedará registrado en la bitácora.', { title: 'Completar mantenimiento', okText: 'Marcar realizado' }))) return
    setSched((ss) => ss.filter((x) => x.id !== mId))
    try { await api('equipment_maint_complete', { p_id: mId }) } catch (e) { alertDialog(e.message) } finally { load() }
  }
  const delMaint = async (mId) => {
    if (!(await confirmDialog('¿Cancelar / eliminar este mantenimiento programado?', { title: 'Cancelar mantenimiento', danger: true, okText: 'Eliminar' }))) return
    setSched((ss) => ss.filter((x) => x.id !== mId))
    try { await api('equipment_maint_delete', { p_id: mId }) } catch (e) { alertDialog(e.message) } finally { load() }
  }
  const printQR = (qrUrl, title, person) => {
    const w = window.open('', '_blank', 'width=360,height=420')
    if (!w) return alertDialog('Permite las ventanas emergentes para imprimir el QR.')
    // Etiqueta pequeña (~3 cm) pegada en la esquina superior izquierda de la hoja
    w.document.write(`<html><head><title>QR ${title}</title><style>
      @page{margin:6mm}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0}
      body{font-family:system-ui,Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .label{width:34mm;padding:1.6mm;display:inline-flex;flex-direction:column;align-items:center;text-align:center;border:0.3mm dashed #bbb}
      .label img{width:27mm;height:27mm}
      .nm{font-size:6.5pt;font-weight:700;line-height:1.05;margin-top:1mm;max-width:31mm;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .pn{font-size:6pt;line-height:1.05;margin-top:.6mm;max-width:31mm}
      .bc{font-size:5pt;color:#444;margin-top:.6mm;letter-spacing:.3pt}
    </style></head><body onload="setTimeout(function(){window.print()},300)">
      <div class="label">
        <img src="${qrUrl}" alt="QR"/>
        <div class="nm">${title}</div>
        ${person ? `<div class="pn">${person}</div>` : ''}
        <div class="bc">BILLCAPITAL · INVENTARIO</div>
      </div>
    </body></html>`)
    w.document.close()
  }

  if (loading) return <div className="page-loader">Cargando…</div>
  if (!eq) return <div><div className="page-head"><h2>Equipo no encontrado</h2></div><button className="btn" onClick={() => nav('/inventario')}>‹ Volver al inventario</button></div>

  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(`${window.location.origin}/m/equipo/${id}`)}`
  const rows = [
    ['Tipo / Nombre', eq.name], ['Marca', eq.brand], ['Modelo', eq.model], ['N° de serie', eq.serial_number],
    ['Ubicación', eq.location], ['Estado', eq.condition],
    ...(section?.assign_to === 'department' ? [['Departamento', eq.assigned_to_name]] : [['Asignado a', eq.assigned_to_name], ['Correo', eq.assigned_to_email]]),
    ...((section?.fields || []).map((f) => [f.label, eq.attributes?.[f.key] || '—', isSecretField(f), f.type])),
  ]

  // Calendario mensual
  const y = cur.getFullYear(), mo = cur.getMonth()
  const first = new Date(y, mo, 1)
  const offset = (first.getDay() + 6) % 7 // lunes = 0
  const cells = Array.from({ length: 42 }, (_, i) => new Date(y, mo, i - offset + 1))
  const byDay = {}
  sched.forEach((m) => { (byDay[m.scheduled_for] = byDay[m.scheduled_for] || []).push(m) })
  const tISO = todayISO()
  const stats = EVENTS.filter((t) => !HIDDEN_TYPES.includes(t)).map((t) => ({ t, n: events.filter((e) => e.event_type === t).length }))
  const nextMaint = sched[0]?.scheduled_for || null
  const lastMaint = [...events].filter((e) => e.event_type === 'Mantenimiento').sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))[0]?.at || null

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>{section?.icon} {eq.name} {eq.brand} {eq.model}</h2><p className="muted">Ficha del equipo · {section?.name || 'Sin tipo'}</p></div>
        <button className="btn" onClick={() => nav('/inventario')}>‹ Volver</button>
      </div></div>

      {/* Resumen: mantenimiento + tipos de intervención (primero) */}
      <div className="stat-cards" style={{ marginBottom: '1rem' }}>
        <div className={`stat-card${nextMaint ? '' : ' zero'}`}>
          <span className="sc-ico"><Icon n="calendar" /></span>
          <span className="sc-n" style={{ fontSize: '.95rem' }}>{nextMaint ? fmtD(nextMaint) : '—'}</span>
          <span className="sc-t">Próximo mantenimiento</span>
        </div>
        <div className={`stat-card${lastMaint ? '' : ' zero'}`}>
          <span className="sc-ico"><Icon n="wrench" /></span>
          <span className="sc-n" style={{ fontSize: '.95rem' }}>{lastMaint ? new Date(lastMaint).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
          <span className="sc-t">Último mantenimiento</span>
        </div>
        {stats.map((s) => (
          <div className={`stat-card${s.n ? '' : ' zero'}`} key={s.t}>
            <span className="sc-ico">{STAT_ICON[s.t] ? <Icon n={STAT_ICON[s.t]} /> : '•'}</span>
            <span className="sc-n">{s.n}</span>
            <span className="sc-t">{s.t}</span>
          </div>
        ))}
      </div>

      <div className="eq-detail">
        <div className="eq-info">
          <div className="pf-card">
            {canManageInventory && fk ? (<>
              <div style={{ marginBottom: '.6rem' }}>
                <label style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Fotos del dispositivo {fkPhotos().length > 0 ? `(${fkPhotos().length})` : ''}</label>
                <PhotoCarousel photos={fkPhotos()} editable onRemove={(i) => setPhotos(fkPhotos().filter((_, j) => j !== i))} />
                <ImagePicker value="" onChange={(url) => { if (url) setPhotos([...fkPhotos(), url]) }} />
              </div>

              {subHead('ident', <><Icon n="tag" /> Identificación</>)}
              {openSec.ident && <div className="pf-fields">
                <div><label>Tipo / Nombre</label><input value={fk.name} onChange={(e) => setFk({ ...fk, name: e.target.value })} /></div>
                <div><label>Marca</label><input list="brand-list-det" placeholder="HP, Lenovo, Apple…" value={fk.brand} onChange={(e) => setFk({ ...fk, brand: e.target.value })} /></div>
                <div><label>Modelo</label><input value={fk.model} onChange={(e) => setFk({ ...fk, model: e.target.value })} /></div>
                <div><label>Identificador de dispositivo</label><input value={fk.serial_number} onChange={(e) => setFk({ ...fk, serial_number: e.target.value })} /></div>
                <div><label>Ubicación</label>
                  <select value={fk.location || ''} onChange={(e) => setFk({ ...fk, location: e.target.value })}>
                    <option value="">—</option>
                    {[...LOCS, ...(fk.location && !LOCS.includes(fk.location) ? [fk.location] : [])].map((o) => <option key={o}>{o}</option>)}
                  </select></div>
                <div><label>Estado</label><select value={fk.condition} onChange={(e) => setFk({ ...fk, condition: e.target.value })}>{CONDS.map((c) => <option key={c}>{c}</option>)}</select></div>
              </div>}
              <datalist id="brand-list-det">{BRANDS.map((b) => <option key={b} value={b} />)}</datalist>

              {(section?.fields || []).length > 0 && (<>
                {subHead('det', <><Icon n="chip" /> Detalles</>)}
                {openSec.det && <div className="pf-fields">
                  {(section.fields || []).map((f) => {
                    const dhcpOn = fk.attributes?.dhcp === 'Sí'
                    const ipDisabled = f.key === 'ip' && dhcpOn
                    return (
                      <div key={f.key}><label>{f.label}</label>
                        {f.type === 'select'
                          ? <select value={fk.attributes?.[f.key] || ''} onChange={(e) => setFkAttr(f.key, e.target.value)}><option value="">—</option>{(f.options || []).map((o) => <option key={o}>{o}</option>)}</select>
                          : f.type === 'bool'
                            ? <select value={fk.attributes?.[f.key] || ''} onChange={(e) => { if (f.key === 'dhcp') setFk((fd) => ({ ...fd, attributes: { ...(fd.attributes || {}), dhcp: e.target.value, ...(e.target.value === 'Sí' ? { ip: '' } : {}) } })); else setFkAttr(f.key, e.target.value) }}><option value="">—</option><option value="Sí">Sí</option><option value="No">No</option></select>
                            : isSecretField(f)
                              ? <SecretField value={fk.attributes?.[f.key] || ''} onChange={(e) => setFkAttr(f.key, e.target.value)} />
                              : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'} value={ipDisabled ? '' : (fk.attributes?.[f.key] || '')} disabled={ipDisabled} placeholder={f.type === 'url' ? 'https://…' : ipDisabled ? 'Automática (DHCP)' : undefined} onChange={(e) => setFkAttr(f.key, e.target.value)} />}
                      </div>
                    )
                  })}
                </div>}
              </>)}

              {subHead('asig', <><Icon n="user" /> Asignación</>)}
              {openSec.asig && <div className="pf-fields">
                <div style={{ gridColumn: '1 / -1' }}><label>¿A quién se asigna?</label>
                  <select value={assignMode} onChange={(e) => { setAssignMode(e.target.value); setManualAssign(false); setFk({ ...fk, assigned_to_name: '', assigned_to_email: '' }) }}>
                    <option value="user">A un usuario</option><option value="department">A un departamento</option>
                  </select>
                </div>
                {assignMode === 'department' ? (
                  <div><label>Departamento</label><select value={fk.assigned_to_name || ''} onChange={(e) => setFk({ ...fk, assigned_to_name: e.target.value, assigned_to_email: '' })}><option value="">—</option>{DEPTS.map((d) => <option key={d} value={d}>{deptIndentLabel(d)}</option>)}</select></div>
                ) : (<>
                  <div style={{ gridColumn: '1 / -1' }}><label>Asignar a (usuario)</label>
                    <select value={manualAssign ? '__manual__' : (fk.assigned_to_email || '')} onChange={(e) => {
                      const v = e.target.value
                      if (v === '__manual__') { setManualAssign(true); return }
                      setManualAssign(false)
                      const u = users.find((x) => x.email === v)
                      const hasCorreo = (section?.fields || []).some((f) => f.key === 'licencia_serie')
                      const hasCtaWin = (section?.fields || []).some((f) => f.key === 'cuenta_windows')
                      setFk((fd) => ({ ...fd, assigned_to_email: v, assigned_to_name: u ? (u.full_name || u.email) : '', attributes: { ...(fd.attributes || {}), ...(hasCorreo ? { licencia_serie: v } : {}), ...(hasCtaWin ? { cuenta_windows: v } : {}) } }))
                    }}>
                      <option value="">— Sin asignar</option>
                      {users.map((u) => <option key={u.id} value={u.email}>{(u.full_name || 'Sin nombre')} — {u.email}</option>)}
                      {fk.assigned_to_email && !users.some((u) => u.email === fk.assigned_to_email) && <option value={fk.assigned_to_email}>{fk.assigned_to_name || 'Actual'} — {fk.assigned_to_email} (actual)</option>}
                      <option value="__manual__">Escribir manualmente (externo)…</option>
                    </select>
                  </div>
                  {manualAssign && (<>
                    <div><label>Asignado a (nombre)</label><input value={fk.assigned_to_name || ''} onChange={(e) => setFk({ ...fk, assigned_to_name: e.target.value })} /></div>
                    <div><label>Correo asignado</label><input value={fk.assigned_to_email || ''} onChange={(e) => setFk({ ...fk, assigned_to_email: e.target.value })} placeholder="externo@dominio.com" /></div>
                  </>)}
                </>)}
              </div>}
              {subHead('soft', <><Icon n="save" /> Software y cuentas</>)}
              {openSec.soft && <>
              <div className="sw-field sw-field-inline" style={{ marginBottom: '.5rem' }}>
                <label>Antivirus</label>
                <select value={swForm.antivirus} onChange={(e) => setSwForm({ ...swForm, antivirus: e.target.value })}>{AV.map((a) => <option key={a} value={a}>{a || '—'}</option>)}</select>
              </div>
              <div className="sw-apps">
                {SW_APPS.map((a) => {
                  const st = swForm.apps?.[a.key] || {}
                  return (
                    <div className={`sw-app${st.on ? ' on' : ''}`} key={a.key}>
                      <label className="sw-app-head"><input type="checkbox" checked={!!st.on} onChange={(e) => setApp(a.key, { on: e.target.checked })} /> <strong>{a.label}</strong> <span className="muted">{st.on ? '· habilitado' : '· no habilitado'}</span></label>
                      {a.accounts && st.on && (
                        <div className="sw-app-acc">
                          <span className="muted" style={{ fontSize: '.76rem' }}>Cuentas / correos en {a.label}:</span>
                          <AcctPicker value={st.accounts || []} users={users} owner={{ email: eq.assigned_to_email, name: eq.assigned_to_name }} placeholder={`Correo en ${a.label}…`} onChange={(v) => setApp(a.key, { accounts: v })} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              </>}

              {(dirty || savingFk) && <div className="save-bar"><button className="btn btn-primary" onClick={saveAll} disabled={savingFk}>{savingFk ? 'Guardando…' : <><Icon n="save" /> Guardar cambios</>}</button></div>}
            </>) : (<>
              {(() => {
                const ph = (eq.attributes?.photos && eq.attributes.photos.length) ? eq.attributes.photos : (eq.image_url ? [eq.image_url] : [])
                return <PhotoCarousel photos={ph} />
              })()}
              <div className="pf-fields">
                {rows.map(([k, v, secret, type]) => (
                  <div className="pf-field" key={k}><label>{k}</label><div className="val">{
                    secret ? <SecretRead value={v} />
                      : (type === 'url' && v && v !== '—')
                        ? <a className="btn-sm btn-lime" style={{ textDecoration: 'none' }} href={/^https?:\/\//i.test(v) ? v : 'https://' + v} target="_blank" rel="noreferrer"><Icon n="link" /> Abrir enlace</a>
                        : (v || <span className="muted">—</span>)
                  }</div></div>
                ))}
              </div>
              <h4 className="det-sub"><Icon n="save" /> Software y cuentas</h4>
              <div className="sw-field sw-field-inline"><label>Antivirus</label><div className="val">{eq.antivirus || <span className="muted">—</span>}</div></div>
              <div className="sw-apps-read">
                {SW_APPS.map((a) => {
                  const st = (eq.attributes?.sw_apps || {})[a.key] || {}
                  return (
                    <div className="sw-field" key={a.key}>
                      <label>{a.label}</label>
                      <div className="val">{st.on ? <><Icon n="check" /> Habilitado</> : <span className="muted">— No habilitado</span>}
                        {a.accounts && (st.accounts || []).length ? <div className="chips" style={{ marginTop: '.3rem' }}>{(st.accounts || []).map((v) => <span className="chip" key={v}>{v}</span>)}</div> : null}</div>
                    </div>
                  )
                })}
              </div>
            </>)}
          </div>

          {/* Calendario de mantenimientos programados */}
          <div className={`section eq-cal${openCal ? ' open' : ''}`} style={{ marginTop: '1rem' }}>
            <button className="sec-head compact sec-toggle" onClick={() => setOpenCal((v) => !v)}>
              <span className="ico"><Icon n="calendar" /></span>
              <span className="t"><strong>Calendario de mantenimientos</strong><br /><span className="muted">{sched.length} programado(s) · aviso 2d / 1d / mismo día</span></span>
              <span className="chev">{openCal ? '▾' : '▸'}</span>
            </button>
            {openCal && <div className="sec-body">
              <div className="cal-wrap">
                <div className="cal">
                  <div className="cal-nav">
                    <button className="btn-sm" onClick={() => setCur(new Date(y, mo - 1, 1))}>‹</button>
                    <strong>{MONTHS[mo]} {y}</strong>
                    <button className="btn-sm" onClick={() => setCur(new Date(y, mo + 1, 1))}>›</button>
                  </div>
                  <div className="cal-grid cal-head-row">{WD.map((d) => <span key={d} className="cal-wd">{d}</span>)}</div>
                  <div className="cal-grid">
                    {cells.map((c, i) => {
                      const ci = isoLocal(c), out = c.getMonth() !== mo
                      const items = byDay[ci] || []
                      const isToday = ci === tISO, isSel = ci === mForm.date, isPast = ci < tISO
                      return (
                        <button key={i} type="button"
                          className={`cal-day${out ? ' out' : ''}${isToday ? ' today' : ''}${isSel ? ' sel' : ''}${items.length ? ' has' : ''}`}
                          disabled={!canManageInventory || isPast}
                          title={items.map((m) => m.event_type).join(', ')}
                          onClick={() => setMForm({ ...mForm, date: ci })}>
                          <span className="cd">{c.getDate()}</span>
                          {items.length > 0 && <span className="cal-dot">{items.length}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {canManageInventory && (
                  <div className="cal-form">
                    <div className="cf-title">Programar mantenimiento</div>
                    <label className="muted">Fecha</label>
                    <input type="date" min={tISO} value={mForm.date} onChange={(e) => setMForm({ ...mForm, date: e.target.value })} />
                    <label className="muted">Tipo</label>
                    <select value={mForm.event_type} onChange={(e) => setMForm({ ...mForm, event_type: e.target.value })}>{MANUAL_EVENTS.map((x) => <option key={x}>{x}</option>)}</select>
                    <label className="muted">Detalle (opcional)</label>
                    <input placeholder="Qué se hará…" value={mForm.note} onChange={(e) => setMForm({ ...mForm, note: e.target.value })} />
                    <button className="btn btn-lime btn-sm" style={{ marginTop: '.5rem' }} onClick={addMaint}>＋ Agendar</button>
                  </div>
                )}
              </div>

              {/* Próximos mantenimientos */}
              <div className="table-wrap" style={{ marginTop: '.8rem' }}><table>
                <thead><tr><th>Fecha</th><th>Faltan</th><th>Tipo</th><th>Detalle</th>{canManageInventory && <th></th>}</tr></thead>
                <tbody>
                  {sched.length === 0 && <tr><td colSpan={canManageInventory ? 5 : 4} className="muted" style={{ padding: '.8rem' }}>No hay mantenimientos programados.</td></tr>}
                  {sched.map((m) => {
                    const dl = daysLeft(m.scheduled_for)
                    const tag = dl < 0 ? { t: 'Vencido', c: 's-rejected' } : dl === 0 ? { t: 'HOY', c: 's-pending' } : dl === 1 ? { t: 'Mañana', c: 's-pending' } : { t: `${dl} días`, c: 's-approved' }
                    return (
                      <tr key={m.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtD(m.scheduled_for)}</td>
                        <td><span className={`badge ${tag.c}`}>{tag.t}</span></td>
                        <td><span className="badge">{m.event_type}</span></td>
                        <td>{m.note || <span className="muted">—</span>}</td>
                        {canManageInventory && <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn-sm btn-lime" title="Marcar realizado" onClick={() => completeMaint(m.id)}><Icon n="check" /></button>
                          <button className="btn-sm btn-danger" title="Cancelar" onClick={() => delMaint(m.id)}><Icon n="close" /></button>
                        </td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
            </div>}
          </div>

          {/* Bitácora de mantenimiento */}
          <div className={`section eq-events${openBita ? ' open' : ''}`} style={{ marginTop: '1rem' }}>
            <button className="sec-head compact sec-toggle" onClick={() => setOpenBita((v) => !v)}>
              <span className="ico"><Icon n="wrench" /></span>
              <span className="t"><strong>Bitácora de mantenimiento</strong><br /><span className="muted">{events.length} registro(s) realizados</span></span>
              <span className="chev">{openBita ? '▾' : '▸'}</span>
            </button>
            {openBita && <div className="sec-body">
              {canManageInventory && (
                <div className="cat-row" style={{ borderBottom: '1px solid var(--line)', paddingBottom: '.7rem', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>{MANUAL_EVENTS.map((x) => <option key={x}>{x}</option>)}</select>
                  <input style={{ flex: 1, minWidth: 180 }} placeholder="Detalle (qué se hizo, quién, observaciones…)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                  <label className="btn-sm" style={{ cursor: 'pointer' }}><Icon n="camera" /> Fotos
                    <input type="file" accept="image/*" multiple hidden onChange={(ev) => { addFormImages(ev.target.files); ev.target.value = '' }} />
                  </label>
                  <button className="btn-sm" type="button" onClick={() => pasteImagesInto(addFormImages)}><Icon n="clipboard" /> Pegar</button>
                  <button className="btn btn-lime btn-sm" onClick={addEvent}>Registrar</button>
                  {form.images.length > 0 && (
                    <div style={{ flexBasis: '100%', display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
                      {form.images.map((src, k) => (
                        <div key={k} style={{ position: 'relative' }}>
                          <img className="ins-thumb" src={src} alt="" />
                          <button type="button" title="Quitar" onClick={() => setForm((fm) => ({ ...fm, images: fm.images.filter((_, j) => j !== k) }))}
                            style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--danger)', color: '#fff', fontSize: '.7rem', lineHeight: 1, cursor: 'pointer' }}><Icon n="close" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="table-wrap"><table>
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Responsable</th>{canManageInventory && <th></th>}</tr></thead>
                <tbody>
                  {events.length === 0 && <tr><td colSpan={canManageInventory ? 5 : 4} className="muted" style={{ padding: '.8rem' }}>Sin registros de mantenimiento.</td></tr>}
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(ev.at)}</td>
                      <td><span className="badge">{ev.event_type}</span></td>
                      <td>{ev.note || <span className="muted">—</span>}
                        {(ev.images && ev.images.length > 0) ? <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
                          {ev.images.map((src, k) => <img key={k} className="ins-thumb" src={src} alt="foto" loading="lazy" decoding="async" onClick={() => viewImage(src)} />)}
                        </div> : null}</td>
                      <td>{ev.actor_name}</td>
                      {canManageInventory && <td className="actions">{String(ev.id).startsWith('tmp-') ? <span className="muted">…</span> : <>
                        <button className="btn-sm" onClick={() => openEditEv(ev)}>Editar</button>
                        <button className="btn-sm btn-danger" onClick={() => delEvent(ev.id)}><Icon n="close" /></button>
                      </>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>}
          </div>
        </div>

        <div className="eq-qr">
          <div style={{ fontWeight: 600, marginBottom: '.5rem' }}>QR del equipo</div>
          <img src={qr} alt="QR del equipo" />
          <p className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem', maxWidth: 200 }}>Escanéalo para abrir esta ficha. Requiere sesión con acceso al inventario.</p>
          <div className="eq-qr-btns">
            <button className="btn btn-sm" onClick={() => printQR(qr, `${eq.name} ${eq.brand || ''} ${eq.model || ''}`.trim(), eq.assigned_to_name || '')}><Icon n="printer" /> Imprimir</button>
            <a className="btn btn-sm" href={qr} download={`qr-${eq.asset_tag || eq.serial_number || eq.id}.png`} target="_blank" rel="noreferrer"><Icon n="download" /> Descargar</a>
          </div>
        </div>
      </div>

      {editEv && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Editar entrada de bitácora</h3>
            <label>Tipo</label>
            <select value={editEv.event_type} onChange={(e) => setEditEv({ ...editEv, event_type: e.target.value })}>{[...new Set([editEv.event_type, ...MANUAL_EVENTS])].map((x) => <option key={x}>{x}</option>)}</select>
            <label>Detalle</label>
            <textarea value={editEv.note} onChange={(e) => setEditEv({ ...editEv, note: e.target.value })} placeholder="Qué se hizo, quién, observaciones…" style={{ minHeight: 70 }} />
            <label>Fotos</label>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {editEv.images.map((src, k) => (
                <div key={k} style={{ position: 'relative' }}>
                  <img className="ins-thumb" src={src} alt="" onClick={() => viewImage(src)} />
                  <button type="button" title="Quitar" onClick={() => setEditEv((e) => ({ ...e, images: e.images.filter((_, j) => j !== k) }))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--danger)', color: '#fff', fontSize: '.7rem', lineHeight: 1, cursor: 'pointer' }}><Icon n="close" /></button>
                </div>
              ))}
              <label className="btn-sm" style={{ cursor: 'pointer' }}><Icon n="camera" /> Agregar fotos
                <input type="file" accept="image/*" multiple hidden onChange={(ev) => { addEditImages(ev.target.files); ev.target.value = '' }} />
              </label>
              <button className="btn-sm" type="button" onClick={() => pasteImagesInto(addEditImages)}><Icon n="clipboard" /> Pegar</button>
            </div>
            <div className="modal-actions"><button className="btn" onClick={() => setEditEv(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveEditEv}>Guardar cambios</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
