// Funcion PRIVADA: consulta disponibilidad (free/busy) en 365 via Microsoft Graph getSchedule.
// Solo se invoca desde el portero (gateway) con x-internal-key.
const INTERNAL = Deno.env.get('INTERNAL_KEY') ?? ''
const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''

function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
}
function graphDT(iso: string): string { return new Date(iso).toISOString().slice(0, 19) }

async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null
  const body = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await r.json()
  if (!j.access_token) console.error('availability: token error', JSON.stringify(j))
  return j.access_token ?? null
}

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-key') !== INTERNAL || !INTERNAL) return json(401, { error: 'forbidden' })
  try {
    const { organizer, emails, starts_at, ends_at } = await req.json()
    const list: string[] = Array.isArray(emails) ? emails.filter((e: any) => typeof e === 'string' && e.includes('@')) : []
    if (!list.length || !starts_at || !ends_at) return json(200, { busy: [], ok: true })

    if (!TENANT || !CID || !CSECRET) return json(200, { busy: [], ok: false, error: 'faltan credenciales MS_*' })
    const token = await graphToken()
    if (!token) return json(200, { busy: [], ok: false, error: 'sin token de Graph' })

    const durMin = Math.max(5, Math.min(1440, Math.round((new Date(ends_at).getTime() - new Date(starts_at).getTime()) / 60000)))
    // El buzon de contexto: el organizador si es valido, si no el primer convocado
    const ctx = (organizer && String(organizer).includes('@')) ? organizer : list[0]
    const payload = {
      schedules: list,
      startTime: { dateTime: graphDT(starts_at), timeZone: 'UTC' },
      endTime: { dateTime: graphDT(ends_at), timeZone: 'UTC' },
      availabilityViewInterval: durMin,
    }
    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ctx)}/calendar/getSchedule`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const out = await resp.json()
    if (!resp.ok) {
      console.error('availability: graph error', resp.status, JSON.stringify(out?.error ?? out))
      return json(200, { busy: [], ok: false, error: (out?.error?.message ?? 'graph error') })
    }
    const busy: string[] = []
    for (const item of (out.value ?? [])) {
      const av: string = item.availabilityView ?? ''
      // 0=libre 1=tentativo 2=ocupado 3=fuera-oficina 4=trabajando-fuera. Consideramos 1/2/3 como choque.
      if (/[123]/.test(av)) busy.push(item.scheduleId)
    }
    return json(200, { busy, ok: true })
  } catch (e) {
    console.error('availability: excepcion', String(e))
    return json(200, { busy: [], ok: false, error: String(e) })
  }
})
