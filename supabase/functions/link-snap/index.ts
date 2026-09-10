import { createClient } from 'jsr:@supabase/supabase-js@2'

// Captura de pantalla de la página de un producto (link) y la guarda en el bucket privado
// "cotizaciones" (snap/<producto>.png). Si la página cambia después, queda el respaldo de lo cotizado.
const SB_URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authz = req.headers.get('Authorization') ?? ''
    if (!authz.startsWith('Bearer ')) return json(401, { error: 'No autenticado' })
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: authz } } })
    const { data: { user }, error } = await asUser.auth.getUser()
    if (error || !user) return json(401, { error: 'Sesion invalida' })

    const { product_id } = await req.json()
    if (!product_id) return json(400, { error: 'Falta product_id' })
    // El usuario debe poder ver el producto (RLS) — de ahí sale la URL, nunca del cliente
    const { data: prod } = await asUser.from('request_products').select('id, product_url').eq('id', product_id).single()
    if (!prod?.product_url) return json(200, { ok: false, reason: 'sin-link' })
    let url = String(prod.product_url).trim()
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    try { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw 0 } catch { return json(200, { ok: false, reason: 'url-invalida' }) }

    // Servicio de captura (renderiza la página y devuelve PNG)
    const shot = `https://image.thum.io/get/width/1200/crop/1000/noanimate/${url}`
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 40000)
    let bytes: Uint8Array
    try {
      const r = await fetch(shot, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (BillCapital-Interno)' } })
      if (!r.ok) return json(200, { ok: false, reason: 'captura-fallo', status: r.status })
      const ct = r.headers.get('content-type') || ''
      if (!ct.startsWith('image/')) return json(200, { ok: false, reason: 'no-imagen' })
      bytes = new Uint8Array(await r.arrayBuffer())
    } finally { clearTimeout(tm) }
    if (bytes.length < 2000) return json(200, { ok: false, reason: 'captura-vacia' })

    const admin = createClient(SB_URL, SERVICE)
    const path = `snap/${product_id}.png`
    const { error: upErr } = await admin.storage.from('cotizaciones').upload(path, bytes, { contentType: 'image/png', upsert: true })
    if (upErr) return json(200, { ok: false, reason: 'no-guardado', detail: upErr.message })
    await admin.from('request_products').update({ snapshot_path: path, snapshot_at: new Date().toISOString() }).eq('id', product_id)
    return json(200, { ok: true, path })
  } catch (e) {
    return json(500, { error: 'Error interno', detail: String(e) })
  }
})
