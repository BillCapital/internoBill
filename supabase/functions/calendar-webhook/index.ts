import { createClient } from 'jsr:@supabase/supabase-js@2'

// PUBLICA: la llama Microsoft Graph. Valida clientState contra INTERNAL_KEY (obligatorio).
const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INTERNAL = Deno.env.get('INTERNAL_KEY') ?? ''
const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''

Deno.serve(async (req) => {
  const u = new URL(req.url)
  // 1) Handshake de validación de la suscripción
  const vt = u.searchParams.get('validationToken')
  if (vt) return new Response(vt, { status: 200, headers: { 'Content-Type': 'text/plain' } })

  try {
    const payload = await req.json()
    const items = payload?.value ?? []
    const admin = createClient(URL, SERVICE)
    for (const it of items) {
      // Autenticidad: el clientState DEBE venir y coincidir con la clave interna.
      // (Graph lo incluye en toda notificación porque lo fijamos al crear la suscripción.)
      if (!INTERNAL || it.clientState !== INTERNAL) { console.error('webhook: clientState ausente o inválido'); continue }
      const eventId = it?.resourceData?.id
      if (!eventId) continue
      const { data: r } = await admin.from('reservations')
        .select('id, calendar_event_id, profiles!reservations_user_id_fkey(email)')
        .eq('calendar_event_id', eventId).maybeSingle()
      if (!r) continue // no es un evento que gestione la app

      if (it.changeType === 'deleted') {
        await admin.rpc('reservation_cancel_from_calendar', { p_event: eventId })
        continue
      }
      // updated: traer el evento en UTC y reflejar cambios
      const email = (r as any).profiles?.email
      const token = await graphToken()
      if (!token || !email) continue
      const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId)}?$select=start,end,isCancelled`, {
        headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
      })
      if (resp.status === 404) { await admin.rpc('reservation_cancel_from_calendar', { p_event: eventId }); continue }
      const ev = await resp.json()
      if (ev?.isCancelled) { await admin.rpc('reservation_cancel_from_calendar', { p_event: eventId }); continue }
      if (ev?.start?.dateTime && ev?.end?.dateTime) {
        const s = new Date(ev.start.dateTime.slice(0, 19) + 'Z').toISOString()
        const e = new Date(ev.end.dateTime.slice(0, 19) + 'Z').toISOString()
        await admin.rpc('reservation_update_from_calendar', { p_event: eventId, p_starts: s, p_ends: e })
      }
    }
  } catch (e) { console.error('webhook: excepcion', String(e)) }
  // Responder rápido para que Graph no reintente
  return new Response(null, { status: 202 })
})

async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null
  const body = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await r.json()
  return j.access_token ?? null
}
