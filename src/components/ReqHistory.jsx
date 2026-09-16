import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'

// Registro GENERAL de cambios de solicitudes: cada evento con su solicitud (#folio),
// fecha y responsable. Tocar el folio abre esa solicitud en la lista.
export function ReqEventsLog({ onOpen }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!open || rows !== null) return
    supabase.from('request_events')
      .select('id,at,actor_name,event,detail,request_id,requests(folio)')
      .order('at', { ascending: false }).limit(150)
      .then(({ data }) => setRows(data || []))
      .catch(() => setRows([]))
  }, [open, rows])

  const f = (iso) => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  const tone = (ev) => /rechaz/i.test(ev) ? 'bad' : /entregada/i.test(ev) ? 'ok2' : /aprobada|autorizada/i.test(ev) ? 'ok' : ''

  return (
    <div className="gz-card" style={{ marginTop: '1rem' }}>
      <button type="button" className="rqh-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon n="clock" /> Registro de solicitudes <span className="chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && (
        rows === null ? <div className="muted" style={{ fontSize: '.8rem', padding: '.4rem 0 .1rem' }}>Cargando…</div>
        : rows.length === 0 ? <div className="muted" style={{ fontSize: '.8rem', padding: '.4rem 0 .1rem' }}>Sin eventos registrados.</div>
        : (
          <div className="table-wrap" style={{ marginTop: '.5rem' }}>
            <table className="tbl-compact">
              <thead><tr><th>Fecha</th><th>Solicitud</th><th>Evento</th><th>Por</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '.78rem' }}>{f(r.at)}</td>
                    <td>
                      <button className="btn-sm" title="Abrir esta solicitud" onClick={() => onOpen && onOpen(r.request_id)}>
                        #{r.requests?.folio || String(r.request_id).slice(0, 4)}
                      </button>
                    </td>
                    <td className={`rqh-item ${tone(r.event)}`} style={{ display: 'table-cell' }}>
                      <span className="rqh-dot" style={{ display: 'inline-block', marginRight: '.4rem', verticalAlign: 'middle' }} />
                      <b style={{ fontSize: '.84rem' }}>{r.event}</b>
                      {r.detail ? <span className="muted" style={{ fontSize: '.76rem' }}> · {r.detail}</span> : null}
                    </td>
                    <td style={{ fontSize: '.82rem' }}>{r.actor_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

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
