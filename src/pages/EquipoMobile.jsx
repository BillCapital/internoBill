import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../lib/icons'

const fmtD = (d) => new Date(d + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
const fmtShort = (iso) => new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
const SW_APPS = [
  { key: 'm365', label: 'Microsoft 365', accounts: true },
  { key: 'outlook', label: 'Outlook', accounts: true },
  { key: 'teams', label: 'Teams', accounts: true },
  { key: 'onedrive', label: 'OneDrive', accounts: true },
  { key: 'adobe', label: 'Adobe PDF', accounts: false },
]

// Vista compacta para móvil (solo lectura). A esta ruta apunta el QR del equipo.
export default function EquipoMobile() {
  const { id } = useParams()
  const { user, loading: authLoading, hasInventory } = useAuth()
  // Inicia sesión y vuelve a ESTA ficha móvil (no a la raíz)
  const signInHere = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'email openid profile offline_access', redirectTo: window.location.href, skipBrowserRedirect: true },
    })
    if (!error && data?.url) window.location.href = data.url
  }
  const [eq, setEq] = useState(null)
  const [section, setSection] = useState(null)
  const [sched, setSched] = useState([])
  const [lastMaint, setLastMaint] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: e } = await supabase.from('equipment').select('*').eq('id', id).single()
    setEq(e || null)
    if (e?.section_id) {
      const { data: s } = await supabase.from('equipment_sections').select('name,icon,fields,assign_to').eq('id', e.section_id).single()
      setSection(s || null)
    }
    const { data: sc } = await supabase.from('equipment_maintenance').select('scheduled_for').eq('equipment_id', id).eq('status', 'programado').order('scheduled_for', { ascending: true }).limit(1)
    setSched(sc ?? [])
    const { data: ev } = await supabase.from('equipment_events').select('at').eq('equipment_id', id).eq('event_type', 'Mantenimiento').order('at', { ascending: false }).limit(1)
    setLastMaint(ev?.[0]?.at || null)
    setLoading(false)
  }, [id])

  useEffect(() => { if (user && hasInventory) load() }, [load, user, hasInventory])

  if (authLoading) return <div className="m-view"><p className="muted">Cargando…</p></div>
  if (!user) return (
    <div className="m-view m-center">
      <div className="m-brand"><span className="brand-mark">B</span> Billcapital</div>
      <p className="muted">Inicia sesión para ver la ficha de este equipo.</p>
      <button className="btn btn-primary" onClick={signInHere}>Iniciar sesión con Microsoft</button>
    </div>
  )
  if (!hasInventory) return <div className="m-view m-center"><p className="muted">Tu cuenta no tiene acceso al inventario.</p></div>
  if (loading) return <div className="m-view"><p className="muted">Cargando ficha…</p></div>
  if (!eq) return <div className="m-view m-center"><p className="muted">Equipo no encontrado.</p></div>

  const rows = [
    ['Tipo / Nombre', eq.name], ['Marca', eq.brand], ['Modelo', eq.model], ['N° de serie', eq.serial_number],
    ['Ubicación', eq.location], ['Estado', eq.condition],
    ...(section?.assign_to === 'department' ? [['Departamento', eq.assigned_to_name]] : [['Asignado a', eq.assigned_to_name], ['Correo', eq.assigned_to_email]]),
    ...((section?.fields || []).map((f) => [f.label, eq.attributes?.[f.key] || ''])),
  ]
  const nextMaint = sched[0]?.scheduled_for || null
  const swApps = eq.attributes?.sw_apps || {}

  return (
    <div className="m-view">
      <div className="m-brand"><span className="brand-mark">B</span> Billcapital · Inventario</div>

      <div className="m-head">
        <div className="m-title">{section?.icon} {eq.name}</div>
        <div className="m-sub">{[eq.brand, eq.model].filter(Boolean).join(' ')}{section?.name ? ` · ${section.name}` : ''}</div>
      </div>

      {eq.image_url && <img className="m-photo" src={eq.image_url} alt="" />}

      <div className="m-cards">
        <div className="m-card"><div className="m-k"><Icon n="calendar" /> Próximo mantenimiento</div><div className="m-v">{nextMaint ? fmtD(nextMaint) : '—'}</div></div>
        <div className="m-card"><div className="m-k"><Icon n="wrench" /> Último mantenimiento</div><div className="m-v">{lastMaint ? fmtShort(lastMaint) : '—'}</div></div>
      </div>

      <div className="m-sec">Datos del equipo</div>
      <div className="m-list">
        {rows.map(([k, v]) => (
          <div className="m-row" key={k}><span className="m-rk">{k}</span><span className="m-rv">{v || '—'}</span></div>
        ))}
      </div>

      <div className="m-sec">Software y cuentas</div>
      <div className="m-list">
        <div className="m-row"><span className="m-rk">Antivirus</span><span className="m-rv">{eq.antivirus || '—'}</span></div>
        {SW_APPS.map((a) => {
          const st = swApps[a.key] || {}
          return (
            <div className="m-row" key={a.key}>
              <span className="m-rk">{a.label}</span>
              <span className="m-rv">
                {st.on ? <><Icon n="check" /> Habilitado</> : '—'}
                {a.accounts && (st.accounts || []).length ? <span className="m-chips">{(st.accounts || []).map((x) => <span key={x}>{x}</span>)}</span> : null}
              </span>
            </div>
          )
        })}
      </div>

      <div className="m-foot">Ficha de solo lectura · escanea el QR del equipo para volver a abrirla.</div>
    </div>
  )
}
