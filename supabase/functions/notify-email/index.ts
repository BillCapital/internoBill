// Envía una notificación de la app al Outlook del usuario vía Microsoft Graph (sendMail).
// Privada: se invoca con x-internal-key (NOTIFY_KEY). La dispara un trigger en la tabla notifications.
const NOTIFY_KEY = Deno.env.get('NOTIFY_KEY') ?? Deno.env.get('INTERNAL_KEY') ?? ''
const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''
const FROM = Deno.env.get('MS_NOTIFY_FROM') ?? 'ambienteinterno@billcapital.com'
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')

function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
}
function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null
  const body = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await r.json()
  if (!j.access_token) console.error('notify-email: token error', JSON.stringify(j))
  return j.access_token ?? null
}

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-key') !== NOTIFY_KEY || !NOTIFY_KEY) return json(401, { error: 'forbidden' })
  try {
    const { email, title, body, link } = await req.json().catch(() => ({}))
    if (!email || String(email).indexOf('@') < 0) return json(400, { error: 'sin correo destino' })
    if (!TENANT || !CID || !CSECRET) return json(500, { error: 'Faltan credenciales MS_*' })
    const token = await graphToken()
    if (!token) return json(500, { error: 'no se pudo obtener token de Graph' })

    const subject = title && String(title).trim() ? String(title) : 'Notificación'
    let html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1c2342">`
    html += `<p style="font-size:16px;font-weight:600;margin:0 0 .4rem">${esc(subject)}</p>`
    if (body) html += `<p style="margin:.2rem 0 .8rem;white-space:pre-line">${esc(String(body))}</p>`
    if (link) {
      const href = String(link).startsWith('http') ? String(link) : (APP_URL ? APP_URL + String(link) : '')
      if (href) html += `<p style="margin:.6rem 0"><a href="${esc(href)}" style="background:#b7ef4e;color:#12210a;padding:.5rem .9rem;border-radius:8px;text-decoration:none;font-weight:600">Abrir en la app</a></p>`
    }
    html += `<p style="color:#8a90a2;font-size:12px;margin-top:1rem">Este correo se generó automáticamente desde el sistema interno de BillCapital.</p></div>`

    const message = {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: email } }],
    }
    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(FROM)}/sendMail`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true }),
    })
    if (resp.status === 202) return json(200, { ok: true })
    const out = await resp.json().catch(() => ({}))
    console.error('notify-email: Graph error', resp.status, JSON.stringify(out?.error ?? out))
    return json(resp.status, { ok: false, error: out?.error ?? out })
  } catch (e) {
    console.error('notify-email: excepcion', String(e))
    return json(500, { error: String(e) })
  }
})
