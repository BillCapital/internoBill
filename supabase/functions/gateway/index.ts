import { createClient } from 'jsr:@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INTERNAL = Deno.env.get('INTERNAL_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function friendly(msg: string): string {
  if (!msg) return 'Error en la solicitud'
  if (msg.includes('no_overlap') || msg.includes('exclusion constraint')) return 'Ese horario ya está reservado por otra reunión aprobada. Elige otro bloque u otra sala.'
  if (msg.includes('validate_reservation_hours') || msg.includes('horario')) return 'El horario está fuera del rango reservable (09:00–13:00 y 15:30–18:00, días hábiles).'
  return msg
}

const RPC_ACTIONS: Record<string, string> = {
  create_request: 'create_request', approve_request: 'approve_request', reject_request: 'reject_request', deliver_request: 'deliver_request',
  manager_approve_request: 'manager_approve_request', manager_reject_request: 'manager_reject_request',
  tech_approve_request: 'tech_approve_request', tech_reject_request: 'tech_reject_request',
  request_product_decide: 'request_product_decide',
  tech_product_add: 'tech_product_add', tech_product_decide: 'tech_product_decide', tech_product_delete: 'tech_product_delete',
  tech_set_budget: 'tech_set_budget', tech_product_set_file: 'tech_product_set_file', touch_seen: 'touch_my_seen',
  create_tech_request: 'create_tech_request', request_attach_add: 'request_attach_add', request_attach_delete: 'request_attach_delete',
  expense_doc_add: 'expense_doc_add', expense_doc_delete: 'expense_doc_delete', expense_doc_set_estado: 'expense_doc_set_estado',
  create_reservation: 'create_reservation', approve_reservation: 'approve_reservation', reject_reservation: 'reject_reservation', cancel_reservation: 'cancel_reservation',
  post_message: 'post_message', create_ticket: 'create_ticket', set_ticket_status: 'set_ticket_status',
  set_user_role: 'set_user_role', set_inventory_access: 'set_inventory_access', set_stock: 'set_stock',
  inventory_upsert: 'inventory_upsert', inventory_delete: 'inventory_delete', room_upsert: 'room_upsert', room_delete: 'room_delete',
  set_category_departments: 'set_category_departments', set_items_departments: 'set_items_departments', set_items_orderable: 'set_items_orderable',
  equipment_upsert: 'equipment_upsert', equipment_delete: 'equipment_delete', section_upsert: 'section_upsert', section_delete: 'section_delete',
  equipment_event_add: 'equipment_event_add', equipment_event_update: 'equipment_event_update', equipment_event_delete: 'equipment_event_delete',
  equipment_maint_add: 'equipment_maint_add', equipment_maint_complete: 'equipment_maint_complete', equipment_maint_delete: 'equipment_maint_delete',
  equipment_add_blank_computers: 'equipment_add_blank_computers', equipment_unassign: 'equipment_unassign', equipment_assign: 'equipment_assign',
  equipment_bulk_update: 'equipment_bulk_update',
  peripheral_upsert: 'peripheral_upsert', peripheral_delete: 'peripheral_delete', peripheral_assign: 'peripheral_assign',
  maint_set_config: 'maint_set_config', maint_set_lote: 'maint_set_lote', maint_set_lotes: 'maint_set_lotes', maint_generate: 'maint_generate', maint_clear: 'maint_clear',
  set_my_phone: 'set_my_phone', set_user_department: 'set_user_department', set_my_avatar: 'set_my_avatar', save_my_profile: 'save_my_profile',
  role_upsert: 'role_upsert', role_delete: 'role_delete', admin_update_user: 'admin_update_user', admin_delete_user: 'admin_delete_user',
  dept_upsert: 'dept_upsert', dept_delete: 'dept_delete', dept_set_users: 'dept_set_users', dept_set_supply_categories: 'dept_set_supply_categories', dept_set_manager: 'dept_set_manager', set_user_active: 'set_user_active',
  announcement_create: 'announcement_create', announcement_delete: 'announcement_delete',
  mark_notification_read: 'mark_notification_read', mark_all_notifications_read: 'mark_all_notifications_read',
  audit_delete: 'audit_delete', activity_delete: 'activity_delete', admin_change_email: 'admin_change_email',
  request_delete: 'request_delete', reservation_delete: 'reservation_delete', ticket_delete: 'ticket_delete',
  my_account_add: 'my_account_add',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authz = req.headers.get('Authorization') ?? ''
    if (!authz.startsWith('Bearer ')) return json(401, { error: 'No autenticado' })

    const asUser = createClient(URL, ANON, { global: { headers: { Authorization: authz } } })
    const { data: { user }, error } = await asUser.auth.getUser()
    if (error || !user) return json(401, { error: 'Sesion invalida' })

    const { action, payload } = await req.json()
    if (!action) return json(400, { error: 'Falta action' })

    if (action === 'check_availability') {
      // Forma y alcance validados en el servidor: el organizador es SIEMPRE quien llama,
      // solo correos del tenant, máximo 15, y ventana horaria válida.
      const p = payload ?? {}
      const organizer = (user.email || '').toLowerCase()
      const okDom = (e: string) => /^[^@\s]+@([a-z0-9-]+\.)*billcapital\.com$/.test(e)
      const emails = Array.isArray(p.emails)
        ? [...new Set(p.emails.filter((e: unknown) => typeof e === 'string').map((e: string) => e.trim().toLowerCase()).filter(okDom))].slice(0, 15)
        : []
      const starts = Date.parse(p.starts_at ?? ''); const ends = Date.parse(p.ends_at ?? '')
      if (!organizer || !okDom(organizer)) return json(200, { data: { busy: [], ok: false } })
      if (!emails.length || !Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts || ends - starts > 24 * 3600 * 1000) {
        return json(200, { data: { busy: [], ok: false } })
      }
      try {
        const resp = await fetch(`${URL}/functions/v1/calendar-availability`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL },
          body: JSON.stringify({ organizer, emails, starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString() }),
        })
        const j = await resp.json().catch(() => ({ busy: [], ok: false }))
        return json(200, { data: j })
      } catch (e) { return json(200, { data: { busy: [], ok: false, error: String(e) } }) }
    }

    if (RPC_ACTIONS[action]) {
      // Antes de cancelar/rechazar/eliminar una reserva, se rescata su evento 365 (después la fila puede no existir)
      let calCancel: { event: string; organizer: string; resId: string } | null = null
      if (['cancel_reservation', 'reject_reservation', 'reservation_delete'].includes(action) && payload?.p_id) {
        try {
          const admin = createClient(URL, SERVICE)
          const { data: rr } = await admin.from('reservations')
            .select('calendar_event_id, profiles!reservations_user_id_fkey(email)')
            .eq('id', payload.p_id).single()
          const ev = (rr as any)?.calendar_event_id, org = (rr as any)?.profiles?.email
          if (ev && org) calCancel = { event: ev, organizer: org, resId: payload.p_id }
        } catch (_) { /* noop */ }
      }
      const { data, error: e } = await asUser.rpc(RPC_ACTIONS[action], payload ?? {})
      if (e) return json(400, { error: friendly(e.message) })
      if (action === 'create_reservation' || action === 'approve_reservation') {
        const resId = action === 'create_reservation' ? data : payload?.p_id
        try { (globalThis as any).EdgeRuntime?.waitUntil(syncCalendar(resId).catch(() => {})) } catch (_) { /* noop */ }
      }
      if (calCancel) {
        try { (globalThis as any).EdgeRuntime?.waitUntil(cancelCalendarEvent(calCancel).catch(() => {})) } catch (_) { /* noop */ }
      }
      return json(200, { data })
    }
    return json(400, { error: 'Accion desconocida' })
  } catch (e) {
    return json(500, { error: 'Error interno del servidor' })
  }
})

async function cancelCalendarEvent(info: { event: string; organizer: string; resId: string }) {
  if (!INTERNAL) return
  await fetch(`${URL}/functions/v1/calendar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL },
    body: JSON.stringify({ op: 'cancel', event_id: info.event, organizer: info.organizer, reservation_id: info.resId }),
  })
}

async function syncCalendar(reservationId: string) {
  if (!reservationId || !INTERNAL) return
  const admin = createClient(URL, SERVICE)
  const { data: r } = await admin.from('reservations')
    .select('status, attendees, profiles!reservations_user_id_fkey(email)')
    .eq('id', reservationId).single()
  if (!r || r.status !== 'approved' || !(r.attendees && r.attendees.length)) return
  await fetch(`${URL}/functions/v1/calendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL },
    body: JSON.stringify({ reservation_id: reservationId }),
  })
  const email = (r as any).profiles?.email
  if (email) {
    try {
      await fetch(`${URL}/functions/v1/calendar-subscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL },
        body: JSON.stringify({ action: 'ensure', email }),
      })
    } catch (_) { /* noop */ }
  }
}
