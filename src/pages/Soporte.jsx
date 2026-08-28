import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Chat from '../components/Chat'
import ActivityLog from '../components/ActivityLog'
import { confirmDialog, promptDialog, alertDialog } from '../lib/ui'
import { Icon } from '../lib/icons'

const ST = [
  { key: 'open', label: 'Abiertos', ico: 'inbox' }, { key: 'in_progress', label: 'En proceso', ico: 'hourglass' },
  { key: 'resolved', label: 'Resueltos', ico: 'check' }, { key: 'closed', label: 'Cerrados', ico: 'folder' },
]
const cls = (k) => 's-' + ({ open: 'open', in_progress: 'prog', resolved: 'solved', closed: 'closed' }[k])
const label = (k) => (ST.find((s) => s.key === k) || {}).label || k

export default function Soporte() {
  const { isAdmin, isSuper, canManageSupport } = useAuth()
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('support_tickets')
      .select('id, subject, status, created_at, user_id, profiles!support_tickets_user_id_fkey(full_name,email)')
      .order('created_at', { ascending: false })
    setRows(data ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const create = async () => {
    const subject = await promptDialog('Asunto del ticket', { title: 'Nuevo ticket', placeholder: 'Ej: No enciende el equipo' }); if (!subject) return
    const description = await promptDialog('Describe el problema', { title: 'Nuevo ticket', placeholder: 'Detalla qué ocurre…' }); if (!description) return
    try { await api('create_ticket', { p_subject: subject, p_description: description }); load() }
    catch (e) { alertDialog(e.message) }
  }
  const changeStatus = async (id, p_status) => {
    try { await api('set_ticket_status', { p_id: id, p_status }); load() } catch (e) { alertDialog(e.message) }
  }

  const data = rows.filter((t) => !status || t.status === status)
  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>{isAdmin ? 'Soporte · todas las conversaciones' : 'Soporte'}</h2>
          <p className="muted">Cada ticket es un chat con Soporte TI. Presiona un panel para filtrar.</p></div>
        <button className="btn btn-lime" onClick={create}>＋ Nuevo ticket</button>
      </div></div>
      <div className="kpi-grid compact">
        <button className={`kpi ${!status ? 'active' : ''}`} onClick={() => setStatus(null)}>
          <div className="ico"><Icon n="chat" /></div><div className="num">{rows.length}</div><div className="lbl">{isAdmin ? 'Tickets en total' : 'Tus tickets'}</div>
        </button>
        {ST.map((s) => (
          <button key={s.key} className={`kpi ${status === s.key ? 'active' : ''}`} onClick={() => setStatus(status === s.key ? null : s.key)}>
            <div className="ico"><Icon n={s.ico} /></div><div className="num">{rows.filter((t) => t.status === s.key).length}</div><div className="lbl">{s.label}</div>
          </button>
        ))}
      </div>
      {data.length === 0 && <div className="conv"><div className="empty">No hay tickets.</div></div>}
      {data.map((t) => (
        <div className={`conv ${open === t.id ? 'open' : ''}`} key={t.id}>
          <button className="cv-head" onClick={() => setOpen(open === t.id ? null : t.id)}>
            <span className="ico"><Icon n="chat" /></span>
            <span className="t"><strong>{t.subject}</strong><br /><span className="prev">{isAdmin ? (t.profiles?.full_name || t.profiles?.email) : ''}</span></span>
            <span className={`badge ${cls(t.status)}`}>{label(t.status)}</span><span className="chev">▾</span>
          </button>
          {open === t.id && (
            <div className="cv-body">
              <Chat type="ticket" id={t.id} locked={t.status === 'closed'} />
              {isAdmin && (
                <div className="adm-actions"><span className="muted">Estado:</span>
                  <select value={t.status} onChange={(e) => changeStatus(t.id, e.target.value)}>
                    {ST.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  {isSuper && <button className="btn btn-danger" onClick={async () => { if (await confirmDialog('¿Eliminar el ticket por completo? No se puede deshacer.', { title: 'Eliminar ticket', danger: true, okText: 'Eliminar' })) { try { await api('ticket_delete', { p_id: t.id }); load() } catch (er) { alertDialog(er.message) } } }}><Icon n="trash" /> Eliminar</button>}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {(isAdmin || canManageSupport) && <ActivityLog kinds={['Soporte']} title="Registro de soporte" />}
    </div>
  )
}
