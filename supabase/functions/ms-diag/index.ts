// Diagnóstico de permisos de la app en Microsoft Graph. SOLO LECTURA.
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
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function graphToken(): Promise<string | null> {
  if (!TENANT || !CID || !CSECRET) return null
  const body = new URLSearchParams({ client_id: CID, client_secret: CSECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await r.json()
  return j.access_token ?? null
}
async function g(token: string, path: string) {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}

const PWD_PERM = 'User-PasswordProfile.ReadWrite.All'
const PWD_PERM_ID = 'cc117bb9-00cf-4eb8-b580-ea2a878fe8f7'
const PWD_ROLES = ['Password Administrator', 'User Administrator', 'Privileged Authentication Administrator', 'Helpdesk Administrator', 'Global Administrator']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: uinfo } = await admin.auth.getUser(jwt)
    if (!uinfo?.user) return json(401, { error: 'No autenticado' })
    const { data: prof } = await admin.from('profiles').select('role').eq('id', uinfo.user.id).single()
    const { data: roleRow } = await admin.from('roles').select('permissions').eq('key', prof?.role ?? 'user').single()
    if (roleRow?.permissions?.full_admin !== true) return json(403, { error: 'Solo el Administrador puede ver este diagnóstico.' })

    const token = await graphToken()
    if (!token) return json(500, { error: 'No se pudo obtener token de Microsoft Graph.' })

    const notes: string[] = []
    const sp = await g(token, `/servicePrincipals(appId='${CID}')?$select=id,displayName,appId`)
    if (!sp.ok) {
      return json(200, { ok: false, tokenOk: true,
        error: 'La app obtiene token, pero no puede leerse a sí misma en el directorio.',
        detail: sp.data?.error?.message,
        hint: 'Para este diagnóstico hace falta el permiso de aplicación Application.Read.All. No afecta al resto de la app.' })
    }
    const spId = sp.data.id as string

    // Nombres de los permisos: se resuelven contra el service principal de Graph
    // direccionado por appId (el $filter fallaba y dejaba puros GUIDs).
    const byId: Record<string, string> = {}
    const graphSp = await g(token, `/servicePrincipals(appId='00000003-0000-0000-c000-000000000000')?$select=id,appRoles`)
    if (graphSp.ok) for (const r of (graphSp.data.appRoles ?? [])) byId[r.id] = r.value
    else notes.push('No se pudieron traducir los nombres de permisos: ' + (graphSp.data?.error?.message ?? graphSp.status))

    let permIds: string[] = []
    const asg = await g(token, `/servicePrincipals/${spId}/appRoleAssignments?$top=200`)
    if (asg.ok) permIds = (asg.data.value ?? []).map((a: Record<string, unknown>) => String(a.appRoleId))
    else notes.push('No se pudieron leer los permisos de API: ' + (asg.data?.error?.message ?? asg.status))
    const perms = permIds.map((id) => byId[id] || id).sort()

    let dirRoles: string[] = []
    const mem = await g(token, `/servicePrincipals/${spId}/transitiveMemberOf?$top=200`)
    if (mem.ok) dirRoles = (mem.data.value ?? [])
      .filter((m: Record<string, unknown>) => String(m['@odata.type'] ?? '').includes('directoryRole'))
      .map((m: Record<string, unknown>) => String(m.displayName)).sort()

    // El permiso basta para cuentas normales; el rol de directorio solo hace
    // falta para restablecer cuentas que tienen rol administrativo en Entra.
    const tienePermiso = permIds.includes(PWD_PERM_ID) || perms.includes(PWD_PERM)
    const tieneRol = dirRoles.some((r) => PWD_ROLES.includes(r))
    const faltan: string[] = []
    if (!tienePermiso) faltan.push(`Permiso de aplicación «${PWD_PERM}» con consentimiento de administrador`)

    return json(200, {
      ok: true,
      app: sp.data.displayName,
      puedeRestablecerContrasenas: tienePermiso,
      notaAdmins: tienePermiso && !tieneRol
        ? 'Cuentas normales: sí. Para restablecer cuentas que son administradores en Entra haría falta además el rol «Administrador de contraseñas» sobre la aplicación.'
        : '',
      permisosDeApi: perms,
      rolesDeDirectorio: dirRoles,
      falta: faltan,
      notas: notes,
    })
  } catch (e) {
    return json(500, { error: String(e) })
  }
})
