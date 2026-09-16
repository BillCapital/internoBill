import { useMemo, useState } from 'react'
import { msUsers } from '../lib/m365'
import { Icon } from '../lib/icons'

// Buzones del tenant leídos desde Microsoft: tipo real (usuario/compartido/sala/equipo),
// alias de cada dirección y si tiene licencia. Solo lectura: crear alias o convertir un
// buzón en compartido se hace en el panel de Exchange (Microsoft no lo permite por API).
const PURPOSE = {
  user: ['Usuario', 's-pending'], shared: ['Compartido', 's-approved'],
  room: ['Sala', 's-prog'], equipment: ['Equipo', 's-prog'], others: ['Otro', 's-closed'],
}
export default function MailboxPanel() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [onlyShared, setOnlyShared] = useState(false)

  const load = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try { const r = await msUsers('listMailboxes'); setRows(r.rows || []) }
    catch (e) { setErr(e.message || 'Error al consultar Microsoft') }
    finally { setBusy(false) }
  }

  const list = useMemo(() => {
    let base = rows || []
    if (onlyShared) base = base.filter((r) => r.purpose !== 'user')
    const t = q.trim().toLowerCase()
    if (t) base = base.filter((r) => [r.name, r.mail, ...(r.aliases || [])].some((x) => (x || '').toLowerCase().includes(t)))
    // Compartidos y salas primero (son los que se pierden de vista), luego por nombre
    const rank = (r) => (r.purpose === 'shared' ? 0 : r.purpose === 'room' || r.purpose === 'equipment' ? 1 : 2)
    return [...base].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'es'))
  }, [rows, q, onlyShared])

  const nShared = useMemo(() => (rows || []).filter((r) => r.purpose !== 'user').length, [rows])

  return (
    <div className="section open" style={{ marginBottom: '.8rem' }}>
      <div className="sec-body">
        <div className="row" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <span className="ico"><Icon n="mail" /></span>
          <strong>Buzones en Microsoft</strong>
          <span className="muted" style={{ fontSize: '.8rem' }}>Buzones, compartidos y alias del tenant, en vivo</span>
          <span style={{ flex: 1 }} />
          {rows && <input className="search" placeholder="Buscar buzón o alias…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} />}
          <button className="btn-sm" disabled={busy} onClick={load}>{busy ? 'Consultando…' : rows ? 'Actualizar' : 'Consultar buzones'}</button>
        </div>
        {err && <div className="muted" style={{ marginTop: '.5rem', fontSize: '.85rem' }}>{err}</div>}
        {rows && !err && (
          <div style={{ marginTop: '.5rem' }}>
            <div className="row" style={{ gap: '.45rem', flexWrap: 'wrap', marginBottom: '.45rem' }}>
              <button className="badge s-approved" style={{ cursor: 'pointer', border: onlyShared ? '2px solid currentColor' : undefined }}
                title={onlyShared ? 'Ver todos los buzones' : 'Ver solo compartidos, salas y equipos'}
                onClick={() => setOnlyShared((v) => !v)}>{nShared} compartidos / salas</button>
              <span className="muted" style={{ fontSize: '.76rem', alignSelf: 'center' }}>{rows.length} buzones en total</span>
            </div>
            <div className="table-wrap"><table className="tbl-compact">
              <thead><tr><th>Buzón</th><th>Dirección</th><th>Tipo</th><th>Alias</th><th>Licencia</th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: '.6rem' }}>Sin buzones en esta vista.</td></tr>}
                {list.map((r) => {
                  const [lbl, tone] = PURPOSE[r.purpose] || PURPOSE.others
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong>{!r.enabled && <span className="muted" style={{ fontSize: '.72rem' }}> · deshabilitado</span>}</td>
                      <td style={{ fontSize: '.84rem' }}>{r.mail}</td>
                      <td><span className={`badge ${tone}`} style={{ fontSize: '.7rem' }}>{lbl}</span></td>
                      <td style={{ fontSize: '.8rem' }}>{(r.aliases || []).length ? r.aliases.join(', ') : <span className="muted">—</span>}</td>
                      <td>{r.licensed ? 'Sí' : <span className="muted">No</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
            <p className="muted" style={{ fontSize: '.74rem', margin: '.5rem 0 0' }}>
              Un buzón compartido no necesita licencia (hasta 50 GB). Crear alias o convertir un buzón en compartido se hace en el
              {' '}<a href="https://admin.exchange.microsoft.com/#/mailboxes" target="_blank" rel="noreferrer">panel de Exchange</a> — Microsoft no lo permite por API.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
