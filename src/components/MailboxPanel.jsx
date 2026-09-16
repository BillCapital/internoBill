import { useEffect, useMemo, useState } from 'react'
import { msUsers } from '../lib/m365'
import { Icon } from '../lib/icons'
import { useAuth } from '../context/AuthContext'
import { confirmDialog, alertDialog } from '../lib/ui'

// Buzones del tenant leídos desde Microsoft: tipo real (usuario/compartido/sala/equipo),
// alias, uso de almacenamiento, y — solo para Acceso total — un explorador para
// descargar (.eml), archivar o eliminar correos de cualquier buzón, con auditoría.
// La regla "mover al archivo después de un año" es directiva de retención de Exchange:
// Microsoft no permite cambiarla por API; se administra en el panel de Exchange.
const PURPOSE = {
  user: ['Usuario', 's-pending'], shared: ['Compartido', 's-approved'],
  room: ['Sala', 's-prog'], equipment: ['Equipo', 's-prog'], others: ['Otro', 's-closed'],
}
const fmtGB = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB' : b >= 1024 ** 2 ? Math.round(b / 1024 ** 2) + ' MB' : Math.round(b / 1024) + ' KB')

export default function MailboxPanel() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState(null)
  const [usage, setUsage] = useState(null) // upn -> {storageBytes, quotaBytes, hasArchive, ...}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [onlyShared, setOnlyShared] = useState(false)
  const [box, setBox] = useState(null) // buzón abierto en el explorador

  const load = async () => {
    if (busy) return
    setBusy(true); setErr('')
    try {
      const r = await msUsers('listMailboxes')
      setRows(r.rows || [])
      if (isAdmin) {
        try {
          const u = await msUsers('mailboxUsage')
          setUsage(Object.fromEntries((u.rows || []).map((x) => [x.upn, x])))
        } catch { /* el informe puede no estar disponible; el panel funciona igual */ }
      }
    } catch (e) { setErr(e.message || 'Error al consultar Microsoft') }
    finally { setBusy(false) }
  }

  const list = useMemo(() => {
    let base = rows || []
    if (onlyShared) base = base.filter((r) => r.purpose !== 'user')
    const t = q.trim().toLowerCase()
    if (t) base = base.filter((r) => [r.name, r.mail, ...(r.aliases || [])].some((x) => (x || '').toLowerCase().includes(t)))
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
          <span className="muted" style={{ fontSize: '.8rem' }}>Buzones, compartidos, alias y uso de almacenamiento, en vivo</span>
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
              <thead><tr><th>Buzón</th><th>Dirección</th><th>Tipo</th><th>Alias</th><th>Uso</th><th>Archivo</th>{isAdmin && <th></th>}</tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={isAdmin ? 7 : 6} className="muted" style={{ padding: '.6rem' }}>Sin buzones en esta vista.</td></tr>}
                {list.map((r) => {
                  const [lbl, tone] = PURPOSE[r.purpose] || PURPOSE.others
                  const u = usage?.[r.mail]
                  const pct = u?.quotaBytes ? Math.round((u.storageBytes / u.quotaBytes) * 100) : null
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong>{!r.enabled && <span className="muted" style={{ fontSize: '.72rem' }}> · deshabilitado</span>}</td>
                      <td style={{ fontSize: '.84rem' }}>{r.mail}</td>
                      <td><span className={`badge ${tone}`} style={{ fontSize: '.7rem' }}>{lbl}</span></td>
                      <td style={{ fontSize: '.8rem' }}>{(r.aliases || []).length ? r.aliases.join(', ') : <span className="muted">—</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{u
                        ? <span title={`${u.items} elementos`} style={pct >= 90 ? { color: 'var(--warn, #f5b13d)', fontWeight: 700 } : undefined}>{fmtGB(u.storageBytes)}{pct !== null ? ` · ${pct}%` : ''}</span>
                        : <span className="muted">—</span>}</td>
                      <td>{u ? (u.hasArchive ? 'Sí' : <span className="muted">No</span>) : <span className="muted">—</span>}</td>
                      {isAdmin && <td className="actions"><button className="btn-sm" onClick={() => setBox(r)} title="Explorar este buzón: descargar, archivar o eliminar correos"><Icon n="inbox" /> Abrir</button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
            <p className="muted" style={{ fontSize: '.74rem', margin: '.5rem 0 0' }}>
              La regla de mover correos al archivo después de un año es una directiva de retención de Exchange: Microsoft no permite cambiarla por API. Se administra (junto con alias y buzones compartidos) en el
              {' '}<a href="https://admin.exchange.microsoft.com/#/mailboxes" target="_blank" rel="noreferrer">panel de Exchange</a>.
            </p>
          </div>
        )}
      </div>
      {box && <MailExplorer box={box} onClose={() => setBox(null)} />}
    </div>
  )
}

// Explorador de un buzón: carpetas a la izquierda, correos a la derecha.
// Cada descarga o eliminación queda en el registro de actividades.
function MailExplorer({ box, onClose }) {
  const [folders, setFolders] = useState(null)
  const [folder, setFolder] = useState(null)
  const [msgs, setMsgs] = useState(null)
  const [skip, setSkip] = useState(0)
  const [more, setMore] = useState(false)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState('')
  const [loading, setLoading] = useState(false)
  const uid = box.mail

  useEffect(() => {
    msUsers('mailFolders', { userId: uid }).then((r) => {
      const fs = r.folders || []
      setFolders(fs)
      const inbox = fs.find((f) => /bandeja|inbox/i.test(f.displayName)) || fs[0]
      if (inbox) setFolder(inbox)
    }).catch((e) => { alertDialog(e.message); onClose() })
  }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMsgs = async (f, sk = 0, append = false) => {
    setLoading(true)
    try {
      const r = await msUsers('mailMessages', search.trim()
        ? { userId: uid, search: search.trim() }
        : { userId: uid, folderId: f?.id, skip: sk })
      const list = r.messages || []
      setMsgs(append ? (m) => [...(m || []), ...list] : list)
      setMore(list.length === 25 && !search.trim())
      setSkip(sk + list.length)
    } catch (e) { alertDialog(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (folder) loadMsgs(folder, 0) }, [folder]) // eslint-disable-line react-hooks/exhaustive-deps

  const fD = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
  const inDeleted = /eliminad/i.test(folder?.displayName || '')

  const download = async (m) => {
    setBusyId(m.id)
    try {
      const r = await msUsers('mailDownload', { userId: uid, messageId: m.id })
      const bytes = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'message/rfc822' }))
      const a = document.createElement('a')
      a.href = url; a.download = (m.subject || 'correo').replace(/[^\w.\- ]+/g, '_').slice(0, 80) + '.eml'
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) { alertDialog(e.message) }
    finally { setBusyId('') }
  }
  const archive = async (m) => {
    setBusyId(m.id)
    try { await msUsers('mailMove', { userId: uid, messageId: m.id, dest: 'archive' }); setMsgs((x) => x.filter((y) => y.id !== m.id)) }
    catch (e) { alertDialog(e.message) } finally { setBusyId('') }
  }
  const del = async (m) => {
    const perm = inDeleted
    const ok = await confirmDialog(perm
      ? `Eliminar DEFINITIVAMENTE "${m.subject}" del buzón de ${box.name}. No se puede deshacer. ¿Continuar?`
      : `Enviar "${m.subject}" a Elementos eliminados del buzón de ${box.name}. ¿Continuar?`)
    if (!ok) return
    setBusyId(m.id)
    try { await msUsers('mailDelete', { userId: uid, messageId: m.id, permanent: perm }); setMsgs((x) => x.filter((y) => y.id !== m.id)) }
    catch (e) { alertDialog(e.message) } finally { setBusyId('') }
  }

  return (
    <div className="backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 980, width: 'min(96vw, 980px)' }}>
        <div className="row" style={{ alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}><Icon n="inbox" /> {box.name}</h3>
          <span className="muted" style={{ fontSize: '.8rem' }}>{box.mail}</span>
          <span style={{ flex: 1 }} />
          <input className="search" placeholder="Buscar en todo el buzón…" value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadMsgs(folder, 0) }} style={{ maxWidth: 220 }} />
          <button className="btn-sm" onClick={() => loadMsgs(folder, 0)} disabled={loading}><Icon n="search" /> Buscar</button>
          <button className="btn-sm" onClick={onClose}><Icon n="close" /> Cerrar</button>
        </div>
        <div style={{ display: 'flex', gap: '.9rem', marginTop: '.7rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 200px', maxHeight: 420, overflowY: 'auto' }}>
            {!folders && <p className="muted" style={{ fontSize: '.8rem' }}>Cargando carpetas…</p>}
            {(folders || []).map((f) => (
              <button key={f.id} className="btn-sm" style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 4, background: folder?.id === f.id ? 'var(--lime)' : undefined, color: folder?.id === f.id ? 'var(--accent-ink, #0b0f14)' : undefined }}
                onClick={() => { setSearch(''); setFolder(f) }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.displayName}</span>
                <span className="muted" style={{ fontSize: '.7rem', color: folder?.id === f.id ? 'inherit' : undefined }}>{f.totalItemCount}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: '1 1 480px', minWidth: 0 }}>
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="tbl-compact">
                <thead><tr><th>Fecha</th><th>De</th><th>Asunto</th><th></th></tr></thead>
                <tbody>
                  {msgs === null && <tr><td colSpan={4} className="muted" style={{ padding: '.6rem' }}>Cargando…</td></tr>}
                  {msgs?.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: '.6rem' }}>Sin correos aquí.</td></tr>}
                  {(msgs || []).map((m) => (
                    <tr key={m.id} style={busyId === m.id ? { opacity: .5 } : undefined}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '.78rem' }}>{fD(m.at)}</td>
                      <td style={{ fontSize: '.82rem' }} title={m.fromAddr}>{m.from}</td>
                      <td style={{ fontSize: '.84rem' }}>{m.hasAttachments && <Icon n="link" size={12} />} {m.subject}</td>
                      <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn-sm" disabled={!!busyId} title="Descargar como archivo .eml" onClick={() => download(m)}><Icon n="download" /></button>
                        <button className="btn-sm" disabled={!!busyId} title="Mover a la carpeta Archivo" onClick={() => archive(m)}><Icon n="folder" /></button>
                        <button className="btn-sm" disabled={!!busyId} title={inDeleted ? 'Eliminar definitivamente' : 'Enviar a Elementos eliminados'} onClick={() => del(m)}><Icon n="trash" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {more && <button className="btn-sm" style={{ marginTop: '.5rem' }} disabled={loading} onClick={() => loadMsgs(folder, skip, true)}>{loading ? 'Cargando…' : 'Cargar más'}</button>}
            <p className="muted" style={{ fontSize: '.72rem', margin: '.5rem 0 0' }}>
              Toda descarga o eliminación queda en el registro de actividades. "Archivo" mueve el correo a la carpeta Archivo del propio buzón.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
