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

// ===== Extracción del cuerpo completo desde el export FastTransfer del archivo en línea =====
// El export técnico de Microsoft (exportItems) trae el correo entero en binario MAPI.
// Se escanea el stream buscando la propiedad PR_HTML (o PR_BODY) y se decodifica con el
// codepage del mensaje (PR_INTERNET_CPID). Así el archivo también se puede LEER completo.
function fxFindProp(buf: Uint8Array, t: number[]): { at: number; len: number } | null {
  for (let i = 0; i + 8 < buf.length; i++) {
    if (buf[i] === t[0] && buf[i + 1] === t[1] && buf[i + 2] === t[2] && buf[i + 3] === t[3]) {
      const len = buf[i + 4] | (buf[i + 5] << 8) | (buf[i + 6] << 16) | (buf[i + 7] << 24)
      if (len > 0 && len < 8 * 1024 * 1024 && i + 8 + len <= buf.length) return { at: i + 8, len }
    }
  }
  return null
}
function fxExtractBody(b64: string): { bodyType: string; body: string } | null {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  // Codepage del mensaje (PR_INTERNET_CPID, PT_LONG): 03 00 DE 3F + valor
  let cs = 'windows-1252'
  for (let i = 0; i + 8 < buf.length; i++) {
    if (buf[i] === 0x03 && buf[i + 1] === 0x00 && buf[i + 2] === 0xde && buf[i + 3] === 0x3f) {
      const cp = buf[i + 4] | (buf[i + 5] << 8) | (buf[i + 6] << 16) | (buf[i + 7] << 24)
      cs = cp === 65001 ? 'utf-8' : cp === 28591 ? 'iso-8859-1' : cp === 1200 ? 'utf-16le' : 'windows-1252'
      break
    }
  }
  // PR_HTML (0x1013, PT_BINARY) -> 02 01 13 10
  const html = fxFindProp(buf, [0x02, 0x01, 0x13, 0x10])
  if (html) {
    const slice = buf.subarray(html.at, html.at + html.len)
    try { return { bodyType: 'html', body: new TextDecoder(cs).decode(slice) } }
    catch { return { bodyType: 'html', body: new TextDecoder('iso-8859-1').decode(slice) } }
  }
  // PR_BODY (0x1000, PT_UNICODE) -> 1F 00 00 10
  const txt = fxFindProp(buf, [0x1f, 0x00, 0x00, 0x10])
  if (txt) return { bodyType: 'text', body: new TextDecoder('utf-16le').decode(buf.subarray(txt.at, txt.at + txt.len)) }
  return null
}
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
    const canInv = perms.full_admin === true || perms.manage_inventory === true
    // Restablecer contraseñas es aparte: solo Acceso total o el permiso explícito de contraseñas.
    const canPwd = perms.full_admin === true || perms.manage_passwords === true

    const p = await req.json().catch(() => ({}))
    const op = p.op as string
    // Operaciones de solo lectura que sirven al inventario/TI: basta gestionar usuarios O inventario.
    const readOnlyOps = new Set(['listDevices', 'securityReport', 'listMailboxes', 'linkDevice', 'deleteDevice', 'deviceKind', 'dirAudit', 'serviceActivity', 'bitlockerKeys', 'bitlockerKey'])
    if (readOnlyOps.has(op) ? !(canUsers || canInv) : !canUsers) {
      return json(403, { error: 'No autorizado (requiere administración de usuarios)' })
    }

    const token = await graphToken()
    if (!token) return json(500, { error: 'No se pudo obtener token de Microsoft Graph. Revisa MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET.' })

    // ===== Dispositivos registrados en Entra ID (gratis, sin licencia Intune) =====
    if (op === 'listDevices') {
      const all: Record<string, unknown>[] = []
      let path: string | null = '/devices?$select=id,deviceId,displayName,operatingSystem,operatingSystemVersion,approximateLastSignInDateTime,accountEnabled,trustType,registrationDateTime,model,manufacturer,extensionAttributes&$expand=registeredOwners($select=displayName,userPrincipalName)&$top=999'
      while (path) {
        const g = await graph(token, 'GET', path)
        if (!g.ok) {
          const msg = g.status === 403
            ? 'Microsoft aún no autoriza la lectura de dispositivos: falta conceder el permiso de aplicación Device.Read.All (con consentimiento de administrador) al registro de la app en Azure.'
            : (g.data?.error?.message ?? 'Error al listar dispositivos')
          return json(g.status, { error: msg, detail: g.data })
        }
        for (const d of g.data.value ?? []) all.push(d as Record<string, unknown>)
        const next = g.data['@odata.nextLink'] as string | undefined
        path = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null
      }
      const devices = all.map((d: Record<string, unknown>) => {
        const o = ((d as any).registeredOwners ?? [])[0] ?? {}
        return {
          id: (d as any).id, devId: (d as any).deviceId || '', name: (d as any).displayName || '',
          os: (d as any).operatingSystem || '', osVersion: (d as any).operatingSystemVersion || '',
          lastActivity: (d as any).approximateLastSignInDateTime || null,
          enabled: (d as any).accountEnabled !== false, trustType: (d as any).trustType || '',
          registered: (d as any).registrationDateTime || null,
          model: (d as any).model || '', manufacturer: (d as any).manufacturer || '',
          owner: o.displayName || '', ownerEmail: String(o.userPrincipalName || '').toLowerCase(),
          serial: ((d as any).extensionAttributes?.extensionAttribute1 ?? '') || '',
          fichaId: ((d as any).extensionAttributes?.extensionAttribute2 ?? '') || '',
          kind: ((d as any).extensionAttributes?.extensionAttribute3 ?? '') || '',
        }
      })
      return json(200, { ok: true, devices })
    }

    // ===== Vincular un dispositivo de Entra con una ficha del inventario =====
    // La serie y el id de la ficha se guardan en el propio objeto del dispositivo en Microsoft
    // (extensionAttribute1/2), asi el cruce persiste aunque se reinstale la app.
    if (op === 'linkDevice') {
      const did = String(p.deviceId || '')
      if (!did) return json(400, { error: 'Falta deviceId' })
      const serial = p.serial ? String(p.serial).slice(0, 250) : null
      const fichaId = p.fichaId ? String(p.fichaId).slice(0, 64) : null
      const g = await graph(token, 'PATCH', `/devices/${did}`, {
        extensionAttributes: { extensionAttribute1: serial, extensionAttribute2: fichaId },
      })
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'No se pudo actualizar el dispositivo en Microsoft' })
      try {
        const { data: me } = await admin.from('profiles').select('full_name').eq('id', caller.id).single()
        await admin.from('activity_log').insert({
          actor_id: caller.id, actor_name: me?.full_name || caller.email, kind: 'Inventario',
          action: fichaId ? 'Equipo Microsoft vinculado a ficha de inventario' : 'Equipo Microsoft desvinculado de su ficha',
          detail: `Dispositivo ${did}` + (serial ? ` · Serie ${serial}` : ''),
        })
      } catch (e) { console.error('ms-users: audit linkDevice', String(e)) }
      return json(200, { ok: true })
    }

    // ===== Clasificar un equipo: corporativo o personal =====
    // Se guarda en el propio dispositivo en Microsoft (extensionAttribute3).
    if (op === 'deviceKind') {
      const did = String(p.deviceId || '')
      const kind = ['corp', 'personal'].includes(p.kind) ? p.kind : null
      if (!did) return json(400, { error: 'Falta deviceId' })
      const g = await graph(token, 'PATCH', `/devices/${did}`, {
        extensionAttributes: { extensionAttribute3: kind },
      })
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'No se pudo clasificar el dispositivo' })
      return json(200, { ok: true })
    }

    // ===== Claves de recuperación BitLocker (solo Acceso total; cada consulta queda auditada) =====
    if (op === 'bitlockerKeys' || op === 'bitlockerKey') {
      if (perms.full_admin !== true) return json(403, { error: 'Las claves BitLocker solo las puede ver el rol con Acceso total.' })
      if (op === 'bitlockerKeys') {
        const devId = String(p.devId || '')
        if (!devId) return json(400, { error: 'Falta el dispositivo.' })
        const g = await graph(token, 'GET', `/informationProtection/bitlocker/recoveryKeys?$filter=deviceId eq '${devId.replace(/[^a-fA-F0-9-]/g, '')}'`)
        if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al listar claves BitLocker' })
        const rows = (g.data.value ?? []).map((k: Record<string, unknown>) => ({ id: (k as any).id, created: (k as any).createdDateTime || null, volumeType: (k as any).volumeType ?? null }))
        return json(200, { ok: true, rows })
      }
      const kid = String(p.keyId || '')
      if (!kid) return json(400, { error: 'Falta la clave.' })
      const g = await graph(token, 'GET', `/informationProtection/bitlocker/recoveryKeys/${encodeURIComponent(kid)}?$select=key,deviceId`)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al leer la clave BitLocker' })
      try {
        const { data: me } = await admin.from('profiles').select('full_name').eq('id', caller.id).single()
        await admin.from('activity_log').insert({
          actor_id: caller.id, actor_name: me?.full_name || caller.email, kind: 'Inventario',
          action: 'Clave BitLocker consultada', detail: `Equipo ${String(p.deviceName || g.data?.deviceId || kid)}`,
        })
      } catch (e) { console.error('ms-users: audit bitlocker', String(e)) }
      return json(200, { ok: true, key: g.data?.key ?? '' })
    }

    // ===== Auditoría del directorio (Entra): quién hizo qué y cuándo (últimos ~7 días) =====
    if (op === 'dirAudit') {
      const cat = String(p.category || '').replace(/[^A-Za-z]/g, '')
      const filt = cat ? `&$filter=${encodeURIComponent(`category eq '${cat}'`)}` : ''
      const g = await graph(token, 'GET', `/auditLogs/directoryAudits?$top=${Math.min(Number(p.top) || 60, 200)}${filt}`)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al leer la auditoría de Microsoft' })
      const rows = (g.data.value ?? []).map((a: Record<string, unknown>) => {
        const ini = (a as any).initiatedBy ?? {}
        const by = ini.user?.userPrincipalName || ini.user?.displayName || ini.app?.displayName || ''
        const tg = ((a as any).targetResources ?? [])[0] ?? {}
        return {
          at: (a as any).activityDateTime || null,
          activity: (a as any).activityDisplayName || '',
          category: (a as any).category || '',
          by, target: tg.displayName || tg.userPrincipalName || '',
          ok: (a as any).result === 'success',
        }
      })
      return json(200, { ok: true, rows })
    }

    // ===== Actividad real por servicio (Exchange/OneDrive/SharePoint/Teams) por usuario =====
    if (op === 'serviceActivity') {
      const r = await fetch(`https://graph.microsoft.com/v1.0/reports/getOffice365ActiveUserDetail(period='D30')`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) return json(r.status, { error: 'Error al leer el informe de actividad', detail: (await r.text()).slice(0, 300) })
      const csv = await r.text()
      const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
      if (!lines.length) return json(200, { ok: true, rows: [] })
      const splitCsv = (l: string) => l.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((x) => x.replace(/^"|"$/g, ''))
      const head = splitCsv(lines[0]).map((h) => h.trim().toLowerCase())
      const col = (n: string) => head.indexOf(n)
      const iUpn = col('user principal name'), iEx = col('exchange last activity date'), iOd = col('onedrive last activity date'),
        iSp = col('sharepoint last activity date'), iTm = col('teams last activity date')
      const rows = lines.slice(1).map(splitCsv).map((c) => ({
        upn: (c[iUpn] || '').toLowerCase(),
        exchange: c[iEx] || null, oneDrive: c[iOd] || null, sharePoint: c[iSp] || null, teams: c[iTm] || null,
      })).filter((r2) => r2.upn)
      return json(200, { ok: true, rows })
    }

    // ===== Eliminar un registro de equipo obsoleto en Entra =====
    // Solo borra el REGISTRO del directorio (equipos formateados, duplicados o dados de baja).
    // Si la máquina sigue existiendo y alguien inicia sesión en ella, se vuelve a registrar sola.
    if (op === 'deleteDevice') {
      const did = String(p.deviceId || '')
      if (!did) return json(400, { error: 'Falta deviceId' })
      const g = await graph(token, 'DELETE', `/devices/${did}`)
      if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'No se pudo eliminar el registro en Microsoft' })
      try {
        const { data: me } = await admin.from('profiles').select('full_name').eq('id', caller.id).single()
        await admin.from('activity_log').insert({
          actor_id: caller.id, actor_name: me?.full_name || caller.email, kind: 'Inventario',
          action: 'Registro de equipo eliminado en Entra', detail: `Dispositivo ${String(p.name || did)}`,
        })
      } catch (e) { console.error('ms-users: audit deleteDevice', String(e)) }
      return json(200, { ok: true })
    }

    // ===== Informe de seguridad: MFA, actividad y licencias por cuenta =====
    if (op === 'securityReport') {
      // 1) Registro de métodos de autenticación (quién tiene MFA). Puede no estar disponible en todos los planes.
      const mfaByUpn: Record<string, { registered: boolean; methods: string[] }> = {}
      let mfaOk = false
      {
        let path: string | null = '/reports/authenticationMethods/userRegistrationDetails?$top=999'
        while (path) {
          const g = await graph(token, 'GET', path)
          if (!g.ok) { console.error('securityReport: mfa', g.status, JSON.stringify(g.data?.error ?? {})); break }
          mfaOk = true
          for (const r of g.data.value ?? []) {
            const upn = String((r as any).userPrincipalName || '').toLowerCase()
            if (upn) mfaByUpn[upn] = { registered: (r as any).isMfaRegistered === true, methods: (r as any).methodsRegistered ?? [] }
          }
          const next = g.data['@odata.nextLink'] as string | undefined
          path = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null
        }
      }
      // 2) Cuentas con licencias y última actividad (signInActivity requiere Entra P1: si falla, se repite sin él)
      const users: Record<string, unknown>[] = []
      let signInOk = true
      const base = '/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses,userType,createdDateTime'
      let path2: string | null = base + ',signInActivity&$top=999'
      while (path2) {
        const g = await graph(token, 'GET', path2)
        if (!g.ok) {
          if (signInOk) { signInOk = false; path2 = base + '&$top=999'; users.length = 0; continue }
          return json(g.status, { error: g.data?.error?.message ?? 'Error al listar cuentas', detail: g.data })
        }
        for (const u of g.data.value ?? []) users.push(u as Record<string, unknown>)
        const next = g.data['@odata.nextLink'] as string | undefined
        path2 = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null
      }
      const rows = users.map((u: Record<string, unknown>) => {
        const upn = String((u as any).userPrincipalName || '').toLowerCase()
        const guest = (u as any).userType === 'Guest' || upn.includes('#ext#')
        const lic = ((u as any).assignedLicenses ?? []).length > 0
        const si = (u as any).signInActivity ?? null
        const last = si?.lastSignInDateTime || si?.lastNonInteractiveSignInDateTime || null
        const mfa = mfaByUpn[upn] ?? null
        return {
          id: (u as any).id, name: (u as any).displayName || '', upn, guest,
          enabled: (u as any).accountEnabled !== false, licensed: lic,
          mfaRegistered: mfa ? mfa.registered : null, mfaMethods: mfa?.methods ?? [],
          lastSignIn: last, created: (u as any).createdDateTime || null,
        }
      })
      return json(200, { ok: true, rows, mfaAvailable: mfaOk, signInAvailable: signInOk })
    }

    // ===== Buzones del tenant: tipo real (usuario/compartido/sala) y alias de cada uno =====
    if (op === 'listMailboxes') {
      const all: Record<string, unknown>[] = []
      let path: string | null = '/users?$select=id,displayName,userPrincipalName,mail,proxyAddresses,assignedLicenses,accountEnabled,userType&$top=999'
      while (path) {
        const g = await graph(token, 'GET', path)
        if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al listar buzones', detail: g.data })
        for (const u of g.data.value ?? []) all.push(u as Record<string, unknown>)
        const next = g.data['@odata.nextLink'] as string | undefined
        path = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null
      }
      const withMail = all.filter((u: Record<string, unknown>) => (u as any).mail && (u as any).userType !== 'Guest')
      // El tipo de buzón (userPurpose) se consulta en lotes de 20 vía $batch
      const purpose: Record<string, string> = {}
      for (let i = 0; i < withMail.length; i += 20) {
        const chunk = withMail.slice(i, i + 20)
        const g = await graph(token, 'POST', '/$batch', {
          requests: chunk.map((u: Record<string, unknown>) => ({
            id: (u as any).id, method: 'GET', url: `/users/${(u as any).id}/mailboxSettings?$select=userPurpose`,
          })),
        })
        if (g.ok) for (const r of g.data?.responses ?? []) {
          if ((r as any).status === 200 && (r as any).body?.userPurpose) purpose[(r as any).id] = (r as any).body.userPurpose
        }
      }
      const rows = withMail.map((u: Record<string, unknown>) => {
        const primary = String((u as any).mail || '').toLowerCase()
        const aliases = ((u as any).proxyAddresses ?? [])
          .filter((a: string) => /^smtp:/i.test(a))
          .map((a: string) => a.slice(5).toLowerCase())
          .filter((a: string) => a !== primary)
        return {
          id: (u as any).id, name: (u as any).displayName || '', mail: primary,
          purpose: purpose[(u as any).id] || 'user',
          enabled: (u as any).accountEnabled !== false,
          licensed: ((u as any).assignedLicenses ?? []).length > 0,
          aliases,
        }
      })
      return json(200, { ok: true, rows })
    }

    // ===== Correo de las personas: explorar, descargar, archivar, eliminar (SOLO Acceso total) =====
    const mailOps = new Set(['mailboxUsage', 'mailFolders', 'mailMessages', 'mailDownload', 'mailMove', 'mailDelete', 'archiveFolders', 'archiveMessages', 'archiveExport', 'archiveEml', 'archiveRead', 'searchAll', 'mailRead'])
    if (mailOps.has(op)) {
      if (perms.full_admin !== true) return json(403, { error: 'El correo de las personas solo lo puede revisar el rol con Acceso total.' })
      // Auditoría: cada acción sensible queda en el registro de actividades
      const audit = async (action: string, detail: string) => {
        try {
          const { data: me } = await admin.from('profiles').select('full_name').eq('id', caller.id).single()
          await admin.from('activity_log').insert({ actor_id: caller.id, actor_name: me?.full_name || caller.email, kind: 'Correo', action, detail })
        } catch (e) { console.error('ms-users: audit', String(e)) }
      }

      if (op === 'mailboxUsage') {
        const r = await fetch(`https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D7')`, { headers: { Authorization: `Bearer ${token}` } })
        if (!r.ok) return json(r.status, { error: 'Error al leer el informe de uso de buzones', detail: (await r.text()).slice(0, 300) })
        const csv = await r.text()
        const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
        if (!lines.length) return json(200, { ok: true, rows: [] })
        const splitCsv = (l: string) => l.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((x) => x.replace(/^"|"$/g, ''))
        const head = splitCsv(lines[0]).map((h) => h.trim().toLowerCase())
        const col = (n: string) => head.indexOf(n)
        const iUpn = col('user principal name'), iStor = col('storage used (byte)'), iQuota = col('prohibit send quota (byte)'),
          iItems = col('item count'), iArch = col('has archive'), iLast = col('last activity date')
        const rows = lines.slice(1).map(splitCsv).map((c) => ({
          upn: (c[iUpn] || '').toLowerCase(),
          storageBytes: Number(c[iStor] || 0), quotaBytes: Number(c[iQuota] || 0),
          items: Number(c[iItems] || 0), hasArchive: /^true$/i.test(c[iArch] || ''), lastActivity: c[iLast] || null,
        })).filter((r2) => r2.upn)
        return json(200, { ok: true, rows })
      }

      // ===== Búsqueda transversal: un término sobre TODOS los buzones a la vez =====
      if (op === 'searchAll') {
        const q = String(p.q || '').trim().slice(0, 120)
        if (q.length < 3) return json(400, { error: 'Escribe al menos 3 caracteres para buscar.' })
        const safe = q.replace(/["\\]/g, ' ')
        // Buzones internos con correo
        const boxes: { id: string; mail: string; name: string }[] = []
        let path: string | null = '/users?$select=id,displayName,mail,userType&$top=999'
        while (path) {
          const g = await graph(token, 'GET', path)
          if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al listar buzones' })
          for (const u of g.data.value ?? []) {
            if ((u as any).mail && (u as any).userType !== 'Guest') {
              boxes.push({ id: (u as any).id, mail: String((u as any).mail).toLowerCase(), name: (u as any).displayName || '' })
            }
          }
          const next = g.data['@odata.nextLink'] as string | undefined
          path = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null
        }
        // Búsqueda por lotes de 15 (límite de $batch: 20)
        const rows: Record<string, unknown>[] = []
        let failed = 0
        for (let i = 0; i < boxes.length; i += 15) {
          const chunk = boxes.slice(i, i + 15)
          const g = await graph(token, 'POST', '/$batch', {
            requests: chunk.map((b2) => ({
              id: b2.id, method: 'GET',
              url: `/users/${b2.id}/messages?$search="${encodeURIComponent(safe)}"&$top=4&$select=id,subject,from,receivedDateTime`,
            })),
          })
          if (!g.ok) { failed += chunk.length; continue }
          for (const r of g.data?.responses ?? []) {
            const b2 = chunk.find((x) => x.id === (r as any).id)
            if (!b2) continue
            if ((r as any).status !== 200) { failed++; continue }
            const hits = ((r as any).body?.value ?? []).map((m: Record<string, unknown>) => ({
              id: (m as any).id, subject: (m as any).subject || '(sin asunto)',
              from: (m as any).from?.emailAddress?.name || (m as any).from?.emailAddress?.address || '',
              at: (m as any).receivedDateTime || null,
            }))
            if (hits.length) rows.push({ mail: b2.mail, name: b2.name, hits })
          }
        }
        await audit('Búsqueda transversal de correo', `Término: "${q}" · ${rows.length} buzones con resultados`)
        rows.sort((a: Record<string, unknown>, b2: Record<string, unknown>) => String((a as any).name).localeCompare(String((b2 as any).name), 'es'))
        return json(200, { ok: true, term: q, total: boxes.length, withHits: rows.length, failed, rows })
      }

      const uid = String(p.userId || '')
      if (!uid) return json(400, { error: 'Falta el usuario.' })

      if (op === 'mailFolders') {
        const g = await graph(token, 'GET', `/users/${encodeURIComponent(uid)}/mailFolders?$top=100&$select=id,displayName,totalItemCount,unreadItemCount`)
        if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al listar carpetas', detail: g.data })
        return json(200, { ok: true, folders: g.data.value ?? [] })
      }

      if (op === 'mailMessages') {
        const sel = '$select=id,subject,from,receivedDateTime,hasAttachments'
        let path: string
        if (p.search) {
          const q = String(p.search).replace(/["\\]/g, ' ').slice(0, 120)
          path = `/users/${encodeURIComponent(uid)}/messages?$search="${encodeURIComponent(q)}"&$top=25&${sel}`
        } else {
          const folder = encodeURIComponent(String(p.folderId || 'inbox'))
          path = `/users/${encodeURIComponent(uid)}/mailFolders/${folder}/messages?$top=25&$skip=${Number(p.skip) || 0}&$orderby=receivedDateTime desc&${sel}`
        }
        const g = await graph(token, 'GET', path)
        if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al listar correos', detail: g.data })
        const msgs = (g.data.value ?? []).map((m: Record<string, unknown>) => ({
          id: (m as any).id, subject: (m as any).subject || '(sin asunto)',
          from: (m as any).from?.emailAddress?.name || (m as any).from?.emailAddress?.address || '',
          fromAddr: (m as any).from?.emailAddress?.address || '',
          at: (m as any).receivedDateTime || null, hasAttachments: !!(m as any).hasAttachments,
        }))
        return json(200, { ok: true, messages: msgs })
      }

      // ===== Vista previa de un correo dentro de la app (cuerpo completo + adjuntos) =====
      if (op === 'mailRead') {
        const mid = String(p.messageId || '')
        if (!mid) return json(400, { error: 'Falta el correo.' })
        const g = await graph(token, 'GET', `/users/${encodeURIComponent(uid)}/messages/${encodeURIComponent(mid)}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments`)
        if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al leer el correo', detail: g.data })
        const m = g.data
        let atts: Record<string, unknown>[] = []
        if (m.hasAttachments) {
          const ga = await graph(token, 'GET', `/users/${encodeURIComponent(uid)}/messages/${encodeURIComponent(mid)}/attachments?$select=id,name,size,contentType`)
          if (ga.ok) atts = (ga.data.value ?? []).map((a: Record<string, unknown>) => ({ id: (a as any).id, name: (a as any).name || 'adjunto', size: (a as any).size ?? 0 }))
        }
        const who = (x: Record<string, unknown>) => (x as any)?.emailAddress?.name || (x as any)?.emailAddress?.address || ''
        await audit('Lectura de correo', `Buzón ${uid} · "${String(m.subject || '').slice(0, 60)}"`)
        return json(200, {
          ok: true,
          subject: m.subject || '(sin asunto)',
          from: who(m.from), fromAddr: m.from?.emailAddress?.address || '',
          to: (m.toRecipients ?? []).map(who).filter(Boolean),
          cc: (m.ccRecipients ?? []).map(who).filter(Boolean),
          at: m.receivedDateTime || null,
          bodyType: m.body?.contentType || 'text',
          body: String(m.body?.content || '').slice(0, 2 * 1024 * 1024),
          attachments: atts,
        })
      }

      // Archivo en línea (In-Place Archive), vía las APIs beta nuevas de Graph. SOLO LECTURA:
      // Microsoft aún no permite descargar (.eml), mover ni eliminar en el archivo por API.
      const archId = async (): Promise<string | null> => {
        const r = await fetch(`https://graph.microsoft.com/beta/users/${encodeURIComponent(uid)}/settings/exchange`, { headers: { Authorization: `Bearer ${token}` } })
        const j = await r.json().catch(() => ({}))
        return j.inPlaceArchiveMailboxId ?? null
      }
      if (op === 'archiveFolders') {
        const arch = await archId()
        if (!arch) return json(200, { ok: true, archive: false, folders: [] })
        const r = await fetch(`https://graph.microsoft.com/beta/admin/exchange/mailboxes/${encodeURIComponent(arch)}/folders?$top=100`, { headers: { Authorization: `Bearer ${token}` } })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          const msg = r.status === 403
            ? 'Para leer el archivo en línea falta conceder en Azure los permisos de aplicación MailboxFolder.Read.All y MailboxItem.Read.All (con consentimiento de administrador).'
            : (j?.error?.message ?? 'Error al leer el archivo en línea')
          return json(r.status, { error: msg })
        }
        const folders = (j.value ?? []).map((f: Record<string, unknown>) => ({
          id: (f as any).id, displayName: (f as any).displayName || (f as any).name || '(carpeta)',
          totalItemCount: (f as any).totalItemCount ?? (f as any).itemCount ?? null,
        })).filter((f: Record<string, unknown>) => (f as any).id)
        return json(200, { ok: true, archive: true, folders })
      }
      if (op === 'archiveMessages') {
        const fid = String(p.folderId || '')
        if (!fid) return json(400, { error: 'Falta la carpeta.' })
        const arch = await archId()
        if (!arch) return json(200, { ok: true, messages: [] })
        // El item del archivo no trae asunto/remitente: se piden como propiedades MAPI extendidas
        // (0x0037 asunto, 0x0C1A remitente, 0x0E06 fecha, 0x1000 cuerpo — Microsoft lo limita a 255 caracteres)
        const exp = encodeURIComponent("singleValueExtendedProperties($filter=id eq 'String 0x0037' or id eq 'String 0x0C1A' or id eq 'SystemTime 0x0E06' or id eq 'String 0x1000')")
        // Filtro opcional por asunto o remitente (contains sobre las propiedades extendidas)
        let fq = ''
        if (p.filter) {
          const t = String(p.filter).replace(/'/g, "''").slice(0, 80)
          fq = '&$filter=' + encodeURIComponent(`singleValueExtendedProperties/any(ep: ep/id eq 'String 0x0037' and contains(ep/value, '${t}')) or singleValueExtendedProperties/any(ep2: ep2/id eq 'String 0x0C1A' and contains(ep2/value, '${t}'))`)
        }
        const r = await fetch(`https://graph.microsoft.com/beta/admin/exchange/mailboxes/${encodeURIComponent(arch)}/folders/${encodeURIComponent(fid)}/items?$top=25&$skip=${Number(p.skip) || 0}${fq}&$expand=${exp}`, { headers: { Authorization: `Bearer ${token}` } })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) return json(r.status, { error: j?.error?.message ?? 'Error al leer el archivo en línea' })
        const msgs = (j.value ?? []).map((m: Record<string, unknown>) => {
          const props: Record<string, string> = {}
          for (const sp of ((m as any).singleValueExtendedProperties ?? [])) {
            const pid = String((sp as any).id || '').toLowerCase()
            if (/0x0?37$/.test(pid)) props.subject = (sp as any).value
            else if (/0x0?c1a$/.test(pid)) props.sender = (sp as any).value
            else if (/0x0?e06$/.test(pid)) props.at = (sp as any).value
            else if (/0x0?1000$/.test(pid)) props.preview = (sp as any).value
          }
          return {
            id: (m as any).id,
            subject: props.subject || '(sin asunto)',
            from: props.sender || '', fromAddr: '',
            at: props.at || (m as any).createdDateTime || null,
            hasAttachments: false,
            preview: (props.preview || '').slice(0, 255),
            size: (m as any).size ?? null,
          }
        })
        return json(200, { ok: true, messages: msgs })
      }
      // ===== Ver un correo del archivo COMPLETO dentro de la app =====
      // Graph no lo expone directo, pero el export FastTransfer trae el correo entero:
      // se extrae el HTML (o texto) del binario y se devuelve para renderizarlo.
      if (op === 'archiveRead') {
        const iid = String(p.itemId || '')
        if (!iid) return json(400, { error: 'Falta el correo.' })
        const arch = await archId()
        if (!arch) return json(400, { error: 'Este buzón no tiene archivo en línea.' })
        const r = await fetch(`https://graph.microsoft.com/beta/admin/exchange/mailboxes/${encodeURIComponent(arch)}/exportItems`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: [iid] }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) return json(r.status, { error: j?.error?.message ?? 'Error al leer el correo del archivo' })
        const data = j.value?.[0]?.data
        if (!data) return json(500, { error: 'Microsoft no devolvió datos del correo.' })
        if (String(data).length > 45 * 1024 * 1024) return json(413, { error: 'Este correo archivado es demasiado grande para abrirlo aquí.' })
        const ext = fxExtractBody(data)
        await audit('Lectura de correo del archivo en línea', `Buzón ${uid} · item ${iid.slice(0, 24)}…`)
        if (!ext) return json(200, { ok: true, full: false, bodyType: 'text', body: String(p.preview || '(No se pudo extraer el contenido de este correo archivado.)') })
        return json(200, { ok: true, full: true, bodyType: ext.bodyType, body: ext.body.slice(0, 3 * 1024 * 1024) })
      }

      // Descargar un correo del archivo como .eml legible: se arma con el encabezado y,
      // cuando la extracción del export lo permite, con el CUERPO COMPLETO del correo.
      if (op === 'archiveEml') {
        const iid = String(p.itemId || '')
        if (!iid) return json(400, { error: 'Falta el correo.' })
        const arch = await archId()
        if (!arch) return json(400, { error: 'Este buzón no tiene archivo en línea.' })
        const exp = encodeURIComponent("singleValueExtendedProperties($filter=id eq 'String 0x0037' or id eq 'String 0x0C1A' or id eq 'String 0x0065' or id eq 'SystemTime 0x0E06' or id eq 'String 0x1000')")
        const r = await fetch(`https://graph.microsoft.com/beta/admin/exchange/mailboxes/${encodeURIComponent(arch)}/items/${encodeURIComponent(iid)}?$expand=${exp}`, { headers: { Authorization: `Bearer ${token}` } })
        const j = await r.json().catch(() => ({}))
        // Si la ruta directa no está disponible, se cae a los datos que ya vinieron en la lista
        const props: Record<string, string> = {}
        for (const sp of (j?.singleValueExtendedProperties ?? [])) {
          const pid = String((sp as any).id || '').toLowerCase()
          if (/0x0?37$/.test(pid)) props.subject = (sp as any).value
          else if (/0x0?c1a$/.test(pid)) props.sender = (sp as any).value
          else if (/0x0?65$/.test(pid)) props.senderAddr = (sp as any).value
          else if (/0x0?e06$/.test(pid)) props.at = (sp as any).value
          else if (/0x0?1000$/.test(pid)) props.body = (sp as any).value
        }
        const subject = props.subject || String(p.subject || '(sin asunto)')
        const senderName = props.sender || String(p.from || '')
        const senderAddr = props.senderAddr || ''
        const when = props.at || String(p.at || '')
        // Cuerpo COMPLETO desde el export FastTransfer (HTML real del correo); si falla, el texto disponible
        let full: { bodyType: string; body: string } | null = null
        try {
          const rx = await fetch(`https://graph.microsoft.com/beta/admin/exchange/mailboxes/${encodeURIComponent(arch)}/exportItems`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemIds: [iid] }),
          })
          const jx = await rx.json().catch(() => ({}))
          const dx = jx.value?.[0]?.data
          if (rx.ok && dx && String(dx).length <= 45 * 1024 * 1024) full = fxExtractBody(dx)
        } catch (e) { console.error('archiveEml: export', String(e)) }
        const bodyTxt = props.body || String(p.preview || '')
        const enc = (s: string) => `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`
        const fromHdr = senderAddr ? `${enc(senderName)} <${senderAddr}>` : enc(senderName || 'desconocido')
        const dateHdr = when ? new Date(when).toUTCString() : new Date().toUTCString()
        const truncated = !full && bodyTxt.length >= 255
        const note = truncated ? '\r\n\r\n----\r\n[Nota: correo recuperado del archivo en línea; solo se pudo obtener el inicio del texto. Para el original con adjuntos usa la Búsqueda de contenido de Purview.]' : ''
        const isHtml = full?.bodyType === 'html'
        const content = full ? full.body : (bodyTxt.replace(/\r?\n/g, '\r\n') + note)
        const eml = [
          `Subject: ${enc(subject)}`,
          `From: ${fromHdr}`,
          `Date: ${dateHdr}`,
          'MIME-Version: 1.0',
          `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`,
          'Content-Transfer-Encoding: 8bit',
          '', content, '',
        ].join('\r\n')
        await audit('Descarga de correo del archivo en línea', `Buzón ${uid} · item ${iid.slice(0, 24)}…`)
        return json(200, { ok: true, eml, truncated })
      }
      // Exportar el original binario (FastTransfer .fts) — respaldo técnico, no se abre en Outlook
      if (op === 'archiveExport') {
        const iid = String(p.itemId || '')
        if (!iid) return json(400, { error: 'Falta el correo.' })
        const arch = await archId()
        if (!arch) return json(400, { error: 'Este buzón no tiene archivo en línea.' })
        const r = await fetch(`https://graph.microsoft.com/beta/admin/exchange/mailboxes/${encodeURIComponent(arch)}/exportItems`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: [iid] }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) return json(r.status, { error: j?.error?.message ?? 'Error al exportar del archivo' })
        const data = j.value?.[0]?.data
        if (!data) return json(500, { error: 'Microsoft no devolvió datos del correo.' })
        if (String(data).length > 35 * 1024 * 1024) return json(413, { error: 'El correo es demasiado grande para exportarlo desde aquí.' })
        await audit('Exportación desde archivo en línea', `Buzón ${uid} · item ${iid.slice(0, 24)}…`)
        return json(200, { ok: true, b64: data })
      }

      if (op === 'mailDownload') {
        const mid = String(p.messageId || '')
        if (!mid) return json(400, { error: 'Falta el correo.' })
        const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(uid)}/messages/${encodeURIComponent(mid)}/$value`, { headers: { Authorization: `Bearer ${token}` } })
        if (!r.ok) return json(r.status, { error: 'No se pudo descargar el correo (' + r.status + ')' })
        const buf = new Uint8Array(await r.arrayBuffer())
        if (buf.byteLength > 25 * 1024 * 1024) return json(413, { error: 'El correo pesa más de 25 MB; descárgalo desde Outlook.' })
        let bin = ''
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        await audit('Descarga de correo', `Buzón ${uid} · mensaje ${mid.slice(0, 24)}…`)
        return json(200, { ok: true, b64: btoa(bin) })
      }

      if (op === 'mailMove') {
        const mid = String(p.messageId || '')
        const dest = String(p.dest || 'archive') // 'archive' | 'deleteditems' | id de carpeta
        if (!mid) return json(400, { error: 'Falta el correo.' })
        const g = await graph(token, 'POST', `/users/${encodeURIComponent(uid)}/messages/${encodeURIComponent(mid)}/move`, { destinationId: dest })
        if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al mover el correo', detail: g.data })
        return json(200, { ok: true, id: g.data?.id ?? null })
      }

      if (op === 'mailDelete') {
        const mid = String(p.messageId || '')
        if (!mid) return json(400, { error: 'Falta el correo.' })
        if (p.permanent === true) {
          const g = await graph(token, 'DELETE', `/users/${encodeURIComponent(uid)}/messages/${encodeURIComponent(mid)}`)
          if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al eliminar', detail: g.data })
          await audit('Eliminación definitiva de correo', `Buzón ${uid} · mensaje ${mid.slice(0, 24)}…`)
        } else {
          const g = await graph(token, 'POST', `/users/${encodeURIComponent(uid)}/messages/${encodeURIComponent(mid)}/move`, { destinationId: 'deleteditems' })
          if (!g.ok) return json(g.status, { error: g.data?.error?.message ?? 'Error al eliminar', detail: g.data })
          await audit('Correo enviado a Elementos eliminados', `Buzón ${uid} · mensaje ${mid.slice(0, 24)}…`)
        }
        return json(200, { ok: true })
      }
    }

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
          // Directo sobre profiles: la RPC de administración exige un admin con sesión y aquí no la hay
          const { error: upErr } = await admin.from('profiles').update({
            full_name: displayName,
            department: p.department || '',
            role: p.role || 'user',
            phone: p.mobilePhone || null,
            country: p.country || 'Chile',
            app_access: p.appAccess !== false,
          }).eq('id', appUserId)
          if (upErr) console.error('ms-users: perfil', upErr.message)
        }
      } catch (e) { console.error('ms-users: sync app', String(e)) }
      // Ficha en "Correos y cuentas" (registro de accesos), sin contraseña: se completa a mano
      try {
        const { data: sec } = await admin.from('equipment_sections').select('id').eq('name', 'Correos y cuentas').maybeSingle()
        if (sec?.id) {
          const { data: dup } = await admin.from('equipment').select('id').eq('section_id', sec.id).eq('assigned_to_email', String(userPrincipalName).toLowerCase()).is('returned_at', null).maybeSingle()
          if (!dup) await admin.from('equipment').insert({
            name: 'Cuenta · ' + displayName, section_id: sec.id, condition: 'Bueno',
            assigned_to_name: displayName, assigned_to_email: String(userPrincipalName).toLowerCase(),
            attributes: { usuario: String(userPrincipalName).toLowerCase() },
          })
        }
      } catch (e) { console.error('ms-users: ficha correos', String(e)) }
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
          const { data: pr } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
          if (pr) {
            const patch2: Record<string, unknown> = {}
            if (p.displayName !== undefined) patch2.full_name = p.displayName
            if (p.department !== undefined) patch2.department = p.department || ''
            if (p.mobilePhone !== undefined) patch2.phone = p.mobilePhone || null
            if (p.country !== undefined && p.country !== null) patch2.country = p.country
            if (Object.keys(patch2).length) {
              const { error: upErr2 } = await admin.from('profiles').update(patch2).eq('id', pr.id)
              if (upErr2) console.error('ms-users: perfil update', upErr2.message)
            }
          }
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
      // Una cuenta recién creada tarda unos segundos en propagarse en Graph ("does not exist"):
      // se reintenta hasta ~25 s antes de rendirse.
      const enc = encodeURIComponent(id)
      const notReady = (st: number, d: unknown) => st === 404 || String((d as any)?.error?.message || '').includes('does not exist')
      let last: { status: number; data: unknown } | null = null
      for (let i = 0; i < 7; i++) {
        const gu = await graph(token, 'GET', `/users/${enc}?$select=usageLocation`)
        if (gu.ok) {
          if (!gu.data?.usageLocation) {
            await graph(token, 'PATCH', `/users/${enc}`, { usageLocation: p.usageLocation || DEFAULT_USAGE })
          }
          const g = await graph(token, 'POST', `/users/${enc}/assignLicense`, { addLicenses: [{ skuId, disabledPlans: [] }], removeLicenses: [] })
          if (g.ok) return json(200, { ok: true, tries: i + 1 })
          last = g
          if (!notReady(g.status, g.data)) break
        } else {
          last = gu
          if (!notReady(gu.status, gu.data)) break
        }
        await new Promise((res) => setTimeout(res, 4000))
      }
      const msg = (last as any)?.data?.error?.message ?? 'Error al asignar la licencia'
      return json((last as any)?.status ?? 500, { error: msg + ' — si la cuenta es recién creada, espera 1–2 minutos y asígnala desde su ficha.', detail: (last as any)?.data })
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
