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
  const [nt, setNt] = useState(null)   // nuevo ticket: { subject, desc, imgs:[{file,preview}], busy }

  const load = useCallback(async () => {
    const { data } = await supabase.from('support_tickets')
      .select('id, subject, status, created_at, user_id, profiles!support_tickets_user_id_fkey(full_name,email)')
      .order('created_at', { ascending: false })
    setRows(data ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const addFiles = (files) => {
    const arr = Array.from(files || []).filter((f) => f.type && f.type.startsWith('image/'))
    if (arr.length) setNt((t) => ({ ...t, imgs: [...t.imgs, ...arr.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))] }))
  }
  const onPasteImg = (e) => {
    const items = e.clipboardData?.items || []
    const files = []
    for (const it of items) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f) } }
    if (files.length) { e.preventDefault(); setNt((t) => ({ ...t, imgs: [...t.imgs, ...files.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))] })) }
  }
  const removeImg = (i) => setNt((t) => ({ ...t, imgs: t.imgs.filter((_, j) => j !== i) }))
  const submitTicket = async () => {
    const subject = (nt.subject || '').trim(); const desc = (nt.desc || '').trim()
    if (!subject || !desc) return alertDialog('El asunto y la descripción son obligatorios.')
    setNt((t) => ({ ...t, busy: true }))
    try {
      const res = await api('create_ticket', { p_subject: subject, p_description: desc })
      const tid = typeof res === 'string' ? res : (res?.id || res)
      for (const im of nt.imgs) {
        try {
          const path = `${tid}/${Date.now()}_${(im.file.name || 'img').replace(/[^\w.\-]+/g, '_')}`
          const { error } = await supabase.storage.from('soporte').upload(path, im.file, { contentType: im.file.type || undefined })
          if (error) continue
          const { data } = supabase.storage.from('soporte').getPublicUrl(path)
          if (data?.publicUrl) await api('post_message', { p_type: 'ticket', p_id: tid, p_body: data.publicUrl })
        } catch { /* continúa con las demás imágenes */ }
      }
      setNt(null); load()
    } catch (e) { alertDialog(e.message); setNt((t) => ({ ...t, busy: false })) }
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
        <button className="btn btn-lime" onClick={() => setNt({ subject: '', desc: '', imgs: [], busy: false })}>＋ Nuevo ticket</button>
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

      {nt && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Nuevo ticket de soporte</h3>
            <label>Asunto</label>
            <input value={nt.subject} autoFocus placeholder="Ej: No enciende el equipo"
              onChange={(e) => setNt((t) => ({ ...t, subject: e.target.value }))} />
            <label>Describe el problema</label>
            <textarea value={nt.desc} onPaste={onPasteImg} style={{ minHeight: '110px' }}
              placeholder="Detalla qué ocurre, cuándo empezó, qué equipo… Puedes pegar una captura con Ctrl+V."
              onChange={(e) => setNt((t) => ({ ...t, desc: e.target.value }))} />
            <label>Imágenes <span className="muted">(opcional — adjunta o pega capturas)</span></label>
            <div className="tk-imgs">
              {nt.imgs.map((im, i) => (
                <div className="tk-thumb" key={i}>
                  <img src={im.preview} alt="" />
                  <button type="button" className="tk-x" title="Quitar" onClick={() => removeImg(i)}><Icon n="close" /></button>
                </div>
              ))}
              <label className="tk-add"><Icon n="plus" /> Agregar
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setNt(null)} disabled={nt.busy}>Cancelar</button>
              <button className="btn btn-primary" onClick={submitTicket} disabled={nt.busy}>{nt.busy ? 'Creando…' : 'Crear ticket'}</button>
            </div>
          </div>
        </div>
      )}

      {(isAdmin || canManageSupport) && <ActivityLog kinds={['Soporte']} title="Registro de soporte" />}
    </div>
  )
}
