import { supabase, SUPABASE_URL } from './supabase'

// Todas las ACCIONES pasan por el portero (gateway). Lectura va por supabase.from() (RLS).
export async function api(action, payload = {}) {
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
