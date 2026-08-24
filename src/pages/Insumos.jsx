import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import ActivityLog from '../components/ActivityLog'
import { confirmDialog, alertDialog, viewImage } from '../lib/ui'
import { fileToResizedDataURL } from '../lib/img'
import ImagePicker from '../components/ImagePicker'
import { loadDeptNames, DEFAULT_DEPTS } from '../lib/depts'
import { useAuth } from '../context/AuthContext'

const COUNTRIES = [['Chile', '🇨🇱'], ['Perú', '🇵🇪'], ['Colombia', '🇨🇴']]
const emptyItem = { name: '', category: '', category_id: '', stock: 0, description: '', departments: [], image_url: '', country: 'Chile', requires_manager: false, purchase_url: '' }

export default function Insumos() {
  const { isAdmin, profile } = useAuth()
  const [items, setItems] = useState([])
  const [country, setCountry] = useState('Chile')      // país (sector) seleccionado
  const countryInit = useRef(false)
  useEffect(() => { if (profile && !countryInit.current) { countryInit.current = true; if (profile.country) setCountry(profile.country) } }, [profile])
  const myCountry = profile?.country || 'Chile'
  const fixedCountry = !isAdmin
  const effCountry = fixedCountry ? myCountry : country
  const [DEPTS, setDEPTS] = useState(DEFAULT_DEPTS)
  useEffect(() => { loadDeptNames().then(setDEPTS) }, [])
  const [cats, setCats] = useState([])
  const [open, setOpen] = useState({})
  const [stockVals, setStockVals] = useState({})
  const [edit, setEdit] = useState(null)
  const [groupMode, setGroupMode] = useState('cat') // 'cat' = por categoría · 'dept' = por departamento
  const [sortBy, setSortBy] = useState('az')     // 'az' | 'recent'
  const [deptEdit, setDeptEdit] = useState(null) // { title, itemIds, departments }
  const [sel, setSel] = useState(new Set())      // insumos seleccionados (ids)
  const secRefs = useRef({})
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const load = useCallback(async () => {
    const [{ data: it }, { data: cs }] = await Promise.all([
      supabase.from('inventory_items').select('id,name,category,category_id,stock,description,departments,is_active,image_url,created_at,country,requires_manager,purchase_url').eq('is_active', true).order('category').order('name'),
      supabase.from('item_categories').select('id,name,parent_id,icon,sort').order('sort').order('name'),
    ])
    setItems(it ?? []); setCats(cs ?? [])
    setStockVals(Object.fromEntries((it ?? []).map((i) => [i.id, i.stock])))
  }, [])
  useEffect(() => { load() }, [load])

  const catLabel = useMemo(() => {
    const by = Object.fromEntries(cats.map((c) => [c.id, c]))
    return (c) => c.parent_id && by[c.parent_id] ? `${by[c.parent_id].name} · ${c.name}` : c.name
  }, [cats])
  const catOptions = useMemo(() => cats.filter((c) => !cats.some((x) => x.parent_id === c.id)), [cats]) // hojas
  // Insumos del país seleccionado (base de todo lo que se muestra)
  const fItems = useMemo(() => items.filter((i) => (i.country || 'Chile') === effCountry), [items, effCountry])
  // Orden de los insumos dentro de cada grupo
  const sortedItems = useMemo(() => {
    const arr = [...fItems]
    if (sortBy === 'recent') arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    else arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }))
    return arr
  }, [fItems, sortBy])
  const byCat = useMemo(() => {
    const g = {}; sortedItems.forEach((i) => { const k = i.category || 'Sin asignar'; (g[k] = g[k] || []).push(i) }); return g
  }, [sortedItems])
  const byDept = useMemo(() => {
    const g = {}
    sortedItems.forEach((i) => {
      const ds = Array.isArray(i.departments) ? i.departments : []
      if (ds.length === 0) { (g['Sin asignar'] = g['Sin asignar'] || []).push(i); return }
      ds.forEach((d) => { (g[d] = g[d] || []).push(i) })
    })
    return g
  }, [sortedItems])
  const byGroup = groupMode === 'dept' ? byDept : byCat
  const orderedGroups = useMemo(() => {
    const e = Object.entries(byGroup)
    e.sort((a, b) => (a[0] === 'Sin asignar' ? -1 : b[0] === 'Sin asignar' ? 1 : a[0].localeCompare(b[0])))
    return e
  }, [byGroup])
  const totalStock = fItems.reduce((a, i) => a + (i.stock || 0), 0)

  const openAndScroll = (g) => {
    setOpen((o) => ({ ...o, [g]: true }))
    setTimeout(() => secRefs.current[g]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const saveStock = async (id) => { try { await api('set_stock', { p_item: id, p_stock: Number(stockVals[id]) || 0 }); load() } catch (e) { alertDialog(e.message) } }
  const saveItem = async () => {
    if (!(edit.name || '').trim()) return alertDialog('Ponle nombre al insumo.')
    const typed = (edit.category || '').trim()
    const match = catOptions.find((c) => catLabel(c).toLowerCase() === typed.toLowerCase())
    const p = { ...edit, stock: Number(edit.stock) || 0, category: typed, category_id: match ? match.id : null, departments: edit.departments || [] }
    try { await api('inventory_upsert', { p }); setEdit(null); load() } catch (e) { alertDialog(e.message) }
  }
  const delItem = async (i) => {
    if (!(await confirmDialog(`¿Estás seguro de eliminar el insumo "${i.name}"?\nEsta acción no se puede deshacer.`, { title: 'Eliminar insumo', danger: true, okText: 'Sí, eliminar', cancelText: 'No, cancelar' }))) return
    setItems((its) => its.filter((x) => x.id !== i.id))
    try { await api('inventory_delete', { p_id: i.id }) } catch (e) { alertDialog(e.message) } finally { load() }
  }
  const openDeptEdit = (arr, title) => {
    const union = [...new Set(arr.flatMap((i) => i.departments || []))]
    setDeptEdit({ title, itemIds: arr.map((i) => i.id), departments: union })
  }
  const applyDepts = async () => {
    try {
      await api('set_items_departments', { p_ids: deptEdit.itemIds, p_departments: deptEdit.departments })
      setDeptEdit(null); setSel(new Set()); load()
    } catch (e) { alertDialog(e.message) }
  }

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Inventario de insumos</h2><p className="muted">Stock disponible. Edita cantidades, agrega o da de baja insumos.</p></div>
        <button className="btn btn-lime" onClick={() => setEdit({ ...emptyItem, country: effCountry })}>＋ Nuevo insumo</button>
      </div></div>

      {/* ==== Sector por país ==== */}
      <div className="country-tabs">
        {COUNTRIES.map(([c, flag]) => {
          const on = effCountry === c
          const locked = fixedCountry && c !== myCountry
          return (
            <button key={c} className={`country-tab ${on ? 'on' : ''}`} disabled={locked}
              title={locked ? 'Solo el rol Administración puede ver otros países' : `Ver insumos de ${c}`}
              onClick={() => setCountry(c)}>
              <span className="cflag">{flag}</span><span className="cname">{c}</span>
            </button>
          )
        })}
        {fixedCountry && <span className="muted" style={{ fontSize: '.74rem', alignSelf: 'center' }}>Ves los insumos de tu país. El rol Administración puede ver los tres.</span>}
      </div>

      <div className="row" style={{ display: 'flex', alignItems: 'center', margin: '.6rem 0 .2rem', gap: '1rem', flexWrap: 'wrap', width: '100%' }}>
        <div className="seg">
          <button className={`seg-btn ${groupMode === 'cat' ? 'on' : ''}`} onClick={() => setGroupMode('cat')}>📁 Categorías</button>
          <button className={`seg-btn ${groupMode === 'dept' ? 'on' : ''}`} onClick={() => setGroupMode('dept')}>🏢 Departamentos</button>
        </div>
        <label className="sort-ctl" style={{ marginLeft: 'auto' }}>Ordenar:
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="az">Alfabético (A–Z)</option>
            <option value="recent">Más recientes</option>
          </select>
        </label>
      </div>

      <div className="kpi-grid compact">
        <button className="kpi kpi-all"><span className="ico" style={{ fontSize: '1.3rem' }}>📦</span>
          <div><div className="num">{fItems.length}</div><div className="lbl">Insumos ({totalStock} en stock)</div></div></button>
        {orderedGroups.map(([g, arr]) => (
          <button key={g} className={`kpi ${open[g] ? 'active' : ''} ${g === 'Sin asignar' ? 'kpi-warn' : ''}`} onClick={() => openAndScroll(g)}>
            <div className="ico">{groupMode === 'dept' ? (g === 'Sin asignar' ? '⚠️' : '🏢') : (g === 'Sin asignar' ? '⚠️' : '📁')}</div><div className="num">{arr.length}</div><div className="lbl">{g}</div></button>
        ))}
      </div>

      {orderedGroups.map(([g, arr]) => {
        const isOpen = !!open[g]
        const selArr = arr.filter((i) => sel.has(i.id))
        const allSel = arr.length > 0 && selArr.length === arr.length
        return (
          <div className={`section ${isOpen ? 'open' : ''}`} key={g} style={{ marginBottom: '.8rem' }} ref={(el) => { secRefs.current[g] = el }}>
            <button className="sec-head compact" onClick={() => setOpen((o) => ({ ...o, [g]: !o[g] }))}>
              <span className="ico">📁</span><span className="t"><strong>{g}</strong><br /><span className="muted">{arr.length} insumo(s)</span></span>
              <span className="count">{arr.reduce((a, i) => a + i.stock, 0)} u.</span><span className="chev">▾</span>
            </button>
            {isOpen && (
              <div className="sec-body">
                <div className="ins-tools" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
                  <button className="btn-sm" onClick={() => openDeptEdit(arr, `toda la carpeta "${g}" (${arr.length})`)}>🏢 Departamentos a toda la carpeta</button>
                  <button className="btn-sm btn-lime" disabled={selArr.length === 0} onClick={() => openDeptEdit(selArr, `${selArr.length} insumo(s) seleccionado(s)`)}>Asignar a seleccionados ({selArr.length})</button>
                  {selArr.length > 0 && <button className="btn-sm" onClick={() => setSel((s) => { const n = new Set(s); arr.forEach((i) => n.delete(i.id)); return n })}>Limpiar selección</button>}
                </div>
                <div className="table-wrap"><table>
                <thead><tr>
                  <th style={{ width: 28 }}><input type="checkbox" checked={allSel} onChange={() => setSel((s) => { const n = new Set(s); if (allSel) arr.forEach((i) => n.delete(i.id)); else arr.forEach((i) => n.add(i.id)); return n })} /></th>
                  <th>Insumo</th><th>Stock</th><th></th></tr></thead>
                <tbody>
                  {arr.map((i) => (
                    <tr key={i.id} className={sel.has(i.id) ? 'row-sel' : ''}>
                      <td><input type="checkbox" checked={sel.has(i.id)} onChange={() => toggleSel(i.id)} /></td>
                      <td><div style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start' }}>
                        {i.image_url ? <img className="ins-thumb" src={i.image_url} alt="" onClick={() => viewImage(i.image_url)} /> : null}
                        <div><strong>{i.name}</strong>{i.requires_manager ? <span className="req-tech-tag" title="Requiere doble aprobación (gerente de área)">🔑 tecnológico</span> : null}{i.description ? <><br /><span className="muted">{i.description}</span></> : null}
                          <br /><span className="muted">Destino: {(i.departments && i.departments.length) ? i.departments.join(', ') : <span style={{ color: 'var(--danger)' }}>Sin asignar — no aparece en solicitudes</span>}</span>
                          {i.purchase_url ? <><br /><a className="btn-sm btn-lime" style={{ textDecoration: 'none', marginTop: '.25rem', display: 'inline-block' }} href={/^https?:\/\//i.test(i.purchase_url) ? i.purchase_url : 'https://' + i.purchase_url} target="_blank" rel="noreferrer">🛒 Comprar</a></> : null}</div>
                      </div></td>
                      <td><div className="qc" style={{ gap: '.4rem' }}>
                        <input type="number" min="0" style={{ width: 76 }} value={stockVals[i.id] ?? ''} onChange={(e) => setStockVals((v) => ({ ...v, [i.id]: e.target.value }))} />
                        <button className="btn-sm btn-lime" onClick={() => saveStock(i.id)} disabled={Number(stockVals[i.id]) === i.stock}>Guardar</button>
                      </div></td>
                      <td className="actions">
                        <button className="btn-sm" onClick={() => setEdit({ ...emptyItem, ...i, category_id: i.category_id || '', departments: i.departments || [] })}>Editar</button>{' '}
                        <button className="btn-sm btn-danger" onClick={() => delItem(i)}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div></div>
            )}
          </div>
        )
      })}

      {edit && (
        <div className="backdrop open">
          <div className="modal">
            <h3>{edit.id ? 'Editar insumo' : 'Nuevo insumo'}</h3>
            <div className="pf-fields">
              <div><label>Nombre</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div><label>Categoría</label>
                <input list="cat-list" value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="Escribe o elige (ej: Periféricos)" />
                <datalist id="cat-list">{catOptions.map((c) => <option key={c.id} value={catLabel(c)} />)}</datalist>
              </div>
              <div><label>Stock</label><input type="number" min="0" value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: e.target.value })} /></div>
              <div><label>País</label>
                <select value={edit.country || effCountry} onChange={(e) => setEdit({ ...edit, country: e.target.value })}>
                  {COUNTRIES.map(([c, flag]) => <option key={c} value={c}>{flag} {c}</option>)}
                </select></div>
              <div><label>Descripción</label><input value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label>🛒 Link de compra <span className="muted">(dónde comprarlo)</span></label>
                <input type="url" value={edit.purchase_url || ''} onChange={(e) => setEdit({ ...edit, purchase_url: e.target.value })} placeholder="https://… (ej: página del proveedor)" /></div>
              <div style={{ gridColumn: '1 / -1' }}><label>Foto del producto</label>
                <ImagePicker value={edit.image_url} onChange={(url) => setEdit((ed) => ({ ...ed, image_url: url }))} />
              </div>
            </div>
            <label className="perm-row" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.6rem', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: '.5rem', padding: '.5rem .7rem' }}>
              <input type="checkbox" checked={!!edit.requires_manager} onChange={(e) => setEdit((ed) => ({ ...ed, requires_manager: e.target.checked }))} />
              <span>🔑 <strong>Insumo tecnológico</strong> — requiere doble aprobación (gestora de pedidos y luego el gerente del área que lo solicita: computadores, mouse, pantallas, soportes, etc.)</span>
            </label>
            <label style={{ display: 'block', marginTop: '.6rem' }}>Departamentos que pueden pedir este insumo <span className="muted">(si no marcas ninguno, no aparecerá en las solicitudes)</span></label>
            <div style={{ margin: '.3rem 0' }}>
              <button className="btn-sm" type="button" onClick={() => setEdit((e) => ({ ...e, departments: (e.departments || []).length === DEPTS.length ? [] : [...DEPTS] }))}>
                {(edit.departments || []).length === DEPTS.length ? 'Quitar todos' : 'Seleccionar todos'}
              </button>
            </div>
            <div className="perm-list" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
              {DEPTS.map((d) => {
                const on = (edit.departments || []).includes(d)
                return (
                  <label key={d} className="perm-row">
                    <input type="checkbox" checked={on} onChange={() => setEdit((e) => ({ ...e, departments: on ? e.departments.filter((x) => x !== d) : [...(e.departments || []), d] }))} />
                    <span><strong>{d}</strong></span>
                  </label>
                )
              })}
            </div>
            <div className="modal-actions"><button className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveItem}>Guardar</button></div>
          </div>
        </div>
      )}

      {deptEdit && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Asignar departamentos</h3>
            <p className="muted" style={{ marginTop: 0 }}>Se aplicará a {deptEdit.title}. Los departamentos que no marques quedarán sin acceso a pedir estos insumos.</p>
            <div style={{ margin: '.3rem 0' }}>
              <button className="btn-sm" type="button" onClick={() => setDeptEdit((d) => ({ ...d, departments: d.departments.length === DEPTS.length ? [] : [...DEPTS] }))}>
                {deptEdit.departments.length === DEPTS.length ? 'Quitar todos' : 'Seleccionar todos'}
              </button>
            </div>
            <div className="perm-list" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
              {DEPTS.map((d) => {
                const on = deptEdit.departments.includes(d)
                return (
                  <label key={d} className="perm-row">
                    <input type="checkbox" checked={on} onChange={() => setDeptEdit((e) => ({ ...e, departments: on ? e.departments.filter((x) => x !== d) : [...e.departments, d] }))} />
                    <span><strong>{d}</strong></span>
                  </label>
                )
              })}
            </div>
            <div className="modal-actions"><button className="btn" onClick={() => setDeptEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={applyDepts}>Aplicar</button></div>
          </div>
        </div>
      )}

      <ActivityLog kinds={['Insumo']} title="Registro de insumos" />
    </div>
  )
}
