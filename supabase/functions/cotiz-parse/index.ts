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

const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 }
// "10/09/2026", "10-09-26", "10 de septiembre de 2026" → ISO yyyy-mm-dd
function parseDate(raw: string): string | null {
  if (!raw) return null
  let m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(raw)
  if (m) {
    const d = +m[1], mo = +m[2], y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2020 && y <= 2100) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  m = /(\d{1,2})\s+de\s+([a-záé]+)\s+(?:de\s+)?(\d{4})/i.exec(raw)
  if (m && MESES[m[2].toLowerCase()]) return `${m[3]}-${String(MESES[m[2].toLowerCase()]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`
  return null
}
function clean(v: string | undefined): string | null {
  if (!v) return null
  const t = v.replace(/\s+/g, ' ').replace(/[|•·]+/g, ' ').trim().replace(/[.,;:]+$/, '')
  return t.length >= 2 ? t.slice(0, 80) : null
}
// Datos útiles para quien aprueba: fecha, validez, entrega, pago, garantía, proveedor
function quoteInfo(text: string) {
  const grab = (re: RegExp) => { const m = re.exec(text); return m ? clean(m[1]) : null }
  const dateLine = grab(/fecha(?:\s+de\s+(?:emisi[oó]n|cotizaci[oó]n))?\s*[:.]?\s*([^\n]{4,40})/i)
  let quoteDate = parseDate(dateLine || '')
  if (!quoteDate) { const any = /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}|\d{1,2}\s+de\s+[a-záé]+\s+(?:de\s+)?\d{4})/i.exec(text); quoteDate = parseDate(any ? any[1] : '') }
  let validDays: number | null = null, validUntil: string | null = null
  const v = /(?:validez|vigencia|v[aá]lid[ao]s?\s+(?:hasta|por|durante))(?:\s+de\s+la\s+(?:oferta|cotizaci[oó]n))?\s*[:.]?\s*([^\n]{2,50})/i.exec(text)
  if (v) {
    const dm = /(\d{1,3})\s*d[ií]as?/i.exec(v[1]); if (dm) validDays = +dm[1]
    const du = parseDate(v[1]); if (du) validUntil = du
  }
  if (!validUntil && validDays && quoteDate) { const d = new Date(quoteDate + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + validDays); validUntil = d.toISOString().slice(0, 10) }
  const delivery = grab(/(?:plazo\s+de\s+entrega|tiempo\s+de\s+entrega|entrega\s+estimada|fecha\s+de\s+entrega|despacho|disponibilidad|entrega)\s*[:.]?\s*([^\n]{3,60})/i)
  const payment = grab(/(?:condici[oó]n(?:es)?\s+de\s+pago|forma\s+de\s+pago|t[eé]rminos\s+de\s+pago|pago)\s*[:.]?\s*([^\n]{3,50})/i)
  const warranty = grab(/garant[ií]a\s*[:.]?\s*([^\n]{3,50})/i)
  const provider = grab(/(?:proveedor|raz[oó]n\s+social|empresa|vendedor)\s*[:.]?\s*([^\n]{3,60})/i)
  const quoteNo = grab(/(?:cotizaci[oó]n|presupuesto|oferta)\s*(?:n[°ºo.]*|#|nro\.?|no\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-\/]{1,20})/i)
  return { quote_date: quoteDate, valid_days: validDays, valid_until: validUntil, delivery, payment, warranty, provider, quote_no: quoteNo }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authz = req.headers.get('Authorization') ?? ''
    if (!authz.startsWith('Bearer ')) return json(401, { error: 'No autenticado' })
    const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authz } } })
    const { data: { user }, error } = await asUser.auth.getUser()
    if (error || !user) return json(401, { error: 'Sesion invalida' })

    const { path, mime, bucket } = await req.json()
    const bkt = bucket === 'facturas' ? 'facturas' : 'cotizaciones'
    if (!path || typeof path !== 'string') return json(400, { error: 'Falta path' })
    if (mime && !String(mime).includes('pdf')) return json(200, { ok: false, reason: 'no-pdf' })

    const admin = createClient(URL, SERVICE)
    const { data: file, error: dlErr } = await admin.storage.from(bkt).download(path)
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
    if (!amounts.length) {
      const cm0 = /(?:c[oó]d(?:igo)?\.?|sku|p\/n|part\s*(?:no|number)|ref(?:erencia)?\.?)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-_.\/]{3,30})/i.exec(text)
      return json(200, { ok: false, reason: 'sin-monto', code: cm0 ? cm0[1].replace(/[.:,]+$/, '') : null, info: quoteInfo(text) })
    }

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

    // Código / SKU del producto: "Código: ABC-123", "SKU 82XM00M4CL", "P/N: ...", "Ref.: ..."
    let code: string | null = null
    const codeRe = /(?:c[oó]d(?:igo)?\.?|sku|p\/n|part\s*(?:no|number)|n[uú]mero\s+de\s+parte|ref(?:erencia)?\.?|modelo)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-_.\/]{3,30})/i
    const cm = codeRe.exec(text)
    if (cm && !/^\d{1,3}$/.test(cm[1])) code = cm[1].replace(/[.:,]+$/, '')

    const info = quoteInfo(text)
    return json(200, { ok: true, price: best, currency: 'CLP', code, info, provider: info.provider, date: info.quote_date })
  } catch (e) {
    return json(500, { error: 'Error interno', detail: String(e) })
  }
})
