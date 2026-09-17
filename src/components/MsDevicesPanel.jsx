import { useEffect, useMemo, useState } from 'react'
import { msUsers } from '../lib/m365'
import { Icon } from '../lib/icons'
import { SkeletonRows } from './Skeleton'
import { confirmDialog } from '../lib/ui'

// Equipos registrados en Microsoft Entra ID (gratis, sin licencia Intune).
// Aparecen automáticamente cuando alguien inicia sesión con su cuenta corporativa en un computador.
// Cada equipo se puede VINCULAR a una ficha del inventario: la serie y el id de la ficha quedan
// guardados en el propio dispositivo dentro de Microsoft (extensionAttributes), así el cruce
// persiste y desde aquí se ve la info completa de cada PC (serie, marca/modelo, ubicación, persona).
export default function MsDevicesPanel({ comps }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [linking, setLinking] = useState(null) // id del dispositivo con el selector abierto
  const [fq, setFq] = useState('') // búsqueda dentro del selector de fichas
  const [saving, setSaving] = useState('')

  const load = async () => {
    setBusy(true); setErr('')
    try { const r = await msUsers('listDevices'); setRows(r.devices || []) }
    catch (e) { setErr(e.message || 'Error al consultar Microsoft') }
    finally { setBusy(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const byFicha = useMemo(() => {
    const m = {}
    ;(comps || []).forEach((e) => { m[e.id] = e })
    return m
  }, [comps])

  // Sugerencia automática: ficha cuyo nombre, serie o cuenta de Windows coincide con el nombre del equipo
  const suggestFor = (d) => {
    const n = (d.name || '').trim().toLowerCase()
    if (!n) return null
    return (comps || []).find((e) =>
      [e.name, e.serial_number, e.asset_tag, e.attributes?.cuenta_windows]
        .some((x) => x && String(x).trim().toLowerCase() === n)) || null
  }

  const fDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
  const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)

  const doLink = async (d, ficha) => {
    setSaving(d.id); setErr('')
    try {
      await msUsers('linkDevice', {
        deviceId: d.id,
        serial: ficha ? (ficha.serial_number || ficha.asset_tag || '') : '',
        fichaId: ficha ? ficha.id : '',
      })
      setRows((rs) => (rs || []).map((x) => (x.id === d.id
        ? { ...x, fichaId: ficha ? ficha.id : '', serial: ficha ? (ficha.serial_number || ficha.asset_tag || '') : '' }
        : x)))
      setLinking(null); setFq('')
    } catch (e) { setErr(e.message || 'No se pudo guardar el vínculo') }
    finally { setSaving('') }
  }

  // Registros duplicados: mismo nombre de equipo registrado más de una vez (máquina
  // formateada o re-registrada). Se marca como antiguo todo registro que no sea el
  // más reciente de su nombre, para poder limpiarlo.
  const dupOld = useMemo(() => {
    const byName = {}
    ;(rows || []).forEach((d) => {
      const k = (d.name || '').trim().toLowerCase()
      if (!k) return
      ;(byName[k] = byName[k] || []).push(d)
    })
    const old = new Set()
    Object.values(byName).forEach((arr) => {
      if (arr.length < 2) return
      const sorted = [...arr].sort((a, b) => new Date(b.lastActivity || b.registered || 0) - new Date(a.lastActivity || a.registered || 0))
      sorted.slice(1).forEach((d) => old.add(d.id))
    })
    return old
  }, [rows])

  const doDelete = async (d) => {
    const ok = await confirmDialog(
      `¿Eliminar el registro de “${d.name || d.id}” en Microsoft?\n\nSolo se borra el registro del directorio (útil para equipos formateados, duplicados o dados de baja). Si la máquina sigue en uso, se volverá a registrar sola en el próximo inicio de sesión.`,
      { danger: true, okText: 'Eliminar registro' },
    )
    if (!ok) return
    setSaving(d.id); setErr('')
    try {
      await msUsers('deleteDevice', { deviceId: d.id, name: d.name })
      setRows((rs) => (rs || []).filter((x) => x.id !== d.id))
    } catch (e) { setErr(e.message || 'No se pudo eliminar el registro') }
    finally { setSaving('') }
  }

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = (rows || []).filter((d) => {
      if (!t) return true
      const f = byFicha[d.fichaId]
      return [d.name, d.owner, d.ownerEmail, d.os, d.serial, f?.brand, f?.model, f?.serial_number, f?.location]
        .some((x) => (x || '').toLowerCase().includes(t))
    })
    return base.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0))
  }, [rows, q, byFicha])

  // Resumen: cuántos quedan sin vincular y qué fichas de computador no tienen equipo detectado
  const stats = useMemo(() => {
    if (!rows) return null
    const linked = rows.filter((d) => d.fichaId && byFicha[d.fichaId]).length
    const usedFichas = new Set(rows.map((d) => d.fichaId).filter(Boolean))
    const orphanFichas = (comps || []).filter((e) => !e.returned_at && !usedFichas.has(e.id)).length
    return { linked, unlinked: rows.length - linked, orphanFichas }
  }, [rows, byFicha, comps])

  const fichaOptions = useMemo(() => {
    const t = fq.trim().toLowerCase()
    return (comps || [])
      .filter((e) => !t || [e.name, e.brand, e.model, e.serial_number, e.asset_tag, e.assigned_to_name, e.location]
        .some((x) => x && String(x).toLowerCase().includes(t)))
      .slice(0, 8)
  }, [comps, fq])

  return (
    <div className="gz-card" style={{ marginBottom: '1rem' }}>
      <div className="row" style={{ alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <h3 style={{ margin: 0 }}>Equipos detectados en Microsoft</h3>
        <span className="muted" style={{ fontSize: '.78rem', flex: '1 1 auto' }}>
          Registrados en Entra ID al iniciar sesión con la cuenta corporativa. Vincula cada uno a su ficha del inventario para ver su información completa.
        </span>
        <input className="search" placeholder="Buscar equipo, persona o serie…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        <button className="btn btn-sm" onClick={load} disabled={busy}><Icon n="refresh" /> Actualizar</button>
      </div>

      {busy && !rows && <SkeletonRows n={3} />}
      {err && (
        <div className="ro-note" style={{ marginBottom: '.4rem' }}>
          <Icon n="alert" /> {err}
        </div>
      )}
      {rows && (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Equipo</th><th>Sistema</th><th>Usuario</th><th>Última actividad</th><th>Ficha del inventario</th><th></th>
            </tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: '.7rem' }}>Sin dispositivos{q ? ' que coincidan con la búsqueda' : ' registrados aún'}.</td></tr>}
              {list.map((d) => {
                const ficha = d.fichaId ? byFicha[d.fichaId] : null
                const sug = !ficha ? suggestFor(d) : null
                const days = daysAgo(d.lastActivity)
                const stale = days !== null && days > 30
                const open = linking === d.id
                return (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.name || '(sin nombre)'}</strong>{!d.enabled && <span className="muted" style={{ fontSize: '.72rem' }}> · deshabilitado</span>}
                      {dupOld.has(d.id) && <span className="badge s-pending" style={{ fontSize: '.68rem', marginLeft: '.35rem' }} title="Este equipo aparece registrado más de una vez; este es un registro antiguo (probablemente se formateó o se volvió a configurar)">Registro antiguo</span>}
                      {d.serial && !ficha && <div className="muted" style={{ fontSize: '.72rem' }}>Serie {d.serial}</div>}
                    </td>
                    <td>{d.os}{d.osVersion ? <span className="muted" style={{ fontSize: '.74rem' }}> {d.osVersion}</span> : null}</td>
                    <td>{d.owner || '—'}{d.ownerEmail ? <div className="muted" style={{ fontSize: '.72rem' }}>{d.ownerEmail}</div> : null}</td>
                    <td>
                      {fDate(d.lastActivity)}
                      {days !== null && <div className="muted" style={{ fontSize: '.72rem', color: stale ? 'var(--warn, #f5b13d)' : undefined }}>{days === 0 ? 'hoy' : `hace ${days} día${days !== 1 ? 's' : ''}`}</div>}
                    </td>
                    <td>
                      {ficha ? (
                        <>
                          <span className="badge s-approved" style={{ fontSize: '.7rem' }}>Vinculado</span>
                          <div style={{ fontSize: '.8rem', marginTop: '.15rem' }}>{[ficha.brand, ficha.model].filter(Boolean).join(' ') || ficha.name}</div>
                          <div className="muted" style={{ fontSize: '.72rem' }}>
                            {[ficha.serial_number && `Serie ${ficha.serial_number}`, ficha.location, ficha.assigned_to_name].filter(Boolean).join(' · ')}
                          </div>
                        </>
                      ) : d.fichaId ? (
                        <span className="badge s-pending" style={{ fontSize: '.7rem' }} title="El dispositivo apunta a una ficha que ya no existe en el inventario">Ficha eliminada</span>
                      ) : (
                        <span className="badge s-pending" style={{ fontSize: '.7rem' }}>Sin vincular</span>
                      )}
                      {open && (
                        <div style={{ marginTop: '.35rem' }}>
                          <input className="search" autoFocus placeholder="Buscar ficha (nombre, serie, persona)…" value={fq} onChange={(e) => setFq(e.target.value)} style={{ maxWidth: 240, fontSize: '.78rem' }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', marginTop: '.25rem', maxWidth: 300 }}>
                            {fichaOptions.length === 0 && <span className="muted" style={{ fontSize: '.74rem' }}>Sin fichas que coincidan.</span>}
                            {fichaOptions.map((e) => (
                              <button key={e.id} className="btn-sm" disabled={saving === d.id} style={{ textAlign: 'left' }} onClick={() => doLink(d, e)}>
                                <b style={{ fontSize: '.78rem' }}>{e.name || [e.brand, e.model].filter(Boolean).join(' ')}</b>
                                <span className="muted" style={{ fontSize: '.72rem' }}> {[e.serial_number, e.assigned_to_name].filter(Boolean).join(' · ')}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {ficha && <button className="btn-sm" disabled={saving === d.id} title="Quitar el vínculo con la ficha" onClick={() => doLink(d, null)}>Quitar</button>}
                      {!ficha && sug && !open && (
                        <button className="btn-sm" disabled={saving === d.id} title={`Coincide con la ficha "${sug.name || sug.serial_number}"`} onClick={() => doLink(d, sug)}>
                          <Icon n="check" /> Vincular ({sug.name || sug.serial_number})
                        </button>
                      )}
                      {!ficha && !open && <button className="btn-sm" disabled={saving === d.id} onClick={() => { setLinking(d.id); setFq('') }}>Vincular…</button>}
                      {open && <button className="btn-sm" onClick={() => { setLinking(null); setFq('') }}>Cancelar</button>}
                      {!open && <button className="btn-sm" disabled={saving === d.id} title="Eliminar este registro del directorio de Microsoft (equipos formateados, duplicados o dados de baja)" onClick={() => doDelete(d)} style={{ marginLeft: '.3rem' }}><Icon n="trash" /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && stats && (
        <p className="muted" style={{ fontSize: '.74rem', margin: '.5rem 0 0' }}>
          {stats.linked} vinculado{stats.linked !== 1 ? 's' : ''} · {stats.unlinked} sin vincular · {stats.orphanFichas} ficha{stats.orphanFichas !== 1 ? 's' : ''} de computador sin equipo detectado en Microsoft.
          El vínculo se guarda dentro del dispositivo en Microsoft, así que se conserva aunque se recargue la app. La fecha de actividad es aproximada: Microsoft la actualiza con días de desfase, por lo que un equipo en uso puede figurar con actividad de hace 1–2 días. “Registro antiguo” marca duplicados de equipos formateados o re-registrados: se pueden eliminar con el botón de papelera (si la máquina sigue viva, se vuelve a registrar sola).
        </p>
      )}
    </div>
  )
}
