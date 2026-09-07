import { createClient } from 'jsr:@supabase/supabase-js@2'

// PRIVADA: crea/renueva suscripciones de Graph para vigilar el buzón del organizador.
const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INTERNAL = Deno.env.get('INTERNAL_KEY') ?? ''
const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''
const LIFETIME_MIN = 4000 // < 4230 (máx. para eventos)

function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }) }

Deno.serve(async (req) => {
  if (req.headers.get('x-internal-key') !== INTERNAL || !INTERNAL) return json(401, { error: 'forbidden' })
  try {
    const { action, email } = await req.json()
    const admin = createClient(URL, SERVICE)
    const token = await graphToken()
    if (!token) return json(500, { error: 'no se pudo obtener token de Graph (revisa secrets MS_*)' })
    const NOTIF = `${URL}/functions/v1/calendar-webhook`

    const expISO = () => new Date(Date.now() + LIFETIME_MIN * 60000).toISOString()
    async function createSub(mail: string) {
      const exp = expISO(); const resource = `/users/${mail}/events`
      const resp = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeType: 'updated,deleted', notificationUrl: NOTIF, resource, expirationDateTime: exp, clientState: INTERNAL }),
      })
      const out = await resp.json()
      if (resp.ok && out.id) { await admin.from('graph_subscriptions').upsert({ id: out.id, user_email: mail, resource, client_state: INTERNAL, expires_at: exp }, { onConflict: 'user_email' }); return { ok: true, id: out.id } }
      console.error('subscribe: create error', resp.status, JSON.stringify(out?.error ?? out))
      return { ok: false, error: out?.error ?? out }
    }
    async function renewSub(row: any) {
      const exp = expISO()
      const resp = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${row.id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expirationDateTime: exp }),
      })
      if (resp.ok) { await admin.from('graph_subscriptions').update({ expires_at: exp }).eq('id', row.id); return { ok: true, renewed: true } }
      await admin.from('graph_subscriptions').delete().eq('id', row.id)
      return await createSub(row.user_email)
    }

    if (action === 'ensure') {
      if (!email) return json(400, { error: 'email requerido' })
      const { data: ex } = await admin.from('graph_subscriptions').select('*').eq('user_email', email).maybeSingle()
      if (ex) {
        if (new Date(ex.expires_at).getTime() - Date.now() > 24 * 3600 * 1000) return json(200, { ok: true, skip: true })
        return json(200, await renewSub(ex))
      }
      return json(200, await createSub(email))
    }
    if (action === 'renew') {
      const { data: rows } = await admin.from('graph_subscriptions').select('*')
      const out = []
      for (const row of (rows ?? [])) out.push(await renewSub(row))
      return json(200, { ok: true, count: out.length })
    }
    return json(400, { error: 'accion desconocida' })
  } catch (e) { console.error('subscribe: excepcion', String(e)); return json(500, { error: String(e) }) }
})

async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null
  const body = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const j = await r.json()
  return j.access_token ?? null
}
