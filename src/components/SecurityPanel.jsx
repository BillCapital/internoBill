import { useEffect, useMemo, useState } from 'react'
import { msUsers } from '../lib/m365'
import { Icon } from '../lib/icons'
import { SkeletonRows } from './Skeleton'

// Panel de seguridad TI: MFA, actividad y licencias de cada cuenta, leído desde Microsoft.
// Solo lectura. Los datos de MFA vienen del informe de registro de métodos de autenticación.
const MFA_NAMES = {
  microsoftAuthenticatorPush: 'App Authenticator', softwareOneTimePasscode: 'Código de app',
  mobilePhone: 'Teléfono', email: 'Correo alternativo', windowsHelloForBusiness: 'Windows Hello',
  fido2SecurityKey: 'Llave de seguridad', temporaryAccessPass: 'Pase temporal', securityQuestion: 'Preguntas',
}
export default function SecurityPanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('') // '' | 'nomfa' | 'inactive' | 'disabledlic'
  const [tab, setTab] = useState('cuentas') // 'cuentas' | 'auditoria'
  const [act, setAct] = useState(null) // actividad por servicio, por upn
  const [audit, setAudit] = useState(null)
  const [auditCat, setAuditCat] = useState('')

  const load = async () => {
    setBusy(true); setErr('')
    try { setData(await msUsers('securityReport')) }
    catch (e) { setErr(e.message || 'Error al consultar Microsoft') }
    finally { setBusy(false) }
    // La actividad por servicio llega aparte para no frenar la tabla principal
    try {
      const r = await msUsers('serviceActivity')
      const m = {}
      ;(r.rows || []).forEach((x) => { m[x.upn] = x })
      setAct(m)
    } catch { /* opcional */ }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadAudit = async (cat) => {
    setAudit(null)
    try { const r = await msUsers('dirAudit', cat ? { category: cat } : {}); setAudit(r.rows || []) }
    catch (e) { setErr(e.message || 'Error al leer la auditoría'); setAudit([]) }
  }
  useEffect(() => { if (tab === 'auditoria' && audit === null) loadAudit(auditCat) }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)
  // Última actividad REAL en M365 (Exchange/OneDrive/SharePoint/Teams): compensa que los
  // inicios de sesión detallados requieran Entra P1.
  const lastAct = (upn) => {
    const a = act?.[upn]
    if (!a) return null
    const ds = [a.exchange, a.oneDrive, a.sharePoint, a.teams].filter(Boolean).sort()
    return ds.length ? ds[ds.length - 1] : null
  }
  const fDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')

  // Solo cuentas internas del dominio (los invitados externos no son responsabilidad de TI)
  const rows = useMemo(() => (data?.rows || []).filter((r) => !r.guest), [data])

  const flags = useMemo(() => {
    const noMfa = rows.filter((r) => r.enabled && r.licensed && r.mfaRegistered === false)
    const inactive = rows.filter((r) => { const d = daysAgo(r.lastSignIn ?? lastAct(r.upn)); return r.enabled && d !== null && d > 60 })
    const disabledLic = rows.filter((r) => !r.enabled && r.licensed)
    return { noMfa, inactive, disabledLic }
  }, [rows])

  const list = useMemo(() => {
    let base = rows
    if (filter === 'nomfa') base = flags.noMfa
    else if (filter === 'inactive') base = flags.inactive
    else if (filter === 'disabledlic') base = flags.disabledLic
    // Primero lo que requiere acción: sin MFA, luego inactivas, luego el resto por nombre
    const rank = (r) => (r.enabled && r.licensed && r.mfaRegistered === false ? 0 : (daysAgo(r.lastSignIn) ?? 0) > 60 ? 1 : 2)
    return [...base].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'es'))
  }, [rows, flags, filter])

  const Chip = ({ k, n, txt, tone }) => (
    <button className={`badge ${tone}`} style={{ cursor: 'pointer', border: filter === k ? '2px solid currentColor' : undefined }}
      title={filter === k ? 'Quitar filtro' : 'Ver solo estas cuentas'}
      onClick={() => setFilter(filter === k ? '' : k)}>{n} {txt}</button>
  )

  return (
    <div className="gz-card" style={{ marginBottom: '1rem' }}>
      <div className="row" style={{ alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.55rem' }}>
        <h3 style={{ margin: 0 }}>Seguridad de cuentas</h3>
        <span className="muted" style={{ fontSize: '.78rem', flex: '1 1 auto' }}>Leído desde Microsoft. Cuentas internas del dominio.</span>
        <button className={`btn-sm ${tab === 'cuentas' ? 'btn btn-sm' : ''}`} onClick={() => setTab('cuentas')}>Cuentas</button>
        <button className={`btn-sm ${tab === 'auditoria' ? 'btn btn-sm' : ''}`} onClick={() => setTab('auditoria')} title="Registro de auditoría de Entra: quién hizo qué y cuándo (últimos ~7 días)">Auditoría Microsoft</button>
        <button className="btn btn-sm" onClick={() => (tab === 'cuentas' ? load() : loadAudit(auditCat))} disabled={busy}><Icon n="refresh" /> Actualizar</button>
      </div>

      {tab === 'auditoria' && (
        <>
          <div className="row" style={{ gap: '.45rem', flexWrap: 'wrap', marginBottom: '.5rem', alignItems: 'center' }}>
            <label className="sort-ctl">Categoría:
              <select value={auditCat} onChange={(e) => { setAuditCat(e.target.value); loadAudit(e.target.value) }}>
                <option value="">Todas</option>
                <option value="Device">Equipos</option>
                <option value="UserManagement">Usuarios</option>
                <option value="GroupManagement">Grupos</option>
                <option value="ApplicationManagement">Aplicaciones</option>
                <option value="RoleManagement">Roles</option>
              </select>
            </label>
            <span className="muted" style={{ fontSize: '.74rem' }}>Microsoft conserva estos eventos ~7 días en el plan actual.</span>
          </div>
          {audit === null ? <SkeletonRows n={3} /> : audit.length === 0 ? <p className="muted" style={{ fontSize: '.8rem' }}>Sin eventos en esta categoría.</p> : (
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="tbl-compact">
                <thead><tr><th>Fecha</th><th>Actividad</th><th>Categoría</th><th>Por</th><th>Objetivo</th><th>Resultado</th></tr></thead>
                <tbody>
                  {audit.map((a, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: '.76rem' }}>{a.at ? new Date(a.at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td style={{ fontSize: '.8rem' }}>{a.activity}</td>
                      <td className="muted" style={{ fontSize: '.76rem' }}>{a.category}</td>
                      <td style={{ fontSize: '.78rem' }}>{a.by || '—'}</td>
                      <td style={{ fontSize: '.78rem' }}>{a.target || '—'}</td>
                      <td>{a.ok ? <span className="badge s-approved" style={{ fontSize: '.68rem' }}>OK</span> : <span className="badge s-rejected" style={{ fontSize: '.68rem' }}>Falló</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab !== 'auditoria' && <>

      {busy && !data && <SkeletonRows n={3} />}
      {err && <div className="ro-note"><Icon n="alert" /> {err}</div>}

      {data && !err && (
        <>
          <div className="row" style={{ gap: '.45rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
            <Chip k="nomfa" n={flags.noMfa.length} txt="sin MFA" tone={flags.noMfa.length ? 's-rejected' : 's-approved'} />
            <Chip k="inactive" n={flags.inactive.length} txt="sin actividad +60 días" tone={flags.inactive.length ? 's-prog' : 's-approved'} />
            <Chip k="disabledlic" n={flags.disabledLic.length} txt="deshabilitadas con licencia" tone={flags.disabledLic.length ? 's-prog' : 's-approved'} />
            {filter && <button className="btn btn-sm" onClick={() => setFilter('')}>Ver todas</button>}
          </div>
          {!data.mfaAvailable && <p className="muted" style={{ fontSize: '.76rem' }}>Microsoft no entregó el informe de MFA para este plan: la columna MFA puede aparecer vacía.</p>}
          {!data.signInAvailable && !act && <p className="muted" style={{ fontSize: '.76rem' }}>Cargando la actividad real por servicio…</p>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Persona</th><th>Cuenta</th><th>Estado</th><th>Licencia</th><th>MFA</th><th>Última actividad</th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: '.7rem' }}>Sin cuentas en esta vista.</td></tr>}
                {list.map((r) => {
                  const when = r.lastSignIn ?? lastAct(r.upn)
                  const d = daysAgo(when)
                  const methods = (r.mfaMethods || []).map((m) => MFA_NAMES[m] || m).join(', ')
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong></td>
                      <td className="muted" style={{ fontSize: '.82rem' }}>{r.upn}</td>
                      <td>{r.enabled ? <span className="badge s-approved">Activa</span> : <span className="badge s-closed">Deshabilitada</span>}</td>
                      <td>{r.licensed ? 'Sí' : <span className="muted">No</span>}</td>
                      <td>{r.mfaRegistered === true
                        ? <span className="badge s-approved" title={methods || 'Método registrado'}>Configurado</span>
                        : r.mfaRegistered === false
                          ? (r.enabled && r.licensed ? <span className="badge s-rejected">Sin MFA</span> : <span className="muted">Sin MFA</span>)
                          : <span className="muted">—</span>}</td>
                      <td>{fDate(when)}{d !== null && <span className="muted" style={{ fontSize: '.74rem', color: d > 60 && r.enabled ? 'var(--warn, #f5b13d)' : undefined }}> · {d === 0 ? 'hoy' : `hace ${d} día${d !== 1 ? 's' : ''}`}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '.74rem', margin: '.5rem 0 0' }}>
            "Sin MFA" marca cuentas activas y con licencia que no han registrado un segundo factor: son las prioritarias. Las deshabilitadas con licencia siguen pagando licencia sin usarse. La última actividad viene del uso real de Exchange, OneDrive, SharePoint y Teams (informe de 30 días de Microsoft).
          </p>
        </>
      )}
      </>}
    </div>
  )
}
