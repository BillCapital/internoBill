import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { fmtMoney } from '../lib/linkPreview'
import { rootDeptOf, loadDepts } from '../lib/depts'
import { confirmDialog, alertDialog } from '../lib/ui'
import { Icon } from '../lib/icons'
import { SkeletonKpis } from '../components/Skeleton'

const BUCKET = 'facturas'
const CATS = ['Telefonía', 'Equipos', 'Software', 'Servicios', 'Arriendo', 'Insumos', 'Otros']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const safeName = (n) => (n || 'archivo').replace(/[^\w.\-]+/g, '_')
const num = (v) => {
  if (v == null) return 0
  const n = Number(String(v).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}` }
// Celda de dinero estilo contable: símbolo a la izquierda, monto a la derecha
function Money({ value, strong }) {
  const txt = fmtMoney(Number(value) || 0) || '$0'
  const m = txt.match(/^(\D*)(.+)$/)
  const sym = m ? m[1].trim() || '$' : '$'
  const n = m ? m[2] : txt
  const Num = strong ? 'strong' : 'span'
  return <span className="mny"><span className="mny-s">{sym}</span><Num className="mny-n">{n}</Num></span>
}

export default function Gastos() {
  const [tab, setTab] = useState('resumen')
  const [lines, setLines] = useState([])
  const [docs, setDocs] = useState([])
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  // Facturas: formulario, filtros, visor
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [flt, setFlt] = useState({ tipo: '', cat: '', dep: '' })
  const [viewer, setViewer] = useState(null)
  const [detail, setDetail] = useState(null) // { kind:'plan'|'dept', title, rows }

  const openPlan = (plan) => setDetail({ kind: 'plan', title: plan, rows: lines.filter((l) => l.plan === plan) })
  const openDept = (depto) => setDetail({ kind: 'dept', title: depto === 'Sin asignar' ? 'Sin asignar' : depto, rows: lines.filter((l) => l.depto === depto) })

  const loadDocs = useCallback(async () => {
    const { data } = await supabase.from('expense_docs').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false })
    setDocs(data ?? [])
  }, [])

  useEffect(() => {
    (async () => {
      const tree = await loadDepts()
      setDepts(tree.filter((d) => (d.depth || 0) === 0).map((d) => d.name))
      const { data: secs } = await supabase.from('equipment_sections').select('id').eq('name', 'Teléfonos')
      const secId = secs?.[0]?.id
      const [{ data: eq }, { data: profs }] = await Promise.all([
        secId ? supabase.from('equipment').select('id,name,attributes,user_id').eq('section_id', secId).is('returned_at', null) : Promise.resolve({ data: [] }),
        supabase.from('profiles').select('id,email,full_name,department'),
      ])
      const profById = Object.fromEntries((profs || []).map((p) => [p.id, p]))
      setLines((eq || []).filter((e) => e.attributes?.linea).map((e) => {
        const p = e.user_id ? profById[e.user_id] : null
        return {
          id: e.id,
          device: e.name || 'Equipo',
          linea: e.attributes.linea || '—',
          plan: e.attributes.operador || '—',
          cargo: num(e.attributes.cargo_fijo),
          renovacion: num(e.attributes.renovacion),
          cuotasPend: Number(e.attributes.cuotas_pagar) || 0,
          persona: p ? (p.full_name || p.email || null) : null,
          depto: p && p.department ? rootDeptOf(p.department) : 'Sin asignar',
        }
      }))
      await loadDocs()
      setLoading(false)
    })()
  }, [loadDocs])

  // ---- Telefonía ----
  const totalMensual = useMemo(() => lines.reduce((a, l) => a + l.cargo, 0), [lines])
  const saldoArriendo = useMemo(() => lines.reduce((a, l) => a + l.renovacion, 0), [lines])
  const enCuotas = useMemo(() => lines.filter((l) => l.cuotasPend > 0).length, [lines])
  const byPlan = useMemo(() => {
    const m = {}; lines.forEach((l) => { (m[l.plan] = m[l.plan] || { plan: l.plan, n: 0, cargo: l.cargo, sub: 0 }); m[l.plan].n++; m[l.plan].sub += l.cargo })
    return Object.values(m).sort((a, b) => b.sub - a.sub)
  }, [lines])
  const byDept = useMemo(() => {
    const m = {}; lines.forEach((l) => { (m[l.depto] = m[l.depto] || { depto: l.depto, n: 0, sub: 0 }); m[l.depto].n++; m[l.depto].sub += l.cargo })
    return Object.values(m).sort((a, b) => (a.depto === 'Sin asignar' ? 1 : b.depto === 'Sin asignar' ? -1 : b.sub - a.sub))
  }, [lines])

  // ---- Facturas / movimientos ----
  const compras = useMemo(() => docs.filter((d) => d.tipo === 'compra').reduce((a, d) => a + Number(d.monto || 0), 0), [docs])
  const ventas = useMemo(() => docs.filter((d) => d.tipo === 'venta').reduce((a, d) => a + Number(d.monto || 0), 0), [docs])
  const docsFiltrados = useMemo(() => docs.filter((d) =>
    (!flt.tipo || d.tipo === flt.tipo) && (!flt.cat || d.categoria === flt.cat) && (!flt.dep || d.departamento === flt.dep)), [docs, flt])

  const startForm = () => setForm({ tipo: 'compra', concepto: '', proveedor: '', categoria: 'Otros', departamento: '', monto: '', fecha: new Date().toISOString().slice(0, 10), file: null })
  const submit = async () => {
    if (!form.concepto.trim()) return alertDialog('Ponle un concepto a la factura.')
    setBusy(true)
    try {
      let path = null, fname = null, mime = null, size = null
      if (form.file) {
        path = `${Date.now()}_${safeName(form.file.name)}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, form.file, { contentType: form.file.type || undefined, upsert: false })
        if (upErr) throw upErr
        fname = form.file.name; mime = form.file.type || ''; size = form.file.size || 0
      }
      await api('expense_doc_add', {
        p_tipo: form.tipo, p_concepto: form.concepto.trim(), p_proveedor: form.proveedor.trim(),
        p_categoria: form.categoria, p_departamento: form.departamento, p_monto: num(form.monto),
        p_fecha: form.fecha, p_path: path, p_name: fname, p_mime: mime, p_size: size,
      })
      setForm(null); loadDocs()
    } catch (e) { alertDialog(e.message || 'No se pudo guardar la factura.') } finally { setBusy(false) }
  }
  const del = async (d) => {
    if (!(await confirmDialog(`¿Eliminar "${d.concepto}"?`, { title: 'Eliminar factura', danger: true, okText: 'Eliminar' }))) return
    try {
      if (d.file_path) await supabase.storage.from(BUCKET).remove([d.file_path])
      await api('expense_doc_delete', { p_id: d.id }); loadDocs()
    } catch (e) { alertDialog(e.message) }
  }
  const openViewer = async (d) => {
    if (!d.file_path) return
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(d.file_path, 3600)
    setViewer({ ...d, url: data?.signedUrl })
  }

  const TABS = [['resumen', 'Resumen', 'grid'], ['telefonia', 'Telefonía', 'phone'], ['facturas', 'Facturas', 'file']]

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Gastos</h2><p className="muted">Cargos recurrentes, compras y ventas de la empresa, con sus facturas.</p></div>
      </div></div>

      <div className="seg" style={{ marginBottom: '1rem' }}>
        {TABS.map(([k, lbl, ic]) => (
          <button key={k} className={`seg-btn ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}><Icon n={ic} /> {lbl}</button>
        ))}
      </div>

      {loading ? <SkeletonKpis n={3} /> : <>
        {tab === 'resumen' && (
          <div className="gz-kpis">
            <div className="gz-kpi accent"><span className="gk-ico"><Icon n="phone" /></span>
              <div className="gk-txt"><div className="gk-num">{fmtMoney(totalMensual)}</div><div className="gk-lbl">Telefonía · cargo fijo / mes</div></div></div>
            <div className="gz-kpi"><span className="gk-ico"><Icon n="cart" /></span>
              <div className="gk-txt"><div className="gk-num">{fmtMoney(compras)}</div><div className="gk-lbl">Compras registradas ({docs.filter((d) => d.tipo === 'compra').length})</div></div></div>
            <div className="gz-kpi"><span className="gk-ico"><Icon n="tag" /></span>
              <div className="gk-txt"><div className="gk-num">{fmtMoney(ventas)}</div><div className="gk-lbl">Ventas registradas ({docs.filter((d) => d.tipo === 'venta').length})</div></div></div>
          </div>
        )}

        {tab === 'telefonia' && (
          <>
            <div className="gz-kpis">
              <div className="gz-kpi accent"><span className="gk-ico"><Icon n="phone" /></span>
                <div className="gk-txt"><div className="gk-num">{fmtMoney(totalMensual)}</div><div className="gk-lbl">Cargo fijo / mes</div></div></div>
              <div className="gz-kpi"><span className="gk-ico"><Icon n="layers" /></span>
                <div className="gk-txt"><div className="gk-num">{lines.length}</div><div className="gk-lbl">Líneas activas</div></div></div>
              <div className="gz-kpi"><span className="gk-ico"><Icon n="tag" /></span>
                <div className="gk-txt"><div className="gk-num">{fmtMoney(saldoArriendo)}</div><div className="gk-lbl">Saldo arriendo equipos · {enCuotas} en cuotas</div></div></div>
            </div>
            <div className="gz-grid">
              <div className="conv gz-card">
                <div className="gz-head"><Icon n="clipboard" /> Por plan</div>
                <div className="table-wrap"><table className="tbl-compact">
                  <thead><tr><th>Plan</th><th className="tr">Líneas</th><th className="mny-h">Cargo c/u</th><th className="mny-h">Subtotal / mes</th></tr></thead>
                  <tbody>{byPlan.map((p) => (<tr key={p.plan} className="gz-row" onClick={() => openPlan(p.plan)} title="Ver dispositivos de este plan"><td><span className="gz-link">{p.plan}</span></td><td className="tr">{p.n}</td><td className="mny-cell"><Money value={p.cargo} /></td><td className="mny-cell"><Money value={p.sub} strong /></td></tr>))}</tbody>
                  <tfoot><tr><td><strong>Total</strong></td><td className="tr"><strong>{lines.length}</strong></td><td></td><td className="mny-cell"><Money value={totalMensual} strong /></td></tr></tfoot>
                </table></div>
              </div>
              <div className="conv gz-card">
                <div className="gz-head"><Icon n="building" /> Por departamento</div>
                <div className="table-wrap"><table className="tbl-compact">
                  <thead><tr><th>Departamento</th><th className="tr">Líneas</th><th className="mny-h">Total / mes</th></tr></thead>
                  <tbody>{byDept.map((d) => (<tr key={d.depto} className={`gz-row${d.depto === 'Sin asignar' ? ' gz-unassigned' : ''}`} onClick={() => openDept(d.depto)} title="Ver dispositivos de este departamento"><td>{d.depto === 'Sin asignar' ? <span className="muted gz-link">Sin asignar</span> : <span className="gz-link">{d.depto}</span>}</td><td className="tr">{d.n}</td><td className="mny-cell"><Money value={d.sub} strong /></td></tr>))}</tbody>
                </table></div>
                <p className="muted" style={{ fontSize: '.78rem', margin: '.5rem .2rem 0' }}>Las líneas sin dueño aparecen como "Sin asignar". A medida que las asignes, el gasto se reparte por departamento.</p>
              </div>
            </div>
          </>
        )}

        {tab === 'facturas' && (
          <>
            <div className="row" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.8rem' }}>
              <button className="btn btn-lime" onClick={startForm}><Icon n="plus" /> Nueva factura</button>
              <select value={flt.tipo} onChange={(e) => setFlt((f) => ({ ...f, tipo: e.target.value }))}><option value="">Compras y ventas</option><option value="compra">Compras</option><option value="venta">Ventas</option></select>
              <select value={flt.cat} onChange={(e) => setFlt((f) => ({ ...f, cat: e.target.value }))}><option value="">Todas las categorías</option>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
              <select value={flt.dep} onChange={(e) => setFlt((f) => ({ ...f, dep: e.target.value }))}><option value="">Todos los departamentos</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
            </div>

            {docsFiltrados.length === 0
              ? <div className="conv"><div className="empty">Aún no hay facturas registradas. Crea la primera con "Nueva factura".</div></div>
              : <div className="conv gz-card">
                  <div className="table-wrap"><table className="tbl-compact ed-table">
                    <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Proveedor</th><th>Categoría</th><th>Depto.</th><th className="mny-h">Monto</th><th></th></tr></thead>
                    <tbody>
                      {docsFiltrados.map((d) => (
                        <tr key={d.id}>
                          <td className="nowrap">{fmtDate(d.fecha)}</td>
                          <td><span className={`badge ${d.tipo === 'venta' ? 's-approved' : ''}`}>{d.tipo === 'venta' ? 'Venta' : 'Compra'}</span></td>
                          <td>{d.concepto}</td>
                          <td>{d.proveedor || <span className="muted">—</span>}</td>
                          <td>{d.categoria}</td>
                          <td>{d.departamento || <span className="muted">—</span>}</td>
                          <td className="mny-cell"><Money value={Number(d.monto)} strong /></td>
                          <td className="actions nowrap">
                            {d.file_path ? <button className="btn-sm" onClick={() => openViewer(d)}><Icon n="eye" /> Ver</button> : null}
                            <button className="icon-btn danger" title="Eliminar" onClick={() => del(d)}><Icon n="trash" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </div>}
          </>
        )}
      </>}

      {/* Formulario de nueva factura */}
      {form && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Nueva factura</h3>
            <div className="pf-fields">
              <div><label>Tipo</label>
                <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><option value="compra">Compra</option><option value="venta">Venta</option></select></div>
              <div><label>Fecha</label><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label>Concepto</label><input value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} placeholder="Ej: 3 monitores Samsung 27''" autoFocus /></div>
              <div><label>Proveedor</label><input value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} placeholder="Ej: PCFactory" /></div>
              <div><label>Monto</label><input type="number" min="0" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} placeholder="0" /></div>
              <div><label>Categoría</label>
                <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label>Departamento</label>
                <select value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })}><option value="">— General —</option>{depts.map((d) => <option key={d}>{d}</option>)}</select></div>
              <div style={{ gridColumn: '1 / -1' }}><label>Factura <span className="muted">(PDF o imagen · opcional)</span></label>
                <input type="file" accept=".pdf,image/*,application/pdf" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} /></div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setForm(null)} disabled={busy}>Cancelar</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Detalle: dispositivos de un plan o departamento */}
      {detail && (
        <div className="backdrop open" onClick={() => setDetail(null)}>
          <div className="modal gz-detail" onClick={(e) => e.stopPropagation()}>
            <div className="gz-detail-head">
              <div>
                <span className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>{detail.kind === 'plan' ? 'Plan' : 'Departamento'}</span>
                <h3 style={{ margin: '.1rem 0 0' }}>{detail.title}</h3>
              </div>
              <button className="btn-sm" type="button" onClick={() => setDetail(null)}><Icon n="close" /> Cerrar</button>
            </div>
            <div className="table-wrap">
              <table className="tbl-compact">
                <thead><tr><th>Número</th><th>Dispositivo</th><th>Asignado a</th>{detail.kind === 'dept' ? <th>Plan</th> : null}<th className="mny-h">Cargo / mes</th></tr></thead>
                <tbody>
                  {detail.rows.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap"><strong>{l.linea}</strong></td>
                      <td>{l.device}</td>
                      <td>{l.persona || <span className="muted">Sin asignar</span>}</td>
                      {detail.kind === 'dept' ? <td>{l.plan}</td> : null}
                      <td className="mny-cell"><Money value={l.cargo} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={detail.kind === 'dept' ? 4 : 3}><strong>Total · {detail.rows.length} {detail.rows.length === 1 ? 'línea' : 'líneas'}</strong></td><td className="mny-cell"><Money value={detail.rows.reduce((a, l) => a + l.cargo, 0)} strong /></td></tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Visor de factura */}
      {viewer && (
        <div className="backdrop open" onClick={() => setViewer(null)}>
          <div className="man-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="mv-head">
              <span className="mv-ico"><Icon n="file" /></span>
              <div className="mv-title"><strong>{viewer.concepto}</strong><span className="muted">{viewer.proveedor || '—'} · {fmtMoney(Number(viewer.monto))}</span></div>
              <button className="btn-sm" type="button" onClick={() => setViewer(null)}><Icon n="close" /> Cerrar</button>
            </div>
            <div className="mv-body">
              {viewer.url && /image\//.test(viewer.mime || '')
                ? <div className="mv-img"><img src={viewer.url} alt={viewer.concepto} /></div>
                : viewer.url ? <iframe title={viewer.concepto} src={viewer.url} className="mv-frame" />
                  : <div className="mv-fallback"><p>No se pudo abrir el archivo.</p></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
