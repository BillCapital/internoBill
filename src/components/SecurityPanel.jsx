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

  const load = async () => {
    setBusy(true); setErr('')
    try { setData(await msUsers('securityReport')) }
    catch (e) { setErr(e.message || 'Error al consultar Microsoft') }
    finally { setBusy(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)
  const fDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')

  // Solo cuentas internas del dominio (los invitados externos no son responsabilidad de TI)
  const rows = useMemo(() => (data?.rows || []).filter((r) => !r.guest), [data])

  const flags = useMemo(() => {
    const noMfa = rows.filter((r) => r.enabled && r.licensed && r.mfaRegistered === false)
    const inactive = rows.filter((r) => { const d = daysAgo(r.lastSignIn); return r.enabled && d !== null && d > 60 })
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
        <button className="btn btn-sm" onClick={load} disabled={busy}><Icon n="refresh" /> Actualizar</button>
      </div>

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
          {!data.signInAvailable && <p className="muted" style={{ fontSize: '.76rem' }}>El detalle de últimos inicios de sesión requiere una licencia Entra ID P1 en el tenant: esa columna puede aparecer vacía.</p>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Persona</th><th>Cuenta</th><th>Estado</th><th>Licencia</th><th>MFA</th><th>Último inicio de sesión</th></tr></thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: '.7rem' }}>Sin cuentas en esta vista.</td></tr>}
                {list.map((r) => {
                  const d = daysAgo(r.lastSignIn)
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
                      <td>{fDate(r.lastSignIn)}{d !== null && <span className="muted" style={{ fontSize: '.74rem', color: d > 60 && r.enabled ? 'var(--warn, #f5b13d)' : undefined }}> · {d === 0 ? 'hoy' : `hace ${d} día${d !== 1 ? 's' : ''}`}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '.74rem', margin: '.5rem 0 0' }}>
            "Sin MFA" marca cuentas activas y con licencia que no han registrado un segundo factor: son las prioritarias. Las deshabilitadas con licencia siguen pagando licencia sin usarse.
          </p>
        </>
      )}
    </div>
  )
}
