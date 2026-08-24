import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { confirmDialog, alertDialog } from '../lib/ui'
import AccesosClaves from './AccesosClaves'
import SortControl from '../components/SortControl'
import { orderDeptTree } from '../lib/depts'

const PERMS = [
  { key: 'manage_orders', label: 'Gestionar solicitudes', desc: 'Aprobar, rechazar y entregar pedidos' },
  { key: 'manage_rooms', label: 'Gestionar salas', desc: 'Aprobar reservas y editar salas' },
  { key: 'manage_supplies', label: 'Administración de insumos', desc: 'Stock, catálogo y acceso de insumos' },
  { key: 'manage_inventory', label: 'Inventario de equipos', desc: 'Equipos y esquemas' },
  { key: 'manage_users', label: 'Usuarios, roles y departamentos', desc: 'Asignar roles, departamentos y permisos' },
  { key: 'manage_support', label: 'Atender soporte', desc: 'Gestionar tickets de soporte' },
  { key: 'full_admin', label: 'Acceso total', desc: 'Administrador — incluye todos los permisos' },
]
const emptyRole = { key: '', label: '', permissions: {}, sort: 0, is_system: false }
const NONE = '__sin_depto__'

export default function Roles() {
  const [tab, setTab] = useState('creds') // 'creds' | 'roles' | 'depts'

  // ---- Roles ----
  const [roles, setRoles] = useState([])
  const [counts, setCounts] = useState({})
  const [edit, setEdit] = useState(null)

  // ---- Departamentos ----
  const [depts, setDepts] = useState([])
  const [users, setUsers] = useState([])         // {id, full_name, email, department, active}
  const [dEdit, setDEdit] = useState(null)
  const [dManage, setDManage] = useState(null)   // { name, userIds:Set }
  const [dSearch, setDSearch] = useState('')
  const [assignOne, setAssignOne] = useState(null) // { user, dept } — asignar un usuario a un depto
  // carpetas: apertura, búsqueda y orden por carpeta
  const [openF, setOpenF] = useState({})
  const [fSearch, setFSearch] = useState({})
  const [fSort, setFSort] = useState({})   // criterio por carpeta: 'name' | 'email'
  const [fDir, setFDir] = useState({})     // dirección por carpeta: 'asc' | 'desc'
  const fRefs = useRef({})

  const load = useCallback(async () => {
    const [{ data: rs }, { data: profs }, { data: ds }, { data: us }] = await Promise.all([
      supabase.from('roles').select('key,label,permissions,is_system,sort').order('sort'),
      supabase.from('profiles').select('role'),
      supabase.from('departments').select('id,name,sort,parent,manager_id'),
      supabase.from('profiles').select('id,full_name,email,department,active,created_at,department_since').order('full_name'),
    ])
    setRoles(rs ?? [])
    const c = {}; (profs ?? []).forEach((p) => { c[p.role] = (c[p.role] || 0) + 1 }); setCounts(c)
    setDepts(orderDeptTree(ds ?? []))
    setUsers(us ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  // ====== ROLES ======
  const save = async () => {
    if (!(edit.label || '').trim()) return alertDialog('Ponle un nombre al rol.')
    try { await api('role_upsert', { p: { key: edit.key || undefined, label: edit.label.trim(), permissions: edit.permissions || {}, sort: Number(edit.sort) || 0 } }); setEdit(null); load() } catch (e) { alertDialog(e.message) }
  }
  const del = async (r) => {
    if (!(await confirmDialog(`¿Eliminar el rol "${r.label}"?`, { title: 'Eliminar rol', danger: true, okText: 'Eliminar' }))) return
    try { await api('role_delete', { p_key: r.key }); load() } catch (e) { alertDialog(e.message) }
  }
  const togglePerm = (k) => setEdit((e) => {
    const p = { ...(e.permissions || {}) }
    if (p[k]) delete p[k]; else p[k] = true
    return { ...e, permissions: p }
  })
  const permSummary = (p) => {
    if (p.full_admin) return 'Acceso total'
    const on = PERMS.filter((x) => x.key !== 'full_admin' && p[x.key]).map((x) => x.label)
    return on.length ? on.join(' · ') : 'Sin permisos especiales'
  }

  // ====== DEPARTAMENTOS ======
  const activeUsers = useMemo(() => users.filter((u) => u.active !== false), [users])
  const usersByDept = useMemo(() => {
    const m = {}; activeUsers.forEach((u) => { const d = u.department || ''; if (!d) return; (m[d] = m[d] || []).push(u) }); return m
  }, [activeUsers])
  const unassigned = useMemo(() => activeUsers.filter((u) => !(u.department || '')), [activeUsers])

  const saveDept = async () => {
    const name = (dEdit.name || '').trim()
    if (!name) return alertDialog('Ponle un nombre al departamento.')
    try {
      await api('dept_upsert', { p_id: dEdit.id || null, p_name: name, p_sort: Number(dEdit.sort) || 0, p_parent: dEdit.parent ?? '' })
      // Gerente de área (2ª llave para insumos tecnológicos). Se guarda por nombre de depto.
      await api('dept_set_manager', { p_dept: name, p_manager: dEdit.manager_id || null })
      setDEdit(null); load()
    } catch (e) { alertDialog(e.message) }
  }
  const deleteDept = async (d) => {
    const n = (usersByDept[d.name] || []).length
    const msg = n > 0
      ? `¿Eliminar el departamento "${d.name}"? Los ${n} usuario(s) asignados quedarán sin departamento.`
      : `¿Eliminar el departamento "${d.name}"?`
    if (!(await confirmDialog(msg, { title: 'Eliminar departamento', danger: true, okText: 'Eliminar' }))) return
    try { await api('dept_delete', { p_id: d.id }); load() } catch (e) { alertDialog(e.message) }
  }
  const openManage = (d) => {
    setDSearch('')
    setDManage({ name: d.name, userIds: new Set((usersByDept[d.name] || []).map((u) => u.id)) })
  }
  const toggleUser = (id) => setDManage((m) => { const s = new Set(m.userIds); s.has(id) ? s.delete(id) : s.add(id); return { ...m, userIds: s } })
  const saveManage = async () => {
    try { await api('dept_set_users', { p_name: dManage.name, p_user_ids: [...dManage.userIds] }); setDManage(null); load() } catch (e) { alertDialog(e.message) }
  }
  const manageList = useMemo(() => {
    if (!dManage) return []
    const q = dSearch.trim().toLowerCase()
    return users
      .filter((u) => u.active !== false)
      // solo personas sin departamento o ya en este departamento (no las de otros)
      .filter((u) => !(u.department || '') || u.department === dManage.name)
      .filter((u) => !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      // los que ya están en el departamento van primero
      .sort((a, b) => {
        const am = a.department === dManage.name ? 0 : 1
        const bm = b.department === dManage.name ? 0 : 1
        if (am !== bm) return am - bm
        return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'es', { sensitivity: 'base' })
      })
  }, [dManage, users, dSearch])

  const removeFromDept = async (u) => {
    if (!(await confirmDialog(`¿Quitar a ${u.full_name || u.email} del departamento? Quedará sin departamento (no se deshabilita su cuenta).`, { title: 'Quitar del departamento', okText: 'Quitar' }))) return
    try { await api('set_user_department', { p_user: u.id, p_dept: '' }); load() } catch (e) { alertDialog(e.message) }
  }
  const saveAssignOne = async () => {
    // dept vacío = mover a "Sin departamento"
    try { await api('set_user_department', { p_user: assignOne.user.id, p_dept: assignOne.dept || '' }); setAssignOne(null); load() } catch (e) { alertDialog(e.message) }
  }

  // filtro + orden dentro de una carpeta
  const applyFS = (list, key) => {
    const q = (fSearch[key] || '').trim().toLowerCase()
    const arr = list.filter((u) => !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    const field = fSort[key] || 'name'
    const dir = fDir[key] || 'asc'
    const cmp = (a, b) => {
      if (field === 'antiguedad') return new Date(a.department_since || a.created_at || 0) - new Date(b.department_since || b.created_at || 0)
      const val = (u) => (field === 'email' ? (u.email || '') : (u.full_name || u.email || '')).toLowerCase()
      return val(a).localeCompare(val(b), 'es')
    }
    const sorted = [...arr].sort(cmp)
    return dir === 'desc' ? sorted.reverse() : sorted
  }
  const openFolder = (key) => {
    setOpenF({ [key]: true }) // abre solo esta carpeta y cierra las demás
    setTimeout(() => fRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 70)
  }

  // Bloque de carpeta reutilizable — función de render (NO componente) para no perder el foco al escribir
  const renderFolder = ({ fkey, icon, title, list, headExtra, canRemove, canAssign }) => {
    const isOpen = !!openF[fkey]
    const rows = applyFS(list, fkey)
    return (
      <div key={fkey} className={`section ${isOpen ? 'open' : ''}`} ref={(el) => { fRefs.current[fkey] = el }} style={{ marginBottom: '.6rem' }}>
        <button className="sec-head compact" onClick={() => setOpenF((o) => (o[fkey] ? {} : { [fkey]: true }))}>
          <span className="ico">{icon}</span>
          <span className="t"><strong>{title}</strong><br /><span className="muted">{list.length} usuario(s)</span></span>
          <span className="count">{list.length}</span><span className="chev">▾</span>
        </button>
        {isOpen && (
          <div className="sec-body">
            {headExtra}
            <div className="row" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
              <input placeholder="Buscar por nombre o correo…" value={fSearch[fkey] || ''} onChange={(e) => setFSearch((s) => ({ ...s, [fkey]: e.target.value }))} style={{ flex: 1, minWidth: 200 }} />
              <SortControl
                fields={[{ value: 'name', label: 'Alfabético (A–Z)' }, { value: 'antiguedad', label: 'Antigüedad' }]}
                field={fSort[fkey] || 'name'} dir={fDir[fkey] || 'asc'}
                onField={(v) => setFSort((s) => ({ ...s, [fkey]: v }))}
                onToggleDir={() => setFDir((d) => ({ ...d, [fkey]: (d[fkey] || 'asc') === 'asc' ? 'desc' : 'asc' }))} />
            </div>
            <div className="table-wrap"><table className="tbl-compact">
              <thead><tr><th>Usuario</th><th>Correo</th><th></th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={3} className="muted" style={{ padding: '.7rem' }}>Sin usuarios.</td></tr>}
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.full_name || '—'}</strong></td>
                    <td><span className="muted">{u.email}</span></td>
                    <td className="actions">
                      {canRemove && <>
                        <button className="btn-sm" onClick={() => setAssignOne({ user: u, dept: u.department || '' })}>Mover</button>{' '}
                        <button className="btn-sm btn-danger" onClick={() => removeFromDept(u)}>Quitar</button>
                      </>}
                      {canAssign && <button className="btn-sm btn-lime" onClick={() => setAssignOne({ user: u, dept: u.department || '' })}>Asignar a departamento</button>}
                      {!canRemove && !canAssign && <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Accesos: roles y departamentos</h2><p className="muted">Crea y edita departamentos y roles, define permisos y guarda las claves de acceso.</p></div>
        {tab === 'roles' && <button className="btn btn-lime" onClick={() => setEdit({ ...emptyRole, permissions: {} })}>＋ Nuevo rol</button>}
        {tab === 'depts' && <button className="btn btn-lime" onClick={() => setDEdit({ id: '', name: '', sort: (depts.length + 1) })}>＋ Nuevo departamento</button>}
      </div></div>

      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: '.4rem', margin: '.2rem 0 .8rem', flexWrap: 'wrap' }}>
        <button className={`seg-btn ${tab === 'creds' ? 'on' : ''}`} onClick={() => setTab('creds')}>🔐 Accesos y claves</button>
        <button className={`seg-btn ${tab === 'roles' ? 'on' : ''}`} onClick={() => setTab('roles')}>🛡️ Roles y permisos</button>
        <button className={`seg-btn ${tab === 'depts' ? 'on' : ''}`} onClick={() => setTab('depts')}>🏢 Departamentos</button>
      </div>

      {/* ===================== DEPARTAMENTOS ===================== */}
      {tab === 'depts' && (
        <div>
          {/* Tarjetas de conteo */}
          <div className="kpi-grid compact" style={{ marginBottom: '.8rem' }}>
            <div className="kpi kpi-all"><span className="ico" style={{ fontSize: '1.3rem' }}>👥</span><div><div className="num">{activeUsers.length}</div><div className="lbl">Usuarios activos</div></div></div>
            {depts.map((d) => (
              <button key={d.id} className={`kpi ${openF[d.name] ? 'active' : ''}`} onClick={() => openFolder(d.name)} title={d.parent ? `Subdepartamento de ${d.parent}` : undefined}>
                <div className="ico">{d.depth ? '↳' : '🏢'}</div><div className="num">{(usersByDept[d.name] || []).length}</div><div className="lbl">{d.name}{d.parent ? <><br /><span className="muted" style={{ fontSize: '.66rem' }}>de {d.parent}</span></> : null}</div>
              </button>
            ))}
            <button className={`kpi ${openF[NONE] ? 'active' : ''}`} onClick={() => openFolder(NONE)}>
              <div className="ico">🚫</div><div className="num">{unassigned.length}</div><div className="lbl">Sin departamento</div>
            </button>
          </div>

          {depts.length === 0 && <p className="muted">Aún no hay departamentos. Crea el primero con «＋ Nuevo departamento».</p>}

          {/* Carpetas por departamento */}
          {depts.map((d) => renderFolder({
            fkey: d.name, icon: d.depth ? '↳' : '🏢', title: d.parent ? `${d.parent} › ${d.name}` : d.name, list: usersByDept[d.name] || [], canRemove: true,
            headExtra: (
              <div style={{ marginBottom: '.5rem' }}>
                <div className="row" style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  <button className="btn-sm" onClick={() => openManage(d)}>👥 Asignar usuarios</button>
                  <button className="btn-sm" onClick={() => setDEdit({ id: d.id, name: d.name, sort: d.sort, parent: d.parent || '', manager_id: d.manager_id || '' })}>⚙️ Ajustes del departamento</button>
                </div>
                <div className="muted" style={{ fontSize: '.72rem', marginTop: '.35rem' }}>
                  {d.manager_id
                    ? <>👤 Responsable del área: <strong>{(users.find((u) => u.id === d.manager_id)?.full_name) || (users.find((u) => u.id === d.manager_id)?.email) || '—'}</strong>.</>
                    : <>Sin responsable de área asignado.</>}
                  {' '}Las compras de insumos tecnológicos las autorizan los gerentes de tecnología.
                </div>
              </div>
            ),
          }))}

          {/* Carpeta: sin departamento */}
          {renderFolder({ fkey: NONE, icon: '🚫', title: 'Sin departamento', list: unassigned, canAssign: true })}
        </div>
      )}

      {/* ===================== ACCESOS Y CLAVES ===================== */}
      {tab === 'creds' && <AccesosClaves />}

      {/* ===================== ROLES ===================== */}
      {tab === 'roles' && (
        <div className="section open"><div className="sec-body"><div className="table-wrap"><table>
          <thead><tr><th>Rol</th><th>Permisos</th><th style={{ textAlign: 'center' }}>Usuarios</th><th></th></tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.key}>
                <td><strong>{r.label}</strong><br /><span className="muted">{r.key}</span></td>
                <td><span className="muted">{permSummary(r.permissions || {})}</span></td>
                <td style={{ textAlign: 'center' }}>{counts[r.key] || 0}</td>
                <td className="actions">
                  <button className="btn-sm" onClick={() => setEdit({ ...r, permissions: { ...(r.permissions || {}) } })}>Editar</button>{' '}
                  {!r.is_system && <button className="btn-sm btn-danger" onClick={() => del(r)}>Eliminar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div></div></div>
      )}

      {/* ---- Modal: asignar un usuario a un departamento ---- */}
      {assignOne && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Mover a departamento</h3>
            <p className="muted" style={{ marginTop: 0 }}>{assignOne.user.full_name || assignOne.user.email}</p>
            <label>Departamento</label>
            <select value={assignOne.dept} onChange={(e) => setAssignOne({ ...assignOne, dept: e.target.value })} autoFocus>
              <option value="">— Sin departamento</option>
              {depts.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
            <div className="modal-actions"><button className="btn" onClick={() => setAssignOne(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveAssignOne}>Guardar</button></div>
          </div>
        </div>
      )}

      {/* ---- Modal ajustes / crear departamento ---- */}
      {dEdit && (
        <div className="backdrop open">
          <div className="modal">
            <h3>{dEdit.id ? 'Ajustes del departamento' : 'Nuevo departamento'}</h3>
            <label>Nombre</label>
            <input value={dEdit.name} onChange={(e) => setDEdit({ ...dEdit, name: e.target.value })} placeholder="Ej: Marketing" autoFocus />
            <label style={{ marginTop: '.6rem' }}>Departamento padre <span className="muted">(déjalo en «Ninguno» para un departamento principal)</span></label>
            <select value={dEdit.parent ?? ''} onChange={(e) => setDEdit({ ...dEdit, parent: e.target.value })}>
              <option value="">— Ninguno (principal)</option>
              {depts.filter((d) => !d.parent && d.name !== dEdit.name).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
            <label style={{ marginTop: '.6rem' }}>Responsable del área <span className="muted">(referencia organizativa; las compras tecnológicas las autorizan los gerentes de tecnología)</span></label>
            <select value={dEdit.manager_id ?? ''} onChange={(e) => setDEdit({ ...dEdit, manager_id: e.target.value })}>
              <option value="">— Sin responsable</option>
              {activeUsers.map((u) => <option key={u.id} value={u.id}>{(u.full_name || u.email)}{u.department ? ` · ${u.department}` : ''}</option>)}
            </select>
            <label style={{ marginTop: '.6rem' }}>Orden</label>
            <input type="number" value={dEdit.sort} onChange={(e) => setDEdit({ ...dEdit, sort: e.target.value })} style={{ width: 120 }} />
            {dEdit.id && <p className="muted" style={{ margin: '.4rem 0 0' }}>Al renombrar se actualizarán los usuarios y los insumos que usen este departamento.</p>}
            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              {dEdit.id
                ? <button className="btn btn-danger" onClick={() => { const d = { id: dEdit.id, name: dEdit.name }; setDEdit(null); deleteDept(d) }}>🗑 Eliminar departamento</button>
                : <span />}
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button className="btn" onClick={() => setDEdit(null)}>Cancelar</button>
                <button className="btn btn-primary" onClick={saveDept}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Modal asignar usuarios ---- */}
      {dManage && (
        <div className="backdrop open">
          <div className="modal modal-lg">
            <h3>Departamento: {dManage.name}</h3>
            <h4 style={{ margin: '.6rem 0 .3rem' }}>Usuarios del departamento <span className="muted" style={{ fontWeight: 400 }}>({dManage.userIds.size} seleccionados)</span></h4>
            <input placeholder="Buscar usuario…" value={dSearch} onChange={(e) => setDSearch(e.target.value)} style={{ marginBottom: '.4rem' }} />
            <div className="perm-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {manageList.map((u) => {
                const otherDept = u.department && u.department !== dManage.name && dManage.userIds.has(u.id) === false
                return (
                  <label key={u.id} className="perm-row">
                    <input type="checkbox" checked={dManage.userIds.has(u.id)} onChange={() => toggleUser(u.id)} />
                    <span><strong>{u.full_name || u.email}</strong><br />
                      <span className="muted">{u.email}{otherDept ? ` · actualmente en ${u.department}` : ''}</span></span>
                  </label>
                )
              })}
            </div>
            <p className="muted" style={{ marginTop: '.4rem' }}>Marcar a un usuario lo mueve a este departamento; desmarcarlo lo deja sin departamento.</p>
            <div className="modal-actions"><button className="btn" onClick={() => setDManage(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveManage}>Guardar cambios</button></div>
          </div>
        </div>
      )}

      {/* ---- Modal editar rol ---- */}
      {edit && (
        <div className="backdrop open">
          <div className="modal">
            <h3>{edit.key ? 'Editar rol' : 'Nuevo rol'}</h3>
            <label>Nombre del rol</label>
            <input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="Ej: Soporte TI" disabled={edit.key === 'admin'} />
            {edit.key && <p className="muted" style={{ margin: '.3rem 0 0' }}>Identificador: <code>{edit.key}</code>{edit.is_system ? ' · rol del sistema (no se puede eliminar)' : ''}</p>}

            <h4 style={{ margin: '1rem 0 .3rem' }}>Permisos</h4>
            <div className="perm-list">
              {PERMS.map((pm) => {
                const checked = pm.key === 'full_admin' ? (edit.permissions?.full_admin === true) : (edit.permissions?.full_admin === true || edit.permissions?.[pm.key] === true)
                const locked = edit.key === 'admin' && pm.key === 'full_admin'
                const disabled = (edit.permissions?.full_admin === true && pm.key !== 'full_admin') || locked
                return (
                  <label key={pm.key} className={`perm-row ${disabled ? 'off' : ''}`}>
                    <input type="checkbox" checked={checked} disabled={disabled} onChange={() => togglePerm(pm.key)} />
                    <span><strong>{pm.label}</strong><br /><span className="muted">{pm.desc}</span></span>
                  </label>
                )
              })}
            </div>
            {edit.permissions?.full_admin && <p className="muted" style={{ marginTop: '.4rem' }}>«Acceso total» incluye todos los permisos automáticamente.</p>}

            <div className="modal-actions"><button className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar rol</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
