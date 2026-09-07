import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// --- Protección SSRF: solo hosts públicos ---
function ipv4Private(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true
  const [a, b] = p
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
}
function ipv6Private(ip: string): boolean {
  const s = ip.toLowerCase()
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('::ffff:')
}
async function hostAllowed(u: URL): Promise<boolean> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.port && u.port !== '80' && u.port !== '443') return false
  const h = u.hostname.replace(/^\[|\]$/g, '')
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost') || !h.includes('.')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return !ipv4Private(h)
  if (h.includes(':')) return !ipv6Private(h)
  try {
    const a = await Deno.resolveDns(h, 'A').catch(() => [] as string[])
    const aaaa = await Deno.resolveDns(h, 'AAAA').catch(() => [] as string[])
    const all = [...a, ...aaaa]
    if (!all.length) return false
    return all.every((ip) => (ip.includes(':') ? !ipv6Private(ip) : !ipv4Private(ip)))
  } catch { return false }
}
// fetch con redirecciones manuales: valida cada salto contra hosts privados
async function safeFetch(url: string, signal: AbortSignal): Promise<Response | null> {
  let cur = url
  for (let hop = 0; hop < 4; hop++) {
    let u: URL
    try { u = new URL(cur) } catch { return null }
    if (!(await hostAllowed(u))) return null
    const r = await fetch(u.href, {
      redirect: 'manual', signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-CL,es;q=0.9',
      },
    })
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location')
      if (!loc) return r
      try { cur = new URL(loc, u).href } catch { return null }
      continue
    }
    return r
  }
  return null
}

const pick = (html: string, res: RegExp[]): string => {
  for (const re of res) { const m = html.match(re); if (m && m[1]) return decode(m[1].trim()) }
  return ''
}
function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
}
const metaRe = (key: string): RegExp[] => [
  new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
  new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
]

function normPrice(s: string): number | null {
  if (!s) return null
  let t = s.replace(/[^0-9.,]/g, '')
  if (!t) return null
  const hasDot = t.includes('.'), hasComma = t.includes(',')
  if (hasDot && hasComma) { t = t.replace(/\./g, '').replace(',', '.') }
  else if (hasComma) { const last = t.split(',').pop() as string; t = last.length === 3 ? t.replace(/,/g, '') : t.replace(',', '.') }
  else if (hasDot) { const p = t.split('.'); const last = p[p.length - 1]; t = (p.length > 2 || last.length === 3) ? t.replace(/\./g, '') : t }
  const n = parseFloat(t)
  return isNaN(n) ? null : Math.round(n)
}

function parsePrice(html: string): { price: number | null, currency: string } {
  const metaP = pick(html, [...metaRe('product:price:amount'), ...metaRe('og:price:amount'), ...metaRe('twitter:data1')])
  const metaC = pick(html, [...metaRe('product:price:currency'), ...metaRe('og:price:currency')])
  let price = normPrice(metaP)
  if (price == null) {
    const ld = html.match(/"price"\s*:\s*"?([0-9.,]+)"?/i)
    if (ld) price = normPrice(ld[1])
  }
  let currency = metaC || ''
  if (!currency) { const c = html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/i); if (c) currency = c[1] }
  return { price, currency: currency || 'CLP' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { url } = await req.json().catch(() => ({}))
    if (!url || !/^https?:\/\//i.test(url)) return json(400, { ok: false, error: 'URL inválida' })
    let host = ''
    try { host = new URL(url).hostname.replace(/^www\./, '') } catch { return json(400, { ok: false, error: 'URL inválida' }) }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    let html = ''
    try {
      const r = await safeFetch(url, ctrl.signal)
      if (!r) return json(200, { ok: false, site: host, error: 'No se pudo leer la página (dirección no permitida). Completa los datos a mano.' })
      const buf = await r.arrayBuffer()
      html = new TextDecoder('utf-8').decode(buf).slice(0, 600000)
    } catch (_) {
      return json(200, { ok: false, site: host, error: 'No se pudo leer la página (puede bloquear la lectura). Completa los datos a mano.' })
    } finally { clearTimeout(timer) }

    const title = pick(html, [...metaRe('og:title'), ...metaRe('twitter:title'), [/<title[^>]*>([^<]+)<\/title>/i][0]])
    let image = pick(html, [...metaRe('og:image:secure_url'), ...metaRe('og:image'), ...metaRe('twitter:image')])
    if (image && image.startsWith('//')) image = 'https:' + image
    if (image && image.startsWith('/')) { try { image = new URL(image, url).href } catch { /* noop */ } }
    const { price, currency } = parsePrice(html)

    return json(200, { ok: true, site: host, title: title || '', image: image || '', price, currency })
  } catch (_e) {
    return json(500, { ok: false, error: 'Error al procesar la página' })
  }
})
