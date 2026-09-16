import { Fragment, useEffect, useMemo, useState } from 'react'
import { msUsers } from '../lib/m365'
import { Icon } from '../lib/icons'
import { useAuth } from '../context/AuthContext'
import { confirmDialog, alertDialog } from '../lib/ui'

// Buzones del tenant leídos desde Microsoft: tipo real, alias, uso de almacenamiento,
// búsqueda transversal sobre todos los buzones, y — solo para Acceso total — un explorador
// por buzón con su archivo en línea (vista previa, filtro y exportación), todo con auditoría.
const PURPOSE = {
  user: ['Usuario', 's-pending'], shared: ['Compartido', 's-approved'],
  room: ['Sala', 's-prog'], equipment: ['Equipo', 's-prog'], others: ['Otro', 's-closed'],
}
const fmtGB = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + ' GB' : b >= 1024 ** 2 ? Math.round(b / 1024 ** 2) + ' MB' : Math.round(b / 1024) + ' KB')
const fD = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const saveBlob = (bytes, name, type) => {
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

export default function MailboxPanel({ auto = false, page = false }) {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState(null)
  const [usage, setUsage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [onlyShared, setOnlyShared] = useState(false)
  const [box, setBox] = useState(null) // {r, search?} buzón abierto en el explorador
  // Búsqueda transversal (todos los buzones a la vez)
  const [gq, setGq] = useState('')
  const [gRes, setGRes] = useState(null)
  const [gBusy, setGBusy] = useState(false)

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
  useEffect(() => { if (auto) load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const globalSearch = async () => {
    const t = gq.trim()
    if (t.length < 3) return alertDialog('Escribe al menos 3 caracteres para buscar.')
    setGBusy(true)
    try { setGRes(await msUsers('searchAll', { q: t })) }
    catch (e) { alertDialog(e.message) }
    finally { setGBusy(false) }
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
  const byMail = useMemo(() => Object.fromEntries((rows || []).map((r) => [r.mail, r])), [rows])

  return (
    <div className={page ? 'gz-card' : 'section open'} style={{ marginBottom: '.8rem' }}>
      <div className={page ? '' : 'sec-body'}>
        <div className="row" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          {!page && <><span className="ico"><Icon n="mail" /></span><strong>Buzones en Microsoft</strong></>}
          <span className="muted" style={{ fontSize: '.8rem' }}>{rows ? `${rows.length} buzones` : 'Datos en vivo desde Microsoft'}</span>
          <span style={{ flex: 1 }} />
          {rows && <input className="search" placeholder="Filtrar buzón o alias…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} />}
          <button className="btn-sm" disabled={busy} onClick={load}>{busy ? 'Consultando…' : rows ? 'Actualizar' : 'Consultar buzones'}</button>
        </div>
        {err && <div className="muted" style={{ marginTop: '.5rem', fontSize: '.85rem' }}>{err}</div>}

        {/* Búsqueda transversal: un término sobre TODOS los buzones a la vez */}
        {rows && !err && isAdmin && (
          <div style={{ margin: '.7rem 0 .4rem', padding: '.6rem .7rem', border: '1px solid var(--line)', borderRadius: 10 }}>
            <div className="row" style={{ gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <Icon n="search" />
              <strong style={{ fontSize: '.88rem' }}>Buscar en todos los buzones</strong>
              <input className="search" placeholder="RUT, cliente, factura…" value={gq} onChange={(e) => setGq(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') globalSearch() }} style={{ flex: '1 1 220px', maxWidth: 340 }} />
              <button className="btn btn-sm" disabled={gBusy} onClick={globalSearch}>{gBusy ? 'Buscando…' : 'Buscar'}</button>
              {gRes && <button className="btn-sm" onClick={() => setGRes(null)}><Icon n="close" /> Limpiar</button>}
            </div>
            {gRes && (
              <div style={{ marginTop: '.55rem' }}>
                <p className="muted" style={{ fontSize: '.78rem', margin: '0 0 .4rem' }}>
                  "{gRes.term}": {gRes.withHits} de {gRes.total} buzones con resultados{gRes.failed ? ` · ${gRes.failed} no se pudieron revisar` : ''}. Se muestran hasta 4 coincidencias por buzón; abre el buzón para ver todas. No incluye los archivos en línea.
                </p>
                {(gRes.rows || []).length === 0 && <p className="muted" style={{ fontSize: '.84rem' }}>Sin coincidencias.</p>}
                {(gRes.rows || []).map((r) => (
                  <div key={r.mail} style={{ borderTop: '1px solid var(--line)', padding: '.45rem 0' }}>
                    <div className="row" style={{ gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '.86rem' }}>{r.name}</strong>
                      <span className="muted" style={{ fontSize: '.76rem' }}>{r.mail}</span>
                      <span style={{ flex: 1 }} />
                      {byMail[r.mail] && <button className="btn-sm" onClick={() => setBox({ r: byMail[r.mail], search: gRes.term })}><Icon n="inbox" /> Abrir con esta búsqueda</button>}
                    </div>
                    <ul style={{ margin: '.25rem 0 0', paddingLeft: '1.1rem' }}>
                      {(r.hits || []).map((h) => (
                        <li key={h.id} style={{ fontSize: '.8rem' }}>{h.subject} <span className="muted">· {h.from} · {fD(h.at)}</span></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {rows && !err && (
          <div style={{ marginTop: '.5rem' }}>
            <div className="row" style={{ gap: '.45rem', flexWrap: 'wrap', marginBottom: '.45rem' }}>
              <button className="badge s-approved" style={{ cursor: 'pointer', border: onlyShared ? '2px solid currentColor' : undefined }}
                title={onlyShared ? 'Ver todos los buzones' : 'Ver solo compartidos, salas y equipos'}
                onClick={() => setOnlyShared((v) => !v)}>{nShared} compartidos / salas</button>
            </div>
            <div className="table-wrap"><table className="tbl-compact">
              <thead><tr><th>Buzón</th><th>Dirección</th><th>Tipo</th><th>Alias</th><th>Uso</th><th>Archivo en línea</th>{isAdmin && <th></th>}</tr></thead>
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
                      <td>{u ? (u.hasArchive ? 'Activado' : <span className="muted">No</span>) : <span className="muted">—</span>}</td>
                      {isAdmin && <td className="actions"><button className="btn-sm" onClick={() => setBox({ r })} title="Explorar este buzón y su archivo en línea"><Icon n="inbox" /> Abrir</button></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
            <p className="muted" style={{ fontSize: '.74rem', margin: '.5rem 0 0' }}>
              La regla de mover correos al archivo en línea después de un año es una directiva de retención de Exchange: Microsoft no permite cambiarla por API. Se administra (junto con alias y buzones compartidos) en el
              {' '}<a href="https://admin.exchange.microsoft.com/#/mailboxes" target="_blank" rel="noreferrer">panel de Exchange</a>. Para búsquedas con exportación formal está la Búsqueda de contenido de Purview (ver manual en Manuales).
            </p>
          </div>
        )}
      </div>
      {box && <MailExplorer box={box.r} initialSearch={box.search || ''} onClose={() => setBox(null)} />}
    </div>
  )
}

// Explorador de un buzón: carpetas en tiempo real + archivo en línea.
// Archivo en línea: vista previa (Microsoft entrega solo los primeros 255 caracteres del cuerpo),
// filtro por asunto/remitente y exportación en formato técnico de Microsoft (.fts).
function MailExplorer({ box, initialSearch = '', onClose }) {
  const [folders, setFolders] = useState(null)
  const [archFolders, setArchFolders] = useState(null)
  const [archErr, setArchErr] = useState('')
  const [folder, setFolder] = useState(null)
  const [msgs, setMsgs] = useState(null)
  const [skip, setSkip] = useState(0)
  const [more, setMore] = useState(false)
  const [search, setSearch] = useState(initialSearch)
  const [archFilter, setArchFilter] = useState('')
  const [reading, setReading] = useState(null) // { m, data } — correo abierto en la vista previa
  const [busyId, setBusyId] = useState('')
  const [loading, setLoading] = useState(false)
  const uid = box.mail

  // Vista completa de un correo del buzón en tiempo real (cuerpo + adjuntos)
  const read = async (m) => {
    setReading({ m, data: null })
    try { setReading({ m, data: await msUsers('mailRead', { userId: uid, messageId: m.id }) }) }
    catch (e) { alertDialog(e.message); setReading(null) }
  }
  // Vista completa de un correo del ARCHIVO en línea: el cuerpo entero se extrae del export de Microsoft
  const readArch = async (m) => {
    setReading({ m, arch: true, data: null })
    try {
      const r = await msUsers('archiveRead', { userId: uid, itemId: m.id, preview: m.preview })
      setReading({ m, arch: true, data: { subject: m.subject, from: m.from, fromAddr: '', at: m.at, to: [], cc: [], bodyType: r.bodyType, body: r.body, attachments: [], full: r.full } })
    } catch (e) { alertDialog(e.message); setReading(null) }
  }

  useEffect(() => {
    msUsers('mailFolders', { userId: uid }).then((r) => {
      const fs = r.folders || []
      setFolders(fs)
      const inbox = fs.find((f) => /bandeja|inbox/i.test(f.displayName)) || fs[0]
      if (inbox) setFolder(inbox)
    }).catch((e) => { alertDialog(e.message); onClose() })
    msUsers('archiveFolders', { userId: uid })
      .then((r) => setArchFolders(r.archive ? (r.folders || []) : false))
      .catch((e) => { setArchFolders(false); setArchErr(e.message || '') })
  }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMsgs = async (f, sk = 0, append = false) => {
    setLoading(true); setReading(null)
    try {
      let r
      if (f?.arch) r = await msUsers('archiveMessages', { userId: uid, folderId: f.id, skip: sk, filter: archFilter.trim() || undefined })
      else r = await msUsers('mailMessages', search.trim() ? { userId: uid, search: search.trim() } : { userId: uid, folderId: f?.id, skip: sk })
      const list = r.messages || []
      setMsgs(append ? (m) => [...(m || []), ...list] : list)
      setMore(list.length === 25 && !(!f?.arch && search.trim()))
      setSkip(sk + list.length)
    } catch (e) { alertDialog(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (folder) loadMsgs(folder, 0) }, [folder]) // eslint-disable-line react-hooks/exhaustive-deps

  const inDeleted = /eliminad/i.test(folder?.displayName || '')
  const inArch = !!folder?.arch

  const download = async (m) => {
    setBusyId(m.id)
    try {
      const r = await msUsers('mailDownload', { userId: uid, messageId: m.id })
      saveBlob(Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0)), (m.subject || 'correo').replace(/[^\w.\- ]+/g, '_').slice(0, 80) + '.eml', 'message/rfc822')
    } catch (e) { alertDialog(e.message) }
    finally { setBusyId('') }
  }
  const downloadArchEml = async (m) => {
    setBusyId(m.id)
    try {
      // Se pasan los datos ya conocidos como respaldo por si la ruta directa no los trae
      const r = await msUsers('archiveEml', { userId: uid, itemId: m.id, subject: m.subject, from: m.from, at: m.at, preview: m.preview })
      const bytes = new TextEncoder().encode(r.eml)
      saveBlob(bytes, (m.subject || 'correo').replace(/[^\w.\- ]+/g, '_').slice(0, 80) + '.eml', 'message/rfc822')
    } catch (e) { alertDialog(e.message) }
    finally { setBusyId('') }
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

  const FolderBtn = ({ f, arch }) => (
    <button className="btn-sm" style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 4, background: folder?.id === f.id ? 'var(--lime)' : undefined, color: folder?.id === f.id ? 'var(--accent-ink, #0b0f14)' : undefined }}
      onClick={() => { setSearch(''); setArchFilter(''); setFolder(arch ? { ...f, arch: true } : f) }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.displayName}</span>
      {f.totalItemCount !== undefined && f.totalItemCount !== null && <span className="muted" style={{ fontSize: '.7rem', color: folder?.id === f.id ? 'inherit' : undefined }}>{f.totalItemCount}</span>}
    </button>
  )

  return (
    <div className="backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 980, width: 'min(96vw, 980px)' }}>
        <div className="row" style={{ alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}><Icon n="inbox" /> {box.name}</h3>
          <span className="muted" style={{ fontSize: '.8rem' }}>{box.mail}</span>
          <span style={{ flex: 1 }} />
          {!inArch ? (
            <>
              <input className="search" placeholder="Buscar en todo el buzón…" value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadMsgs(folder, 0) }} style={{ maxWidth: 220 }} />
              <button className="btn-sm" onClick={() => loadMsgs(folder, 0)} disabled={loading}><Icon n="search" /> Buscar</button>
            </>
          ) : (
            <>
              <input className="search" placeholder="Filtrar por asunto o remitente…" value={archFilter} onChange={(e) => setArchFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadMsgs(folder, 0) }} style={{ maxWidth: 230 }} />
              <button className="btn-sm" onClick={() => loadMsgs(folder, 0)} disabled={loading}><Icon n="search" /> Filtrar</button>
            </>
          )}
          <button className="btn-sm" onClick={onClose}><Icon n="close" /> Cerrar</button>
        </div>
        <div style={{ display: 'flex', gap: '.9rem', marginTop: '.7rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 210px', maxHeight: 440, overflowY: 'auto' }}>
            {!folders && <p className="muted" style={{ fontSize: '.8rem' }}>Cargando carpetas…</p>}
            {(folders || []).map((f) => <FolderBtn key={f.id} f={f} />)}
            <div className="muted" style={{ fontSize: '.68rem', letterSpacing: '.08em', textTransform: 'uppercase', margin: '.6rem 0 .3rem' }}>Archivo en línea</div>
            {archFolders === null && <p className="muted" style={{ fontSize: '.76rem' }}>Consultando…</p>}
            {archFolders === false && <p className="muted" style={{ fontSize: '.76rem' }}>{archErr || 'Este buzón no tiene archivo en línea.'}</p>}
            {Array.isArray(archFolders) && archFolders.map((f) => <FolderBtn key={f.id} f={f} arch />)}
          </div>
          <div style={{ flex: '1 1 480px', minWidth: 0 }}>
            {inArch && <p className="muted" style={{ fontSize: '.76rem', margin: '0 0 .4rem' }}>
              Toca un correo archivado para verlo <b>completo</b> aquí mismo (el contenido se extrae del respaldo de Microsoft; puede tardar unos segundos). La descarga .eml también incluye el correo completo. Los adjuntos de correos archivados solo se recuperan vía Búsqueda de contenido de Purview.
            </p>}

            {/* Vista previa completa del correo, dentro de la app */}
            {reading && (
              <div>
                <div className="row" style={{ gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.45rem' }}>
                  <button className="btn-sm" onClick={() => setReading(null)}>← Volver a la lista</button>
                  <span style={{ flex: 1 }} />
                  <button className="btn-sm btn-lime" disabled={!!busyId} onClick={() => (reading.arch ? downloadArchEml(reading.m) : download(reading.m))}><Icon n="download" /> Descargar .eml</button>
                </div>
                {!reading.data ? <p className="muted" style={{ fontSize: '.84rem' }}>Cargando correo…</p> : (
                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '.6rem .75rem', borderBottom: '1px solid var(--line)' }}>
                      <strong style={{ fontSize: '.95rem' }}>{reading.data.subject}</strong>
                      <div className="muted" style={{ fontSize: '.78rem', marginTop: 2 }}>
                        De: {reading.data.from}{reading.data.fromAddr ? ` <${reading.data.fromAddr}>` : ''} · {fD(reading.data.at)}
                      </div>
                      {reading.data.to?.length > 0 && <div className="muted" style={{ fontSize: '.74rem' }}>Para: {reading.data.to.join(', ')}</div>}
                      {reading.data.cc?.length > 0 && <div className="muted" style={{ fontSize: '.74rem' }}>CC: {reading.data.cc.join(', ')}</div>}
                      {reading.data.attachments?.length > 0 && (
                        <div style={{ marginTop: '.35rem', display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                          {reading.data.attachments.map((a) => (
                            <span key={a.id} className="badge s-closed" style={{ fontSize: '.7rem' }} title="Los adjuntos van dentro del .eml al descargarlo"><Icon n="link" size={11} /> {a.name}{a.size ? ` · ${fmtGB(a.size)}` : ''}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* El cuerpo se muestra en un iframe aislado (sandbox): el HTML del correo no puede ejecutar nada en la app */}
                    {String(reading.data.bodyType).toLowerCase() === 'html'
                      ? <iframe title="correo" sandbox="" style={{ width: '100%', height: 360, border: 0, background: '#fff' }}
                          srcDoc={`<base target="_blank"><style>body{font:14px/1.5 -apple-system,Segoe UI,Arial,sans-serif;margin:12px;color:#111}img{max-width:100%}</style>${reading.data.body}`} />
                      : <pre style={{ margin: 0, padding: '.7rem .75rem', maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: '.84rem', fontFamily: 'inherit' }}>{reading.data.body}</pre>}
                  </div>
                )}
              </div>
            )}

            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto', display: reading ? 'none' : undefined }}>
              <table className="tbl-compact">
                <thead><tr><th>Fecha</th><th>De</th><th>Asunto</th><th></th></tr></thead>
                <tbody>
                  {msgs === null && <tr><td colSpan={4} className="muted" style={{ padding: '.6rem' }}>Cargando…</td></tr>}
                  {msgs?.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: '.6rem' }}>Sin correos aquí.</td></tr>}
                  {(msgs || []).map((m) => (
                    <Fragment key={m.id}>
                      <tr style={busyId === m.id ? { opacity: .5 } : { cursor: 'pointer' }}
                        title="Abrir el correo"
                        onClick={inArch ? () => readArch(m) : () => read(m)}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '.78rem' }}>{fD(m.at)}</td>
                        <td style={{ fontSize: '.82rem' }} title={m.fromAddr}>{m.from}</td>
                        <td style={{ fontSize: '.84rem' }}>{m.hasAttachments && <Icon n="link" size={12} />} {m.subject}</td>
                        <td className="actions" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                          {inArch ? (
                            <button className="btn-sm" disabled={!!busyId} title="Descargar como .eml (abre en Outlook)" onClick={() => downloadArchEml(m)}><Icon n="download" /></button>
                          ) : (
                            <>
                              <button className="btn-sm" disabled={!!busyId} title="Descargar como archivo .eml" onClick={() => download(m)}><Icon n="download" /></button>
                              <button className="btn-sm" disabled={!!busyId} title={inDeleted ? 'Eliminar definitivamente' : 'Enviar a Elementos eliminados'} onClick={() => del(m)}><Icon n="trash" /></button>
                            </>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {more && !reading && <button className="btn-sm" style={{ marginTop: '.5rem' }} disabled={loading} onClick={() => loadMsgs(folder, skip, true)}>{loading ? 'Cargando…' : 'Cargar más'}</button>}
            {!inArch && <p className="muted" style={{ fontSize: '.72rem', margin: '.5rem 0 0' }}>Toda descarga o eliminación queda en el registro de actividades.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
