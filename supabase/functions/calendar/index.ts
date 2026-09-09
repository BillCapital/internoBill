import { createClient } from 'jsr:@supabase/supabase-js@2'

// Funcion PRIVADA: solo se invoca desde el portero (gateway) con x-internal-key.
const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INTERNAL = Deno.env.get('INTERNAL_KEY') ?? ''
const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''

function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
}
function graphDT(iso: string): string { return new Date(iso).toISOString().slice(0, 19) }
// El texto del usuario va dentro de HTML: se escapa para impedir HTML/links inyectados en la invitación
function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-key') !== INTERNAL || !INTERNAL) return json(401, { error: 'forbidden' })
  try {
    const { reservation_id, op, event_id, organizer: orgIn } = await req.json()
    const admin = createClient(URL, SERVICE)

    // Cancelación: borra el evento 365 del organizador (invitados reciben la cancelación)
    if (op === 'cancel') {
      if (!event_id || !orgIn) return json(400, { error: 'faltan event_id/organizer' })
      const token = await graphToken()
      if (!token) return json(500, { error: 'no se pudo obtener token de Graph' })
      const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(orgIn)}/events/${encodeURIComponent(event_id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      if (reservation_id) { try { await admin.from('reservations').update({ calendar_event_id: null }).eq('id', reservation_id) } catch (_) { /* noop */ } }
      if (!resp.ok && resp.status !== 404) console.error('calendar: cancel error', resp.status)
      return json(200, { ok: resp.ok || resp.status === 404 })
    }
    const { data: r, error: selErr } = await admin.from('reservations')
      .select('id,title,starts_at,ends_at,justification,attendees,calendar_event_id,rooms(name,location),profiles!reservations_user_id_fkey(email,full_name)')
      .eq('id', reservation_id).single()
    if (selErr) { console.error('calendar: select error', selErr.message); return json(500, { error: 'db: ' + selErr.message }) }
    if (!r) return json(404, { error: 'reserva no encontrada' })
    // Ya tiene evento: no crear otro (evita citas duplicadas por reintentos)
    if ((r as any).calendar_event_id) return json(200, { ok: true, event: (r as any).calendar_event_id })

    const organizer = (r as any).profiles?.email
    if (!organizer) return json(400, { error: 'organizador sin correo' })

    if (!TENANT || !CID || !CSECRET) { console.error('calendar: faltan secrets MS_*'); return json(500, { error: 'Faltan credenciales MS_*' }) }
    const token = await graphToken()
    if (!token) { console.error('calendar: no se pudo obtener token'); return json(500, { error: 'no se pudo obtener token de Graph' }) }

    // Los participantes vienen de la reserva (el frontend decide si incluye al creador)
    const attendees = ((r as any).attendees ?? []).map((a: any) => ({
      emailAddress: { address: a.email ?? a, name: a.name ?? '' }, type: 'required',
    }))
    const ev = {
      subject: `[Sala ${(r as any).rooms?.name}] ${r.title}`,
      body: { contentType: 'HTML', content: `Reserva de sala.<br>Justificacion: ${esc((r as any).justification)}` },
      start: { dateTime: graphDT((r as any).starts_at), timeZone: 'UTC' },
      end: { dateTime: graphDT((r as any).ends_at), timeZone: 'UTC' },
      location: { displayName: `${(r as any).rooms?.name} ${(r as any).rooms?.location ?? ''}` },
      attendees,
      responseRequested: true,
      isReminderOn: true,
      reminderMinutesBeforeStart: 1440,
    }
    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizer)}/events`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(ev),
    })
    const out = await resp.json()
    if (resp.ok && out.id) {
      await admin.from('reservations').update({ calendar_event_id: out.id }).eq('id', r.id)
    } else {
      console.error('calendar: Graph error', resp.status, JSON.stringify(out?.error ?? out))
    }
    return json(resp.status, { ok: resp.ok, event: out.id ?? null, error: resp.ok ? undefined : (out?.error ?? out) })
  } catch (e) {
    console.error('calendar: excepcion', String(e))
    return json(500, { error: 'error interno' })
  }
})

async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null
  const body = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await r.json()
  if (!j.access_token) console.error('calendar: token error', JSON.stringify(j))
  return j.access_token ?? null
}
