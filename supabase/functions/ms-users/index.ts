// Gestión de usuarios de Microsoft 365 desde la app, vía Microsoft Graph (client-credentials).
// Sincroniza también el perfil interno de la app. Solo lo pueden usar administradores (rol con manage_users).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TENANT = Deno.env.get('MS_TENANT_ID') ?? ''
const CID = Deno.env.get('MS_CLIENT_ID') ?? ''
const CSECRET = Deno.env.get('MS_CLIENT_SECRET') ?? ''
const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DEFAULT_USAGE = Deno.env.get('MS_USAGE_LOCATION') ?? 'CL'
const BASE_DOMAIN = 'billcapital.com'

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
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await r.json()
  if (!j.access_token) console.error('ms-users: token error', JSON.stringify(j))
  return j.access_token ?? null
}

async function graph(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 204) return { ok: true, status: 204, data: null }
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}
function randPwd() { return 'Zt' + crypto.randomUUID().replace(/-/g, '').slice(0, 16) + '!9' }
// Correo REAL de la cuenta según Graph (nunca confiar en el que envía el cliente)
async function emailFromGraph(token: string, id: string): Promise<string | null> {
  const g = await graph(token, 'GET', `/users/${encodeURIComponent(id)}?$select=userPrincipalName,mail`)
  if (!g.ok) return null
  const e = g.data?.userPrincipalName || g.data?.mail
  return typeof e === 'string' && e.includes('@') ? e.toLowerCase() : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: uinfo } = await admin.auth.getUser(jwt)
    const caller = uinfo?.user
    if (!caller) return json(401, { error: 'No autenticado' })
    const { data: prof } = await admin.from('profiles').select('role,active,app_access').eq('id', caller.id).single()
    if (prof && (prof.active === false || prof.app_access === false)) return json(403, { error: 'Cuenta sin acceso' })
    const { data: roleRow } = await admin.from('roles').select('permissions').eq('key', prof?.role ?? 'user').single()
    const perms = roleRow?.permissions ?? {}
    const canUsers = perms.full_admin === true || perms.manage_users === true
    if (!canUsers) return json(403, { error: 'No autorizado (requiere administración de usuarios)' })
    // Restablecer contraseñas es aparte: solo Acceso total o el permiso explícito de contraseñas.
    const canPwd = perms.full_admin === true || perms.manage_passwords === true

    const token = await graphToken()
    if (!token) return json(500, { error: 'No se pudo obtener token de Microsoft Graph. Revisa MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET.' })

    const p = await req.json().catch(() => ({}))
    const op = p.op as string

    if (op === 'list') {
      const sel = '$select=id,displayName,userPrincipalName,mail,accountEnabled,userType,jobTitle,department,mobilePhone,createdDateTime'
      const g = await graph(token, 'GET', `/users?${sel}&$top=999&$orderby=displayName`)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al listar', detail: g.data })
      return json(200, { ok: true, users: g.data.value ?? [] })
    }

    if (op === 'create') {
      const { displayName, userPrincipalName, password } = p
      if (!displayName || !userPrincipalName || !password) return json(400, { error: 'Faltan nombre, correo (UPN) o contraseña.' })
      const nick = String(userPrincipalName).split('@')[0]
      const gBody: Record<string, unknown> = {
        accountEnabled: true, displayName, mailNickname: nick, userPrincipalName,
        usageLocation: p.usageLocation || DEFAULT_USAGE,
        passwordProfile: { password, forceChangePasswordNextSignIn: p.forceChange !== false },
      }
      if (p.jobTitle) gBody.jobTitle = p.jobTitle
      if (p.department) gBody.department = p.department
      if (p.mobilePhone) gBody.mobilePhone = p.mobilePhone
      const g = await graph(token, 'POST', '/users', gBody)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al crear en M365', detail: g.data })
      let appUserId: string | null = null
      try {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: userPrincipalName, email_confirm: true, password, user_metadata: { full_name: displayName },
        })
        if (cErr && !String(cErr.message || '').toLowerCase().includes('already')) console.error('ms-users: createUser', cErr.message)
        appUserId = created?.user?.id ?? null
        if (!appUserId) {
          const { data: byEmail } = await admin.from('profiles').select('id').eq('email', userPrincipalName).maybeSingle()
          appUserId = byEmail?.id ?? null
        }
        if (appUserId) {
          await admin.rpc('admin_update_user', {
            p_user: appUserId, p_full_name: displayName, p_department: p.department || '',
            p_role: p.role || 'user', p_inventory: false, p_phone: p.mobilePhone || null, p_avatar: null,
            p_notes: null, p_country: p.country || 'Chile',
          })
          await admin.from('profiles').update({ app_access: p.appAccess !== false }).eq('id', appUserId)
        }
      } catch (e) { console.error('ms-users: sync app', String(e)) }
      return json(200, { ok: true, id: g.data.id, appUserId })
    }

    if (op === 'update') {
      const { id } = p
      if (!id) return json(400, { error: 'Falta el id del usuario.' })
      const patch: Record<string, unknown> = {}
      for (const k of ['displayName', 'jobTitle', 'department', 'mobilePhone']) if (p[k] !== undefined) patch[k] = p[k]
      if (Object.keys(patch).length) {
        const g = await graph(token, 'PATCH', `/users/${encodeURIComponent(id)}`, patch)
        if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al editar en M365', detail: g.data })
      }
      try {
        const email = await emailFromGraph(token, id)
        if (email) {
          const { data: pr } = await admin.from('profiles').select('id,role,inventory_access').eq('email', email).maybeSingle()
          if (pr) await admin.rpc('admin_update_user', {
            p_user: pr.id, p_full_name: p.displayName ?? null, p_department: p.department ?? '',
            p_role: pr.role || 'user', p_inventory: pr.inventory_access === true, p_phone: p.mobilePhone ?? null,
            p_avatar: null, p_notes: null, p_country: p.country ?? null,
          })
        }
      } catch (e) { console.error('ms-users: update sync', String(e)) }
      return json(200, { ok: true })
    }

    if (op === 'setEnabled') {
      const { id, enabled } = p
      if (!id) return json(400, { error: 'Falta el id del usuario.' })
      const g = await graph(token, 'PATCH', `/users/${encodeURIComponent(id)}`, { accountEnabled: !!enabled })
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al cambiar el estado', detail: g.data })
      try {
        // El correo se obtiene de Graph por el id (no del cliente): imposible desactivar a un tercero.
        const email = await emailFromGraph(token, id)
        if (email) await admin.from('profiles').update({ active: !!enabled }).eq('email', email)
      } catch (e) { console.error('ms-users: setEnabled sync', String(e)) }
      return json(200, { ok: true })
    }

    if (op === 'resetPassword') {
      if (!canPwd) return json(403, { error: 'Restablecer contraseñas está reservado al Administrador y al Gerente TI.' })
      const { id, password } = p
      if (!id || !password) return json(400, { error: 'Falta el id o la nueva contraseña.' })
      const g = await graph(token, 'PATCH', `/users/${encodeURIComponent(id)}`, {
        passwordProfile: { password, forceChangePasswordNextSignIn: p.forceChange !== false },
      })
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al restablecer la contraseña', detail: g.data })
      return json(200, { ok: true })
    }

    if (op === 'listSkus') {
      const g = await graph(token, 'GET', '/subscribedSkus?$select=skuId,skuPartNumber,prepaidUnits,consumedUnits,capabilityStatus,appliesTo')
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al leer licencias del tenant', detail: g.data })
      const skus = (g.data.value ?? []).filter((s: Record<string, unknown>) => (s as any).appliesTo === 'User').map((s: Record<string, unknown>) => {
        const pre = (s as any).prepaidUnits?.enabled ?? 0
        const used = (s as any).consumedUnits ?? 0
        return { skuId: (s as any).skuId, skuPartNumber: (s as any).skuPartNumber, total: pre, used, available: pre - used }
      })
      return json(200, { ok: true, skus })
    }

    if (op === 'userLicenses') {
      const { id } = p
      if (!id) return json(400, { error: 'Falta el id del usuario.' })
      const g = await graph(token, 'GET', `/users/${encodeURIComponent(id)}?$select=assignedLicenses,usageLocation`)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al leer licencias del usuario', detail: g.data })
      return json(200, { ok: true, assignedLicenses: g.data.assignedLicenses ?? [], usageLocation: g.data.usageLocation ?? null })
    }

    if (op === 'assignLicense') {
      const { id, skuId } = p
      if (!id || !skuId) return json(400, { error: 'Falta el id del usuario o de la licencia.' })
      const gu = await graph(token, 'GET', `/users/${encodeURIComponent(id)}?$select=usageLocation`)
      if (gu.ok && !gu.data?.usageLocation) {
        await graph(token, 'PATCH', `/users/${encodeURIComponent(id)}`, { usageLocation: p.usageLocation || DEFAULT_USAGE })
      }
      const g = await graph(token, 'POST', `/users/${encodeURIComponent(id)}/assignLicense`, { addLicenses: [{ skuId, disabledPlans: [] }], removeLicenses: [] })
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al asignar la licencia', detail: g.data })
      return json(200, { ok: true })
    }

    if (op === 'removeLicense') {
      const { id, skuId } = p
      if (!id || !skuId) return json(400, { error: 'Falta el id del usuario o de la licencia.' })
      const g = await graph(token, 'POST', `/users/${encodeURIComponent(id)}/assignLicense`, { addLicenses: [], removeLicenses: [skuId] })
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al quitar la licencia', detail: g.data })
      return json(200, { ok: true })
    }

    // ===== SINCRONIZAR: traer usuarios reales de M365 y crear en la app los que falten =====
    // Sin filtro de dominio. Los invitados externos (#EXT# / userType Guest) entran con su dominio real, SIN acceso a la app.
    if (op === 'syncFromM365') {
      type MU = { id?: string; displayName?: string; userPrincipalName?: string; mail?: string | null; userType?: string | null; accountEnabled?: boolean }
      const all: MU[] = []
      let path: string | null = '/users?$select=id,displayName,userPrincipalName,mail,userType,accountEnabled&$top=999'
      while (path) {
        const g = await graph(token, 'GET', path)
        if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al listar M365', detail: g.data })
        for (const u of g.data.value ?? []) all.push(u as MU)
        const next = g.data['@odata.nextLink'] as string | undefined
        path = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null
      }
      const validEmail = (s: string) => /^[^\s@#]+@[^\s@#]+\.[^\s@#]+$/.test(s)
      // Reconstruye el correo real de un invitado desde su UPN: "usuario_dominio.com#EXT#@tenant..." -> "usuario@dominio.com"
      const guestEmailFromUpn = (upn: string) => {
        const pre = upn.split('#EXT#')[0]
        const guessed = pre.replace(/_([^_]+)$/, '@$1')
        return validEmail(guessed) ? guessed.toLowerCase() : ''
      }
      const { data: existing } = await admin.from('profiles').select('email')
      const have = new Set((existing ?? []).map((x: Record<string, unknown>) => String((x as any).email || '').toLowerCase()))
      let created = 0
      const errors: string[] = []
      const addedNames: string[] = []
      const skipped: string[] = []
      const byDomain: Record<string, number> = {}
      let guests = 0
      for (const u of all) {
        const upn = String(u.userPrincipalName || '')
        const isGuest = (u.userType === 'Guest') || upn.includes('#EXT#')
        // Correo con dominio real. Invitado: mail real -> reconstruido del UPN. Interno: UPN -> mail.
        let email = ''
        if (isGuest) email = (u.mail && validEmail(u.mail)) ? u.mail.toLowerCase() : guestEmailFromUpn(upn)
        else email = validEmail(upn) ? upn.toLowerCase() : ((u.mail && validEmail(u.mail)) ? u.mail.toLowerCase() : '')
        if (!email) { skipped.push((u.displayName || upn || '(sin correo)') + (isGuest ? ' [invitado]' : '')); continue }
        const dom = email.split('@')[1] || '-'
        byDomain[dom] = (byDomain[dom] || 0) + 1
        if (isGuest) guests++
        if (have.has(email)) continue
        try {
          const { data: cu, error: ce } = await admin.auth.admin.createUser({
            email, email_confirm: true, password: randPwd(), user_metadata: { full_name: u.displayName || '' },
          })
          if (ce) { if (!String(ce.message || '').toLowerCase().includes('already')) errors.push(email + ': ' + ce.message); continue }
          created++; addedNames.push(u.displayName || email)
          // Invitados externos: sin acceso a la app. Desactivados en M365: inactivos.
          const patch: Record<string, unknown> = {}
          if (u.accountEnabled === false) patch.active = false
          if (isGuest) patch.app_access = false
          if (cu?.user?.id && Object.keys(patch).length) await admin.from('profiles').update(patch).eq('id', cu.user.id)
        } catch (e) { errors.push(email + ': ' + String(e)) }
      }
      const guestsSeen = all.filter((x) => (x.userType === 'Guest') || String(x.userPrincipalName || '').includes('#EXT#')).length
      return json(200, { ok: true, totalM365: all.length, guestsSeen, created, added: addedNames, skipped, guests, byDomain, errors })
    }

    return json(400, { error: 'Operación no reconocida: ' + op })
  } catch (e) {
    console.error('ms-users: excepción', String(e))
    return json(500, { error: 'Error interno' })
  }
})
