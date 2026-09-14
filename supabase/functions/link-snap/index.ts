import { createClient } from 'jsr:@supabase/supabase-js@2'

// Captura de pantalla de la página de un producto (link), guardada en el bucket privado "cotizaciones"
// (snap/<producto>.jpg). Responde AL INSTANTE y captura en segundo plano: la app consulta el producto
// hasta que aparece snapshot_path. Servicio: mShots (WordPress.com); thum.io de respaldo.
const SB_URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function fetchShot(shotUrl: string): Promise<{ bytes: Uint8Array; ct: string } | null> {
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 20000)
  try {
    const r = await fetch(shotUrl, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (BillCapital-Interno)' } })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (!ct.startsWith('image/')) return null
    return { bytes: new Uint8Array(await r.arrayBuffer()), ct }
  } catch { return null } finally { clearTimeout(tm) }
}

async function capture(productId: string, url: string) {
  // Página COMPLETA (no solo el primer pantallazo): viewport alto en mShots; thum.io /fullpage de respaldo
  const mshots = `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=1200&h=4000&vpw=1200&vph=4000`
  let bytes: Uint8Array | null = null
  for (let i = 0; i < 14 && !bytes; i++) {
    const r = await fetchShot(mshots)
    // el GIF de "generando…" es pequeño; la captura real llega como JPEG/PNG de mayor peso
    if (r && !r.ct.includes('gif') && r.bytes.length > 8000) bytes = r.bytes
    else await new Promise((res) => setTimeout(res, 5000))
  }
  if (!bytes) {
    const r = await fetchShot(`https://image.thum.io/get/fullpage/width/1200/noanimate/${url}`)
    if (r && r.bytes.length > 8000) bytes = r.bytes
  }
  if (!bytes) return
  const admin = createClient(SB_URL, SERVICE)
  const path = `snap/${productId}.jpg`
  const { error: upErr } = await admin.storage.from('cotizaciones').upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
  if (!upErr) await admin.from('request_products').update({ snapshot_path: path, snapshot_at: new Date().toISOString() }).eq('id', productId)
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
    if (!prod?.product_url) return json(200, { ok: false, reason: 'el producto no tiene link' })
    let url = String(prod.product_url).trim()
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    try { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol)) throw 0 } catch { return json(200, { ok: false, reason: 'el link no es una URL válida' }) }

    // Se responde de inmediato; la captura sigue en segundo plano
    try { (globalThis as any).EdgeRuntime?.waitUntil(capture(product_id, url).catch(() => {})) }
    catch { capture(product_id, url).catch(() => {}) }
    return json(200, { ok: true, queued: true })
  } catch (e) {
    return json(500, { error: 'Error interno', detail: String(e) })
  }
})
