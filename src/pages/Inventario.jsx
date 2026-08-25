import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import ActivityLog from '../components/ActivityLog'
import { confirmDialog, alertDialog, viewImage } from '../lib/ui'
import ImagePicker from '../components/ImagePicker'
import SortControl from '../components/SortControl'
import FilterControl from '../components/FilterControl'
import { loadDeptNames, DEFAULT_DEPTS, deptIndentLabel } from '../lib/depts'
import { Icon, sectionIconName } from '../lib/icons'
import { SkeletonKpis, SkeletonRows } from '../components/Skeleton'

const CONDS = ['Bueno', 'Regular', 'Sin asignar', 'En mantenimiento', 'De baja']
const LOCS = ['CM', 'Remoto', 'CM/Remoto']
const COUNTRIES = [['Chile', 'CL'], ['Perú', 'PE'], ['Colombia', 'CO']]
const normc = (s) => (s || '').trim().toLowerCase()
const AV = ['', 'Activo', 'Inactivo', 'No aplica']
const BRANDS = ['HP', 'Lenovo', 'Apple', 'Dell', 'Asus', 'Acer', 'Microsoft', 'Samsung', 'Huawei', 'LG', 'MSI', 'Brother', 'Epson', 'Canon', 'Xiaomi', 'Otra']
const FIELD_TYPES = [['text', 'Texto'], ['number', 'Número'], ['date', 'Fecha'], ['select', 'Lista de opciones'], ['bool', 'Sí / No'], ['email', 'Correo']]
const slug = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('f' + Math.random().toString(36).slice(2, 6))
const emptyEquip = (section_id) => ({ name: '', brand: '', model: '', serial_number: '', asset_tag: '', location: '', condition: 'Bueno', antivirus: '', assigned_to_name: '', assigned_to_email: '', section_id, attributes: {}, image_url: '' })

export default function Inventario() {
  const nav = useNavigate()
  const { canManageInventory, isAdmin, profile } = useAuth()
  const [country, setCountry] = useState('Chile')      // país (sector) seleccionado
  const countryInit = useRef(false)
  useEffect(() => { if (profile && !countryInit.current) { countryInit.current = true; if (profile.country) setCountry(profile.country) } }, [profile])
  const [cfg, setCfg] = useState(null)            // configuración de mantenimientos
  const [DEPTS, setDEPTS] = useState(DEFAULT_DEPTS)
  useEffect(() => { loadDeptNames().then(setDEPTS) }, [])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [open, setOpen] = useState({})           // secciones desplegadas
  const [edit, setEdit] = useState(null)          // equipo en edición
  const [schemaEdit, setSchemaEdit] = useState(null) // tipo/esquema en edición
  const [showSchemas, setShowSchemas] = useState(false)
  const [users, setUsers] = useState([])          // perfiles para asignar
  const [manualAssign, setManualAssign] = useState(false)
  const [assignMode, setAssignMode] = useState('user') // 'user' | 'department' (por registro)
  const [view, setView] = useState('equipos')     // 'equipos' | 'accesos'
  const [sortBy, setSortBy] = useState('recent')   // 'az' | 'recent' — por defecto, más recientes
  const [folderQ, setFolderQ] = useState({})       // búsqueda por carpeta
  const [folderSort, setFolderSort] = useState({}) // criterio de orden por carpeta
  const [folderDir, setFolderDir] = useState({})   // dirección por carpeta
  const [folderFilter, setFolderFilter] = useState({}) // filtros por carpeta { cond, asig }
  const [cfgOpen, setCfgOpen] = useState(false)    // config de mantenimientos desplegada
  const [openLote, setOpenLote] = useState({})     // lotes desplegados
  // Periféricos (por cantidad + asignación por usuario)
  const [periphs, setPeriphs] = useState([])
  const [periphAssign, setPeriphAssign] = useState([])
  const [periphForm, setPeriphForm] = useState(null)   // modal crear/editar periférico
  const [openPeriph, setOpenPeriph] = useState({})     // filas expandidas
  const [pSel, setPSel] = useState({})                 // { [periphId]: { user, qty } }
  const [openStock, setOpenStock] = useState({})       // filas de stock expandidas
  const mantRefs = useRef({})                      // refs para desplazar a cada lote/zona
  const focusZone = (key) => {
    setOpenLote((o) => ({ ...o, [key]: true }))
    setTimeout(() => mantRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 70)
  }
  // Secciones que son claves/credenciales (van en la carpeta "Accesos y claves")
  const CRED = useMemo(() => new Set(['Servicios y accesos admin', 'Redes WiFi', 'Correos y cuentas']), [])
  // Filtra (búsqueda + filtros) y ordena las filas de una carpeta según sus controles propios
  const filterSortRows = (rows, key) => {
    const q = (folderQ[key] || '').trim().toLowerCase()
    const f = folderFilter[key] || {}
    let arr = rows.filter((e) => !q || `${e.name || ''} ${e.brand || ''} ${e.model || ''} ${e.serial_number || ''} ${e.location || ''} ${e.assigned_to_name || ''} ${e.assigned_to_email || ''}`.toLowerCase().includes(q))
    if (f.cond) arr = arr.filter((e) => e.condition === f.cond)
    if (f.asig === 'asignado') arr = arr.filter((e) => e.assigned_to_name || e.assigned_to_email)
    else if (f.asig === 'sin') arr = arr.filter((e) => !(e.assigned_to_name || e.assigned_to_email))
    const field = folderSort[key] || 'recent'
    const dir = folderDir[key] || (field === 'recent' ? 'desc' : 'asc')
    const cmp = (a, b) => {
      if (field === 'name') return `${a.name || ''} ${a.brand || ''}`.localeCompare(`${b.name || ''} ${b.brand || ''}`, 'es', { sensitivity: 'base' })
      if (field === 'assigned') return (a.assigned_to_name || a.assigned_to_email || '').localeCompare(b.assigned_to_name || b.assigned_to_email || '', 'es', { sensitivity: 'base' })
      return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    }
    const sorted = [...arr].sort(cmp)
    return dir === 'desc' ? sorted.reverse() : sorted
  }

  const load = useCallback(async () => {
    const [{ data: secs }, { data: eq }, { data: us }, { data: per }, { data: pa }] = await Promise.all([
      supabase.from('equipment_sections').select('id,name,icon,fields,assign_to').order('name'),
      supabase.from('equipment').select('id,name,brand,model,serial_number,asset_tag,location,condition,antivirus,assigned_to_name,assigned_to_email,section_id,attributes,image_url,created_at,user_id').is('returned_at', null).order('name'),
      supabase.from('profiles').select('id,full_name,email,department,active,country,role,app_access').order('full_name'),
      supabase.from('peripherals').select('id,name,model,buy_link,total_qty').order('name'),
      supabase.from('peripheral_assignments').select('peripheral_id,user_id,user_name,user_email,qty'),
    ])
    setSections(secs ?? []); setItems(eq ?? []); setUsers(us ?? [])
    setPeriphs(per ?? []); setPeriphAssign(pa ?? [])
    const { data: mc } = await supabase.from('maint_config').select('*').maybeSingle()
    if (mc) setCfg(mc)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  // Al abrir/cerrar el modal de equipo, parte con el selector (no modo manual)
  useEffect(() => {
    setManualAssign(false)
    // El modo de asignación arranca según el tipo de sección, pero es editable por registro:
    // si el registro ya tiene un correo asignado es un usuario; si no y la sección es por depto, departamento.
    const sec = sections.find((x) => x.id === edit?.section_id)
    setAssignMode(edit?.assigned_to_email ? 'user' : (sec?.assign_to === 'department' ? 'department' : 'user'))
  }, [edit?.id, edit?.section_id, sections])

  // ===== País (sector): cada equipo pertenece al país de su usuario asignado; el stock lleva attributes.pais =====
  const usersByEmail = useMemo(() => { const m = {}; users.forEach((u) => { const k = normc(u.email); if (k) m[k] = u }); return m }, [users])
  const usersById = useMemo(() => { const m = {}; users.forEach((u) => { m[u.id] = u }); return m }, [users])
  const countryOf = useCallback((e) => {
    const em = normc(e.assigned_to_email)
    const u = (em && usersByEmail[em]) || (e.user_id && usersById[e.user_id])
    if (u) return u.country || 'Chile'
    return e.attributes?.pais || 'Chile'   // stock sin asignar / usuario externo / departamento
  }, [usersByEmail, usersById])
  // Solo el rol admin puede recorrer los 3 países; el resto queda fijado a su propio país
  const myCountry = profile?.country || 'Chile'
  const fixedCountry = !isAdmin
  const effCountry = fixedCountry ? myCountry : country
  // Equipos del país seleccionado (base de todo lo que se muestra abajo)
  const fItems = useMemo(() => items.filter((e) => countryOf(e) === effCountry), [items, effCountry, countryOf])
  // Usuarios del país seleccionado (no aparecen los de otros países ni las cuentas solo-organización sin acceso)
  const countryUsers = useMemo(() => users.filter((u) => u.app_access !== false && (u.country || 'Chile') === effCountry), [users, effCountry])
  const countryUserIds = useMemo(() => new Set(countryUsers.map((u) => u.id)), [countryUsers])
  const bySection = useMemo(() => {
    const g = {}; fItems.forEach((e) => { (g[e.section_id] = g[e.section_id] || []).push(e) }); return g
  }, [fItems])
  const secRefs = useRef({})
  const openOnlyAndScroll = (id) => {
    setOpen({ [id]: true })
    setTimeout(() => secRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  const secById = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s])), [sections])
  // Tarjeta de datos faltantes seleccionada
  const [gapSel, setGapSel] = useState(null)
  const [credSel, setCredSel] = useState(null)
  const [sinAsigOpen, setSinAsigOpen] = useState(false)  // detalle de la tarjeta "Sin asignar"
  const [mantOpen, setMantOpen] = useState(false)        // detalle de la tarjeta "En mantenimiento"
  const compSection = useMemo(() => sections.find((s) => s.name === 'Computadores'), [sections])
  // Personas sin computador asignado (match por correo o nombre)
  const noPc = useMemo(() => {
    const norm = (s) => (s || '').trim().toLowerCase()
    const comps = compSection ? (bySection[compSection.id] || []) : []
    // Los usuarios deshabilitados (active === false) no cuentan como "sin computador"
    return countryUsers.filter((u) => u.active !== false).filter((u) => !comps.some((c) => (c.user_id && c.user_id === u.id) || norm(c.assigned_to_email) === norm(u.email) || (u.full_name && norm(c.assigned_to_name) === norm(u.full_name))))
  }, [countryUsers, bySection, compSection])
  // Datos faltantes en el registro de equipos físicos (campos base + de esquema)
  const gaps = useMemo(() => {
    const map = {}
    const add = (key, label, e) => { (map[key] = map[key] || { key, label, items: [] }).items.push(e) }
    fItems.forEach((e) => {
      const s = secById[e.section_id]
      if (!s || CRED.has(s.name)) return
      const dept = s.assign_to === 'department'
      // "Sin asignar" se muestra en la tarjeta de resumen de arriba, no aquí
      if (dept && !e.assigned_to_name) add('sin_depto', 'Sin departamento', e)
      if (!e.brand) add('sin_marca', 'Sin marca', e)
      if (!e.model) add('sin_modelo', 'Sin modelo', e)
      if (!e.serial_number) add('sin_serie', 'Sin identificador de dispositivo', e)
      if (!e.location) add('sin_ubicacion', 'Sin ubicación', e)
      if (s.name === 'Computadores' && !(e.antivirus || '').trim()) add('sin_av', 'Sin antivirus', e)
      ;(s.fields || []).forEach((f) => {
        // La IP no cuenta como faltante si el equipo está en DHCP (es automática)
        if (f.key === 'ip' && e.attributes?.dhcp === 'Sí') return
        const v = e.attributes?.[f.key]
        if (!v || String(v).trim() === '') add('f_' + f.key, 'Sin ' + f.label.toLowerCase(), e)
      })
    })
    return map
  }, [fItems, secById, CRED])
  // Casos por revisar: posibles duplicados / doble equipo (series repetidas o cuenta de Windows compartida)
  const cases = useMemo(() => {
    const comps = compSection ? (bySection[compSection.id] || []) : []
    const list = []
    const bySerial = {}
    comps.forEach((e) => { const k = (e.serial_number || '').trim().toLowerCase(); if (k) (bySerial[k] = bySerial[k] || []).push(e) })
    Object.values(bySerial).forEach((arr) => {
      if (arr.length > 1) list.push({ key: 'serie:' + arr[0].serial_number, nota: `Serie "${arr[0].serial_number}" repetida en ${arr.length} equipos — misma máquina física en varias fichas (posible copia).`, items: arr })
    })
    const byCta = {}
    comps.forEach((e) => { const k = (e.attributes?.cuenta_windows || '').trim().toLowerCase(); if (k) (byCta[k] = byCta[k] || []).push(e) })
    Object.values(byCta).forEach((arr) => {
      // Distintas personas (por correo, con respaldo en el nombre). Si son de la misma persona, no es un caso.
      const persons = [...new Set(arr.map((e) => (e.assigned_to_email || e.assigned_to_name || '').trim().toLowerCase()).filter(Boolean))]
      if (arr.length > 1 && persons.length > 1) {
        const names = [...new Set(arr.map((e) => e.assigned_to_name).filter(Boolean))]
        list.push({ key: 'cta:' + (arr[0].attributes.cuenta_windows), nota: `${arr.length} equipos de distintas personas comparten la cuenta de Windows "${arr[0].attributes.cuenta_windows}"${names.length ? ` (${names.join(', ')})` : ''} — revisar.`, items: arr })
      }
    })
    return list
  }, [bySection, compSection])
  // Lista de tarjetas de datos faltantes (personas + dispositivos + casos), ordenadas por cantidad.
  // Cada tarjeta lleva un nivel de severidad por color según la proporción de la flota afectada:
  //   crit (rojo) ≥40% · warn (ámbar) ≥15% · info (azul) el resto. Así se ve de un vistazo qué apremia.
  const gapCards = useMemo(() => {
    const devTotal = fItems.filter((e) => { const s = secById[e.section_id]; return s && !CRED.has(s.name) }).length || 1
    const sev = (n, denom) => { const r = n / (denom || 1); return r >= 0.4 ? 'crit' : r >= 0.15 ? 'warn' : 'info' }
    const cards = []
    if (noPc.length) cards.push({ key: 'no_pc', icon: 'ban', label: 'Sin computador', n: noPc.length, kind: 'people', sev: sev(noPc.length, countryUsers.length) })
    Object.values(gaps).sort((a, b) => b.items.length - a.items.length).forEach((g) => cards.push({ key: g.key, icon: 'alert', label: g.label, n: g.items.length, kind: 'dev', sev: sev(g.items.length, devTotal) }))
    if (cases.length) cards.push({ key: 'casos', icon: 'folder', label: 'Casos por revisar', n: cases.length, kind: 'cases', sev: 'warn' })
    return cards
  }, [noPc, gaps, cases, fItems, secById, CRED, countryUsers])
  // Datos faltantes en Accesos y claves (contraseña, asignación, usuario)
  const credGaps = useMemo(() => {
    const map = {}
    const add = (key, label, e) => { (map[key] = map[key] || { key, label, items: [] }).items.push(e) }
    items.forEach((e) => {
      const s = secById[e.section_id]
      if (!s || !CRED.has(s.name)) return
      if (!(e.attributes?.contrasena || '').trim()) add('sin_pass', 'Sin contraseña', e)
      if (s.name !== 'Redes WiFi' && !(e.assigned_to_name || e.assigned_to_email)) add('sin_asig', 'Sin asignar', e)
      if (s.name === 'Servicios y accesos admin' && !(e.attributes?.usuario || '').trim()) add('sin_user', 'Sin usuario', e)
    })
    return map
  }, [items, secById, CRED])
  const credCards = useMemo(() => Object.values(credGaps).sort((a, b) => b.items.length - a.items.length).map((g) => ({ key: g.key, icon: 'alert', label: g.label, n: g.items.length })), [credGaps])
  // Secciones visibles según la carpeta seleccionada (Equipos vs Accesos y claves; vacío en Mantenimientos)
  const visibleSections = useMemo(
    () => ((view === 'mant' || view === 'perif' || view === 'stock') ? [] : sections.filter((s) => !CRED.has(s.name))),
    [sections, view, CRED]
  )
  // Stock disponible: equipos SIN asignar agrupados por su tipo (sección)
  const stockEquip = useMemo(() => sections
    .filter((s) => !CRED.has(s.name))
    .map((s) => {
      const list = (bySection[s.id] || []).filter((e) => !(e.assigned_to_name || e.assigned_to_email))
      return { id: s.id, name: s.name, icon: s.icon, items: list, n: list.length }
    })
    .filter((g) => g.n > 0), [sections, bySection, CRED])
  // Periféricos: cantidad asignada y miembros por periférico (solo usuarios del país seleccionado)
  const cPeriphAssign = useMemo(() => periphAssign.filter((a) => countryUserIds.has(a.user_id)), [periphAssign, countryUserIds])
  const periphAsg = useMemo(() => { const m = {}; cPeriphAssign.forEach((a) => { m[a.peripheral_id] = (m[a.peripheral_id] || 0) + (a.qty || 0) }); return m }, [cPeriphAssign])
  const periphMembers = useMemo(() => { const m = {}; cPeriphAssign.forEach((a) => { (m[a.peripheral_id] = m[a.peripheral_id] || []).push(a) }); return m }, [cPeriphAssign])
  const savePeriph = async () => {
    if (!(periphForm.name || '').trim()) return alertDialog('Ponle un nombre al periférico.')
    try { await api('peripheral_upsert', { p: { ...periphForm, total_qty: Number(periphForm.total_qty) || 0 } }); setPeriphForm(null); load() } catch (e) { alertDialog(e.message) }
  }
  const delPeriph = async (p) => {
    if (!(await confirmDialog(`¿Eliminar "${p.name}"? Se quitan también sus asignaciones.`, { title: 'Eliminar periférico', danger: true, okText: 'Eliminar' }))) return
    try { await api('peripheral_delete', { p_id: p.id }); load() } catch (e) { alertDialog(e.message) }
  }
  const assignPeriph = async (periphId, userId, qty) => {
    if (!userId) return
    try { await api('peripheral_assign', { p_peripheral: periphId, p_user: userId, p_qty: Number(qty) || 0 }); load() } catch (e) { alertDialog(e.message) }
  }
  const viewCount = useMemo(
    () => visibleSections.reduce((n, s) => n + (bySection[s.id] || []).length, 0),
    [visibleSections, bySection]
  )
  // Equipos sin asignar (de las secciones visibles) — para la tarjeta de resumen
  const sinAsignarItems = useMemo(() => {
    const visIds = new Set(visibleSections.map((s) => s.id))
    return fItems.filter((e) => visIds.has(e.section_id) && !(e.assigned_to_name || e.assigned_to_email))
  }, [fItems, visibleSections])
  // Equipos en mantenimiento (de las secciones visibles) — para la tarjeta de resumen
  const enMantItems = useMemo(() => {
    const visIds = new Set(visibleSections.map((s) => s.id))
    return fItems.filter((e) => visIds.has(e.section_id) && e.condition === 'En mantenimiento')
  }, [fItems, visibleSections])
  const switchView = (v) => { setView(v); setOpen({}) }

  // ===== Mantenimientos programados =====
  const comps = useMemo(() => (compSection ? (bySection[compSection.id] || []) : []), [compSection, bySection])
  const nLotes = useMemo(() => Math.max(1, Math.ceil(comps.length / (cfg?.batch_size || 5))), [comps, cfg])
  const loteOf = (e) => { const v = parseInt(e.attributes?.maint_lote, 10); return Number.isFinite(v) ? v : null }
  const addDays = (iso, d) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + d); return t }
  const fmtD = (dt) => dt.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
  const loteWindow = (L) => {
    if (!cfg?.start_date) return '—'
    const ini = addDays(cfg.start_date, (L - 1) * (cfg.gap_weeks || 2) * 7)
    const fin = new Date(ini); fin.setDate(fin.getDate() + Math.max(0, (cfg.window_days || 4) - 1))
    return `${fmtD(ini)} → ${fmtD(fin)}`
  }
  const setLote = (id, lote) => {
    setItems((its) => its.map((x) => x.id === id ? { ...x, attributes: { ...(x.attributes || {}), ...(lote ? { maint_lote: lote } : {}) } } : x))
    if (!lote) setItems((its) => its.map((x) => { if (x.id !== id) return x; const a = { ...(x.attributes || {}) }; delete a.maint_lote; return { ...x, attributes: a } }))
    api('maint_set_lote', { p_id: id, p_lote: lote }).catch((e) => alertDialog(e.message)).finally(load)
  }
  const saveMaintCfg = async () => { try { await api('maint_set_config', { p: cfg }); alertDialog('Configuración guardada.'); load() } catch (e) { alertDialog(e.message) } }
  const autoDistribute = async () => {
    if (!(await confirmDialog('¿Auto-repartir todos los computadores en grupos? Nunca pone 2 equipos de la misma persona en el mismo grupo. Puedes ajustar después.', { title: 'Auto-repartir en grupos', okText: 'Repartir' }))) return
    const cap = cfg?.batch_size || 5
    const byPerson = {}
    comps.forEach((e) => { const k = e.assigned_to_name || ('id:' + e.id); (byPerson[k] = byPerson[k] || []).push(e) })
    const NL = Math.max(1, Math.ceil(comps.length / cap))
    const lotes = Array.from({ length: NL }, () => [])
    const map = {}
    Object.keys(byPerson).sort((a, b) => byPerson[b].length - byPerson[a].length).forEach((p) => {
      byPerson[p].forEach((e) => {
        const cand = lotes.map((l, i) => i).filter((i) => lotes[i].length < cap && !lotes[i].some((x) => (x.assigned_to_name || ('id:' + x.id)) === p))
        cand.sort((a, b) => lotes[a].length - lotes[b].length)
        const idx = cand.length ? cand[0] : lotes.map((l, i) => i).sort((a, b) => lotes[a].length - lotes[b].length)[0]
        lotes[idx].push(e); map[e.id] = idx + 1
      })
    })
    try { await api('maint_set_lotes', { p: map }); load() } catch (e) { alertDialog(e.message) }
  }
  const genProgram = async () => {
    if (!(await confirmDialog(`¿Generar la programación de los próximos ${cfg?.horizon_years || 3} año(s)? Se crean los mantenimientos de cada equipo con su grupo (avisos 2 días / 1 día antes / el día). Se regenera si ya existía.`, { title: 'Generar programación', okText: 'Generar' }))) return
    try { const r = await api('maint_generate', {}); alertDialog(`Programación generada: ${r ?? 0} mantenimientos creados.`); load() } catch (e) { alertDialog(e.message) }
  }
  const clearProgram = async () => {
    if (!(await confirmDialog('¿Borrar la programación automática futura? (No afecta los mantenimientos cargados a mano)', { title: 'Limpiar programación', danger: true, okText: 'Borrar' }))) return
    try { const r = await api('maint_clear', {}); alertDialog(`Se borraron ${r ?? 0} mantenimientos programados.`); load() } catch (e) { alertDialog(e.message) }
  }

  const saveEquip = async () => {
    if (!(edit.name || '').trim()) return alertDialog('Indica el tipo/nombre del equipo.')
    const s = secById[edit.section_id]
    for (const f of (s?.fields || [])) {
      if (f.required && !String(edit.attributes?.[f.key] ?? '').trim()) return alertDialog(`El campo "${f.label}" es obligatorio.`)
    }
    try { await api('equipment_upsert', { p: edit }); setEdit(null); load() } catch (e) { alertDialog(e.message) }
  }
  const delEquip = async (e) => {
    if (!(await confirmDialog(`¿Estás seguro de eliminar "${e.name} ${e.brand} ${e.model}"?\nEsta acción no se puede deshacer.`, { title: 'Eliminar equipo', danger: true, okText: 'Sí, eliminar', cancelText: 'No, cancelar' }))) return
    setItems((its) => its.filter((x) => x.id !== e.id))
    try { await api('equipment_delete', { p_id: e.id }) } catch (er) { alertDialog(er.message) } finally { load() }
  }
  const saveSchema = async () => {
    const s = schemaEdit
    if (!(s.name || '').trim()) return alertDialog('Ponle un nombre al tipo de equipo.')
    const fields = (s.fields || []).filter((f) => (f.label || '').trim()).map((f) => {
      const o = { key: f.key || slug(f.label), label: f.label.trim(), type: f.type || 'text' }
      if (o.type === 'select') o.options = (f.optionsText || '').split(',').map((x) => x.trim()).filter(Boolean)
      if (f.required) o.required = true
      return o
    })
    try { await api('section_upsert', { p: { id: s.id, name: s.name.trim(), icon: s.icon || '', assign_to: s.assign_to || 'user', fields } }); setSchemaEdit(null); load() } catch (e) { alertDialog(e.message) }
  }
  const delSchema = async (s) => {
    if (!(await confirmDialog(`¿Eliminar el tipo "${s.name}"? Los equipos de este tipo quedarán sin categoría.`, { title: 'Eliminar tipo de equipo', danger: true, okText: 'Eliminar' }))) return
    try { await api('section_delete', { p_id: s.id }); load() } catch (e) { alertDialog(e.message) }
  }

  const openSchema = (s) => setSchemaEdit(s
    ? { ...s, fields: (s.fields || []).map((f) => ({ ...f, optionsText: (f.options || []).join(', ') })) }
    : { name: '', icon: '', assign_to: 'user', fields: [] })
  // Duplica un tipo existente (sin id -> se crea uno nuevo)
  const dupSchema = (s) => setSchemaEdit({
    name: `${s.name} (copia)`, icon: s.icon || '', assign_to: s.assign_to || 'user',
    fields: (s.fields || []).map((f) => ({ ...f, optionsText: (f.options || []).join(', ') })),
  })
  const moveField = (i, dir) => setSchemaEdit((se) => {
    const fs = [...se.fields]; const j = i + dir
    if (j < 0 || j >= fs.length) return se
    const t = fs[i]; fs[i] = fs[j]; fs[j] = t
    return { ...se, fields: fs }
  })

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Inventario de la empresa</h2><p className="muted">Cada tipo de equipo tiene su propio esquema de datos. Toca una tarjeta para desplegarla.</p></div>
        <button className="btn" onClick={() => setShowSchemas((v) => !v)}><Icon n="gear" /> Tipos de equipo</button>
      </div></div>

      {/* ==== Sector por país ==== */}
      <div className="country-tabs">
        {COUNTRIES.map(([c, flag]) => {
          const on = effCountry === c
          const locked = fixedCountry && c !== myCountry
          return (
            <button key={c} className={`country-tab ${on ? 'on' : ''}`} disabled={locked}
              title={locked ? 'Solo el rol Administración puede ver otros países' : `Ver inventario de ${c}`}
              onClick={() => setCountry(c)}>
              <span className="cflag">{flag}</span><span className="cname">{c}</span>
            </button>
          )
        })}
        {fixedCountry && <span className="muted" style={{ fontSize: '.74rem', alignSelf: 'center' }}>Ves el inventario de tu país. El rol Administración puede ver los tres.</span>}
      </div>

      {/* ==== Carpetas: Equipos vs Accesos y claves ==== */}
      <div className="row" style={{ display: 'flex', alignItems: 'center', margin: '.4rem 0 .6rem', gap: '1rem', flexWrap: 'wrap', width: '100%' }}>
        <div className="seg">
          <button className={`seg-btn ${view === 'equipos' ? 'on' : ''}`} onClick={() => switchView('equipos')}><Icon n="monitor" /> Equipos</button>
          <button className={`seg-btn ${view === 'perif' ? 'on' : ''}`} onClick={() => switchView('perif')}><Icon n="mouse" /> Periféricos</button>
          <button className={`seg-btn ${view === 'stock' ? 'on' : ''}`} onClick={() => switchView('stock')}><Icon n="layers" /> Stock</button>
          {canManageInventory && <button className={`seg-btn ${view === 'mant' ? 'on' : ''}`} onClick={() => switchView('mant')}><Icon n="wrench" /> Mantenimientos</button>}
        </div>
      </div>

      {/* ==== Pestaña Mantenimientos ==== */}
      {view === 'mant' && (() => {
        const sinLote = comps.filter((e) => !loteOf(e))
        const conLote = comps.length - sinLote.length
        const lotesConEq = Array.from({ length: nLotes }, (_, i) => i + 1).filter((L) => comps.some((e) => loteOf(e) === L))
        const firstLote = lotesConEq[0] || 1
        const proximo = lotesConEq.length ? loteWindow(lotesConEq[0]).split(' → ')[0] : '—'
        const loteSelect = (e, val) => (
          <select value={val} onChange={(ev) => setLote(e.id, ev.target.value ? Number(ev.target.value) : null)}>
            <option value="">— sin grupo</option>
            {Array.from({ length: nLotes }).map((_, k) => <option key={k + 1} value={k + 1}>Grupo {k + 1}</option>)}
          </select>
        )
        return (
        <div>
          {/* Tarjetas resumen — tocar una te lleva a su zona */}
          <div className="kpi-grid compact">
            <button className="kpi kpi-all" onClick={() => focusZone(firstLote)} title="Todos los computadores · ir a los grupos"><span className="ico"><Icon n="monitor" /></span><div><div className="num">{comps.length}</div><div className="lbl">Computadores</div></div></button>
            <button className="kpi" onClick={() => focusZone(firstLote)} title="Equipos ya incluidos en la programación de mantenimiento"><div className="ico"><Icon n="wrench" /></div><div className="num">{conLote}</div><div className="lbl">En mantenimiento</div></button>
            <button className="kpi" onClick={() => focusZone(firstLote)} title="Próxima ventana de mantenimiento programada"><div className="ico"><Icon n="calendar" /></div><div className="num" style={{ fontSize: '1rem' }}>{proximo}</div><div className="lbl">Próximo</div></button>
            <button className="kpi" onClick={() => focusZone(1)} title="Ver los grupos de mantenimiento"><div className="ico"><Icon n="folder" /></div><div className="num">{nLotes}</div><div className="lbl">Grupos</div></button>
            <button className={`kpi ${openLote.sin ? 'active' : ''}`} onClick={() => focusZone('sin')} title="Equipos que aún no entran en la programación"><div className="ico"><Icon n="alert" /></div><div className="num">{sinLote.length}</div><div className="lbl">Sin grupo</div></button>
          </div>

          {/* Configuración (desplegable) */}
          <div className={`section ${cfgOpen ? 'open' : ''}`} style={{ marginBottom: '.6rem' }}>
            <button className="sec-head compact" onClick={() => setCfgOpen((v) => !v)}>
              <span className="ico"><Icon n="gear" /></span>
              <span className="t"><strong>Configuración de la programación</strong><br /><span className="muted">cada {cfg?.freq_months || 3} meses · {cfg?.batch_size || 5} por grupo · {cfg?.window_days || 4} día(s) · {cfg?.horizon_years || 3} años</span></span>
              <span className="chev">▾</span>
            </button>
            {cfgOpen && <div className="sec-body">
              {cfg ? (<>
                <div className="pf-fields">
                  <div><label>Fecha de inicio</label><input type="date" value={cfg.start_date || ''} onChange={(e) => setCfg({ ...cfg, start_date: e.target.value })} /></div>
                  <div><label>Cada cuántos meses</label><input type="number" min="1" value={cfg.freq_months} onChange={(e) => setCfg({ ...cfg, freq_months: e.target.value })} /></div>
                  <div><label>Días por ventana (1–7)</label><input type="number" min="1" max="7" value={cfg.window_days} onChange={(e) => setCfg({ ...cfg, window_days: e.target.value })} /></div>
                  <div><label>Equipos por grupo</label><input type="number" min="1" value={cfg.batch_size} onChange={(e) => setCfg({ ...cfg, batch_size: e.target.value })} /></div>
                  <div><label>Semanas entre grupos</label><input type="number" min="1" value={cfg.gap_weeks} onChange={(e) => setCfg({ ...cfg, gap_weeks: e.target.value })} /></div>
                  <div><label>Horizonte (años)</label><input type="number" min="1" value={cfg.horizon_years} onChange={(e) => setCfg({ ...cfg, horizon_years: e.target.value })} /></div>
                </div>
                <div className="row" style={{ display: 'flex', marginTop: '.6rem', gap: '.5rem', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                  <button className="btn btn-primary btn-sm" onClick={saveMaintCfg}>Guardar configuración</button>
                  <button className="btn btn-sm" onClick={autoDistribute}><Icon n="dice" /> Auto-repartir en grupos</button>
                  <button className="btn btn-lime btn-sm" onClick={genProgram}>Generar programación ({cfg.horizon_years} años)</button>
                  <button className="btn btn-danger btn-sm" onClick={clearProgram}><Icon n="trash" /> Limpiar programación</button>
                </div>
              </>) : <p className="muted">Cargando configuración…</p>}
            </div>}
          </div>

          {/* Tarjeta destacada: equipos sin lote */}
          {sinLote.length > 0 && (
            <div className={`section ${openLote.sin ? 'open' : ''}`} ref={(el) => { mantRefs.current.sin = el }} style={{ marginBottom: '.6rem', borderColor: 'rgba(255,190,60,.45)' }}>
              <button className="sec-head compact" onClick={() => setOpenLote((o) => ({ ...o, sin: !o.sin }))}>
                <span className="ico"><Icon n="alert" /></span>
                <span className="t"><strong>Equipos sin grupo</strong><br /><span className="muted">Aún no entran en la programación — asígnales un grupo</span></span>
                <span className="count">{sinLote.length}</span><span className="chev">▾</span>
              </button>
              {openLote.sin && <div className="sec-body">
                <div className="table-wrap"><table className="tbl-compact">
                  <thead><tr><th>Equipo</th><th>Persona</th><th>Asignar a grupo</th></tr></thead>
                  <tbody>{sinLote.map((e) => (
                    <tr key={e.id}>
                      <td><strong>{e.name}</strong> {e.brand} {e.model}</td>
                      <td>{e.assigned_to_name || <span className="muted">—</span>}</td>
                      <td>{loteSelect(e, '')}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </div>}
            </div>
          )}

          {/* Lotes (desplegables) */}
          {Array.from({ length: nLotes }).map((_, i) => {
            const L = i + 1
            const rows = comps.filter((e) => loteOf(e) === L)
            const isOpen = !!openLote[L]
            return (
              <div className={`section ${isOpen ? 'open' : ''}`} key={L} ref={(el) => { mantRefs.current[L] = el }} style={{ marginBottom: '.5rem' }}>
                <button className="sec-head compact" onClick={() => setOpenLote((o) => ({ ...o, [L]: !o[L] }))}>
                  <span className="ico"><Icon n="layers" /></span>
                  <span className="t"><strong>Grupo {L}</strong><br /><span className="muted">{loteWindow(L)} · {rows.length}/{cfg?.batch_size || 5} equipos</span></span>
                  <span className="count">{rows.length}</span><span className="chev">▾</span>
                </button>
                {isOpen && <div className="sec-body">
                  <div className="table-wrap"><table className="tbl-compact">
                    <thead><tr><th>Equipo</th><th>Persona</th><th>Grupo</th></tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={3} className="muted" style={{ padding: '.6rem' }}>Sin equipos en este grupo.</td></tr>}
                      {rows.map((e) => (
                        <tr key={e.id}>
                          <td><strong>{e.name}</strong> {e.brand} {e.model}</td>
                          <td>{e.assigned_to_name || <span className="muted">—</span>}</td>
                          <td>{loteSelect(e, loteOf(e) || '')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>}
              </div>
            )
          })}
        </div>
        )
      })()}

      {/* ==== Tipos de equipo (ventana) ==== */}
      {showSchemas && (
        <div className="backdrop open">
          <div className="modal modal-xl">
            <h3>Tipos de equipo</h3>
            <p className="muted" style={{ marginTop: 0 }}>Un “tipo” (Computadores, Impresoras, Celulares…) define qué datos se piden al registrar un equipo. Todos incluyen marca, modelo, serie, ubicación y estado; aquí puedes agregar datos extra propios de cada tipo.</p>
            <div style={{ margin: '.4rem 0 .6rem' }}>
              <button className="btn btn-lime btn-sm" onClick={() => openSchema(null)}>＋ Nuevo tipo de equipo</button>
            </div>
            <div className="table-wrap"><table className="tbl-compact tipos-table">
              <thead><tr><th>Tipo</th><th>Se asigna a</th><th>Datos extra</th><th></th></tr></thead>
              <tbody>
                {sections.filter((s) => !CRED.has(s.name)).map((s) => (
                  <tr key={s.id}>
                    <td><span className="ico"><Icon n={sectionIconName(s.name)} /></span> <strong>{s.name}</strong></td>
                    <td>{s.assign_to === 'department' ? 'Departamento' : 'Usuario'}</td>
                    <td><span className="muted">{(s.fields || []).map((f) => f.label).join(' · ') || 'Solo los datos comunes'}</span></td>
                    <td className="actions">
                      <button className="btn-sm" onClick={() => openSchema(s)}>Editar</button>{' '}
                      <button className="btn-sm" onClick={() => dupSchema(s)}>Duplicar</button>{' '}
                      <button className="btn-sm btn-danger" onClick={() => delSchema(s)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="modal-actions"><button className="btn" onClick={() => setShowSchemas(false)}>Cerrar</button></div>
          </div>
        </div>
      )}

      {/* Carga: siluetas mientras llegan los datos */}
      {loading && view === 'equipos' && <div style={{ marginTop: '.4rem' }}><SkeletonKpis n={8} /><SkeletonRows n={4} /></div>}

      {/* ==== Resumen (tarjetas de información) ==== */}
      {!loading && view === 'equipos' && <div className="kpi-grid compact">
        <button className="kpi kpi-all" onClick={() => setOpen({})}>
          <span className="ico"><Icon n={view === 'accesos' ? 'lock' : 'grid'} /></span>
          <div><div className="num">{viewCount}</div><div className="lbl">{view === 'accesos' ? 'Registros de claves' : 'Equipos en total'}</div></div>
        </button>
        {visibleSections.map((s) => (
          <button key={s.id} className={`kpi ${open[s.id] ? 'active' : ''}`} onClick={() => openOnlyAndScroll(s.id)}>
            <div className="ico"><Icon n={sectionIconName(s.name)} /></div>
            <div className="num">{(bySection[s.id] || []).length}</div>
            <div className="lbl">{s.name}</div>
          </button>
        ))}
        <button className={`kpi ${mantOpen ? 'active' : ''}`} onClick={() => setMantOpen((v) => !v)} title="Equipos con estado En mantenimiento">
          <div className="ico"><Icon n="wrench" /></div>
          <div className="num">{enMantItems.length}</div>
          <div className="lbl">En mantenimiento</div>
        </button>
        <button className={`kpi ${sinAsigOpen ? 'active' : ''}`} onClick={() => setSinAsigOpen((v) => !v)} title="Equipos sin persona/departamento asignado">
          <div className="ico"><Icon n="ban" /></div>
          <div className="num">{sinAsignarItems.length}</div>
          <div className="lbl">Sin asignar</div>
        </button>
      </div>}

      {/* Detalle de la tarjeta "En mantenimiento" */}
      {view === 'equipos' && mantOpen && (
        <div className="section open" style={{ marginBottom: '.8rem' }}><div className="sec-body">
          <div className="row" style={{ marginBottom: '.4rem' }}>
            <strong>En mantenimiento · {enMantItems.length}</strong>
            <button className="btn-sm" onClick={() => setMantOpen(false)}><Icon n="close" /> Cerrar</button>
          </div>
          {enMantItems.length === 0
            ? <p className="muted" style={{ margin: '.2rem 0' }}>No hay equipos en mantenimiento.</p>
            : <div className="table-wrap"><table className="tbl-compact">
                <thead><tr><th>Equipo</th><th>Tipo</th><th>Asignado a</th><th></th></tr></thead>
                <tbody>
                  {enMantItems.map((e) => (
                    <tr key={e.id}>
                      <td><strong>{e.name}</strong> {e.brand} {e.model}</td>
                      <td><span className="muted">{secById[e.section_id]?.name}</span></td>
                      <td>{e.assigned_to_name || <span className="muted">Sin asignar</span>}</td>
                      <td className="actions">
                        <button className="btn-sm" onClick={() => nav(`/equipo/${e.id}`)}>Ver / Editar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>}
        </div></div>
      )}

      {/* Detalle de la tarjeta "Sin asignar" */}
      {view === 'equipos' && sinAsigOpen && (
        <div className="section open" style={{ marginBottom: '.8rem' }}><div className="sec-body">
          <div className="row" style={{ marginBottom: '.4rem' }}>
            <strong>Sin asignar · {sinAsignarItems.length}</strong>
            <button className="btn-sm" onClick={() => setSinAsigOpen(false)}><Icon n="close" /> Cerrar</button>
          </div>
          {sinAsignarItems.length === 0
            ? <p className="muted" style={{ margin: '.2rem 0' }}>No hay equipos sin asignar.</p>
            : <div className="table-wrap"><table className="tbl-compact">
                <thead><tr><th>Equipo</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {sinAsignarItems.map((e) => (
                    <tr key={e.id}>
                      <td><strong>{e.name}</strong> {e.brand} {e.model}</td>
                      <td><span className="muted">{secById[e.section_id]?.name}</span></td>
                      <td><span className="badge">{e.condition}</span></td>
                      <td className="actions">
                        <button className="btn-sm" onClick={() => nav(`/equipo/${e.id}`)}>Ver / Editar</button>{' '}
                        <button className="btn-sm btn-danger" onClick={() => delEquip(e)}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>}
        </div></div>
      )}

      {/* ==== Tarjetas de datos faltantes (solo vista Equipos) ==== */}
      {view === 'equipos' && gapCards.length > 0 && (
        <div style={{ marginBottom: '.8rem' }}>
          <div className="gap-head">
            <span className="muted" style={{ fontSize: '.8rem' }}>Datos faltantes — toca una tarjeta para ver el detalle</span>
            <span className="gap-legend">
              <span className="gl crit"><span className="dot" />Crítico</span>
              <span className="gl warn"><span className="dot" />Medio</span>
              <span className="gl info"><span className="dot" />Leve</span>
            </span>
          </div>
          <div className="kpi-grid compact">
            {gapCards.map((c) => (
              <button key={c.key} className={`kpi gap-${c.sev} ${gapSel === c.key ? 'active' : ''}`} onClick={() => setGapSel(gapSel === c.key ? null : c.key)}>
                <div className="ico"><Icon n={c.icon} /></div>
                <div className="num">{c.n}</div>
                <div className="lbl">{c.label}</div>
              </button>
            ))}
          </div>
          {gapSel && (() => {
            const card = gapCards.find((c) => c.key === gapSel)
            if (!card) return null
            const rows = card.kind === 'people'
              ? [...noPc].sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email, 'es'))
              : [...(gaps[gapSel]?.items || [])].sort((a, b) => `${a.name} ${a.assigned_to_name || ''}`.localeCompare(`${b.name} ${b.assigned_to_name || ''}`, 'es'))
            return (
              <div className="section open" style={{ marginTop: '.5rem' }}><div className="sec-body">
                <div className="row" style={{ marginBottom: '.4rem' }}>
                  <strong>{card.label} · {card.n}</strong>
                  <button className="btn-sm" onClick={() => setGapSel(null)}><Icon n="close" /> Cerrar</button>
                </div>
                {card.kind === 'cases' ? (
                  <div>
                    {cases.map((cs) => (
                      <div key={cs.key} style={{ marginBottom: '.8rem' }}>
                        <div style={{ background: 'rgba(255,190,60,.1)', border: '1px solid rgba(255,190,60,.35)', borderRadius: 8, padding: '.5rem .7rem', marginBottom: '.4rem', fontSize: '.85rem', display: 'flex', gap: '.4rem', alignItems: 'flex-start' }}><Icon n="pin" /> <span>{cs.nota}</span></div>
                        <div className="table-wrap"><table className="tbl-compact">
                          <thead><tr><th>Equipo</th><th>Serie</th><th>Asignado a</th><th>Cuenta Windows</th><th></th></tr></thead>
                          <tbody>{cs.items.map((e) => (
                            <tr key={e.id}>
                              <td><strong>{e.name}</strong> {e.brand} {e.model}</td>
                              <td>{e.serial_number || <span className="muted">—</span>}</td>
                              <td>{e.assigned_to_name || <span className="muted">—</span>}</td>
                              <td>{e.attributes?.cuenta_windows || <span className="muted">—</span>}</td>
                              <td className="actions"><button className="btn-sm" onClick={() => nav(`/equipo/${e.id}`)}>Detalle</button>{' '}<button className="btn-sm" onClick={() => setEdit({ ...emptyEquip(e.section_id), ...e, attributes: e.attributes || {} })}>Editar</button></td>
                            </tr>
                          ))}</tbody>
                        </table></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="table-wrap"><table className="tbl-compact">
                    {card.kind === 'people' ? (<>
                      <thead><tr><th>Persona</th><th>Correo</th></tr></thead>
                      <tbody>{rows.map((u) => <tr key={u.id}><td><strong>{u.full_name || '—'}</strong></td><td>{u.email}</td></tr>)}</tbody>
                    </>) : (<>
                      <thead><tr><th>Equipo</th><th>Asignado a</th><th>Tipo</th><th></th></tr></thead>
                      <tbody>{rows.map((e) => (
                        <tr key={e.id}>
                          <td><strong>{e.name}</strong> {e.brand} {e.model}</td>
                          <td>{e.assigned_to_name || <span className="muted">Sin asignar</span>}{e.assigned_to_email ? <><br /><span className="muted">{e.assigned_to_email}</span></> : null}</td>
                          <td><span className="muted">{secById[e.section_id]?.name}</span></td>
                          <td className="actions"><button className="btn-sm" onClick={() => setEdit({ ...emptyEquip(e.section_id), ...e, attributes: e.attributes || {} })}>Completar</button></td>
                        </tr>
                      ))}</tbody>
                    </>)}
                  </table></div>
                )}
              </div></div>
            )
          })()}
        </div>
      )}

      {/* ==== Pestaña Stock (disponible / sin asignar) ==== */}
      {view === 'stock' && (
        <div>
          <div className="muted" style={{ fontSize: '.82rem', margin: '0 0 .6rem' }}>Stock disponible — unidades que no están asignadas a nadie, listas para entregar.</div>
          <h4 className="det-sub">Equipos sin asignar</h4>
          {stockEquip.length === 0 && <p className="muted">No hay equipos sin asignar.</p>}
          {stockEquip.map((g) => {
            const isOpen = !!openStock[g.id]
            return (
              <div className={`section ${isOpen ? 'open' : ''}`} key={g.id} style={{ marginBottom: '.5rem' }}>
                <button className="sec-head compact" onClick={() => setOpenStock((o) => ({ ...o, [g.id]: !o[g.id] }))}>
                  <span className="ico"><Icon n={sectionIconName(g.name)} /></span>
                  <span className="t"><strong>{g.name}</strong><br /><span className="muted">{g.n} disponible(s) en stock</span></span>
                  <span className="count">{g.n}</span><span className="chev">▾</span>
                </button>
                {isOpen && <div className="sec-body"><div className="table-wrap"><table className="tbl-compact">
                  <thead><tr><th>Equipo</th><th>Serie</th><th>Estado</th><th></th></tr></thead>
                  <tbody>
                    {g.items.map((e) => (
                      <tr key={e.id}>
                        <td><strong>{e.name}</strong> {e.brand} {e.model}</td>
                        <td>{e.serial_number || <span className="muted">—</span>}</td>
                        <td><span className="badge">{e.condition}</span></td>
                        <td className="actions"><button className="btn-sm" onClick={() => nav(`/equipo/${e.id}`)}>Ver / Asignar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div></div>}
              </div>
            )
          })}
          <h4 className="det-sub" style={{ marginTop: '1rem' }}>Periféricos disponibles</h4>
          {periphs.length === 0 && <p className="muted">No hay periféricos registrados.</p>}
          {periphs.length > 0 && <div className="table-wrap"><table className="tbl-compact">
            <thead><tr><th>Periférico</th><th>Total</th><th>Asignados</th><th>Disponibles</th></tr></thead>
            <tbody>
              {periphs.map((p) => {
                const asg = periphAsg[p.id] || 0; const disp = (p.total_qty || 0) - asg
                return (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong>{p.model ? ` · ${p.model}` : ''}</td>
                    <td>{p.total_qty}</td><td>{asg}</td>
                    <td><span className="badge" style={{ color: disp > 0 ? undefined : 'var(--danger)' }}>{disp}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>}
        </div>
      )}

      {/* ==== Pestaña Periféricos ==== */}
      {view === 'perif' && (
        <div>
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.7rem' }}>
            <button className="btn btn-lime btn-sm" onClick={() => setPeriphForm({ name: '', model: '', buy_link: '', total_qty: 0 })}>＋ Agregar periférico</button>
            <span className="muted" style={{ fontSize: '.82rem' }}>Crea un periférico con su cantidad y asígnalo por unidades a cada usuario.</span>
          </div>
          {periphs.length === 0 && <p className="muted">Aún no hay periféricos. Crea el primero con "Agregar periférico".</p>}
          {periphs.map((p) => {
            const asg = periphAsg[p.id] || 0
            const disp = (p.total_qty || 0) - asg
            const isOpen = !!openPeriph[p.id]
            const members = periphMembers[p.id] || []
            const sel = pSel[p.id] || { user: '', qty: 1 }
            return (
              <div className={`section ${isOpen ? 'open' : ''}`} key={p.id} style={{ marginBottom: '.7rem' }}>
                <button className="sec-head compact" onClick={() => setOpenPeriph((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                  <span className="ico"><Icon n="mouse" /></span>
                  <span className="t"><strong>{p.name}</strong>{p.model ? ` · ${p.model}` : ''}<br />
                    <span className="muted">Total {p.total_qty} · Asignados {asg} · <span style={{ color: disp > 0 ? 'var(--lime)' : 'var(--danger)' }}>Disponibles {disp}</span></span></span>
                  <span className="count">{p.total_qty}</span><span className="chev">▾</span>
                </button>
                {isOpen && <div className="sec-body">
                  <div className="row" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem', alignItems: 'center' }}>
                    {p.buy_link ? <a className="btn-sm" href={p.buy_link} target="_blank" rel="noreferrer"><Icon n="link" /> Link de compra</a> : null}
                    <button className="btn-sm" onClick={() => setPeriphForm({ ...p })}>Editar</button>
                    <button className="btn-sm btn-danger" onClick={() => delPeriph(p)}>Eliminar</button>
                  </div>
                  {/* Asignar a un usuario */}
                  <div className="row" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
                    <select style={{ flex: 1, minWidth: 180 }} value={sel.user} onChange={(e) => setPSel((s) => ({ ...s, [p.id]: { ...sel, user: e.target.value } }))}>
                      <option value="">Asignar a…</option>
                      {countryUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                    </select>
                    <input type="number" min="1" max={disp} style={{ width: 70 }} value={sel.qty} onChange={(e) => setPSel((s) => ({ ...s, [p.id]: { ...sel, qty: e.target.value } }))} />
                    <button className="btn-sm btn-lime" disabled={disp <= 0 || !sel.user || Number(sel.qty) < 1 || Number(sel.qty) > disp} onClick={() => { assignPeriph(p.id, sel.user, sel.qty); setPSel((s) => ({ ...s, [p.id]: { user: '', qty: 1 } })) }}>Asignar</button>
                  </div>
                  <div className="table-wrap"><table className="tbl-compact">
                    <thead><tr><th>Usuario</th><th>Cantidad</th><th></th></tr></thead>
                    <tbody>
                      {members.length === 0 && <tr><td colSpan={3} className="muted" style={{ padding: '.6rem' }}>Sin asignaciones.</td></tr>}
                      {members.map((m) => (
                        <tr key={m.user_id}>
                          <td><strong>{m.user_name || m.user_email}</strong></td>
                          <td><span className="badge">{m.qty}</span></td>
                          <td className="actions"><button className="btn-sm btn-danger" onClick={() => assignPeriph(p.id, m.user_id, 0)}>Quitar</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>}
              </div>
            )
          })}
        </div>
      )}

      {/* ==== Modal crear / editar periférico ==== */}
      {periphForm && (
        <div className="backdrop open">
          <div className="modal">
            <h3>{periphForm.id ? 'Editar' : 'Agregar'} periférico</h3>
            <div className="pf-fields">
              <div style={{ gridColumn: '1 / -1' }}><label>Nombre</label><input value={periphForm.name || ''} onChange={(e) => setPeriphForm({ ...periphForm, name: e.target.value })} placeholder="Ej: Mouse" /></div>
              <div><label>Modelo</label><input value={periphForm.model || ''} onChange={(e) => setPeriphForm({ ...periphForm, model: e.target.value })} /></div>
              <div><label>Cantidad</label><input type="number" min="0" value={periphForm.total_qty ?? 0} onChange={(e) => setPeriphForm({ ...periphForm, total_qty: e.target.value })} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label>Link de compra</label><input value={periphForm.buy_link || ''} onChange={(e) => setPeriphForm({ ...periphForm, buy_link: e.target.value })} placeholder="https://…" /></div>
            </div>
            <div className="modal-actions"><button className="btn" onClick={() => setPeriphForm(null)}>Cancelar</button><button className="btn btn-primary" onClick={savePeriph}>Guardar</button></div>
          </div>
        </div>
      )}

      {/* ==== Tarjetas desplegables por tipo ==== */}
      {visibleSections.map((s) => {
        const all = bySection[s.id] || []
        const rows = filterSortRows(all, s.id)
        const isOpen = !!open[s.id]
        return (
          <div className={`section ${isOpen ? 'open' : ''}`} key={s.id} style={{ marginBottom: '.8rem' }} ref={(el) => { secRefs.current[s.id] = el }}>
            <button className="sec-head compact" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
              <span className="ico"><Icon n={sectionIconName(s.name)} /></span>
              <span className="t"><strong>{s.name}</strong><br /><span className="muted">{all.length} equipo(s) · {s.assign_to === 'department' ? 'asignado a departamento' : 'asignado a usuario'}</span></span>
              <span className="count">{all.length}</span><span className="chev">▾</span>
            </button>
            {isOpen && (() => {
              const showAV = s.name === 'Computadores' || rows.some((r) => r.antivirus)
              const eqCols = 6 + (showAV ? 1 : 0)
              return (
              <div className="sec-body">
                <div className="row" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
                  <button className="btn-sm btn-lime" onClick={() => setEdit({ ...emptyEquip(s.id), attributes: { pais: effCountry, ...(s.name === 'Computadores' ? { tipo: 'Notebook', pin: '123321', so: 'Windows 11 Home', propiedad: 'Empresarial', dhcp: 'Sí', pass_windows: 'No aplica' } : {}) } })}>＋ Agregar {s.name.toLowerCase()}</button>
                  <input placeholder="Buscar en esta carpeta…" value={folderQ[s.id] || ''} onChange={(e) => setFolderQ((q) => ({ ...q, [s.id]: e.target.value }))} style={{ flex: 1, minWidth: 200 }} />
                  <SortControl
                    fields={[{ value: 'recent', label: 'Más recientes' }, { value: 'name', label: 'Nombre' }, { value: 'assigned', label: s.assign_to === 'department' ? 'Departamento' : 'Asignado a' }]}
                    field={folderSort[s.id] || 'recent'} dir={folderDir[s.id] || ((folderSort[s.id] || 'recent') === 'recent' ? 'desc' : 'asc')}
                    onField={(v) => setFolderSort((o) => ({ ...o, [s.id]: v }))}
                    onToggleDir={() => setFolderDir((d) => { const cur = d[s.id] || ((folderSort[s.id] || 'recent') === 'recent' ? 'desc' : 'asc'); return { ...d, [s.id]: cur === 'asc' ? 'desc' : 'asc' } })} />
                  <FilterControl active={!!(folderFilter[s.id]?.cond || folderFilter[s.id]?.asig)}>
                    <label>Estado
                      <select value={folderFilter[s.id]?.cond || ''} onChange={(e) => setFolderFilter((o) => ({ ...o, [s.id]: { ...o[s.id], cond: e.target.value } }))}>
                        <option value="">Todos</option>{CONDS.map((c) => <option key={c}>{c}</option>)}
                      </select></label>
                    <label>Asignación
                      <select value={folderFilter[s.id]?.asig || ''} onChange={(e) => setFolderFilter((o) => ({ ...o, [s.id]: { ...o[s.id], asig: e.target.value } }))}>
                        <option value="">Todas</option>
                        <option value="asignado">Asignados</option>
                        <option value="sin">Sin asignar</option>
                      </select></label>
                    <button className="btn-sm" type="button" onClick={() => setFolderFilter((o) => ({ ...o, [s.id]: {} }))}>Limpiar filtros</button>
                  </FilterControl>
                </div>
                {(() => {
                  return (
                  <div className="table-wrap"><table className="tbl-compact">
                    <thead><tr>
                      <th>Equipo</th><th>Serie</th><th>Ubicación</th>
                      <th>{s.assign_to === 'department' ? 'Departamento' : 'Asignado a'}</th><th>Estado</th>{showAV && <th>Antivirus</th>}<th></th>
                    </tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={eqCols} className="muted" style={{ padding: '.7rem' }}>Sin equipos.</td></tr>}
                      {rows.map((e) => (
                        <tr key={e.id}>
                          <td><div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>{e.image_url ? <img className="ins-thumb" src={e.image_url} alt="" onClick={() => viewImage(e.image_url)} /> : null}<span><strong>{e.name}</strong> {e.brand} {e.model}</span></div></td>
                          <td>{e.serial_number}</td>
                          <td>{e.location}</td>
                          <td>{s.assign_to === 'department'
                            ? <span className="badge"><Icon n="building" /> {e.assigned_to_name || '—'}</span>
                            : <>{e.assigned_to_name || <span className="muted">Sin asignar</span>}<br /><span className="muted">{e.assigned_to_email}</span></>}</td>
                          <td><span className="badge">{e.condition}</span></td>
                          {showAV && <td>{e.antivirus ? <span className={`badge ${(e.antivirus || '').toLowerCase().includes('activo') ? 's-approved' : (e.antivirus || '').toLowerCase().includes('inactivo') ? 's-rejected' : ''}`}>{e.antivirus}</span> : <span className="muted">—</span>}</td>}
                          <td className="actions">
                            <button className="btn-sm" onClick={() => nav(`/equipo/${e.id}`)}>Ver / Editar</button>{' '}
                            <button className="btn-sm btn-danger" onClick={() => delEquip(e)}>Eliminar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                  )
                })()}
              </div>
              )
            })()}
          </div>
        )
      })}

      {/* ==== Modal editar / agregar equipo ==== */}
      {edit && (() => {
        const s = secById[edit.section_id] || { fields: [], assign_to: 'user', name: 'Equipo' }
        const isCred = CRED.has(s.name)
        const setAttr = (k, v) => setEdit({ ...edit, attributes: { ...(edit.attributes || {}), [k]: v } })
        return (
          <div className="backdrop open">
            <div className="modal">
              <h3>{edit.id ? 'Editar' : 'Agregar'} {s.name.toLowerCase()}</h3>
              <div className="pf-fields">
                {isCred ? (
                  <div style={{ gridColumn: '1 / -1' }}><label>Nombre</label><input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ej: Cuenta · Operaciones" /></div>
                ) : (<>
                  {[['name', 'Tipo / Nombre'], ['brand', 'Marca'], ['model', 'Modelo'], ['serial_number', 'Identificador de dispositivo']].map(([k, lbl]) => (
                    <div key={k}><label>{lbl}</label>
                      <input list={k === 'brand' ? 'brand-list' : undefined} placeholder={k === 'brand' ? 'HP, Lenovo, Apple…' : undefined} value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                    </div>
                  ))}
                  <datalist id="brand-list">{BRANDS.map((b) => <option key={b} value={b} />)}</datalist>
                  <div><label>Ubicación</label>
                    <select value={edit.location || ''} onChange={(e) => setEdit({ ...edit, location: e.target.value })}>
                      <option value="">—</option>
                      {[...LOCS, ...(edit.location && !LOCS.includes(edit.location) ? [edit.location] : [])].map((o) => <option key={o}>{o}</option>)}
                    </select></div>
                  <div><label>Estado</label><select value={edit.condition} onChange={(e) => setEdit({ ...edit, condition: e.target.value })}>{CONDS.map((c) => <option key={c}>{c}</option>)}</select></div>
                  {(() => {
                    const asgUser = edit.assigned_to_email ? users.find((u) => normc(u.email) === normc(edit.assigned_to_email)) : null
                    const derived = asgUser ? (asgUser.country || 'Chile') : null
                    return (
                      <div><label>País {derived ? <span className="muted">(según usuario)</span> : ''}</label>
                        <select value={derived || edit.attributes?.pais || effCountry} disabled={!!derived}
                          title={derived ? 'Se toma automáticamente del país del usuario asignado' : undefined}
                          onChange={(e) => setEdit({ ...edit, attributes: { ...(edit.attributes || {}), pais: e.target.value } })}>
                          {COUNTRIES.map(([c, flag]) => <option key={c} value={c}>{flag} {c}</option>)}
                        </select></div>
                    )
                  })()}
                  <div style={{ gridColumn: '1 / -1' }}><label>Foto del dispositivo</label>
                    <ImagePicker value={edit.image_url} onChange={(url) => setEdit((ed) => ({ ...ed, image_url: url }))} />
                  </div>
                </>)}

                {/* Campos dinámicos del esquema */}
                {(s.fields || []).map((f) => {
                  const dhcpOn = edit.attributes?.dhcp === 'Sí'
                  const ipDisabled = f.key === 'ip' && dhcpOn
                  return (
                  <div key={f.key}><label>{f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
                    {f.type === 'select'
                      ? <select value={edit.attributes?.[f.key] || ''} onChange={(e) => setAttr(f.key, e.target.value)}><option value="">—</option>{(f.options || []).map((o) => <option key={o}>{o}</option>)}</select>
                      : f.type === 'bool'
                        ? <select value={edit.attributes?.[f.key] || ''} onChange={(e) => {
                            // al activar DHCP, la IP pasa a ser automática (se limpia y bloquea)
                            if (f.key === 'dhcp') setEdit((ed) => ({ ...ed, attributes: { ...(ed.attributes || {}), dhcp: e.target.value, ...(e.target.value === 'Sí' ? { ip: '' } : {}) } }))
                            else setAttr(f.key, e.target.value)
                          }}><option value="">—</option><option value="Sí">Sí</option><option value="No">No</option></select>
                        : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
                            value={ipDisabled ? '' : (edit.attributes?.[f.key] || '')} disabled={ipDisabled}
                            placeholder={ipDisabled ? 'Automática (DHCP)' : undefined}
                            onChange={(e) => setAttr(f.key, e.target.value)} />}
                  </div>
                  )
                })}

                {/* Asignación: elegible por registro (usuario o departamento) */}
                <div style={{ gridColumn: '1 / -1' }}><label>¿A quién se asigna?</label>
                  <select value={assignMode} onChange={(e) => { setAssignMode(e.target.value); setManualAssign(false); setEdit({ ...edit, assigned_to_name: '', assigned_to_email: '' }) }}>
                    <option value="user">A un usuario</option>
                    <option value="department">A un departamento</option>
                  </select>
                </div>
                {assignMode === 'department' ? (
                  <div><label>Departamento asignado</label>
                    <select value={edit.assigned_to_name || ''} onChange={(e) => setEdit({ ...edit, assigned_to_name: e.target.value, assigned_to_email: '' })}>
                      <option value="">—</option>{DEPTS.map((d) => <option key={d} value={d}>{deptIndentLabel(d)}</option>)}
                    </select></div>
                ) : (<>
                  <div style={{ gridColumn: '1 / -1' }}><label>Asignar a (usuario)</label>
                    <select value={manualAssign ? '__manual__' : (edit.assigned_to_email || '')}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === '__manual__') { setManualAssign(true); return }
                        setManualAssign(false)
                        const u = users.find((x) => x.email === v)
                        const hasCorreo = (s.fields || []).some((f) => f.key === 'licencia_serie')
                        const hasCtaWin = (s.fields || []).some((f) => f.key === 'cuenta_windows')
                        setEdit((ed) => ({ ...ed, assigned_to_email: v, assigned_to_name: u ? (u.full_name || u.email) : '', attributes: { ...(ed.attributes || {}), ...(u ? { pais: u.country || 'Chile' } : {}), ...(hasCorreo ? { licencia_serie: v } : {}), ...(hasCtaWin ? { cuenta_windows: v } : {}) } }))
                      }}>
                      <option value="">— Sin asignar</option>
                      {countryUsers.map((u) => <option key={u.id} value={u.email}>{(u.full_name || 'Sin nombre')} — {u.email}</option>)}
                      {edit.assigned_to_email && !countryUsers.some((u) => u.email === edit.assigned_to_email) &&
                        <option value={edit.assigned_to_email}>{edit.assigned_to_name || 'Actual'} — {edit.assigned_to_email} (actual)</option>}
                      <option value="__manual__">Escribir manualmente (externo)…</option>
                    </select>
                    {!manualAssign && edit.assigned_to_email && <p className="muted" style={{ fontSize: '.74rem', margin: '.3rem 0 0' }}>Correo: {edit.assigned_to_email}</p>}
                  </div>
                  {manualAssign && (<>
                    <div><label>Asignado a (nombre)</label><input value={edit.assigned_to_name || ''} onChange={(e) => setEdit({ ...edit, assigned_to_name: e.target.value })} /></div>
                    <div><label>Correo asignado</label><input value={edit.assigned_to_email || ''} onChange={(e) => setEdit({ ...edit, assigned_to_email: e.target.value })} placeholder="externo@dominio.com" /></div>
                  </>)}
                </>)}
              </div>
              <div className="modal-actions"><button className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveEquip}>Guardar</button></div>
            </div>
          </div>
        )
      })()}

      {/* ==== Modal editar / crear esquema (tipo) ==== */}
      {schemaEdit && (
        <div className="backdrop open">
          <div className="modal">
            <h3>{schemaEdit.id ? 'Editar tipo de equipo' : 'Nuevo tipo de equipo'}</h3>
            <div className="pf-fields">
              <div><label>Nombre del tipo</label><input value={schemaEdit.name} onChange={(e) => setSchemaEdit({ ...schemaEdit, name: e.target.value })} placeholder="Ej: Tablets" /></div>
              <div><label>¿A quién se asigna?</label>
                <select value={schemaEdit.assign_to} onChange={(e) => setSchemaEdit({ ...schemaEdit, assign_to: e.target.value })}>
                  <option value="user">A un usuario</option>
                  <option value="department">A un departamento</option>
                </select></div>
            </div>

            <h4 style={{ margin: '1rem 0 .3rem' }}>Datos extra de este tipo</h4>
            <p className="muted" style={{ marginTop: 0 }}>Marca, modelo, serie, ubicación y estado ya vienen incluidos. Aquí agregas solo los datos propios de este tipo (por ejemplo “IP”, “Sistema operativo”, “N° de tóner”).</p>
            {(schemaEdit.fields || []).map((f, i) => (
              <div key={i} className="cat-row" style={{ alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                <div className="fld-move">
                  <button className="btn-sm" title="Subir" disabled={i === 0} onClick={() => moveField(i, -1)}>↑</button>
                  <button className="btn-sm" title="Bajar" disabled={i === schemaEdit.fields.length - 1} onClick={() => moveField(i, 1)}>↓</button>
                </div>
                <input style={{ flex: '1 1 140px' }} placeholder="Nombre del dato (ej: IP)" value={f.label} onChange={(e) => { const fs = [...schemaEdit.fields]; fs[i] = { ...f, label: e.target.value }; setSchemaEdit({ ...schemaEdit, fields: fs }) }} />
                <select value={f.type || 'text'} onChange={(e) => { const fs = [...schemaEdit.fields]; fs[i] = { ...f, type: e.target.value }; setSchemaEdit({ ...schemaEdit, fields: fs }) }}>
                  {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {f.type === 'select' && <input style={{ flex: '1 1 160px' }} placeholder="Opciones separadas por coma" value={f.optionsText || ''} onChange={(e) => { const fs = [...schemaEdit.fields]; fs[i] = { ...f, optionsText: e.target.value }; setSchemaEdit({ ...schemaEdit, fields: fs }) }} />}
                <label className="fld-req" title="Campo obligatorio"><input type="checkbox" checked={!!f.required} onChange={(e) => { const fs = [...schemaEdit.fields]; fs[i] = { ...f, required: e.target.checked }; setSchemaEdit({ ...schemaEdit, fields: fs }) }} /> Obligatorio</label>
                <button className="btn-sm btn-danger" onClick={() => setSchemaEdit({ ...schemaEdit, fields: schemaEdit.fields.filter((_, j) => j !== i) })}><Icon n="close" /></button>
              </div>
            ))}
            <div style={{ marginTop: '.5rem' }}><button className="btn-sm" onClick={() => setSchemaEdit({ ...schemaEdit, fields: [...(schemaEdit.fields || []), { label: '', type: 'text' }] })}>＋ Agregar dato</button></div>

            <div className="modal-actions"><button className="btn" onClick={() => setSchemaEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveSchema}>Guardar tipo</button></div>
          </div>
        </div>
      )}

      <ActivityLog kinds={['Equipo']} title="Registro de equipos" />
    </div>
  )
}
