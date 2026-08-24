import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { confirmDialog, alertDialog } from '../lib/ui'

const fmt = (iso) => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

// Registro de actividad por área (últimos 31 días). Se muestra dentro de cada apartado de supervisión.
export default function ActivityLog({ kinds, title = 'Registro de actividad' }) {
  const { isSuper } = useAuth()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)

  // Clave estable para no re-consultar en cada render del padre (kinds llega como literal nuevo cada vez)
  const kindsKey = (kinds && kinds.length) ? kinds.join(',') : ''
  const load = useCallback(async () => {
    let q = supabase.from('activity_log').select('id,at,actor_name,kind,action,detail').order('at', { ascending: false }).limit(300)
    if (kindsKey) q = q.in('kind', kindsKey.split(','))
    const { data } = await q
    setRows(data ?? [])
  }, [kindsKey])
  useEffect(() => { load() }, [load])

  const del = async (r) => {
    if (!(await confirmDialog('¿Eliminar esta entrada del registro?', { title: 'Eliminar entrada', danger: true, okText: 'Eliminar' }))) return
    try { await api('activity_delete', { p_id: r.id }); await load() } catch (e) { alertDialog(e.message) }
  }

  return (
    <div className={`section ${open ? 'open' : ''}`} style={{ marginTop: '1rem' }}>
      <button className="sec-head compact" onClick={() => setOpen((v) => !v)}>
        <span className="ico">🗂️</span><span className="t"><strong>{title}</strong><br /><span className="muted">Últimos 31 días · {rows.length} movimiento(s)</span></span>
        <span className="count">{rows.length}</span><span className="chev">▾</span>
      </button>
      {open && <div className="sec-body"><div className="table-wrap"><table>
        <thead><tr><th>Fecha y hora</th><th>Responsable</th><th>Acción</th><th>Detalle</th>{isSuper && <th></th>}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={isSuper ? 5 : 4} className="muted" style={{ padding: '.8rem' }}>Sin movimientos registrados.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.at)}</td>
              <td>{r.actor_name}</td>
              <td>{r.action}</td>
              <td><span className="muted">{r.detail}</span></td>
              {isSuper && <td className="actions"><button className="btn-sm btn-danger" onClick={() => del(r)}>Eliminar</button></td>}
            </tr>
          ))}
        </tbody>
      </table></div></div>}
    </div>
  )
}
