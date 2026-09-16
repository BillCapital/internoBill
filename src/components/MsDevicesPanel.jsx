import { useEffect, useMemo, useState } from 'react'
import { msUsers } from '../lib/m365'
import { Icon } from '../lib/icons'
import { SkeletonRows } from './Skeleton'

// Equipos registrados en Microsoft Entra ID (gratis, sin licencia Intune).
// Aparecen automáticamente cuando alguien inicia sesión con su cuenta corporativa en un computador.
// Se cruzan por nombre/serie con los equipos ya cargados en el inventario.
export default function MsDevicesPanel({ comps }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')

  const load = async () => {
    setBusy(true); setErr('')
    try { const r = await msUsers('listDevices'); setRows(r.devices || []) }
    catch (e) { setErr(e.message || 'Error al consultar Microsoft') }
    finally { setBusy(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Nombres y series del inventario, para marcar qué equipo detectado ya está registrado
  const known = useMemo(() => {
    const s = new Set()
    ;(comps || []).forEach((e) => {
      if (e.name) s.add(e.name.trim().toLowerCase())
      if (e.serial_number) s.add(e.serial_number.trim().toLowerCase())
      if (e.asset_tag) s.add(String(e.asset_tag).trim().toLowerCase())
    })
    return s
  }, [comps])

  const fDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
  const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = (rows || []).filter((d) => !t || [d.name, d.owner, d.ownerEmail, d.os, d.model, d.manufacturer].some((x) => (x || '').toLowerCase().includes(t)))
    // Más recientes primero
    return base.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0))
  }, [rows, q])

  return (
    <div className="gz-card" style={{ marginBottom: '1rem' }}>
      <div className="row" style={{ alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <h3 style={{ margin: 0 }}>Equipos detectados en Microsoft</h3>
        <span className="muted" style={{ fontSize: '.78rem', flex: '1 1 auto' }}>
          Registrados en Entra ID al iniciar sesión con la cuenta corporativa. No requiere licencia adicional.
        </span>
        <input className="search" placeholder="Buscar equipo o persona…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        <button className="btn btn-sm" onClick={load} disabled={busy}><Icon n="refresh" /> Actualizar</button>
      </div>

      {busy && !rows && <SkeletonRows n={3} />}
      {err && (
        <div className="ro-note" style={{ marginBottom: '.4rem' }}>
          <Icon n="alert" /> {err}
        </div>
      )}
      {rows && !err && (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Equipo</th><th>Sistema</th><th>Modelo</th><th>Usuario</th><th>Última actividad</th><th>Inventario</th>
            </tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: '.7rem' }}>Sin dispositivos{q ? ' que coincidan con la búsqueda' : ' registrados aún'}.</td></tr>}
              {list.map((d) => {
                const inInv = known.has((d.name || '').trim().toLowerCase())
                const days = daysAgo(d.lastActivity)
                const stale = days !== null && days > 30
                return (
                  <tr key={d.id}>
                    <td><strong>{d.name || '(sin nombre)'}</strong>{!d.enabled && <span className="muted" style={{ fontSize: '.72rem' }}> · deshabilitado</span>}</td>
                    <td>{d.os}{d.osVersion ? <span className="muted" style={{ fontSize: '.74rem' }}> {d.osVersion}</span> : null}</td>
                    <td>{[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}</td>
                    <td>{d.owner || '—'}{d.ownerEmail ? <div className="muted" style={{ fontSize: '.72rem' }}>{d.ownerEmail}</div> : null}</td>
                    <td>
                      {fDate(d.lastActivity)}
                      {days !== null && <div className="muted" style={{ fontSize: '.72rem', color: stale ? 'var(--warn, #f5b13d)' : undefined }}>{days === 0 ? 'hoy' : `hace ${days} día${days !== 1 ? 's' : ''}`}</div>}
                    </td>
                    <td>{inInv
                      ? <span className="badge s-approved" style={{ fontSize: '.7rem' }}>Registrado</span>
                      : <span className="badge s-pending" style={{ fontSize: '.7rem' }} title="No se encontró un equipo del inventario con este nombre o serie">No registrado</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && !err && (
        <p className="muted" style={{ fontSize: '.74rem', margin: '.5rem 0 0' }}>
          "Registrado" indica que el nombre del equipo coincide con un equipo del inventario (por nombre, serie o etiqueta). La fecha de actividad es aproximada: Microsoft la actualiza con algunos días de desfase.
        </p>
      )}
    </div>
  )
}
