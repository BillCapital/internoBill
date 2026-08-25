import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Chat from '../components/Chat'
import ActivityLog from '../components/ActivityLog'
import { confirmDialog, alertDialog } from '../lib/ui'
import { Icon } from '../lib/icons'

const SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '15:30', '16:00', '16:30', '17:00', '17:30']
const LUNCH_AFTER = 8
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const isWknd = (ds) => { const d = new Date(ds + 'T12:00:00').getDay(); return d === 0 || d === 6 }
const slotStart = (ds, t) => new Date(`${ds}T${t}:00`)
const addMin = (dt, m) => new Date(dt.getTime() + m * 60000)
const hhmm = (dt) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`
const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
const dayLong = (ds) => new Date(ds + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
const emptyRoom = { name: '', location: '', capacity: 4, description: '', is_active: true }
// Fecha y hora ACTUAL en Santiago de Chile (independiente de la zona del navegador)
const nowSCL = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const o = {}; p.forEach((x) => { o[x.type] = x.value })
  const hh = o.hour === '24' ? 0 : Number(o.hour)
  return { date: `${o.year}-${o.month}-${o.day}`, min: hh * 60 + Number(o.minute) }
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

export default function Rooms() {
  const { profile, canManageRooms, isSuper } = useAuth()
  const now = new Date()
  const [calY, setCalY] = useState(now.getFullYear())
  const [calM, setCalM] = useState(now.getMonth())
  const [calDay, setCalDay] = useState('') // sin día elegido: la sección de horas no se muestra hasta seleccionar
  const salRightRef = useRef(null)
  // En móvil, al elegir un día, desplaza a la sección de horas para agendar
  useEffect(() => {
    if (calDay && !isWknd(calDay) && window.innerWidth <= 760) {
      const t = setTimeout(() => salRightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 90)
      return () => clearTimeout(t)
    }
  }, [calDay])
  const [rooms, setRooms] = useState([])
  const [res, setRes] = useState([])
  const [openRes, setOpenRes] = useState(null)
  const [form, setForm] = useState(null) // {room, slotIdx}
  const [manageRooms, setManageRooms] = useState(false)
  const [roomEdit, setRoomEdit] = useState(null) // sala en edición/creación
  const [users, setUsers] = useState([])         // perfiles para convocar
  const [extAtt, setExtAtt] = useState('')       // correo externo manual

  const load = useCallback(async () => {
    const [{ data: rms }, { data: rs }, { data: us }] = await Promise.all([
      supabase.from('rooms').select('id,name,location,capacity,description,is_active').eq('is_active', true).order('name'),
      supabase.from('reservations').select('id,room_id,title,starts_at,ends_at,status,justification,user_id,profiles!reservations_user_id_fkey(full_name,email)').neq('status', 'cancelled').neq('status', 'rejected'),
      supabase.from('profiles').select('id,full_name,email,app_access').order('full_name'),
    ])
    setRooms(rms ?? []); setRes(rs ?? []); setUsers((us ?? []).filter((u) => u.app_access !== false))
  }, [])
  useEffect(() => { load() }, [load])

  const dayRes = useMemo(() => res.filter((r) => calDay && r.starts_at.slice(0, 10) === calDay), [res, calDay])
  const resAt = (roomId, t) => {
    const s = slotStart(calDay, t)
    return dayRes.find((r) => r.room_id === roomId && new Date(r.starts_at).getTime() === s.getTime())
  }
  const covered = (roomId, t) => {
    const s = slotStart(calDay, t).getTime()
    return dayRes.some((r) => r.room_id === roomId && new Date(r.starts_at).getTime() <= s && s < new Date(r.ends_at).getTime())
  }
  const durSlots = (r) => Math.round((new Date(r.ends_at) - new Date(r.starts_at)) / 1800000)

  const maxDur = (roomId, idx) => {
    const blockEnd = idx < LUNCH_AFTER ? LUNCH_AFTER : SLOTS.length
    let firstBusy = blockEnd
    for (let j = idx + 1; j < blockEnd; j++) { if (covered(roomId, SLOTS[j])) { firstBusy = j; break } }
    return Math.min(6, blockEnd - idx, firstBusy - idx)
  }

  // Ventana horaria (ISO) de la reserva en edición
  const resWindow = (f) => { const start = slotStart(calDay, SLOTS[f.slotIdx]); const end = addMin(start, f.dur * 30); return { starts_at: start.toISOString(), ends_at: end.toISOString() } }
  const durLabel = (f) => { const mm = f.dur * 30; return mm < 60 ? mm + ' min' : (mm / 60) + ' h' }
  // Consulta a 365 (Graph) qué correos ya tienen algo agendado en ese horario
  const checkBusy = async (emails, f) => {
    const list = (emails || []).filter((e) => e && e.includes('@'))
    if (!list.length) return []
    try {
      const { starts_at, ends_at } = resWindow(f)
      const r = await api('check_availability', { organizer: profile?.email, emails: list, starts_at, ends_at })
      return r?.busy || []
    } catch { return [] }
  }

  const submitReserve = async () => {
    const t = SLOTS[form.slotIdx]
    const ns = nowSCL()
    if (calDay < ns.date || (calDay === ns.date && toMin(t) <= ns.min)) return alertDialog('Esa hora ya pasó (hora de Santiago). Elige un horario futuro.')
    const start = slotStart(calDay, t)
    const end = addMin(start, form.dur * 30)
    const attendees = (form.att || []).map((a) => ({ email: a.email, name: a.name || '' }))
    if (form.includeSelf && profile?.email && !attendees.some((a) => a.email.toLowerCase() === profile.email.toLowerCase())) {
      attendees.push({ email: profile.email, name: profile.full_name || profile.email })
    }
    // Aviso final: ¿algún convocado —o quien reserva— ya tiene reunión en ese horario?
    // Se incluye siempre al que agenda, aunque no esté marcado como participante.
    const checkList = [...new Set([...attendees.map((a) => a.email), profile?.email].filter((e) => e && e.includes('@')).map((e) => e.toLowerCase()))]
    if (checkList.length) {
      const busy = await checkBusy(checkList, form)
      if (busy.length) {
        const names = busy.map((em) => {
          if (profile?.email && em.toLowerCase() === profile.email.toLowerCase()) return `${profile.full_name || 'Tú'} (tú, quien reserva)`
          const a = attendees.find((x) => x.email.toLowerCase() === em.toLowerCase())
          return a?.name && a.name !== a.email ? `${a.name} (${em})` : em
        })
        const ok = await confirmDialog(`Estas personas ya tienen una reunión agendada en ese horario:\n\n• ${names.join('\n• ')}\n\n¿Quieres reservar de todos modos o prefieres elegir otro horario?`, { title: 'Reunión en conflicto a esa hora', danger: true, okText: 'Reservar igual', cancelText: 'Elegir otro horario' })
        if (!ok) { setForm(null); setExtAtt(''); return }
      }
    }
    try {
      await api('create_reservation', {
        p_room: form.room, p_starts: start.toISOString(), p_ends: end.toISOString(),
        p_title: form.title || 'Reunión', p_just: form.just || '', p_attendees: attendees,
      })
      setForm(null); setExtAtt(''); load()
    } catch (e) { alertDialog(e.message) }
  }
  // Acción sobre una reserva: cierra al instante, refleja el cambio localmente y reconcilia en segundo plano (tras completar).
  const act = (action, p_id) => {
    setOpenRes(null)
    setRes((rs) => action === 'approve_reservation'
      ? rs.map((r) => (r.id === p_id ? { ...r, status: 'approved' } : r))
      : (['reject_reservation', 'cancel_reservation', 'reservation_delete'].includes(action) ? rs.filter((r) => r.id !== p_id) : rs))
    ;(async () => { try { await api(action, { p_id }) } catch (e) { alertDialog(e.message) } finally { load() } })()
  }

  // gestión de salas (admin / gestora)
  const saveRoom = async () => {
    if (!(roomEdit.name || '').trim()) return alertDialog('Ponle nombre a la sala.')
    try { await api('room_upsert', { p: { ...roomEdit, capacity: Number(roomEdit.capacity) || 1 } }); setRoomEdit(null); load() } catch (e) { alertDialog(e.message) }
  }
  const delRoom = async (r) => {
    if (!(await confirmDialog(`¿Eliminar la sala "${r.name}"?`, { title: 'Eliminar sala', danger: true, okText: 'Eliminar' }))) return
    setRooms((rs) => rs.filter((x) => x.id !== r.id))
    try { await api('room_delete', { p_id: r.id }) } catch (e) { alertDialog(e.message) } finally { load() }
  }

  // calendario mensual
  const startDow = (new Date(calY, calM, 1).getDay() + 6) % 7
  const daysInMonth = new Date(calY, calM + 1, 0).getDate()
  const shift = (n) => { let m = calM + n, y = calY; if (m < 0) { m = 11; y-- } if (m > 11) { m = 0; y++ } setCalM(m); setCalY(y) }

  const openObj = res.find((r) => r.id === openRes)
  const scl = nowSCL()

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Reserva de salas</h2>
          <p className="muted">Reservable 09:00–13:00 y 15:30–18:00 · fines de semana no operativos. {canManageRooms ? 'Aceptas las solicitudes de reserva.' : 'Tu reserva queda pendiente hasta que la acepten.'}</p></div>
        {canManageRooms && <button className="btn btn-lime" onClick={() => setManageRooms((v) => !v)}>Gestionar salas</button>}
      </div></div>

      {canManageRooms && manageRooms && (
        <div className="section open" style={{ marginBottom: '1rem' }}>
          <div className="sec-body">
            <div className="row" style={{ marginBottom: '.6rem' }}>
              <strong>Salas de reunión</strong>
              <button className="btn btn-lime btn-sm" onClick={() => setRoomEdit({ ...emptyRoom })}>＋ Nueva sala</button>
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>Sala</th><th>Ubicación</th><th>Capacidad</th><th></th></tr></thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong>{r.description ? <><br /><span className="muted">{r.description}</span></> : null}</td>
                    <td>{r.location || <span className="muted">—</span>}</td>
                    <td>{r.capacity} pers.</td>
                    <td className="actions">
                      <button className="btn-sm" onClick={() => setRoomEdit(r)}>Editar</button>{' '}
                      <button className="btn-sm btn-danger" onClick={() => delRoom(r)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      <div className="sal-cols">
        <div className="sal-left">
          <div className="cal-head"><button className="cal-nav" onClick={() => shift(-1)}>‹</button><span className="cal-title">{monthName(calY, calM)}</span><button className="cal-nav" onClick={() => shift(1)}>›</button></div>
          <div className="month">
            {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map((d) => <div className="dow" key={d}>{d}</div>)}
            {Array.from({ length: startDow }).map((_, i) => <div className="day other" key={'o' + i}></div>)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const d = i + 1, ds = iso(calY, calM, d), wknd = isWknd(ds), past = ds < scl.date
              const has = res.some((r) => r.starts_at.slice(0, 10) === ds)
              const cl = ['day']; if (wknd) cl.push('wknd'); if (past) cl.push('past'); if (ds === scl.date) cl.push('today'); if (ds === calDay && !wknd && !past) cl.push('sel')
              return <button className={cl.join(' ')} key={ds} disabled={wknd || past} onClick={() => { setCalDay(ds); setForm(null); setOpenRes(null) }}>{d}{has && !wknd ? <span className="dot"></span> : null}</button>
            })}
          </div>
        </div>

        {calDay && !isWknd(calDay) && (
          <div className="sal-right" ref={salRightRef}>
            <>
              <h3 style={{ textTransform: 'capitalize' }}>{dayLong(calDay)}</h3>
              <div style={{ overflowX: 'auto' }}><table className="cal"><thead><tr><th>Bloque</th>{rooms.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
                <tbody>
                  {SLOTS.map((t, idx) => {
                    const end = hhmm(addMin(slotStart(calDay, t), 30))
                    const slotPast = calDay === scl.date && toMin(t) <= scl.min
                    return (
                      <ReservRow key={t} rooms={rooms} label={`${t}–${end}`} lunch={idx === LUNCH_AFTER} past={slotPast}
                        cells={rooms.map((r) => {
                          const b = resAt(r.id, t)
                          const isCov = covered(r.id, t)
                          return { room: r, res: b, covered: isCov, idx, t }
                        })}
                        resAt={resAt} covered={covered} durSlots={durSlots} idx={idx} t={t} slotList={SLOTS}
                        canManageRooms={canManageRooms} profile={profile}
                        onReserve={(room) => { setExtAtt(''); setForm({ room: room.id, slotIdx: idx, dur: Math.min(2, maxDur(room.id, idx)) || 1, maxDur: maxDur(room.id, idx), title: 'Reunión', just: '', att: [], includeSelf: true }) }}
                        onOpen={(id) => setOpenRes(id)} />
                    )
                  })}
                </tbody>
              </table></div>
            </>
          </div>
        )}
      </div>

      {form && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Reservar sala</h3>
            <p className="muted">{dayLong(calDay)} · desde {SLOTS[form.slotIdx]}</p>
            <label>Título</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <label>Duración</label>
            <select value={form.dur} onChange={(e) => setForm({ ...form, dur: Number(e.target.value) })}>
              {Array.from({ length: form.maxDur }).map((_, i) => { const d = i + 1, mm = d * 30; return <option key={d} value={d}>{mm < 60 ? mm + ' min' : (mm / 60) + ' h'}</option> })}
            </select>
            <label>Convocados <span className="muted">— se les crea la cita en su calendario 365</span></label>
            <select value="" onChange={async (e) => {
              const v = e.target.value; if (!v) return
              const u = users.find((x) => x.email === v)
              const nm = u ? (u.full_name || u.email) : v
              setForm((f) => (f.att || []).some((a) => a.email === v) ? f : { ...f, att: [...(f.att || []), { email: v, name: nm }] })
              const busy = await checkBusy([v], form)
              if (busy.length) alertDialog(`${nm} ya tiene una reunión agendada el ${dayLong(calDay)} desde las ${SLOTS[form.slotIdx]} (${durLabel(form)}). Considera elegir otro horario.`, { title: 'Convocado ocupado' })
            }}>
              <option value="">＋ Agregar convocado…</option>
              {users.filter((u) => u.email && !(form.att || []).some((a) => a.email === u.email)).map((u) => (
                <option key={u.id} value={u.email}>{(u.full_name || 'Sin nombre')} — {u.email}</option>
              ))}
            </select>
            <div className="qc" style={{ marginTop: '.4rem', gap: '.4rem' }}>
              <input style={{ flex: 1 }} placeholder="Correo externo…" value={extAtt}
                onChange={(e) => setExtAtt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-ext-att')?.click() } }} />
              <button id="add-ext-att" className="btn-sm" type="button" onClick={() => {
                const v = extAtt.trim().toLowerCase()
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return alertDialog('Escribe un correo válido.')
                setForm((f) => (f.att || []).some((a) => a.email === v) ? f : { ...f, att: [...(f.att || []), { email: v, name: v }] })
                setExtAtt('')
              }}>Agregar</button>
            </div>
            {(form.att || []).length > 0 && (
              <div className="cart-box" style={{ marginTop: '.5rem' }}>
                <div className="cart-head"><span><Icon n="users" /> Convocados</span><span className="cart-count">{form.att.length}</span></div>
                <ul className="cart-list">
                  {form.att.map((a) => (
                    <li key={a.email}><span>{a.name && a.name !== a.email ? `${a.name} · ${a.email}` : a.email}</span>
                      <button className="cart-x" title="Quitar" type="button" onClick={() => setForm((f) => ({ ...f, att: f.att.filter((x) => x.email !== a.email) }))}><Icon n="close" /></button></li>
                  ))}
                </ul>
              </div>
            )}
            <label className="self-chk">
              <input type="checkbox" checked={form.includeSelf} onChange={(e) => setForm({ ...form, includeSelf: e.target.checked })} />
              <span>Incluirme como participante</span>
            </label>
            <p className="self-hint muted">Recibirás la invitación en tu Outlook.</p>
            <label>Justificación (obligatoria)</label>
            <textarea value={form.just} onChange={(e) => setForm({ ...form, just: e.target.value })} placeholder="¿Para qué necesitas la sala?" />
            <div className="modal-actions"><button className="btn" onClick={() => setForm(null)}>Cancelar</button><button className="btn btn-primary" onClick={submitReserve}>Reservar</button></div>
          </div>
        </div>
      )}

      {roomEdit && (
        <div className="backdrop open">
          <div className="modal">
            <h3>{roomEdit.id ? 'Editar sala' : 'Nueva sala'}</h3>
            <div className="pf-fields">
              <div><label>Nombre</label><input value={roomEdit.name} onChange={(e) => setRoomEdit({ ...roomEdit, name: e.target.value })} placeholder="Sala Andes" /></div>
              <div><label>Ubicación</label><input value={roomEdit.location} onChange={(e) => setRoomEdit({ ...roomEdit, location: e.target.value })} placeholder="Piso 3" /></div>
              <div><label>Capacidad</label><input type="number" min="1" value={roomEdit.capacity} onChange={(e) => setRoomEdit({ ...roomEdit, capacity: e.target.value })} /></div>
              <div><label>Descripción</label><input value={roomEdit.description} onChange={(e) => setRoomEdit({ ...roomEdit, description: e.target.value })} placeholder="Proyector, videollamada…" /></div>
            </div>
            <div className="modal-actions"><button className="btn" onClick={() => setRoomEdit(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveRoom}>Guardar</button></div>
          </div>
        </div>
      )}

      {openObj && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Reserva de sala</h3>
            <div className="reqsum"><strong>{openObj.title}</strong> · {openObj.profiles?.full_name || openObj.profiles?.email}
              <span className={`badge ${openObj.status === 'approved' ? 's-approved' : 's-pending'}`} style={{ marginLeft: 6 }}>{openObj.status === 'approved' ? 'Aprobada' : 'Pendiente'}</span>
              <br /><span className="muted">Justificación: {openObj.justification}</span></div>
            <Chat type="reservation" id={openObj.id} />
            <div className="modal-actions">
              {canManageRooms && openObj.status === 'pending' && <>
                <button className="btn btn-lime" onClick={async () => { if (await confirmDialog('¿Aceptar la reserva?', { title: 'Aceptar reserva', okText: 'Aceptar' })) act('approve_reservation', openObj.id) }}>Aceptar</button>
                <button className="btn btn-danger" onClick={async () => { if (await confirmDialog('¿Rechazar la reserva?', { title: 'Rechazar reserva', danger: true, okText: 'Rechazar' })) act('reject_reservation', openObj.id) }}>Rechazar</button>
              </>}
              <button className="btn btn-danger" onClick={async () => { if (await confirmDialog('¿Cancelar la reserva?', { title: 'Cancelar reserva', danger: true, okText: 'Cancelar reserva' })) act('cancel_reservation', openObj.id) }}>Cancelar reserva</button>
              {isSuper && <button className="btn btn-danger" onClick={async () => { if (await confirmDialog('¿Eliminar la reserva por completo? No se puede deshacer.', { title: 'Eliminar reserva', danger: true, okText: 'Eliminar' })) act('reservation_delete', openObj.id) }}><Icon n="trash" /> Eliminar</button>}
              <button className="btn" onClick={() => setOpenRes(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {canManageRooms && <ActivityLog kinds={['Reserva']} title="Registro de reservas" />}
    </div>
  )
}

function ReservRow({ label, lunch, cells, durSlots, canManageRooms, profile, onReserve, onOpen, rooms, past }) {
  return (
    <>
      {lunch && <tr className="lunch"><td>13:00–15:30</td><td colSpan={rooms.length}>Colación (no reservable)</td></tr>}
      <tr className={past ? 'slot-past' : ''}>
        <td>{label}</td>
        {cells.map((c) => {
          if (c.covered && !c.res) return null // cubierto por rowspan de arriba
          if (c.res) {
            const mine = c.res.profiles?.email === profile?.email
            const clas = c.res.status === 'approved' ? 'slot busy' : 'slot pending'
            return <td key={c.room.id} rowSpan={durSlots(c.res)}>
              <button className={clas} style={{ height: '100%', width: '100%' }} onClick={() => (mine || canManageRooms) && onOpen(c.res.id)}>
                {c.res.title}<br /><span className="muted">{c.res.profiles?.full_name || c.res.profiles?.email}{c.res.status === 'pending' ? ' · pend.' : ''}</span>
              </button></td>
          }
          if (past) return <td key={c.room.id}><button className="slot slot-off" disabled title="Hora pasada">—</button></td>
          return <td key={c.room.id}><button className="slot" onClick={() => onReserve(c.room)}>＋</button></td>
        })}
      </tr>
    </>
  )
}
