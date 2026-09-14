import { createClient } from 'jsr:@supabase/supabase-js@2'

// Procesa la COLA de correos (mail_outbox) y envía por Microsoft Graph como la cuenta interno@.
// Función PRIVADA: solo la invoca el cron con x-internal-key (secret MAILER_KEY).
// Salvaguardas: interruptor general, modo prueba con lista blanca, tope por tanda,
// tope por destinatario/hora, dedupe en la cola y máximo 3 intentos por correo.
const SB_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAILER_KEY = Deno.env.get('MAILER_KEY') ?? ''
const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''

function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
}
async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null
  const body = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await r.json()
  return j.access_token ?? null
}

Deno.serve(async (req) => {
  if (!MAILER_KEY || req.headers.get('x-internal-key') !== MAILER_KEY) return json(401, { error: 'forbidden' })
  const admin = createClient(SB_URL, SERVICE)
  const { data: cfg } = await admin.from('mail_config').select('*').eq('id', 1).single()
  if (!cfg?.enabled) return json(200, { ok: true, skipped: 'deshabilitado' })

  const { data: queue } = await admin.from('mail_outbox')
    .select('*').eq('status', 'queued').lt('attempts', 3)
    .order('created_at').limit(Math.min(cfg.max_per_run || 10, 25))
  if (!queue?.length) return json(200, { ok: true, sent: 0 })

  const token = await graphToken()
  if (!token) return json(200, { ok: false, error: 'sin token de Graph' })

  const allow = (cfg.allowlist || []).map((e: string) => e.toLowerCase())
  let sent = 0
  for (const m of queue) {
    // Modo prueba: fuera de la lista blanca no se envía (queda 'skipped', visible para revisar)
    if (cfg.test_mode && !allow.includes(m.to_email)) {
      await admin.from('mail_outbox').update({ status: 'skipped', last_error: 'modo prueba: destinatario fuera de la lista blanca' }).eq('id', m.id)
      continue
    }
    // Tope por destinatario por hora
    const { count } = await admin.from('mail_outbox').select('id', { count: 'exact', head: true })
      .eq('to_email', m.to_email).eq('status', 'sent').gte('sent_at', new Date(Date.now() - 3600000).toISOString())
    if ((count || 0) >= (cfg.max_per_recipient_hour || 3)) continue // se reintenta en la próxima tanda

    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.sender)}/sendMail`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: m.subject,
          body: { contentType: 'HTML', content: m.html },
          toRecipients: [{ emailAddress: { address: m.to_email } }],
        },
        saveToSentItems: false,
      }),
    })
    if (r.ok || r.status === 202) {
      await admin.from('mail_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), attempts: m.attempts + 1 }).eq('id', m.id)
      sent++
    } else {
      const err = await r.text().catch(() => String(r.status))
      await admin.from('mail_outbox').update({ status: m.attempts + 1 >= 3 ? 'failed' : 'queued', attempts: m.attempts + 1, last_error: `HTTP ${r.status}: ${err.slice(0, 400)}` }).eq('id', m.id)
    }
  }
  return json(200, { ok: true, sent })
})
