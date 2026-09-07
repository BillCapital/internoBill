// Listas de distribución / grupos de Microsoft 365 vía Microsoft Graph (client-credentials).
// Solo administradores (permiso manage_users). Reutiliza el app registration de ms-users.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''
const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null
  const body = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const j = await r.json()
  if (!j.access_token) console.error('ms-groups: token error', JSON.stringify(j))
  return j.access_token ?? null
}
async function graph(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ConsistencyLevel: 'eventual' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 204) return { ok: true, status: 204, data: null }
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}
function kindOf(g: any): string {
  const gt = g.groupTypes || []
  if (gt.includes('Unified')) return 'm365'
  if (g.mailEnabled && g.securityEnabled) return 'mail-security'
  if (g.mailEnabled && !g.securityEnabled) return 'distribution'
  return 'security'
}
async function pageAll(token: string, first: string) {
  const all: any[] = []
  let path: string | null = first
  while (path) {
    const g = await graph(token, 'GET', path)
    if (!g.ok) return { ok: false, status: g.status, data: g.data, all }
    for (const x of g.data.value ?? []) all.push(x)
    const next = g.data['@odata.nextLink'] as string | undefined
    path = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null
  }
  return { ok: true, all }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: uinfo } = await admin.auth.getUser(jwt)
    const caller = uinfo?.user
    if (!caller) return json(401, { error: 'No autenticado' })
    const { data: prof } = await admin.from('profiles').select('role').eq('id', caller.id).single()
    const { data: roleRow } = await admin.from('roles').select('permissions').eq('key', prof?.role ?? 'user').single()
    const perms = roleRow?.permissions ?? {}
    if (!(perms.full_admin === true || perms.manage_users === true)) return json(403, { error: 'No autorizado (requiere administración de usuarios)' })

    const token = await graphToken()
    if (!token) return json(500, { error: 'No se pudo obtener token de Microsoft Graph. Revisa MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET.' })

    const p = await req.json().catch(() => ({}))
    const op = p.op as string

    if (op === 'list') {
      // Traer TODOS los grupos (sin filtro server-side, que a veces omite listas) y filtrar los que tienen correo.
      const r = await pageAll(token, '/groups?$select=id,displayName,mail,description,groupTypes,mailEnabled,securityEnabled&$top=999')
      if (!r.ok) return json(r.status ?? 500, { error: r.data?.error?.message ?? 'Error al listar grupos', detail: r.data })
      const groups = r.all
        .filter((g) => g.mailEnabled === true || (g.groupTypes || []).includes('Unified'))
        .map((g) => ({ id: g.id, displayName: g.displayName, mail: g.mail, description: g.description, kind: kindOf(g) }))
        .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'es'))
      return json(200, { ok: true, groups, totalGroups: r.all.length })
    }

    if (op === 'members') {
      const { id } = p
      if (!id) return json(400, { error: 'Falta el id de la lista.' })
      const r = await pageAll(token, `/groups/${encodeURIComponent(id)}/members?$select=id,displayName,userPrincipalName,mail&$top=999`)
      if (!r.ok) return json(r.status ?? 500, { error: r.data?.error?.message ?? 'Error al leer los miembros', detail: r.data })
      const members = r.all.map((m) => ({ id: m.id, displayName: m.displayName, mail: m.mail || m.userPrincipalName }))
        .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'es'))
      return json(200, { ok: true, members })
    }

    if (op === 'users') {
      const r = await pageAll(token, '/users?$select=id,displayName,userPrincipalName,mail,accountEnabled&$top=999&$orderby=displayName')
      if (!r.ok) return json(r.status ?? 500, { error: r.data?.error?.message ?? 'Error al listar usuarios', detail: r.data })
      const users = r.all.map((u) => ({ id: u.id, displayName: u.displayName, mail: u.mail || u.userPrincipalName, enabled: u.accountEnabled }))
      return json(200, { ok: true, users })
    }

    if (op === 'addMember') {
      const { id, userId } = p
      if (!id || !userId) return json(400, { error: 'Falta la lista o la persona.' })
      const g = await graph(token, 'POST', `/groups/${encodeURIComponent(id)}/members/$ref`, { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}` })
      if (!g.ok) {
        const msg = g.data?.error?.message ?? 'Error al agregar a la persona'
        if (String(msg).toLowerCase().includes('already')) return json(200, { ok: true, already: true })
        return json(g.status, { error: msg, detail: g.data })
      }
      return json(200, { ok: true })
    }

    if (op === 'removeMember') {
      const { id, userId } = p
      if (!id || !userId) return json(400, { error: 'Falta la lista o la persona.' })
      const g = await graph(token, 'DELETE', `/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/$ref`)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al quitar a la persona', detail: g.data })
      return json(200, { ok: true })
    }

    if (op === 'create') {
      const { displayName, mailNickname, description } = p
      if (!displayName || !mailNickname) return json(400, { error: 'Falta el nombre o el alias de correo.' })
      const nick = String(mailNickname).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60)
      const body: Record<string, unknown> = {
        displayName, mailNickname: nick, description: description || undefined,
        mailEnabled: true, securityEnabled: false, groupTypes: ['Unified'], visibility: 'Private',
      }
      const g = await graph(token, 'POST', '/groups', body)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al crear la lista', detail: g.data })
      return json(200, { ok: true, id: g.data.id, mail: g.data.mail })
    }

    if (op === 'delete') {
      const { id } = p
      if (!id) return json(400, { error: 'Falta el id de la lista.' })
      const g = await graph(token, 'DELETE', `/groups/${encodeURIComponent(id)}`)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al eliminar la lista', detail: g.data })
      return json(200, { ok: true })
    }

    return json(400, { error: 'Operación no reconocida: ' + op })
  } catch (e) {
    console.error('ms-groups: excepción', String(e))
    return json(500, { error: String(e) })
  }
})
