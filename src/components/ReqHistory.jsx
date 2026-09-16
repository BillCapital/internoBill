import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'

// Historial propio de cada solicitud: línea de tiempo con cada paso (creada, aprobada,
// autorizada, entregada, rechazada…), quién lo hizo y cuándo. Se llena solo desde la base.
export default function ReqHistory({ reqId }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!open || rows !== null) return
    supabase.from('request_events').select('id,at,actor_name,event,detail')
      .eq('request_id', reqId).order('at')
      .then(({ data }) => setRows(data || []))
      .catch(() => setRows([]))
  }, [open, rows, reqId])

  const f = (iso) => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const tone = (ev) => /rechaz/i.test(ev) ? 'bad' : /entregada/i.test(ev) ? 'ok2' : /aprobada|autorizada/i.test(ev) ? 'ok' : ''

  return (
    <div className="rqh">
      <button type="button" className="rqh-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon n="clock" /> Historial <span className="chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && (
        rows === null ? <div className="muted" style={{ fontSize: '.8rem', padding: '.3rem 0 .1rem' }}>Cargando…</div>
        : rows.length === 0 ? <div className="muted" style={{ fontSize: '.8rem', padding: '.3rem 0 .1rem' }}>Sin eventos registrados.</div>
        : (
          <ul className="rqh-list">
            {rows.map((r) => (
              <li key={r.id} className={`rqh-item ${tone(r.event)}`}>
                <span className="rqh-dot" />
                <span className="rqh-ev"><b>{r.event}</b>{r.actor_name ? <span className="muted"> · {r.actor_name}</span> : null}
                  {r.detail ? <span className="rqh-detail">{r.detail}</span> : null}</span>
                <span className="rqh-at muted">{f(r.at)}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
