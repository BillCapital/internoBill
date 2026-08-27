import { supabase, SUPABASE_URL } from './supabase'

// Llama a la función link-preview y devuelve { ok, title, image, price, currency, site, error }
export async function fetchLinkPreview(url) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'No autenticado' }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/link-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ url }),
    })
    return await res.json()
  } catch {
    return { ok: false, error: 'No se pudo conectar. Revisa el link e inténtalo de nuevo.' }
  }
}

// Formatea un precio en pesos (CLP) u otra moneda de forma legible
export function fmtMoney(price, currency = 'CLP') {
  if (price == null || price === '' || isNaN(Number(price))) return ''
  const n = Number(price)
  try {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: currency || 'CLP', maximumFractionDigits: 0 }).format(n)
  } catch {
    return '$' + n.toLocaleString('es-CL')
  }
}
