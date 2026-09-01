import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { confirmDialog, alertDialog } from '../lib/ui'
import { Icon } from '../lib/icons'

// Llama a la función de listas/grupos de Microsoft 365 (ms-groups)
async function msGroups(op, payload = {}) {
  const { data, error } = await supabase.functions.invoke('ms-groups', { body: { op, ...payload } })
  if (error) {
    let msg = error.message || 'Error'
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (data && data.error) throw new Error(data.error)
  return data
}

const KIND = {
  m365: { label: 'Microsoft 365', cls: 'k-m365' },
  distribution: { label: 'Distribución', cls: 'k-dist' },
  'mail-security': { label: 'Seguridad · correo', cls: 'k-sec' },
  security: { label: 'Seguridad', cls: 'k-sec' },
}
const norm = (s) => (s || '').toLowerCase()

export default function Listas() {
  const [groups, setGroups] = useState(null)
  const [users, setUsers] = useState(null)   // se carga bajo demanda al abrir "Agregar persona"
  const [sel, setSel] = useState(null)
  const [members, setMembers] = useState(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addQ, setAddQ] = useState('')
  const [nw, setNw] = useState(null)       // modal nueva lista: { name, nick, desc, busy }
  const [err, setErr] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [gloss, setGloss] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try { const g = await msGroups('list'); setGroups(g.groups || []) }
    catch (e) { setErr(e.message); setGroups([]) }
  }, [])
  useEffect(() => { load() }, [load])
  const ensureUsers = async () => { if (users !== null) return; try { const r = await msGroups('users'); setUsers(r.users || []) } catch (e) { setUsers([]); alertDialog(e.message) } }

  const openGroup = async (g) => {
    setSel(g); setMembers(null); setAddOpen(false); setAddQ('')
    try { const r = await msGroups('members', { id: g.id }); setMembers(r.members || []) }
    catch (e) { alertDialog(e.message); setMembers([]) }
  }
  const reloadMembers = async (gid) => { const r = await msGroups('members', { id: gid }); setMembers(r.members || []) }

  const addMember = async (u) => {
    setBusy(true)
    try { await msGroups('addMember', { id: sel.id, userId: u.id }); await reloadMembers(sel.id); setAddQ('') }
    catch (e) { alertDialog(e.message) } finally { setBusy(false) }
  }
  const removeMember = async (m) => {
    if (!(await confirmDialog(`¿Quitar a ${m.displayName} de "${sel.displayName}"?`, { title: 'Quitar de la lista', okText: 'Quitar', danger: true }))) return
    setBusy(true)
    try { await msGroups('removeMember', { id: sel.id, userId: m.id }); await reloadMembers(sel.id) }
    catch (e) { alertDialog(e.message) } finally { setBusy(false) }
  }
  const createGroup = async () => {
    const name = (nw.name || '').trim(); const nick = (nw.nick || '').trim().replace(/[^a-zA-Z0-9._-]/g, '')
    if (name.length < 2 || nick.length < 2) return alertDialog('Ponle un nombre y un alias de correo (mínimo 2 caracteres).')
    setNw((s) => ({ ...s, busy: true }))
    try {
      const r = await msGroups('create', { displayName: name, mailNickname: nick, description: nw.desc || '' })
      setNw(null); await load()
      if (r?.id) openGroup({ id: r.id, displayName: name, mail: r.mail, kind: 'm365' })
    } catch (e) { alertDialog(e.message); setNw((s) => ({ ...s, busy: false })) }
  }
  const delGroup = async (g) => {
    if (!(await confirmDialog(`¿Eliminar la lista "${g.displayName}" por completo? No se puede deshacer.`, { title: 'Eliminar lista', danger: true, okText: 'Eliminar' }))) return
    try { await msGroups('delete', { id: g.id }); if (sel?.id === g.id) { setSel(null); setMembers(null) }; await load() }
    catch (e) { alertDialog(e.message) }
  }

  const sync = async () => {
    setSyncing(true); setUsers(null)
    try { await load(); if (sel) { const r = await msGroups('members', { id: sel.id }); setMembers(r.members || []) } }
    catch (e) { alertDialog(e.message) } finally { setSyncing(false) }
  }

  const [kindFilter, setKindFilter] = useState(null) // null | 'm365' | 'distribution' | 'seguridad'
  const inKind = (g, f) => !f || (f === 'seguridad' ? (g.kind === 'mail-security' || g.kind === 'security') : g.kind === f)
  const counts = useMemo(() => {
    const c = { all: 0, m365: 0, distribution: 0, seguridad: 0 }
    for (const g of groups || []) { c.all++; if (g.kind === 'm365') c.m365++; else if (g.kind === 'distribution') c.distribution++; else c.seguridad++ }
    return c
  }, [groups])
  // Orden: primero Microsoft 365, luego Distribución, luego Seguridad; dentro de cada grupo, alfabético.
  const kindRank = (k) => (k === 'm365' ? 0 : k === 'distribution' ? 1 : 2)
  const shown = useMemo(() => (groups || [])
    .filter((g) => inKind(g, kindFilter) && (!q || norm(g.displayName).includes(norm(q)) || norm(g.mail).includes(norm(q))))
    .slice()
    .sort((a, b) => (kindRank(a.kind) - kindRank(b.kind)) || norm(a.displayName).localeCompare(norm(b.displayName), 'es')), [groups, q, kindFilter])
  const memberIds = useMemo(() => new Set((members || []).map((m) => m.id)), [members])
  const candidates = useMemo(() => (users || []).filter((u) => !memberIds.has(u.id) && (norm(u.displayName).includes(norm(addQ)) || norm(u.mail).includes(norm(addQ)))).slice(0, 40), [users, memberIds, addQ])

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Listas de distribución</h2>
          <p className="muted">Grupos y listas de Microsoft 365. Agrega o quita personas, crea o elimina listas.</p></div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className={`btn ${gloss ? 'on' : ''}`} onClick={() => setGloss((v) => !v)}><Icon n="info" /> Glosario</button>
          <button className={`btn ${syncing ? 'is-sync' : ''}`} onClick={sync} disabled={syncing}><Icon n="refresh" /> {syncing ? 'Sincronizando…' : 'Sincronizar'}</button>
          <button className="btn btn-lime" onClick={() => setNw({ name: '', nick: '', desc: '', busy: false })}><Icon n="plus" /> Nueva lista</button>
        </div>
      </div></div>

      {err && <div className="conv" style={{ padding: '1rem', marginBottom: '1rem', color: 'var(--danger)' }}><Icon n="ban" /> {err}</div>}

      {gloss && (
        <div className="dl-gloss">
          <div className="dl-gloss-title"><Icon n="info" /> Tipos de lista</div>
          <ul className="dl-gloss-list">
            <li><span className="dl-kind k-dist">Distribución</span><span>Lista de distribución <strong>clásica</strong> de Exchange. Solo para <strong>enviar correo</strong> a un conjunto de personas — sin buzón propio, Teams ni SharePoint.</span></li>
            <li><span className="dl-kind k-m365">Microsoft 365</span><span>Grupo de Microsoft 365 (moderno). Funciona como lista de correo y además tiene <strong>buzón compartido, calendario, Teams y SharePoint</strong>. Es lo que se crea hoy por defecto.</span></li>
            <li><span className="dl-kind k-sec">Seguridad · correo</span><span>Grupo de <strong>seguridad</strong> con correo habilitado. Se usa para dar permisos/accesos y también recibe correo.</span></li>
          </ul>
          <p className="muted dl-gloss-note">Al crear una <strong>Nueva lista</strong> se genera un grupo de Microsoft 365 (Graph no permite crear listas de distribución clásicas; el grupo M365 funciona igual como lista). Agregar o quitar personas funciona en las Microsoft 365 y de seguridad; algunas de distribución clásicas muy antiguas se gestionan solo desde Exchange.</p>
        </div>
      )}

      <div className="dl-wrap">
        {/* Panel izquierdo: listas */}
        <div className="dl-list">
          <div className="dl-search"><Icon n="search" /><input value={q} placeholder="Buscar lista…" onChange={(e) => setQ(e.target.value)} /></div>
          <div className="dl-filters">
            <button className={`dl-chip ${!kindFilter ? 'on' : ''}`} onClick={() => setKindFilter(null)}>Todas <span>{counts.all}</span></button>
            {counts.m365 > 0 && <button className={`dl-chip ${kindFilter === 'm365' ? 'on' : ''}`} onClick={() => setKindFilter('m365')}>Microsoft 365 <span>{counts.m365}</span></button>}
            {counts.distribution > 0 && <button className={`dl-chip ${kindFilter === 'distribution' ? 'on' : ''}`} onClick={() => setKindFilter('distribution')}>Distribución <span>{counts.distribution}</span></button>}
            {counts.seguridad > 0 && <button className={`dl-chip ${kindFilter === 'seguridad' ? 'on' : ''}`} onClick={() => setKindFilter('seguridad')}>Seguridad <span>{counts.seguridad}</span></button>}
          </div>
          {groups === null ? <div className="muted dl-empty">Cargando listas…</div>
            : shown.length === 0 ? <div className="muted dl-empty">No hay listas{q ? ' que coincidan' : ''}.</div>
              : shown.map((g) => {
                const k = KIND[g.kind] || KIND.distribution
                return (
                  <button key={g.id} className={`dl-item ${sel?.id === g.id ? 'on' : ''}`} onClick={() => openGroup(g)}>
                    <span className="dl-ic"><Icon n="mail" /></span>
                    <span className="dl-info"><strong>{g.displayName}</strong><span className="dl-mail">{g.mail || '—'}</span></span>
                    <span className={`dl-kind ${k.cls}`}>{k.label}</span>
                  </button>
                )
              })}
        </div>

        {/* Panel derecho: miembros */}
        <div className="dl-detail">
          {!sel ? <div className="muted dl-empty" style={{ padding: '2rem 1rem' }}>Selecciona una lista para ver y editar sus miembros.</div> : <>
            <div className="dl-detail-head">
              <div><h3 style={{ margin: 0 }}>{sel.displayName}</h3>
                <span className="muted" style={{ fontSize: '.82rem' }}>{sel.mail || '—'} · {(KIND[sel.kind] || KIND.distribution).label}</span></div>
              <button className="btn-sm btn-danger" onClick={() => delGroup(sel)}><Icon n="trash" /> Eliminar lista</button>
            </div>

            <div className="dl-members-head">
              <span className="th-eyebrow">Miembros {members ? `· ${members.length}` : ''}</span>
              <button className="btn-sm btn-lime" onClick={() => setAddOpen((v) => { const nv = !v; if (nv) ensureUsers(); return nv })}><Icon n="plus" /> Agregar persona</button>
            </div>

            {addOpen && (
              <div className="dl-add">
                <div className="dl-search"><Icon n="search" /><input autoFocus value={addQ} placeholder="Buscar persona por nombre o correo…" onChange={(e) => setAddQ(e.target.value)} /></div>
                <div className="dl-cands">
                  {users === null ? <div className="muted" style={{ padding: '.5rem' }}>Cargando personas…</div>
                    : candidates.length === 0 ? <div className="muted" style={{ padding: '.5rem' }}>Sin coincidencias.</div>
                    : candidates.map((u) => (
                      <button key={u.id} className="dl-cand" disabled={busy} onClick={() => addMember(u)}>
                        <span className="dl-info"><strong>{u.displayName}</strong><span className="dl-mail">{u.mail}</span></span>
                        <span className="dl-add-ic"><Icon n="plus" /></span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {members === null ? <div className="muted dl-empty">Cargando miembros…</div>
              : members.length === 0 ? <div className="muted dl-empty">Esta lista no tiene miembros aún.</div>
                : <div className="dl-members">
                  {members.map((m) => (
                    <div className="dl-member" key={m.id}>
                      <span className="dl-info"><strong>{m.displayName}</strong><span className="dl-mail">{m.mail}</span></span>
                      <button className="dl-rm" title="Quitar" disabled={busy} onClick={() => removeMember(m)}><Icon n="close" /></button>
                    </div>
                  ))}
                </div>}
          </>}
        </div>
      </div>

      {/* Modal nueva lista */}
      {nw && (
        <div className="backdrop open">
          <div className="modal" style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0 }}>Nueva lista</h3>
            <p className="muted" style={{ fontSize: '.82rem', marginTop: 0 }}>Se crea como grupo de Microsoft 365 (con buzón), que funciona como lista de distribución.</p>
            <div className="tk-field"><label>Nombre</label>
              <input value={nw.name} autoFocus placeholder="Ej: Equipo Comercial" onChange={(e) => setNw((s) => ({ ...s, name: e.target.value }))} /></div>
            <div className="tk-field"><label>Alias de correo</label>
              <input value={nw.nick} placeholder="equipo-comercial" onChange={(e) => setNw((s) => ({ ...s, nick: e.target.value.replace(/[^a-zA-Z0-9._-]/g, '') }))} />
              <span className="muted" style={{ fontSize: '.75rem' }}>{nw.nick ? `${nw.nick}@billcapital.com` : 'se usará como dirección de la lista'}</span></div>
            <div className="tk-field"><label>Descripción <span className="muted">(opcional)</span></label>
              <input value={nw.desc} onChange={(e) => setNw((s) => ({ ...s, desc: e.target.value }))} /></div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setNw(null)} disabled={nw.busy}>Cancelar</button>
              <button className="btn btn-primary" onClick={createGroup} disabled={nw.busy}>{nw.busy ? 'Creando…' : 'Crear lista'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
