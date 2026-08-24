import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { confirmDialog, alertDialog } from '../lib/ui'

const fmt = (iso) => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const KINDS = ['Solicitud', 'Reserva', 'Equipo']
const badgeFor = (k) => k === 'Reserva' ? 's-pending' : k === 'Equipo' ? 's-prog' : 's-approved'
const ICON_FOR = { 'Reserva': '📅', 'Equipo': '💻', 'Solicitud': '📦' }

export default function Actividad() {
  const { isSuper } = useAuth()
  const [rows, setRows] = useState([])
  const [kind, setKind] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('activity_log').select('id,at,actor_name,kind,action,detail').order('at', { ascending: false }).limit(500)
    setRows(data ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const del = async (r) => {
    if (!(await confirmDialog('¿Eliminar esta entrada del registro?', { title: 'Eliminar entrada', danger: true, okText: 'Eliminar' }))) return
    try { await api('activity_delete', { p_id: r.id }); load() } catch (e) { alertDialog(e.message) }
  }

  const counts = useMemo(() => { const c = {}; rows.forEach((r) => { c[r.kind] = (c[r.kind] || 0) + 1 }); return c }, [rows])
  const data = rows.filter((r) => !kind || r.kind === kind)

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Registro de actividad</h2><p className="muted">Pedidos, solicitudes, reservas y cambios de equipos de los últimos 31 días. La bitácora de cada equipo se conserva de forma permanente en su ficha.</p></div>
      </div></div>

      <div className="kpi-grid compact">
        <button className={`kpi kpi-all`} onClick={() => setKind(null)}><span className="ico" style={{ fontSize: '1.3rem' }}>🗂️</span>
          <div><div className="num">{rows.length}</div><div className="lbl">Movimientos (31 días)</div></div></button>
        {KINDS.map((k) => (
          <button key={k} className={`kpi ${kind === k ? 'active' : ''}`} onClick={() => setKind(kind === k ? null : k)}>
            <div className="ico">{ICON_FOR[k] || '📦'}</div><div className="num">{counts[k] || 0}</div><div className="lbl">{k === 'Equipo' ? 'Equipos' : k + 's'}</div>
          </button>
        ))}
      </div>

      <div className="section open"><div className="sec-body"><div className="table-wrap"><table>
        <thead><tr><th>Fecha y hora</th><th>Responsable</th><th>Tipo</th><th>Acción</th><th>Detalle</th>{isSuper && <th></th>}</tr></thead>
        <tbody>
          {data.length === 0 && <tr><td colSpan={isSuper ? 6 : 5} className="muted" style={{ padding: '.8rem' }}>Sin movimientos registrados.</td></tr>}
          {data.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.at)}</td>
              <td>{r.actor_name}</td>
              <td><span className={`badge ${badgeFor(r.kind)}`}>{r.kind}</span></td>
              <td>{r.action}</td>
              <td><span className="muted">{r.detail}</span></td>
              {isSuper && <td className="actions"><button className="btn-sm btn-danger" onClick={() => del(r)}>Eliminar</button></td>}
            </tr>
          ))}
        </tbody>
      </table></div></div></div>
    </div>
  )
}
