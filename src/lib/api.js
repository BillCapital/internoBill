import { supabase, SUPABASE_URL } from './supabase'
import { chooseDialog } from './ui'

// ---- Vista General (admin / gerente TI): al crear algo se pregunta en qué país aplicarlo ----
let generalView = false
export function _setGeneralView(v) { generalView = !!v }
export const COUNTRY_OPTIONS = [
  { value: 'Chile', label: 'Chile' }, { value: 'Colombia', label: 'Colombia' }, { value: 'Perú', label: 'Perú' }, { value: 'España', label: 'España' },
  { value: '*', label: 'Todos los países', hint: 'visible en todos los ambientes' },
]
// Pregunta el país (solo en vista General) y lo deja fijado para lo que se cree a continuación.
// Devuelve el país elegido, o null si se canceló.
export async function askCountryForCreate(what = 'esto') {
  if (!generalView) return 'same'
  const c = await chooseDialog(`Estás en la vista General. ¿En qué país quieres aplicar ${what}?`, { title: 'País de destino', options: COUNTRY_OPTIONS, okText: 'Continuar' })
  if (!c) return null
  const { error } = await supabase.rpc('set_target_country', { p_country: c })
  if (error) throw new Error(error.message)
  return c
}
const isNew = (p) => !(p?.p_id || p?.id || p?.p?.id)
// acción → (payload) => texto de lo que se crea, o null si no aplica (edición)
const CREATE_ACTIONS = {
  create_request: () => 'la solicitud', create_tech_request: () => 'la solicitud', create_ticket: () => 'el ticket',
  announcement_create: () => 'el anuncio', expense_doc_add: () => 'el documento', equipment_add_blank_computers: () => 'los equipos',
  room_upsert: (p) => (isNew(p) ? 'la sala' : null), inventory_upsert: (p) => (isNew(p) ? 'el insumo' : null),
  equipment_upsert: (p) => (isNew(p) ? 'el equipo' : null), peripheral_upsert: (p) => (isNew(p) ? 'el periférico' : null),
  dept_upsert: (p) => (isNew(p) ? 'el departamento' : null),
}

// Todas las ACCIONES pasan por el portero (gateway). Lectura va por supabase.from() (RLS).
export async function api(action, payload = {}) {
  const what = CREATE_ACTIONS[action]?.(payload)
  if (what) { const c = await askCountryForCreate(what); if (c === null) { const e = new Error('Acción cancelada.'); e.cancelled = true; throw e } }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/gateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, payload }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.error) throw new Error(j.error || 'Error en la solicitud')
  return j.data
}
