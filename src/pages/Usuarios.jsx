import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { confirmDialog, alertDialog } from '../lib/ui'
import { loadDeptNames, DEFAULT_DEPTS, deptIndentLabel } from '../lib/depts'
import SortControl from '../components/SortControl'
import FilterControl from '../components/FilterControl'
import { Icon } from '../lib/icons'
import { SkeletonKpis, SkeletonTableRows } from '../components/Skeleton'
import { exportCsv } from '../lib/export'

const initials = (n) => (n || '?').split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase()
const fmt = (iso) => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const VIEW = 220, OUT = 200
const COUNTRIES = [['Chile', 'CL'], ['Colombia', 'CO'], ['Perú', 'PE']]
const flagOf = (c) => (COUNTRIES.find(([n]) => n === c) || [])[1] || ''
// Dominio del correo (para agrupar por proveedor: @billcapital.com = Microsoft 365, etc.)
const domainOf = (email) => ((email || '').split('@')[1] || 'sin dominio').toLowerCase()
const isBillDomain = (dom) => dom === 'billcapital.com' || dom.endsWith('.billcapital.com')
const isM365 = (email) => isBillDomain(domainOf(email))
const domainLabel = (dom) => dom === '__sistema__' ? 'Cuentas de servicio (no son personas)' : isBillDomain(dom) ? `Microsoft 365 · @${dom}` : dom === 'sin dominio' ? 'Sin correo' : `@${dom}`
const domainIcon = (dom) => dom === '__sistema__' ? 'building' : isBillDomain(dom) ? 'mail' : dom === 'sin dominio' ? 'ban' : 'mail'
// Nombres amigables de licencias M365 (skuPartNumber → nombre)
const SKU_NAMES = {
  O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Empresa Básico', O365_BUSINESS_PREMIUM: 'Microsoft 365 Empresa Estándar',
  O365_BUSINESS: 'Microsoft 365 Aplicaciones para Empresas', SPB: 'Microsoft 365 Empresa Premium',
  SPE_E3: 'Microsoft 365 E3', SPE_E5: 'Microsoft 365 E5', ENTERPRISEPACK: 'Office 365 E3', ENTERPRISEPREMIUM: 'Office 365 E5',
  STANDARDPACK: 'Office 365 E1', EXCHANGESTANDARD: 'Exchange Online (Plan 1)', EXCHANGEENTERPRISE: 'Exchange Online (Plan 2)',
  POWER_BI_STANDARD: 'Power BI (gratis)', FLOW_FREE: 'Power Automate (gratis)', TEAMS_EXPLORATORY: 'Teams Exploratory',
}
const skuName = (part) => SKU_NAMES[part] || (part || '').replace(/_/g, ' ')
// UPN a partir del nombre: "María Pérez" → "maria.perez"
const upnSlug = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
// Contraseña aleatoria segura: 16 caracteres, con mayúsculas, minúsculas, números y símbolos
// garantizados, sin caracteres ambiguos (O/0, I/l/1) y sin prefijo fijo.
const genPwd = () => {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789', S = '!@#$%*?-_'
  const all = U + L + D + S
  const rnd = (n) => { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n } catch { return Math.floor(Math.random() * n) } }
  const pick = (set) => set[rnd(set.length)]
  const chars = [pick(U), pick(U), pick(L), pick(L), pick(D), pick(D), pick(S), pick(S)]
  while (chars.length < 16) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = chars[i]; chars[i] = chars[j]; chars[j] = t }
  return chars.join('')
}
const MS_DOMAINS = ['billcapital.com', 'mic.billcapital.com']
// Llama a la función de gestión de usuarios de Microsoft 365 (ms-users)
async function msUsers(op, payload = {}) {
  const { data, error } = await supabase.functions.invoke('ms-users', { body: { op, ...payload } })
  if (error) {
    let msg = error.message || 'Error'
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (data && data.error) throw new Error(data.error)
  return data
}

export default function Usuarios() {
  const { user, refreshProfile, isSuper } = useAuth()
  const nav = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [DEPTS, setDEPTS] = useState(DEFAULT_DEPTS)
  useEffect(() => { loadDeptNames().then(setDEPTS) }, [])
  const [roles, setRoles] = useState([])
  const [log, setLog] = useState([])
  const [compEquip, setCompEquip] = useState([]) // equipos de la sección Computadores (para contar por persona)
  const [periphs, setPeriphs] = useState([])     // catálogo de periféricos
  const [periphAssign, setPeriphAssign] = useState([]) // asignaciones de periféricos
  const [pPick, setPPick] = useState({ per: '', qty: 1 }) // asignar periférico en el modal
  const [q, setQ] = useState('')
  const [sortField, setSortField] = useState('name') // 'name' | 'dept' | 'role' | 'recent'
  const [sortDir, setSortDir] = useState('asc')       // 'asc' | 'desc'
  const [roleFilter, setRoleFilter] = useState(null) // filtra la lista por rol al tocar una tarjeta
  const [domainFilter, setDomainFilter] = useState('') // '' = todos · filtra por dominio de correo
  const [statusFilter, setStatusFilter] = useState('active') // 'active' | 'disabled' | 'all'
  const [deptFilter, setDeptFilter] = useState('')           // '' = todos
  const [countryFilter, setCountryFilter] = useState('')     // '' = todos
  const [missingFilter, setMissingFilter] = useState('')     // '' | 'pc' | 'perif' | 'phone' | 'dept'
  const [mgmtFilter, setMgmtFilter] = useState(false)        // true = solo cargos de gestión (mayores a "Usuario")
  const [rolesOpen, setRolesOpen] = useState(false)          // carpeta "Cargos de gestión": muestra una tarjeta por rol

  // "Cargo de gestión" = tiene acceso a la app y su rol no es el común "Usuario".
  // (Los sin acceso —Mic, Sistema— quedan por debajo de Usuario y no cuentan.)
  const isMgmt = (u) => u.app_access !== false && u.role !== 'user'
  const mgmtCount = useMemo(() => rows.filter((u) => u.active !== false && isMgmt(u)).length, [rows])
  const [edit, setEdit] = useState(null)
  const [newUser, setNewUser] = useState(null)        // modal crear usuario en Microsoft 365
  const [msBusy, setMsBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [groupByDomain, setGroupByDomain] = useState(true)
  const [msSkus, setMsSkus] = useState([])            // catálogo de licencias del tenant
  const [msLic, setMsLic] = useState(null)            // licencias del usuario en edición
  const [licBusy, setLicBusy] = useState(false)
  const [licPick, setLicPick] = useState('')
  const [compTarget, setCompTarget] = useState('')   // cantidad objetivo de computadores (crea faltantes)
  const [compBusy, setCompBusy] = useState(false)
  const [assignPick, setAssignPick] = useState('')   // computador existente sin asignar a asignar
  const [logOpen, setLogOpen] = useState(false)
  const fileRef = useRef(null)
  const [cropImg, setCropImg] = useState(null)
  const [scale, setScale] = useState(1)
  const [minScale, setMinScale] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef(null)

  const onPickFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    if (!file.type.startsWith('image/')) { alertDialog('Selecciona una imagen.'); return }
    const reader = new FileReader()
    reader.onload = () => { const img = new Image(); img.onload = () => { const b = VIEW / Math.min(img.width, img.height); setCropImg(img); setMinScale(b); setScale(b); setOff({ x: 0, y: 0 }) }; img.src = reader.result }
    reader.readAsDataURL(file)
    if (fileRef.current) fileRef.current.value = ''
  }
  const clampOff = (o, sc) => { if (!cropImg) return o; const w = cropImg.width * sc, h = cropImg.height * sc; const mx = Math.max(0, (w - VIEW) / 2), my = Math.max(0, (h - VIEW) / 2); return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) } }
  const onDown = (e) => { const p = e.touches ? e.touches[0] : e; drag.current = { x: p.clientX, y: p.clientY, off: { ...off } } }
  const onMove = (e) => { if (!drag.current) return; const p = e.touches ? e.touches[0] : e; setOff(clampOff({ x: drag.current.off.x + (p.clientX - drag.current.x), y: drag.current.off.y + (p.clientY - drag.current.y) }, scale)) }
  const onUp = () => { drag.current = null }
  const applyCrop = () => {
    const canvas = document.createElement('canvas'); canvas.width = OUT; canvas.height = OUT
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1e222b'; ctx.fillRect(0, 0, OUT, OUT)
    ctx.save(); ctx.beginPath(); ctx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2); ctx.clip()
    const k = OUT / VIEW, w = cropImg.width * scale * k, h = cropImg.height * scale * k
    ctx.drawImage(cropImg, (OUT - w) / 2 + off.x * k, (OUT - h) / 2 + off.y * k, w, h); ctx.restore()
    setEdit((ed) => ({ ...ed, avatar_url: canvas.toDataURL('image/png') })); setCropImg(null)
  }

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString()
    const [{ data: profs }, { data: rs }, { data: lg }, { data: secs }, { data: eq }, { data: pr }, { data: pa }] = await Promise.all([
      supabase.rpc('admin_list_users'),
      supabase.from('roles').select('key,label,permissions,sort').order('sort'),
      supabase.from('audit_log').select('id,actor_name,target_name,detail,created_at').gt('created_at', since).order('created_at', { ascending: false }),
      supabase.from('equipment_sections').select('id,name'),
      supabase.from('equipment').select('id,name,brand,model,serial_number,condition,user_id,assigned_to_email,section_id,attributes'),
      supabase.from('peripherals').select('id,name,model,total_qty'),
      supabase.from('peripheral_assignments').select('peripheral_id,user_id,qty'),
    ])
    const compIds = new Set((secs ?? []).filter((s) => /comput/i.test(s.name || '')).map((s) => s.id))
    setRows(profs ?? []); setRoles(rs ?? []); setLog(lg ?? [])
    setCompEquip((eq ?? []).filter((e) => compIds.has(e.section_id)))
    setPeriphs(pr ?? []); setPeriphAssign(pa ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Computadores por persona: se atribuye por user_id o, si falta, por correo asignado
  const compCount = useMemo(() => {
    const byEmail = {}; rows.forEach((u) => { if (u.email) byEmail[u.email.toLowerCase()] = u.id })
    const m = {}
    compEquip.forEach((e) => {
      let uid = e.user_id
      if (!uid && e.assigned_to_email) uid = byEmail[e.assigned_to_email.toLowerCase()]
      if (uid) m[uid] = (m[uid] || 0) + 1
    })
    return m
  }, [rows, compEquip])

  // Computadores de una persona (por vínculo directo o correo)
  const compsOf = useCallback((u) => {
    if (!u) return []
    const em = (u.email || '').toLowerCase()
    return compEquip.filter((e) => e.user_id === u.id || (e.assigned_to_email || '').toLowerCase() === em)
  }, [compEquip])

  // Computadores en STOCK (disponibles) para asignar a la persona: sin asignar Y marcados como disponible.
  const freeComps = useMemo(() => compEquip.filter((e) => !e.user_id && !((e.assigned_to_email || '').trim()) && e.attributes?.disponible === true), [compEquip])

  // Al abrir la edición, precargar la cantidad actual; se refresca tras crear
  useEffect(() => { if (edit) setCompTarget(String(compsOf(edit).length)) }, [edit?.id, compEquip])

  // Cuántos tiene y cuántos se crearían con el total pedido (nunca negativos)
  const compCur = useMemo(() => compsOf(edit).length, [edit, compEquip, compsOf])
  const compToCreate = useMemo(() => { const t = parseInt(compTarget, 10); return Number.isFinite(t) ? Math.max(0, t - compCur) : 0 }, [compTarget, compCur])

  const unassignComp = async (c) => {
    const lbl = [c.name, c.brand, c.model].filter(Boolean).join(' ') || 'Computador'
    if (!(await confirmDialog(`¿Quitar "${lbl}" de ${edit.full_name || edit.email}? Quedará como "Sin asignar" en el inventario (no se elimina).`, { title: 'Quitar computador', okText: 'Quitar' }))) return
    setCompBusy(true)
    try { await api('equipment_unassign', { p_equipment: c.id }); await load() } catch (e) { alertDialog(e.message) } finally { setCompBusy(false) }
  }
  const assignExisting = async () => {
    if (!assignPick) return
    setCompBusy(true)
    try { await api('equipment_assign', { p_equipment: assignPick, p_user: edit.id }); setAssignPick(''); await load() } catch (e) { alertDialog(e.message) } finally { setCompBusy(false) }
  }

  // Periféricos: disponibilidad por periférico y asignaciones de la persona en edición
  const periphById = useMemo(() => Object.fromEntries(periphs.map((p) => [p.id, p])), [periphs])

  // ===== Información faltante (tarjetas de arriba) =====
  // Solo personas reales: activas y que no sean cuentas de sistema/entidad ni Mic.
  const isPerson = useCallback((u) => u.active !== false && u.role !== 'sistema' && u.role !== 'mic' && !u.is_entity, [])
  // Periféricos asignados por persona (suma de cantidades)
  const periphCountByUser = useMemo(() => {
    const m = {}; periphAssign.forEach((a) => { if (a.qty > 0) m[a.user_id] = (m[a.user_id] || 0) + a.qty }); return m
  }, [periphAssign])
  // ¿A esta persona le falta X?
  const lacks = useCallback((u, kind) => {
    if (kind === 'pc') return !((compCount[u.id] || 0) > 0)
    if (kind === 'perif') return !((periphCountByUser[u.id] || 0) > 0)
    if (kind === 'phone') return !((u.phone || '').trim())
    if (kind === 'dept') return !((u.department || '').trim())
    return false
  }, [compCount, periphCountByUser])
  const MISSING_CARDS = [
    { key: 'dept', ico: 'building', label: 'Sin departamento' },
  ]
  const missingCounts = useMemo(() => {
    const c = { pc: 0, perif: 0, phone: 0, dept: 0 }
    rows.forEach((u) => { if (!isPerson(u)) return; MISSING_CARDS.forEach((m) => { if (lacks(u, m.key)) c[m.key]++ }) })
    return c
  }, [rows, isPerson, lacks])
  // Total de personas activas: denominador para colorear la información faltante por severidad
  const peopleCount = useMemo(() => rows.filter(isPerson).length, [rows, isPerson])
  // Nivel de color según proporción de personas afectadas: crit ≥40% · warn ≥15% · info el resto (0 = neutro)
  const missSev = (n) => { if (!n) return ''; const r = n / (peopleCount || 1); return r >= 0.4 ? 'gap-crit' : r >= 0.15 ? 'gap-warn' : 'gap-info' }
  const periphAvail = useMemo(() => {
    const asg = {}; periphAssign.forEach((a) => { asg[a.peripheral_id] = (asg[a.peripheral_id] || 0) + (a.qty || 0) })
    const m = {}; periphs.forEach((p) => { m[p.id] = (p.total_qty || 0) - (asg[p.id] || 0) }); return m
  }, [periphs, periphAssign])
  const myPeriphs = useMemo(() => (edit ? periphAssign.filter((a) => a.user_id === edit.id) : []), [periphAssign, edit])
  const assignPeriphUser = async () => {
    if (!pPick.per) return
    setCompBusy(true)
    try { await api('peripheral_assign', { p_peripheral: pPick.per, p_user: edit.id, p_qty: Number(pPick.qty) || 0 }); setPPick({ per: '', qty: 1 }); await load() } catch (e) { alertDialog(e.message) } finally { setCompBusy(false) }
  }
  const removePeriphUser = async (perId) => {
    setCompBusy(true)
    try { await api('peripheral_assign', { p_peripheral: perId, p_user: edit.id, p_qty: 0 }); await load() } catch (e) { alertDialog(e.message) } finally { setCompBusy(false) }
  }

  const applyComps = async () => {
    const target = parseInt(compTarget, 10)
    const current = compsOf(edit).length
    if (isNaN(target) || target < 0) return alertDialog('Escribe una cantidad válida.')
    if (target <= current) return alertDialog(`${edit.full_name || 'La persona'} ya tiene ${current} computador(es). Se mantienen. Para bajar la cantidad, quita equipos desde su ficha en el inventario.`)
    setCompBusy(true)
    try {
      const r = await api('equipment_add_blank_computers', { p_user: edit.id, p_target: target })
      await load()
      alertDialog(`Se crearon ${r?.creados ?? 0} computador(es) nuevos, ligados a ${edit.full_name || edit.email}. Completa sus datos desde el inventario.`)
    } catch (e) { alertDialog(e.message) } finally { setCompBusy(false) }
  }

  const roleLabel = useMemo(() => Object.fromEntries(roles.map((r) => [r.key, r.label])), [roles])
  const roleHasInv = useMemo(() => Object.fromEntries(roles.map((r) => [r.key, !!(r.permissions?.full_admin || r.permissions?.manage_inventory)])), [roles])

  const save = async () => {
    try {
      const payload = {
        p_user: edit.id, p_full_name: (edit.full_name || '').trim(),
        p_department: edit.department || '', p_role: edit.role, p_inventory: null,
        p_phone: (edit.phone || '').trim(), p_notes: edit.admin_notes ?? '', p_country: edit.country ?? '',
        p_is_hr: !!edit.is_hr, p_is_it_manager: !!edit.is_it_manager,
      }
      if (edit.avatar_url !== edit._avatar0) payload.p_avatar = edit.avatar_url || ''
      await api('admin_update_user', payload)
      // Reflejar los cambios en Microsoft 365 (solo cuentas @billcapital) — sin bloquear si falla
      if (isM365(edit.email)) {
        try {
          await msUsers('update', {
            id: edit.email, userPrincipalName: edit.email,
            displayName: (edit.full_name || '').trim(), department: edit.department || '',
            mobilePhone: (edit.phone || '').trim(), country: edit.country ?? null,
          })
        } catch (e) { console.warn('M365 update:', e.message) }
      }
      if (edit.id === user?.id) await refreshProfile()
      setEdit(null); load()
    } catch (e) { alertDialog(e.message) }
  }

  // Crear un usuario nuevo en Microsoft 365 (y perfil en la app)
  const createMsUser = async () => {
    const n = newUser
    if (!(n.displayName || '').trim()) return alertDialog('Escribe el nombre para mostrar.')
    if (!(n.upnLocal || '').trim()) return alertDialog('Escribe el usuario del correo (la parte antes de la @).')
    if ((n.password || '').length < 8) return alertDialog('La contraseña debe tener al menos 8 caracteres.')
    const upn = `${upnSlug(n.upnLocal)}@${n.domain}`
    setMsBusy(true)
    try {
      await msUsers('create', {
        displayName: n.displayName.trim(), userPrincipalName: upn,
        password: n.password, forceChange: n.forceChange !== false,
        jobTitle: n.jobTitle || '', department: n.department || '', mobilePhone: n.phone || '',
        country: n.country || 'Chile', usageLocation: usageOf(n.country), role: n.role || 'user', appAccess: n.appAccess !== false,
      })
      setNewUser(null)
      alertDialog(`Usuario ${upn} creado en Microsoft 365. Su perfil quedó preparado en la app${n.appAccess === false ? ' (sin acceso, solo organización)' : ''}.`)
      load()
    } catch (e) { alertDialog('No se pudo crear: ' + e.message) } finally { setMsBusy(false) }
  }

  // Traer de Microsoft 365 los usuarios que aún no están en la app y crearlos
  const syncM365 = async () => {
    setSyncBusy(true)
    try {
      const r = await msUsers('syncFromM365')
      await load()
      const byDom = r?.byDomain ? Object.entries(r.byDomain).sort((a, b) => b[1] - a[1]).map(([d, n]) => `  · @${d}: ${n}`).join('\n') : ''
      const extra = [
        byDom ? `\nDominios importables (${r.totalM365} usuarios en M365):\n${byDom}` : '',
        (r?.guestsSeen !== undefined) ? `\nInvitados que Graph devolvió: ${r.guestsSeen}` : '',
        r?.guests ? `\nInvitados con correo usable: ${r.guests} (entran SIN acceso a la app)` : '',
        (r?.skipped?.length) ? `\nOmitidos (sin correo usable): ${r.skipped.length} — ${(r.skipped || []).slice(0, 5).join(', ')}${r.skipped.length > 5 ? '…' : ''}` : '',
      ].join('')
      if (r?.created) {
        const names = (r.added || []).slice(0, 12).join(', ')
        alertDialog(`Se agregaron ${r.created} usuario(s) desde Microsoft 365${names ? ':\n' + names : ''}${(r.added || []).length > 12 ? '…' : ''}${extra}`)
      } else {
        alertDialog(`Todo al día: no había usuarios nuevos en Microsoft 365.${extra}`)
      }
    } catch (e) { alertDialog('No se pudo sincronizar: ' + e.message) } finally { setSyncBusy(false) }
  }

  // Restablecer la contraseña de un usuario en Microsoft 365
  const resetMsPassword = async (u) => {
    const pwd = window.prompt(`Nueva contraseña temporal para ${u.email}:\n(mínimo 8 caracteres; el usuario deberá cambiarla al ingresar)`)
    if (pwd === null) return
    if (pwd.length < 8) return alertDialog('La contraseña debe tener al menos 8 caracteres.')
    setMsBusy(true)
    try { await msUsers('resetPassword', { id: u.email, password: pwd, forceChange: true }); alertDialog('Contraseña restablecida en Microsoft 365.') }
    catch (e) { alertDialog('No se pudo restablecer: ' + e.message) } finally { setMsBusy(false) }
  }

  // ===== Licencias M365 =====
  const usageOf = (country) => country === 'Colombia' ? 'CO' : country === 'Perú' ? 'PE' : 'CL'
  const loadLicenses = useCallback(async (u) => {
    if (!u || !isM365(u.email)) { setMsSkus([]); setMsLic(null); return }
    setMsLic(null); setLicPick('')
    try {
      const [skusR, licR] = await Promise.all([msUsers('listSkus'), msUsers('userLicenses', { id: u.email })])
      setMsSkus(skusR?.skus || [])
      setMsLic({ assignedLicenses: licR?.assignedLicenses || [], usageLocation: licR?.usageLocation })
    } catch (e) { setMsSkus([]); setMsLic({ error: e.message, assignedLicenses: [] }) }
  }, [])
  useEffect(() => { if (edit) loadLicenses(edit); else { setMsSkus([]); setMsLic(null) } }, [edit?.id, loadLicenses])
  const assignLic = async (skuId) => {
    if (!skuId) return
    setLicBusy(true)
    try {
      await msUsers('assignLicense', { id: edit.email, skuId, usageLocation: usageOf(edit.country) })
      setLicPick('')
      // Actualización optimista: Graph tarda unos segundos en reflejarlo en la lectura, así que lo mostramos ya
      setMsLic((m) => (m && !m.error) ? { ...m, assignedLicenses: [...(m.assignedLicenses || []), { skuId }] } : m)
      setMsSkus((ss) => ss.map((s) => s.skuId === skuId ? { ...s, available: Math.max(0, (s.available || 0) - 1) } : s))
    } catch (e) { alertDialog('No se pudo asignar la licencia: ' + e.message) } finally { setLicBusy(false) }
  }
  const removeLic = async (skuId, name) => {
    if (!(await confirmDialog(`¿Quitar la licencia "${name}" de ${edit.full_name || edit.email}? Perderá acceso a los servicios de esa licencia.`, { title: 'Quitar licencia', danger: true, okText: 'Quitar' }))) return
    setLicBusy(true)
    try {
      await msUsers('removeLicense', { id: edit.email, skuId })
      setMsLic((m) => (m && !m.error) ? { ...m, assignedLicenses: (m.assignedLicenses || []).filter((l) => l.skuId !== skuId) } : m)
      setMsSkus((ss) => ss.map((s) => s.skuId === skuId ? { ...s, available: (s.available || 0) + 1 } : s))
    } catch (e) { alertDialog('No se pudo quitar la licencia: ' + e.message) } finally { setLicBusy(false) }
  }

  const setUserActive = async (u, active) => {
    if (u.id === user?.id) return alertDialog('No puedes deshabilitar tu propia cuenta.')
    if (!active && !(await confirmDialog(`¿Deshabilitar la cuenta de "${u.full_name || u.email}"? Quedará sin acceso ni departamento, pero se conserva en el registro para orden e inventario.${isM365(u.email) ? '\n\nTambién se bloqueará su acceso en Microsoft 365.' : ''}`, { title: 'Deshabilitar cuenta', danger: true, okText: 'Deshabilitar' }))) return
    try {
      await api('set_user_active', { p_user: u.id, p_active: active })
      if (isM365(u.email)) { try { await msUsers('setEnabled', { id: u.email, userPrincipalName: u.email, enabled: active }) } catch (e) { console.warn('M365 setEnabled:', e.message) } }
      load()
    } catch (e) { alertDialog(e.message) }
  }

  const delUser = async (u) => {
    if (u.id === user?.id) return alertDialog('No puedes eliminar tu propia cuenta.')
    const m365 = isM365(u.email)
    const extra = m365 ? '\n\nAdemás se LIBERARÁN sus licencias de Microsoft 365 (los cupos vuelven a estar disponibles) y se bloqueará su cuenta de M365.' : ''
    if (!(await confirmDialog(`¿Eliminar al usuario "${u.full_name || u.email}"?\nSe borra su cuenta y acceso en la app. Los equipos que tenía quedan en el inventario, solo sin el usuario ligado.${extra}\nEsta acción no se puede deshacer.`, { title: 'Eliminar usuario', danger: true, okText: 'Sí, eliminar', cancelText: 'No, cancelar' }))) return
    setRows((rs) => rs.filter((x) => x.id !== u.id))
    try {
      if (m365) {
        // Liberar licencias y bloquear la cuenta en Microsoft 365 antes de borrar el perfil
        try {
          const lic = await msUsers('userLicenses', { id: u.email })
          for (const l of (lic?.assignedLicenses || [])) { try { await msUsers('removeLicense', { id: u.email, skuId: l.skuId }) } catch (e) { console.warn('lic', e.message) } }
          await msUsers('setEnabled', { id: u.email, userPrincipalName: u.email, enabled: false })
        } catch (e) { console.warn('offboard M365', e.message) }
      }
      await api('admin_delete_user', { p_user: u.id })
    } catch (e) { alertDialog(e.message) } finally { load() }
  }

  const disabledCount = useMemo(() => rows.filter((u) => u.active === false).length, [rows])
  // Dominios de correo presentes (para las tarjetas de filtro por proveedor)
  const domainCounts = useMemo(() => {
    const m = {}; rows.forEach((u) => {
      const passStatus = statusFilter === 'all' || (statusFilter === 'disabled' ? u.active === false : u.active !== false)
      if (passStatus) { const d = domainOf(u.email); m[d] = (m[d] || 0) + 1 }
    }); return m
  }, [rows, statusFilter])
  const domainList = useMemo(() => {
    const rank = (d) => d === 'billcapital.com' ? 0 : isBillDomain(d) ? 1 : d === 'sin dominio' ? 3 : 2
    return Object.keys(domainCounts).sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b))
  }, [domainCounts])
  const data = rows.filter((u) => (statusFilter === 'all' || (statusFilter === 'disabled' ? u.active === false : u.active !== false)) && (!roleFilter || u.role === roleFilter) && (!deptFilter || (u.department || '') === deptFilter) && (!countryFilter || (u.country || '') === countryFilter) && (!domainFilter || domainOf(u.email) === domainFilter) && (!missingFilter || (isPerson(u) && lacks(u, missingFilter))) && (!mgmtFilter || isMgmt(u)) && (!q || (u.full_name || '').toLowerCase().includes(q.toLowerCase()) || (u.email || '').toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => {
      let r = 0
      if (sortField === 'recent') r = new Date(a.last_sign_in_at || a.created_at || 0) - new Date(b.last_sign_in_at || b.created_at || 0)
      else if (sortField === 'dept') r = (a.department || '').localeCompare(b.department || '', 'es', { sensitivity: 'base' })
      else if (sortField === 'country') r = (a.country || '').localeCompare(b.country || '', 'es', { sensitivity: 'base' })
      else if (sortField === 'comp') r = (compCount[a.id] || 0) - (compCount[b.id] || 0)
      else if (sortField === 'role') r = (roleLabel[a.role] || a.role || '').localeCompare(roleLabel[b.role] || b.role || '', 'es', { sensitivity: 'base' })
      else r = (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'es', { sensitivity: 'base' })
      return sortDir === 'asc' ? r : -r
    })
  // Agrupar la lista por dominio de correo (proveedor): @billcapital.com = Microsoft 365
  const groups = useMemo(() => {
    if (!groupByDomain) return [['all', data]]
    const m = {}; const sys = []
    data.forEach((u) => {
      if (u.role === 'sistema') { sys.push(u); return }   // cuentas de sistema/entidad → sección aparte
      const d = domainOf(u.email); (m[d] = m[d] || []).push(u)
    })
    const rank = (d) => d === 'billcapital.com' ? 0 : isBillDomain(d) ? 1 : d === 'sin dominio' ? 3 : 2
    const out = Object.keys(m).sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b)).map((k) => [k, m[k]])
    if (sys.length) out.push(['__sistema__', sys])
    return out
  }, [data, groupByDomain])
  // Ordenar al tocar el encabezado (alterna asc/desc si es la misma columna)
  const setSort = (f) => { if (sortField === f) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc') } }
  const thSort = (f, label) => {
    const active = sortField === f
    const up = active && sortDir === 'asc'
    const col = active ? 'var(--lime)' : 'var(--muted)'
    const tri = {
      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
      width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
      [up ? 'borderBottom' : 'borderTop']: `9px solid ${col}`,
    }
    return (
      <th onClick={() => setSort(f)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', position: 'relative', paddingRight: '1.4rem' }}>
        {label}
        <span style={tri} />
      </th>
    )
  }
  return (
    <div className="page-usuarios">
      <div className="page-head"><div className="row">
        <div><h2>Usuarios</h2><p className="muted">Edita el perfil de cualquier persona. Los roles y permisos se definen en la sección Roles.</p></div>
        <div className="row usr-controls" style={{ gap: '.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input className="search" placeholder="Buscar por nombre o correo…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
          <button className="btn" onClick={() => exportCsv(`usuarios_${countryFilter || 'todos'}`, [
            { label: 'Nombre', value: (u) => u.full_name || '' },
            { label: 'Correo', value: 'email' },
            { label: 'Departamento', value: (u) => u.department || '' },
            { label: 'País', value: (u) => u.country || '' },
            { label: 'Rol', value: (u) => roleLabel[u.role] || u.role || '' },
            { label: 'Computadores', value: (u) => compCount[u.id] || 0 },
            { label: 'Estado', value: (u) => u.active === false ? 'Deshabilitado' : 'Activo' },
          ], data)} title="Descarga la lista visible (respeta filtros) a Excel/CSV"><Icon n="download" /> Exportar</button>
          <button className="btn" disabled={syncBusy} onClick={syncM365} title="Trae de Microsoft 365 los usuarios que aún no están en la app">{syncBusy ? 'Sincronizando…' : <><Icon n="refresh" /> Sincronizar M365</>}</button>
          <button className="btn btn-lime" onClick={() => setNewUser({ displayName: '', upnLocal: '', domain: 'billcapital.com', upnEdited: false, password: genPwd(), showPwd: true, jobTitle: '', department: '', phone: '', country: 'Chile', role: 'user', appAccess: true, forceChange: true })}>＋ Crear usuario (M365)</button>
        </div>
      </div></div>

      {loading && <SkeletonKpis n={10} />}
      {!loading && <div className="kpi-cats">
        {/* Resumen */}
        <div className="kpi-cat">
          <div className="kpi-cat-t">Resumen</div>
          <div className="kpi-grid compact kpi-sm">
            <button className={`kpi ${!roleFilter && !mgmtFilter && statusFilter === 'active' && !countryFilter && !domainFilter && !missingFilter ? 'active' : ''}`} onClick={() => { setRoleFilter(null); setMgmtFilter(false); setCountryFilter(''); setDomainFilter(''); setStatusFilter('active'); setMissingFilter('') }}>
              <div className="ico"><Icon n="users" /></div><div className="num">{rows.length}</div><div className="lbl">Todos</div>
            </button>
            <button className={`kpi mgmt-head ${mgmtFilter ? 'active' : ''} ${rolesOpen ? 'folder-open' : ''}`} onClick={() => { const willOpen = !rolesOpen; setRolesOpen(willOpen); setMgmtFilter(willOpen); setRoleFilter(null); setStatusFilter('active'); setMissingFilter('') }} title="Cargos por encima de Usuario (con acceso a la app). Ábrela para ver el detalle por rol; se puede combinar con un país.">
              <div className="ico"><Icon n="shield" /></div><div className="num">{mgmtCount}</div><div className="lbl">Cargos</div>
              <span className="chev">▾</span>
            </button>
            <button className={`kpi ${statusFilter === 'disabled' ? 'active' : ''}`} onClick={() => { setStatusFilter(statusFilter === 'disabled' ? 'active' : 'disabled'); setRoleFilter(null); setCountryFilter(''); setDomainFilter(''); setMissingFilter('') }}>
              <div className="ico"><Icon n="lock" /></div>
              <div className="num">{disabledCount}</div><div className="lbl">Deshabilitados</div>
            </button>
          </div>
        </div>
        {/* Por rol */}
        <div className="kpi-cat">
          <div className="kpi-cat-t">Por rol</div>
          <div className="kpi-grid compact kpi-sm">
            {roles.filter((r) => ['user', 'sistema', 'mic'].includes(r.key)).map((r) => (
              <button className={`kpi ${roleFilter === r.key ? 'active' : ''}`} key={r.key} onClick={() => { setRoleFilter(roleFilter === r.key ? null : r.key); setMgmtFilter(false); setRolesOpen(false); setStatusFilter('active'); setMissingFilter('') }}>
                <div className="ico"><Icon n={r.key === 'sistema' ? 'gear' : r.key === 'mic' ? 'building' : 'user'} /></div>
                <div className="num">{rows.filter((u) => u.role === r.key && u.active !== false).length}</div><div className="lbl">{r.label}</div>
              </button>
            ))}
          </div>
        </div>
        {/* Por país */}
        <div className="kpi-cat">
          <div className="kpi-cat-t">Por país</div>
          <div className="kpi-grid compact kpi-sm">
            {COUNTRIES.map(([name]) => (
              <button className={`kpi ${countryFilter === name ? 'active' : ''}`} key={name} onClick={() => { setCountryFilter(countryFilter === name ? '' : name); setStatusFilter('active'); setMissingFilter('') }}>
                <div className="ico"><Icon n="pin" /></div>
                <div className="num">{rows.filter((u) => (u.country || '') === name && u.active !== false).length}</div><div className="lbl">{name}</div>
              </button>
            ))}
          </div>
        </div>
        {/* Por dominio */}
        <div className="kpi-cat">
          <div className="kpi-cat-t">Por dominio de correo</div>
          <div className="kpi-grid compact kpi-sm">
            {domainList.map((dom) => (
              <button className={`kpi ${domainFilter === dom ? 'active' : ''}`} key={dom} onClick={() => { setDomainFilter(domainFilter === dom ? '' : dom); setStatusFilter('active'); setMissingFilter('') }} title={domainLabel(dom)}>
                <div className="ico"><Icon n={domainIcon(dom)} /></div>
                <div className="num">{domainCounts[dom]}</div><div className="lbl">{dom === 'sin dominio' ? 'Sin correo' : `@${dom}`}</div>
              </button>
            ))}
          </div>
        </div>
      </div>}

      {/* Carpeta "Cargos de gestión": detalle por rol, desplegable desde la tarjeta de arriba */}
      {!loading && rolesOpen && (
        <div className="mgmt-folder">
          <div className="mgmt-folder-t"><Icon n="shield" /> Cargos · detalle por rol</div>
          <div className="kpi-grid compact kpi-sm">
            {roles.filter((r) => !['user', 'sistema', 'mic'].includes(r.key)).map((r) => (
              <button className={`kpi ${roleFilter === r.key ? 'active' : ''}`} key={r.key} onClick={() => { setRoleFilter(roleFilter === r.key ? null : r.key); setMgmtFilter(false); setStatusFilter('active'); setMissingFilter('') }}>
                <div className="ico"><Icon n={r.permissions?.full_admin ? 'shield' : 'user'} /></div>
                <div className="num">{rows.filter((u) => u.role === r.key && u.active !== false && u.app_access !== false).length}</div><div className="lbl">{r.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Información faltante: tarjetas agregadas de lo que falta por completar (personas activas) */}
      {!loading && <div className="miss-block">
        <div className="gap-head">
          <span className="miss-title"><Icon n="alert" /> Información faltante <span className="muted">(personas activas)</span></span>
          <span className="gap-legend">
            <span className="gl crit"><span className="dot" />Crítico</span>
            <span className="gl warn"><span className="dot" />Medio</span>
            <span className="gl info"><span className="dot" />Leve</span>
          </span>
        </div>
        <div className="kpi-grid compact kpi-sm">
          {MISSING_CARDS.map((m) => (
            <button key={m.key} className={`kpi ${missSev(missingCounts[m.key])} ${missingFilter === m.key ? 'active' : ''}`}
              onClick={() => { const on = missingFilter === m.key; setMissingFilter(on ? '' : m.key); if (!on) { setStatusFilter('active'); setRoleFilter(null); setCountryFilter(''); setDomainFilter(''); setDeptFilter('') } }}>
              <div className="ico"><Icon n={m.ico} /></div>
              <div className="num">{missingCounts[m.key]}</div><div className="lbl">{m.label}</div>
            </button>
          ))}
        </div>
      </div>}

      {!loading && (countryFilter || mgmtFilter || roleFilter) && (
        <div className="filter-summary">
          <span className="fs-label">Mostrando:</span>
          {countryFilter && <span className="fs-chip">{countryFilter}</span>}
          {mgmtFilter && <span className="fs-chip">Cargos</span>}
          {roleFilter && <span className="fs-chip">{(roles.find((r) => r.key === roleFilter) || {}).label || roleFilter}</span>}
          <span className="fs-count">{data.length} persona{data.length === 1 ? '' : 's'}</span>
          <button className="btn-sm" onClick={() => { setCountryFilter(''); setMgmtFilter(false); setRoleFilter(null); setDomainFilter(''); setMissingFilter('') }}>Limpiar</button>
        </div>
      )}

      <div className="section open"><div className="sec-body"><div className="table-wrap"><table className="usr-cards">
        <thead><tr>{thSort('name', 'Persona')}{thSort('dept', 'Departamento')}{thSort('country', 'País')}{thSort('role', 'Rol')}{thSort('comp', 'Computadores')}{thSort('recent', 'Último ingreso')}
          <th className="th-filter" style={{ textAlign: 'right' }}>
            <FilterControl active={!!deptFilter || !!roleFilter || statusFilter !== 'active'}>
              <label>Departamento
                <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                  <option value="">Todos</option>{DEPTS.map((d) => <option key={d} value={d}>{deptIndentLabel(d)}</option>)}
                </select></label>
              <label>Rol
                <select value={roleFilter || ''} onChange={(e) => setRoleFilter(e.target.value || null)}>
                  <option value="">Todos</option>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select></label>
              <label>Estado
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="active">Activos</option>
                  <option value="disabled">Deshabilitados</option>
                  <option value="all">Todos</option>
                </select></label>
              <button className="btn-sm" type="button" onClick={() => { setDeptFilter(''); setRoleFilter(null); setStatusFilter('active'); setDomainFilter(''); setCountryFilter(''); setMissingFilter('') }}>Limpiar filtros</button>
            </FilterControl>
          </th></tr></thead>
        <tbody>
          {loading && <SkeletonTableRows rows={8} cols={7} />}
          {!loading && data.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: '.8rem' }}>Sin usuarios.</td></tr>}
          {!loading && groups.map(([dom, us]) => (
            <Fragment key={dom}>
              {groupByDomain && <tr className="grp-row"><td colSpan={7}><span className="grp-ico">{domainIcon(dom)}</span> {domainLabel(dom)} <span className="muted">· {us.length}</span></td></tr>}
              {us.map((u) => (
                <tr key={u.id}>
                  <td><div className="row" style={{ justifyContent: 'flex-start', gap: '.5rem' }}>
                    {u.avatar_url ? <img className="avatar-img" src={u.avatar_url} alt="" loading="lazy" decoding="async" /> : <div className="avatar sm">{initials(u.full_name || u.email)}</div>}
                    <div><strong>{u.full_name || '—'}</strong>{u.id === user?.id && <span className="badge" style={{ marginLeft: 6 }}>tú</span>}{u.active === false && <span className="badge s-rejected" style={{ marginLeft: 6 }}>Deshabilitado</span>}{u.app_access === false && <span className="badge" style={{ marginLeft: 6 }} title="Solo para organización · sin acceso a la app"><Icon n="ban" /> Sin acceso</span>}<br /><span className="muted">{u.email}</span></div>
                  </div></td>
                  <td>{u.department || <span className="muted">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{u.country ? <span>{flagOf(u.country)} {u.country}</span> : <span className="muted">—</span>}</td>
                  <td><span className="badge">{roleLabel[u.role] || (isSuper ? u.role : 'Administrador')}</span></td>
                  <td>{compCount[u.id] ? <span className="badge comp-badge"><span className="emo"><Icon n="monitor" /></span><span className="comp-n">{compCount[u.id]}</span></span> : <span className="muted comp-badge"><span className="emo"><Icon n="monitor" /></span><span className="comp-n">0</span></span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{u.last_sign_in_at ? fmt(u.last_sign_in_at) : <span className="muted">Nunca</span>}</td>
                  <td className="actions">{(roleLabel[u.role] || isSuper) ? <>
                    <button className="btn-sm" onClick={() => setEdit({ ...u, full_name: u.full_name || '', phone: u.phone || '', avatar_url: u.avatar_url || '', _avatar0: u.avatar_url || '', admin_notes: u.admin_notes || '' })}>Editar</button>{' '}
                    {u.id !== user?.id && (u.active === false
                      ? <button className="btn-sm btn-lime" onClick={() => setUserActive(u, true)}>Reactivar</button>
                      : <button className="btn-sm" onClick={() => setUserActive(u, false)}>Deshabilitar</button>)}{' '}
                    {isSuper && u.id !== user?.id && <button className="btn-sm btn-danger" onClick={() => delUser(u)}>Eliminar</button>}
                  </> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table></div></div></div>

      {/* Registro de cambios (últimas 24h) */}
      <div className={`section ${logOpen ? 'open' : ''}`} style={{ marginTop: '1rem' }}>
        <button className="sec-head compact" onClick={() => setLogOpen((v) => !v)}>
          <span className="ico"><Icon n="folder" /></span><span className="t"><strong>Registro de cambios</strong><br /><span className="muted">Últimos 31 días · {log.length} cambio(s)</span></span>
          <span className="count">{log.length}</span><span className="chev">▾</span>
        </button>
        {logOpen && <div className="sec-body"><div className="table-wrap"><table>
          <thead><tr><th>Fecha y hora</th><th>Responsable</th><th>Cambio</th>{isSuper && <th></th>}</tr></thead>
          <tbody>
            {log.length === 0 && <tr><td colSpan={isSuper ? 4 : 3} className="muted" style={{ padding: '.8rem' }}>No hay cambios en los últimos 31 días.</td></tr>}
            {log.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmt(l.created_at)}</td>
                <td>{l.actor_name}</td>
                <td><strong>{l.target_name}</strong> · <span className="muted">{l.detail}</span></td>
                {isSuper && <td className="actions"><button className="btn-sm btn-danger" onClick={async () => { if (await confirmDialog('¿Eliminar esta entrada del registro?', { title: 'Eliminar entrada', danger: true, okText: 'Eliminar' })) { try { await api('audit_delete', { p_id: l.id }); load() } catch (e) { alertDialog(e.message) } } }}>Eliminar</button></td>}
              </tr>
            ))}
          </tbody>
        </table></div></div>}
      </div>

      {/* Modal editar perfil */}
      {edit && (
        <div className="backdrop open">
          <div className="modal pf-modal">
            <div className="pf-head">
              {edit.avatar_url ? <img className="big-avatar" src={edit.avatar_url} alt="" /> : <div className="big">{initials(edit.full_name || edit.email)}</div>}
              <div className="pf-head-info">
                <h3>Editar perfil</h3>
                <p className="muted">{edit.email}</p>
                <div className="pf-head-actions">
                  <button className="btn-sm" onClick={() => fileRef.current?.click()}>{edit.avatar_url ? 'Cambiar foto' : 'Subir foto'}</button>
                  {edit.avatar_url && <button className="btn-sm btn-danger" onClick={() => setEdit({ ...edit, avatar_url: '' })}>Quitar foto</button>}
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
                </div>
              </div>
            </div>
            <div className="pf-fields">
              <div><label>Nombre</label><input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></div>
              <div><label>Teléfono</label><input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="+56 9 ..." /></div>
              <div><label>Departamento</label>
                <select value={edit.department || ''} onChange={(e) => setEdit({ ...edit, department: e.target.value })}>
                  <option value="">— Sin asignar</option>{DEPTS.map((d) => <option key={d} value={d}>{deptIndentLabel(d)}</option>)}
                </select></div>
              <div><label>País</label>
                <select value={edit.country || ''} onChange={(e) => setEdit({ ...edit, country: e.target.value })}>
                  <option value="">— Sin país</option>{COUNTRIES.map(([n, f]) => <option key={n} value={n}>{f} {n}</option>)}
                </select></div>
              <div><label>Rol</label>
                <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} disabled={edit.id === user?.id}>
                  {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                {edit.id === user?.id && <span className="muted" style={{ fontSize: '.75rem' }}>No puedes cambiar tu propio rol</span>}
              </div>
            </div>
            <div className="pf-section">
              <div className="pf-section-head">Computadores asignados <span className="muted">— {compsOf(edit).length} en inventario</span></div>
              {compsOf(edit).length > 0 ? (
                <ul className="pf-list">
                  {compsOf(edit).map((c) => (
                    <li key={c.id} className="pf-list-item">
                      <span><Icon n="monitor" /> {[c.name, c.brand, c.model].filter(Boolean).join(' ') || 'Computador'}{c.serial_number ? ` · ${c.serial_number}` : ''}</span>
                      <span className="btns">
                        <button type="button" className="btn-sm" onClick={() => nav(`/equipo/${c.id}`)}>Ver ficha</button>
                        <button type="button" className="btn-sm btn-danger" disabled={compBusy} onClick={() => unassignComp(c)}>Quitar</button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted pf-empty">Sin computadores asignados.</p>}
              <div className="pf-assign">
                <select value={assignPick} onChange={(e) => setAssignPick(e.target.value)}>
                  <option value="">Asignar uno del stock (disponible)…</option>
                  {freeComps.map((c) => <option key={c.id} value={c.id}>{[c.name, c.brand, c.model].filter(Boolean).join(' ') || 'Computador'}{c.serial_number ? ` · ${c.serial_number}` : ''}</option>)}
                </select>
                <button type="button" className="btn-sm" disabled={compBusy || !assignPick} onClick={assignExisting}>Asignar</button>
              </div>
              <div className="pf-assign">
                <label className="pf-inline-lbl">Total que debe tener</label>
                <input type="number" min={compCur} style={{ width: 80, flex: 'none' }} value={compTarget} onChange={(e) => setCompTarget(e.target.value)} />
                <button type="button" className="btn-sm btn-lime" disabled={compBusy || compToCreate <= 0} onClick={applyComps}>{compBusy ? 'Registrando…' : 'Registrar'}</button>
                <span className="muted" style={{ fontSize: '.74rem' }}>{compToCreate > 0 ? `Tiene ${compCur} · se registrarán ${compToCreate}` : `Tiene ${compCur} · nada por crear`}</span>
              </div>
              <p className="muted pf-hint">Indica el total que debe tener: se registran solo los que faltan. Si ya tiene esa cantidad, no crea nada. Al quitar, el equipo NO se elimina: queda como "Sin asignar" en el inventario.</p>
            </div>
            <div className="pf-section">
              <div className="pf-section-head">Periféricos asignados <span className="muted">— {myPeriphs.reduce((n, a) => n + (a.qty || 0), 0)} unidad(es)</span></div>
              {myPeriphs.length > 0 ? (
                <ul className="pf-list">
                  {myPeriphs.map((a) => (
                    <li key={a.peripheral_id} className="pf-list-item">
                      <span><Icon n="mouse" /> {periphById[a.peripheral_id]?.name || 'Periférico'}{periphById[a.peripheral_id]?.model ? ` · ${periphById[a.peripheral_id].model}` : ''} <span className="badge">{a.qty}</span></span>
                      <button type="button" className="btn-sm btn-danger" disabled={compBusy} onClick={() => removePeriphUser(a.peripheral_id)}>Quitar</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted pf-empty">Sin periféricos asignados.</p>}
              <div className="pf-assign">
                <select value={pPick.per} onChange={(e) => setPPick({ ...pPick, per: e.target.value })}>
                  <option value="">Asignar periférico…</option>
                  {periphs.map((p) => <option key={p.id} value={p.id} disabled={(periphAvail[p.id] || 0) <= 0}>{p.name}{p.model ? ` · ${p.model}` : ''} (disp: {periphAvail[p.id] || 0})</option>)}
                </select>
                <input type="number" min="1" max={pPick.per ? (periphAvail[pPick.per] || 0) : undefined} style={{ width: 64, flex: 'none' }} value={pPick.qty} onChange={(e) => setPPick({ ...pPick, qty: e.target.value })} />
                <button type="button" className="btn-sm" disabled={compBusy || !pPick.per || Number(pPick.qty) < 1 || Number(pPick.qty) > (periphAvail[pPick.per] || 0)} onClick={assignPeriphUser}>Asignar</button>
              </div>
            </div>
            {isM365(edit.email) && (
              <div className="pf-section">
                <div className="pf-section-head">Licencias de Microsoft 365</div>
                {!msLic && <p className="muted pf-empty">Cargando licencias…</p>}
                {msLic?.error && <p className="muted pf-empty" style={{ color: 'var(--danger)' }}>No se pudieron cargar: {msLic.error}</p>}
                {msLic && !msLic.error && (<>
                  {(msLic.assignedLicenses || []).length > 0 ? (
                    <ul className="pf-list">
                      {msLic.assignedLicenses.map((l) => {
                        const sku = msSkus.find((s) => s.skuId === l.skuId)
                        const nm = skuName(sku?.skuPartNumber) || l.skuId
                        return (
                          <li key={l.skuId} className="pf-list-item">
                            <span><Icon n="file" /> {nm}</span>
                            <button type="button" className="btn-sm btn-danger" disabled={licBusy} onClick={() => removeLic(l.skuId, nm)}>Quitar</button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : <p className="muted pf-empty">Sin licencias asignadas.</p>}
                  <div className="pf-assign">
                    <select value={licPick} onChange={(e) => setLicPick(e.target.value)}>
                      <option value="">Asignar licencia…</option>
                      {msSkus.filter((s) => s.available > 0 && !(msLic.assignedLicenses || []).some((l) => l.skuId === s.skuId)).map((s) => (
                        <option key={s.skuId} value={s.skuId}>{skuName(s.skuPartNumber)} ({s.available} disp.)</option>
                      ))}
                    </select>
                    <button type="button" className="btn-sm btn-lime" disabled={licBusy || !licPick} onClick={() => assignLic(licPick)}>{licBusy ? 'Aplicando…' : 'Asignar'}</button>
                  </div>
                  <p className="muted pf-hint">Solo se muestran licencias con unidades disponibles. Asignar una licencia habilita sus servicios (Office, Exchange/Outlook, etc.) para la persona.</p>
                </>)}
              </div>
            )}
            <div className="pf-section">
              <div className="pf-section-head">Información adicional <span className="muted">— solo administradores · no afecta el sistema</span></div>
              <textarea value={edit.admin_notes || ''} onChange={(e) => setEdit({ ...edit, admin_notes: e.target.value })} placeholder="Correo alterno, credenciales, notas internas…" style={{ minHeight: 70, marginTop: 0 }} />
            </div>
            <div className="modal-actions pf-actions" style={{ justifyContent: 'space-between' }}>
              {isM365(edit.email)
                ? <button className="btn" disabled={msBusy} onClick={() => resetMsPassword(edit)} title="Establece una contraseña temporal en Microsoft 365"><Icon n="key" /> Restablecer contraseña (M365)</button>
                : <span />}
              <span style={{ display: 'flex', gap: '.5rem' }}>
                <button className="btn" onClick={() => setEdit(null)}>Cancelar</button>
                <button className="btn btn-primary" onClick={save}>Guardar cambios</button>
              </span>
            </div>

            {cropImg && (
              <div className="backdrop open" style={{ zIndex: 60 }}>
                <div className="modal" style={{ maxWidth: 320, textAlign: 'center' }}>
                  <h3>Recorta la foto</h3>
                  <p className="muted" style={{ marginTop: 0 }}>Arrastra y acerca. Se guardará circular.</p>
                  <div className="cropper" style={{ width: VIEW, height: VIEW }}
                    onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                    onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}>
                    <img src={cropImg.src} draggable="false" alt="" style={{ position: 'absolute', width: cropImg.width * scale, height: cropImg.height * scale, left: (VIEW - cropImg.width * scale) / 2 + off.x, top: (VIEW - cropImg.height * scale) / 2 + off.y }} />
                    <div className="crop-mask" />
                  </div>
                  <input type="range" min={minScale} max={minScale * 4} step="0.01" value={scale} onChange={(e) => { const sc = Number(e.target.value); setScale(sc); setOff((o) => clampOff(o, sc)) }} style={{ width: VIEW, marginTop: '.7rem' }} />
                  <div className="modal-actions" style={{ justifyContent: 'center' }}>
                    <button className="btn" onClick={() => setCropImg(null)}>Cancelar</button>
                    <button className="btn btn-primary" onClick={applyCrop}>Usar foto</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal crear usuario en Microsoft 365 */}
      {newUser && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Crear usuario en Microsoft 365</h3>
            <p className="muted" style={{ marginTop: 0 }}>Se crea la cuenta en Microsoft 365 y se prepara su perfil en la app. El usuario deberá cambiar la contraseña al primer ingreso.</p>
            <div className="pf-fields">
              <div style={{ gridColumn: '1 / -1' }}><label>Nombre para mostrar</label>
                <input value={newUser.displayName} placeholder="Ej: María Pérez"
                  onChange={(e) => setNewUser((n) => ({ ...n, displayName: e.target.value, upnLocal: n.upnEdited ? n.upnLocal : upnSlug(e.target.value) }))} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label>Correo</label>
                <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                  <input value={newUser.upnLocal} placeholder="maria.perez" style={{ flex: '3 1 auto', minWidth: 140 }}
                    onChange={(e) => setNewUser({ ...newUser, upnLocal: e.target.value, upnEdited: true })} />
                  <span className="muted">@</span>
                  <select value={newUser.domain} style={{ flex: '0 0 auto', width: 170 }} onChange={(e) => setNewUser({ ...newUser, domain: e.target.value })}>
                    {MS_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {newUser.upnLocal && <p className="muted" style={{ fontSize: '.72rem', margin: '.25rem 0 0' }}>Se creará: <strong>{upnSlug(newUser.upnLocal)}@{newUser.domain}</strong></p>}
              </div>
              <div style={{ gridColumn: '1 / -1' }}><label>Contraseña temporal</label>
                <div style={{ display: 'flex', gap: '.35rem' }}>
                  <input type={newUser.showPwd ? 'text' : 'password'} value={newUser.password} placeholder="mínimo 8 caracteres" style={{ flex: 1, minWidth: 0 }}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
                  <button type="button" className="btn-sm" title={newUser.showPwd ? 'Ocultar' : 'Ver'} onClick={() => setNewUser({ ...newUser, showPwd: !newUser.showPwd })}><Icon n={newUser.showPwd ? 'eyeOff' : 'eye'} /></button>
                  <button type="button" className="btn-sm" title="Copiar" onClick={() => { try { navigator.clipboard?.writeText(newUser.password) } catch { /* noop */ } }}><Icon n="copy" /></button>
                  <button type="button" className="btn-sm" onClick={() => setNewUser({ ...newUser, password: genPwd(), showPwd: true })}>Generar</button>
                </div>
              </div>
              <div><label>Cargo</label><input value={newUser.jobTitle} onChange={(e) => setNewUser({ ...newUser, jobTitle: e.target.value })} /></div>
              <div><label>Teléfono</label><input value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} placeholder="+56 9 ..." /></div>
              <div><label>Departamento</label>
                <select value={newUser.department} onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}>
                  <option value="">— Sin asignar</option>{DEPTS.map((d) => <option key={d} value={d}>{deptIndentLabel(d)}</option>)}
                </select></div>
              <div><label>País</label>
                <select value={newUser.country} onChange={(e) => setNewUser({ ...newUser, country: e.target.value })}>
                  {COUNTRIES.map(([n, f]) => <option key={n} value={n}>{f} {n}</option>)}
                </select></div>
              <div><label>Rol</label>
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value, ...(e.target.value === 'sistema' ? { appAccess: false } : {}) })}>
                  {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                {newUser.role === 'sistema' && <span className="muted" style={{ fontSize: '.72rem' }}>Cuenta de entidad / buzón compartido (sin acceso a la app).</span>}
              </div>
              <div><label>Acceso a la app</label>
                <select value={newUser.appAccess ? 'si' : 'no'} onChange={(e) => setNewUser({ ...newUser, appAccess: e.target.value === 'si' })}>
                  <option value="si">Con acceso</option>
                  <option value="no">Solo organización (sin acceso)</option>
                </select></div>
            </div>
            <label className="perm-row" style={{ marginTop: '.6rem' }}>
              <input type="checkbox" checked={newUser.forceChange !== false} onChange={(e) => setNewUser({ ...newUser, forceChange: e.target.checked })} />
              <span>Pedir cambio de contraseña en el primer ingreso</span>
            </label>
            <div className="modal-actions"><button className="btn" onClick={() => setNewUser(null)}>Cancelar</button><button className="btn btn-primary" disabled={msBusy} onClick={createMsUser}>{msBusy ? 'Creando…' : 'Crear en Microsoft 365'}</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
