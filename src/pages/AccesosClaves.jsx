import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { confirmDialog, alertDialog } from '../lib/ui'
import { loadDeptNames, DEFAULT_DEPTS, deptIndentLabel } from '../lib/depts'
import SortControl from '../components/SortControl'
import FilterControl from '../components/FilterControl'
import { Icon, sectionIconName } from '../lib/icons'
import { useAuth } from '../context/AuthContext'
import { SkeletonKpis, SkeletonRows } from '../components/Skeleton'

// Secciones que son claves/credenciales
const CRED_NAMES = ['Servicios y accesos admin', 'Redes WiFi', 'Correos y cuentas']

// Muestra la contraseña enmascarada con un botón para revelar/ocultar
function PassCell({ value }) {
  const [show, setShow] = useState(false)
  if (!value) return <span className="muted">—</span>
  return (
    <span className="pass-cell" style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
      <span style={{ fontFamily: 'monospace', letterSpacing: show ? 0 : '.12em' }}>{show ? value : '••••••••'}</span>
      <button type="button" className="pass-eye" title={show ? 'Ocultar' : 'Ver'} onClick={() => setShow((s) => !s)}><Icon n={show ? 'eyeOff' : 'eye'} /></button>
    </span>
  )
}
const emptyCred = (section_id) => ({ name: '', condition: 'Bueno', antivirus: '', assigned_to_name: '', assigned_to_email: '', section_id, attributes: {}, image_url: '' })

export default function AccesosClaves() {
  // Candado propio: aunque el componente se monte desde otra página, solo el admin edita claves
  const { isAdmin } = useAuth()
  const roClaves = !isAdmin
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [users, setUsers] = useState([])
  const [DEPTS, setDEPTS] = useState(DEFAULT_DEPTS)
  const [open, setOpen] = useState({})
  const [edit, setEdit] = useState(null)
  const [credSel, setCredSel] = useState(null)
  const [assignMode, setAssignMode] = useState('user')
  const [manualAssign, setManualAssign] = useState(false)
  const [fq, setFq] = useState({})       // búsqueda por carpeta
  const [fsort, setFsort] = useState({}) // criterio de orden por carpeta
  const [fdir, setFdir] = useState({})   // dirección por carpeta
  const [ffilter, setFfilter] = useState({}) // filtros por carpeta { falta, dom, dept }
  const [fgroup, setFgroup] = useState({})   // agrupar por carpeta: '' | 'dom' | 'dept'
  const [copiedId, setCopiedId] = useState(null)

  // Copia los datos con el formato que corresponde al tipo de clave:
  // una red WiFi no tiene "usuario" ni "correo" — tiene nombre de red.
  const copyCred = async (e, secName = '') => {
    const limpio = (e.name || '').replace(/^(WiFi|Cuenta|Servicio)\s*·\s*/i, '')
    const correo = e.attributes?.usuario || e.assigned_to_email || ''
    const pass = e.attributes?.contrasena || ''
    let lineas
    if (/wifi|redes/i.test(secName)) lineas = [`Red: ${limpio}`, `Contraseña: ${pass}`]
    else if (/correo|cuenta/i.test(secName)) lineas = [`Cuenta: ${limpio}`, correo ? `Correo: ${correo}` : '', `Contraseña: ${pass}`]
    else lineas = [`Servicio: ${limpio}`, correo ? `Usuario: ${correo}` : '', `Contraseña: ${pass}`]
    const txt = lineas.filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(txt)
      setCopiedId(e.id); setTimeout(() => setCopiedId((c) => (c === e.id ? null : c)), 1500)
    } catch (err) { alertDialog('No se pudo copiar: ' + err.message) }
  }

  useEffect(() => { loadDeptNames().then(setDEPTS) }, [])

  const load = useCallback(async () => {
    const [{ data: secs }, { data: eq }, { data: us }] = await Promise.all([
      supabase.from('equipment_sections').select('id,name,icon,fields,assign_to').order('name'),
      supabase.from('equipment').select('id,name,assigned_to_name,assigned_to_email,section_id,attributes,created_at').is('returned_at', null).order('name'),
      supabase.from('profiles').select('id,full_name,email,department,app_access').order('full_name'),
    ])
    const cred = (secs ?? []).filter((s) => CRED_NAMES.includes(s.name))
    const credIds = new Set(cred.map((s) => s.id))
    setSections(cred)
    setItems((eq ?? []).filter((e) => credIds.has(e.section_id)))
    setUsers((us ?? []).filter((u) => u.app_access !== false))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    setManualAssign(false)
    const sec = sections.find((x) => x.id === edit?.section_id)
    setAssignMode(edit?.assigned_to_email ? 'user' : (sec?.assign_to === 'department' ? 'department' : 'user'))
  }, [edit?.id, edit?.section_id, sections])

  const secById = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s])), [sections])
  // Departamento de cada persona por correo, y dominio de una clave
  const deptByEmail = useMemo(() => Object.fromEntries(users.map((u) => [String(u.email || '').toLowerCase(), u.department || ''])), [users])
  const credEmail = (e) => String(e.assigned_to_email || (/@/.test(e.attributes?.usuario || '') ? e.attributes.usuario : '') || '').toLowerCase()
  const credDom = (e) => credEmail(e).split('@')[1] || ''
  const credDept = (e) => deptByEmail[credEmail(e)] || ''
  const bySection = useMemo(() => { const g = {}; items.forEach((e) => { (g[e.section_id] = g[e.section_id] || []).push(e) }); return g }, [items])

  const credGaps = useMemo(() => {
    const map = {}
    const add = (key, label, e) => { (map[key] = map[key] || { key, label, items: [] }).items.push(e) }
    items.forEach((e) => {
      const s = secById[e.section_id]; if (!s) return
      if (!(e.attributes?.contrasena || '').trim()) add('sin_pass', 'Sin contraseña', e)
      if (s.name !== 'Redes WiFi' && !(e.assigned_to_name || e.assigned_to_email)) add('sin_asig', 'Sin asignar', e)
      if (s.name === 'Servicios y accesos admin' && !(e.attributes?.usuario || '').trim()) add('sin_user', 'Sin usuario', e)
    })
    return map
  }, [items, secById])
  const credCards = useMemo(() => Object.values(credGaps).sort((a, b) => b.items.length - a.items.length).map((g) => ({ key: g.key, label: g.label, n: g.items.length })), [credGaps])

  const saveCred = async () => {
    if (!(edit.name || '').trim()) return alertDialog('Indica el nombre.')
    try { await api('equipment_upsert', { p: edit }); setEdit(null); load() } catch (e) { alertDialog(e.message) }
  }
  const delCred = async (e) => {
    if (!(await confirmDialog(`¿Eliminar "${e.name}"?`, { title: 'Eliminar registro', danger: true, okText: 'Eliminar' }))) return
    setItems((its) => its.filter((x) => x.id !== e.id))
    try { await api('equipment_delete', { p_id: e.id }) } catch (er) { alertDialog(er.message) } finally { load() }
  }

  return (
    <div>
      {loading && <><SkeletonKpis n={4} /><SkeletonRows n={3} /></>}
      {/* Resumen */}
      {!loading && <div className="kpi-grid compact">
        <button className="kpi kpi-all" onClick={() => setOpen({})}>
          <span className="ico"><Icon n="lock" /></span>
          <div><div className="num">{items.length}</div><div className="lbl">Registros de claves</div></div>
        </button>
        {sections.map((s) => (
          <button key={s.id} className={`kpi ${open[s.id] ? 'active' : ''}`} onClick={() => setOpen({ [s.id]: true })}>
            <div className="ico"><Icon n={sectionIconName(s.name)} /></div>
            <div className="num">{(bySection[s.id] || []).length}</div>
            <div className="lbl">{s.name}</div>
          </button>
        ))}
      </div>}

      {/* Datos faltantes */}
      {credCards.length > 0 && (
        <div style={{ margin: '.8rem 0' }}>
          <div className="muted" style={{ fontSize: '.8rem', margin: '0 0 .35rem' }}>Datos faltantes — toca una tarjeta para ver el detalle</div>
          <div className="kpi-grid compact">
            {credCards.map((c) => (
              <button key={c.key} className={`kpi ${credSel === c.key ? 'active' : ''}`} onClick={() => setCredSel(credSel === c.key ? null : c.key)}>
                <div className="ico"><Icon n="alert" /></div><div className="num">{c.n}</div><div className="lbl">{c.label}</div>
              </button>
            ))}
          </div>
          {credSel && (() => {
            const rows = [...(credGaps[credSel]?.items || [])].sort((a, b) => a.name.localeCompare(b.name, 'es'))
            return (
              <div className="section open" style={{ marginTop: '.5rem' }}><div className="sec-body">
                <div className="row" style={{ marginBottom: '.4rem' }}><strong>{credGaps[credSel]?.label} · {rows.length}</strong><button className="btn-sm" onClick={() => setCredSel(null)}><Icon n="close" /> Cerrar</button></div>
                <div className="table-wrap"><table className="tbl-compact">
                  <thead><tr><th>Nombre</th><th>Asignado a</th><th>Contraseña</th><th></th></tr></thead>
                  <tbody>{rows.map((e) => (
                    <tr key={e.id}>
                      <td><strong>{e.name}</strong></td>
                      <td>{e.assigned_to_name || e.assigned_to_email || <span className="muted">—</span>}</td>
                      <td><PassCell value={e.attributes?.contrasena} /></td>
                      <td className="actions"><button className="btn-sm" onClick={() => setEdit({ ...emptyCred(e.section_id), ...e, attributes: e.attributes || {} })}>Completar</button></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </div></div>
            )
          })()}
        </div>
      )}

      {/* Carpetas por tipo */}
      {sections.map((s) => {
        const all = bySection[s.id] || []
        const q = (fq[s.id] || '').trim().toLowerCase()
        const falta = ffilter[s.id]?.falta || ''
        let filtered = all.filter((e) => !q || `${e.name || ''} ${e.assigned_to_name || ''} ${e.assigned_to_email || ''} ${e.attributes?.usuario || ''}`.toLowerCase().includes(q))
        if (falta === 'pass') filtered = filtered.filter((e) => !(e.attributes?.contrasena || '').trim())
        else if (falta === 'asig') filtered = filtered.filter((e) => !(e.assigned_to_name || e.assigned_to_email))
        const fDom = ffilter[s.id]?.dom || '', fDept = ffilter[s.id]?.dept || ''
        if (fDom) filtered = filtered.filter((e) => credDom(e) === fDom)
        if (fDept) filtered = filtered.filter((e) => (fDept === '__sin__' ? !credDept(e) : credDept(e) === fDept))
        // Opciones de los filtros, sacadas de lo que hay en la carpeta
        const domOpts = [...new Set(all.map(credDom).filter(Boolean))].sort()
        const deptOpts = [...new Set(all.map(credDept).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
        const grp = fgroup[s.id] || ''
        const field = fsort[s.id] || 'recent'
        const dir = fdir[s.id] || (field === 'recent' ? 'desc' : 'asc')
        const cmp = (a, b) => field === 'recent'
          ? new Date(a.created_at || 0) - new Date(b.created_at || 0)
          : (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })
        const sorted = [...filtered].sort(cmp)
        const rows = dir === 'desc' ? sorted.reverse() : sorted
        const isOpen = !!open[s.id]
        const showAssigned = all.some((r) => r.assigned_to_name)
        const showUser = (s.fields || []).some((f) => f.key === 'usuario')
        const cols = 2 + (showAssigned ? 1 : 0) + (showUser ? 1 : 0)
        return (
          <div className={`section ${isOpen ? 'open' : ''}`} key={s.id} style={{ marginBottom: '.8rem' }}>
            <button className="sec-head compact" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
              <span className="ico"><Icon n={sectionIconName(s.name)} /></span>
              <span className="t"><strong>{s.name}</strong><br /><span className="muted">{all.length} registro(s)</span></span>
              <span className="count">{all.length}</span><span className="chev">▾</span>
            </button>
            {isOpen && (
              <div className="sec-body">
                <div className="row" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
                  {!roClaves && <button className="btn-sm btn-lime" onClick={() => setEdit({ ...emptyCred(s.id) })}>＋ Agregar {s.name.toLowerCase()}</button>}
                  <input placeholder="Buscar en esta carpeta…" value={fq[s.id] || ''} onChange={(e) => setFq((o) => ({ ...o, [s.id]: e.target.value }))} style={{ flex: 1, minWidth: 200 }} />
                  <SortControl
                    fields={[{ value: 'recent', label: 'Más recientes' }, { value: 'name', label: 'Nombre' }]}
                    field={fsort[s.id] || 'recent'} dir={fdir[s.id] || ((fsort[s.id] || 'recent') === 'recent' ? 'desc' : 'asc')}
                    onField={(v) => setFsort((o) => ({ ...o, [s.id]: v }))}
                    onToggleDir={() => setFdir((d) => { const cur = d[s.id] || ((fsort[s.id] || 'recent') === 'recent' ? 'desc' : 'asc'); return { ...d, [s.id]: cur === 'asc' ? 'desc' : 'asc' } })} />
                  {(domOpts.length > 1 || deptOpts.length > 0) && (
                    <label className="sort-ctl">Agrupar:
                      <select value={grp} onChange={(e) => setFgroup((o) => ({ ...o, [s.id]: e.target.value }))}>
                        <option value="">Sin agrupar</option>
                        {domOpts.length > 1 && <option value="dom">Por dominio</option>}
                        {deptOpts.length > 0 && <option value="dept">Por departamento</option>}
                      </select>
                    </label>
                  )}
                  <FilterControl active={!!(ffilter[s.id]?.falta || ffilter[s.id]?.dom || ffilter[s.id]?.dept)}>
                    <label>Mostrar
                      <select value={ffilter[s.id]?.falta || ''} onChange={(e) => setFfilter((o) => ({ ...o, [s.id]: { ...o[s.id], falta: e.target.value } }))}>
                        <option value="">Todos</option>
                        <option value="pass">Sin contraseña</option>
                        <option value="asig">Sin asignar</option>
                      </select></label>
                    {domOpts.length > 1 && <label>Dominio
                      <select value={ffilter[s.id]?.dom || ''} onChange={(e) => setFfilter((o) => ({ ...o, [s.id]: { ...o[s.id], dom: e.target.value } }))}>
                        <option value="">Todos</option>
                        {domOpts.map((d) => <option key={d} value={d}>@{d}</option>)}
                      </select></label>}
                    {deptOpts.length > 0 && <label>Departamento
                      <select value={ffilter[s.id]?.dept || ''} onChange={(e) => setFfilter((o) => ({ ...o, [s.id]: { ...o[s.id], dept: e.target.value } }))}>
                        <option value="">Todos</option>
                        {deptOpts.map((d) => <option key={d} value={d}>{d}</option>)}
                        <option value="__sin__">Sin departamento</option>
                      </select></label>}
                    <button className="btn-sm" type="button" onClick={() => setFfilter((o) => ({ ...o, [s.id]: {} }))}>Limpiar filtros</button>
                  </FilterControl>
                </div>
                <div className="table-wrap"><table className="tbl-compact cred-cards">
                  <thead><tr>
                    <th>Nombre</th>{showAssigned && <th>Asignado a</th>}{showUser && <th>Usuario / correo</th>}<th>Contraseña</th><th></th>
                  </tr></thead>
                  <tbody>
                    {rows.length === 0 && <tr><td colSpan={cols} className="muted" style={{ padding: '.7rem' }}>Sin registros.</td></tr>}
                    {(grp ? (() => {
                      const key = grp === 'dom' ? credDom : credDept
                      const label = (k) => (k ? (grp === 'dom' ? '@' + k : k) : (grp === 'dom' ? 'Sin correo' : 'Sin departamento'))
                      const gmap = {}
                      rows.forEach((e) => { const k = key(e); (gmap[k] = gmap[k] || []).push(e) })
                      return Object.keys(gmap).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'es')))
                        .flatMap((k) => [{ __grp: label(k), __n: gmap[k].length, id: 'g-' + k }, ...gmap[k]])
                    })() : rows).map((e) => {
                      if (e.__grp) return <tr key={e.id} className="grp-row cred-grp"><td colSpan={cols}><span className="grp-lbl">{e.__grp}</span><span className="grp-count">{e.__n}</span></td></tr>
                      const pass = e.attributes?.contrasena || ''
                      return (
                        <tr key={e.id}>
                          <td><strong>{e.name}</strong></td>
                          {showAssigned && <td>{e.assigned_to_name || <span className="muted">Sin asignar</span>}{e.assigned_to_email && <><br /><span className="muted">{e.assigned_to_email}</span></>}</td>}
                          {showUser && <td>{e.attributes?.usuario || e.assigned_to_email || <span className="muted">—</span>}</td>}
                          <td><PassCell value={pass} /></td>
                          <td className="actions">
                            <button className="btn-sm" onClick={() => copyCred(e, s.name)}>{copiedId === e.id ? <><Icon n="check" /> Copiado</> : <><Icon n="copy" /> Copiar</>}</button>{' '}
                            {!roClaves && <><button className="btn-sm" onClick={() => setEdit({ ...emptyCred(s.id), ...e, attributes: e.attributes || {} })}>Editar</button>{' '}</>}
                            {!roClaves && <button className="btn-sm btn-danger" onClick={() => delCred(e)}>Eliminar</button>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table></div>
              </div>
            )}
          </div>
        )
      })}

      {/* Modal editar / agregar credencial */}
      {edit && (() => {
        const s = secById[edit.section_id] || { fields: [], assign_to: 'user', name: 'registro' }
        const setAttr = (k, v) => setEdit({ ...edit, attributes: { ...(edit.attributes || {}), [k]: v } })
        return (
          <div className="backdrop open">
            <div className="modal">
              <h3>{edit.id ? 'Editar' : 'Agregar'} {s.name.toLowerCase()}</h3>
              <div className="pf-fields">
                <div style={{ gridColumn: '1 / -1' }}><label>Nombre</label><input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ej: Cuenta · Operaciones" autoFocus /></div>

                {(s.fields || []).map((f) => (
                  <div key={f.key}><label>{f.label}{f.required && <span style={{ color: 'var(--danger)' }}> *</span>}</label>
                    {f.type === 'select'
                      ? <select value={edit.attributes?.[f.key] || ''} onChange={(e) => setAttr(f.key, e.target.value)}><option value="">—</option>{(f.options || []).map((o) => <option key={o}>{o}</option>)}</select>
                      : f.type === 'bool'
                        ? <select value={edit.attributes?.[f.key] || ''} onChange={(e) => setAttr(f.key, e.target.value)}><option value="">—</option><option value="Sí">Sí</option><option value="No">No</option></select>
                        : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
                            value={edit.attributes?.[f.key] || ''} onChange={(e) => setAttr(f.key, e.target.value)} />}
                  </div>
                ))}

                {s.name !== 'Redes WiFi' && (<>
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
                          setEdit((ed) => ({ ...ed, assigned_to_email: v, assigned_to_name: u ? (u.full_name || u.email) : '' }))
                        }}>
                        <option value="">— Sin asignar</option>
                        {users.map((u) => <option key={u.id} value={u.email}>{(u.full_name || 'Sin nombre')} — {u.email}</option>)}
                        {edit.assigned_to_email && !users.some((u) => u.email === edit.assigned_to_email) &&
                          <option value={edit.assigned_to_email}>{edit.assigned_to_name || 'Actual'} — {edit.assigned_to_email} (actual)</option>}
                        <option value="__manual__">Escribir manualmente (externo)…</option>
                      </select>
                    </div>
                    {manualAssign && (<>
                      <div><label>Asignado a (nombre)</label><input value={edit.assigned_to_name || ''} onChange={(e) => setEdit({ ...edit, assigned_to_name: e.target.value })} /></div>
                      <div><label>Correo asignado</label><input value={edit.assigned_to_email || ''} onChange={(e) => setEdit({ ...edit, assigned_to_email: e.target.value })} placeholder="externo@dominio.com" /></div>
                    </>)}
                  </>)}
                </>)}
              </div>
              <div className="modal-actions"><button className="btn" onClick={() => setEdit(null)}>Cancelar</button>{!roClaves && <button className="btn btn-primary" onClick={saveCred}>Guardar</button>}</div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
