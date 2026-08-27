import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/linkPreview'
import { rootDeptOf, loadDepts } from '../lib/depts'
import { Icon } from '../lib/icons'
import { SkeletonKpis } from '../components/Skeleton'

const num = (v) => {
  if (v == null) return 0
  const n = Number(String(v).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

export default function Gastos() {
  const [lines, setLines] = useState([])       // teléfonos con attributes + depto resuelto
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      // Alimenta rootDeptOf() para agrupar subdepartamentos bajo su padre
      await loadDepts()
      const { data: secs } = await supabase.from('equipment_sections').select('id,name').eq('name', 'Teléfonos')
      const secId = secs?.[0]?.id
      if (!secId) { setLoading(false); return }
      const [{ data: eq }, { data: profs }] = await Promise.all([
        supabase.from('equipment').select('id,attributes,user_id,assigned_to_name').eq('section_id', secId).is('returned_at', null),
        supabase.from('profiles').select('id,department'),
      ])
      const deptById = Object.fromEntries((profs || []).map((p) => [p.id, p.department || '']))
      const rows = (eq || []).filter((e) => e.attributes?.linea).map((e) => {
        const dept = e.user_id ? (deptById[e.user_id] || '') : ''
        return {
          linea: e.attributes.linea,
          plan: e.attributes.operador || '—',
          cargo: num(e.attributes.cargo_fijo),
          renovacion: num(e.attributes.renovacion),
          cuotasPend: Number(e.attributes.cuotas_pagar) || 0,
          persona: e.assigned_to_name || '',
          depto: dept ? rootDeptOf(dept) : 'Sin asignar',
        }
      })
      setLines(rows); setLoading(false)
    })()
  }, [])

  const totalMensual = useMemo(() => lines.reduce((a, l) => a + l.cargo, 0), [lines])
  const saldoArriendo = useMemo(() => lines.reduce((a, l) => a + l.renovacion, 0), [lines])
  const enCuotas = useMemo(() => lines.filter((l) => l.cuotasPend > 0).length, [lines])

  const byPlan = useMemo(() => {
    const m = {}
    lines.forEach((l) => { const k = l.plan; (m[k] = m[k] || { plan: k, n: 0, cargo: l.cargo, sub: 0 }); m[k].n++; m[k].sub += l.cargo })
    return Object.values(m).sort((a, b) => b.sub - a.sub)
  }, [lines])

  const byDept = useMemo(() => {
    const m = {}
    lines.forEach((l) => { const k = l.depto; (m[k] = m[k] || { depto: k, n: 0, sub: 0 }); m[k].n++; m[k].sub += l.cargo })
    return Object.values(m).sort((a, b) => (a.depto === 'Sin asignar' ? 1 : b.depto === 'Sin asignar' ? -1 : b.sub - a.sub))
  }, [lines])

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Gastos</h2><p className="muted">Cargos recurrentes de la empresa. Empezamos por telefonía; se irá sumando el resto.</p></div>
      </div></div>

      {loading ? <SkeletonKpis n={3} /> : (
        <>
          <div className="kpi-grid compact">
            <div className="kpi kpi-all"><span className="ico"><Icon n="phone" /></span>
              <div><div className="num">{fmtMoney(totalMensual)}</div><div className="lbl">Telefonía · cargo fijo / mes</div></div></div>
            <div className="kpi"><span className="ico"><Icon n="layers" /></span>
              <div><div className="num">{lines.length}</div><div className="lbl">Líneas activas</div></div></div>
            <div className="kpi"><span className="ico"><Icon n="tag" /></span>
              <div><div className="num">{fmtMoney(saldoArriendo)}</div><div className="lbl">Saldo arriendo equipos ({enCuotas} en cuotas)</div></div></div>
          </div>

          <div className="gz-grid">
            <div className="conv gz-card">
              <div className="gz-head"><Icon n="clipboard" /> Por plan</div>
              <div className="table-wrap"><table className="tbl-compact">
                <thead><tr><th>Plan</th><th style={{ textAlign: 'right' }}>Líneas</th><th style={{ textAlign: 'right' }}>Cargo c/u</th><th style={{ textAlign: 'right' }}>Subtotal / mes</th></tr></thead>
                <tbody>
                  {byPlan.map((p) => (
                    <tr key={p.plan}><td>{p.plan}</td>
                      <td style={{ textAlign: 'right' }}>{p.n}</td>
                      <td style={{ textAlign: 'right' }} className="tnum">{fmtMoney(p.cargo)}</td>
                      <td style={{ textAlign: 'right' }} className="tnum"><strong>{fmtMoney(p.sub)}</strong></td></tr>
                  ))}
                </tbody>
                <tfoot><tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{lines.length}</strong></td><td></td>
                  <td style={{ textAlign: 'right' }}><strong>{fmtMoney(totalMensual)}</strong></td></tr></tfoot>
              </table></div>
            </div>

            <div className="conv gz-card">
              <div className="gz-head"><Icon n="building" /> Por departamento</div>
              <div className="table-wrap"><table className="tbl-compact">
                <thead><tr><th>Departamento</th><th style={{ textAlign: 'right' }}>Líneas</th><th style={{ textAlign: 'right' }}>Total / mes</th></tr></thead>
                <tbody>
                  {byDept.map((d) => (
                    <tr key={d.depto} className={d.depto === 'Sin asignar' ? 'gz-unassigned' : ''}>
                      <td>{d.depto === 'Sin asignar' ? <span className="muted">Sin asignar</span> : d.depto}</td>
                      <td style={{ textAlign: 'right' }}>{d.n}</td>
                      <td style={{ textAlign: 'right' }} className="tnum"><strong>{fmtMoney(d.sub)}</strong></td></tr>
                  ))}
                </tbody>
              </table></div>
              <p className="muted" style={{ fontSize: '.78rem', margin: '.5rem .2rem 0' }}>Las líneas aún sin dueño aparecen como "Sin asignar". A medida que las asignes, el gasto se reparte por departamento.</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
