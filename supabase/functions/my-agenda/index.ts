import { createClient } from 'jsr:@supabase/supabase-js@2'

// Agenda de Outlook DEL PROPIO usuario para un día: cada persona solo puede ver la suya
// (el correo sale de su sesión, nunca del cliente). Se usa en Salas para coordinar reservas.
const SB_URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authz = req.headers.get('Authorization') ?? ''
    if (!authz.startsWith('Bearer ')) return json(401, { error: 'No autenticado' })
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: authz } } })
    const { data: { user }, error } = await asUser.auth.getUser()
    if (error || !user?.email) return json(401, { error: 'Sesion invalida' })
    const email = user.email.toLowerCase()
    if (!/^[^@\s]+@([a-z0-9-]+\.)*billcapital\.com$/.test(email)) return json(200, { ok: false, reason: 'fuera-del-tenant' })

    const { start, end } = await req.json()
    const s = Date.parse(start ?? ''), e = Date.parse(end ?? '')
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || e - s > 3 * 86400000) return json(400, { error: 'rango inválido' })

    const token = await graphToken()
    if (!token) return json(200, { ok: false, reason: 'sin-token' })
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/calendarView`
      + `?startDateTime=${new Date(s).toISOString()}&endDateTime=${new Date(e).toISOString()}`
      + `&$select=subject,start,end,isAllDay,showAs,location,isCancelled,organizer,attendees,onlineMeeting,webLink&$top=25`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      // Casilla sin licencia Exchange u otro error: se informa sin romper la página
      return json(200, { ok: false, reason: `graph-${r.status}`, detail: t.slice(0, 200) })
    }
    const out = await r.json()
    const events = (out.value || []).filter((ev: any) => !ev.isCancelled).map((ev: any) => ({
      subject: ev.subject || '(sin título)',
      start: ev.start?.dateTime ? ev.start.dateTime + 'Z' : null,
      end: ev.end?.dateTime ? ev.end.dateTime + 'Z' : null,
      all_day: !!ev.isAllDay,
      show_as: ev.showAs || 'busy',
      location: ev.location?.displayName || '',
      organizer: ev.organizer?.emailAddress?.name || ev.organizer?.emailAddress?.address || '',
      attendees: (ev.attendees || []).slice(0, 12).map((a: any) => a?.emailAddress?.name || a?.emailAddress?.address).filter(Boolean),
      online: !!ev.onlineMeeting,
    }))
    events.sort((a: any, b: any) => String(a.start).localeCompare(String(b.start)))
    return json(200, { ok: true, events })
  } catch (e) {
    return json(500, { error: 'Error interno', detail: String(e) })
  }
})
