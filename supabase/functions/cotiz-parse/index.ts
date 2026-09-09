import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'npm:unpdf@0.11.0'

// Lee una cotización (PDF) desde el bucket privado y sugiere el precio (mayor monto en CLP encontrado).
const URL = Deno.env.get('SUPABASE_URL')!
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

// Convierte "1.596.990" o "1,596,990" o "1596990" a número entero de pesos
function toClp(raw: string): number | null {
  const t = raw.replace(/[^\d.,]/g, '')
  if (!t) return null
  // quita separadores de miles (puntos o comas seguidos de 3 dígitos) y decimales
  const digits = t.replace(/[.,]/g, '')
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authz = req.headers.get('Authorization') ?? ''
    if (!authz.startsWith('Bearer ')) return json(401, { error: 'No autenticado' })
    const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authz } } })
    const { data: { user }, error } = await asUser.auth.getUser()
    if (error || !user) return json(401, { error: 'Sesion invalida' })

    const { path, mime } = await req.json()
    if (!path || typeof path !== 'string') return json(400, { error: 'Falta path' })
    if (mime && !String(mime).includes('pdf')) return json(200, { ok: false, reason: 'no-pdf' })

    const admin = createClient(URL, SERVICE)
    const { data: file, error: dlErr } = await admin.storage.from('cotizaciones').download(path)
    if (dlErr || !file) return json(200, { ok: false, reason: 'no-file' })
    const buf = new Uint8Array(await file.arrayBuffer())

    let text = ''
    try {
      const pdf = await getDocumentProxy(buf)
      const r = await extractText(pdf, { mergePages: true })
      text = Array.isArray(r.text) ? r.text.join('\n') : (r.text || '')
    } catch { return json(200, { ok: false, reason: 'parse-error' }) }
    if (!text.trim()) return json(200, { ok: false, reason: 'sin-texto' })

    const lc = text.toLowerCase()
    // Todos los montos con separador de miles ($1.596.990 / 1,596,990) — descarta números sueltos cortos
    const amounts: { val: number; idx: number }[] = []
    const re = /\$?\s*(\d{1,3}(?:[.,]\d{3})+)(?:[.,]\d{1,2})?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const v = toClp(m[1])
      if (v && v >= 1000 && v <= 100000000) amounts.push({ val: v, idx: m.index })
    }
    if (!amounts.length) return json(200, { ok: false, reason: 'sin-monto' })

    // Preferir el monto que aparece junto a la palabra "total" (gran total de la cotización)
    let best: number | null = null
    const totalPos: number[] = []
    let ti = lc.indexOf('total')
    while (ti !== -1) { totalPos.push(ti); ti = lc.indexOf('total', ti + 5) }
    if (totalPos.length) {
      // el monto más cercano (después) a alguna aparición de "total", tomando el mayor
      const near = amounts.filter((a) => totalPos.some((p) => a.idx >= p && a.idx - p < 40))
      if (near.length) best = Math.max(...near.map((a) => a.val))
    }
    if (best == null) best = Math.max(...amounts.map((a) => a.val)) // fallback: el mayor monto

    return json(200, { ok: true, price: best, currency: 'CLP' })
  } catch (e) {
    return json(500, { error: 'Error interno', detail: String(e) })
  }
})
