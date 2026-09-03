import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { confirmDialog, alertDialog } from '../lib/ui'
import { Icon } from '../lib/icons'

const initials = (n) => (n || '?').split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase()
const VIEW = 260   // tamaño del recuadro de recorte en pantalla
const OUT = 200    // tamaño final exportado (px)

export default function Perfil() {
  const { profile, role, roleLabel, isAdmin, patchProfile, refreshProfile } = useAuth()
  const [equipos, setEquipos] = useState([])
  const [form, setForm] = useState({ phone: '', work_mode: '', emergency_name: '', emergency_phone: '', birth_day: '', birth_month: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const fileRef = useRef(null)

  // Estado del recortador
  const [cropImg, setCropImg] = useState(null) // HTMLImageElement
  const [scale, setScale] = useState(1)
  const [minScale, setMinScale] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef(null)

  useEffect(() => {
    setForm({
      phone: profile?.phone || '',
      work_mode: profile?.work_mode || '',
      emergency_name: profile?.emergency_name || '',
      emergency_phone: profile?.emergency_phone || '',
      birth_day: profile?.birth_day || '',
      birth_month: profile?.birth_month || '',
    })
  }, [profile?.phone, profile?.work_mode, profile?.emergency_name, profile?.emergency_phone, profile?.birth_day, profile?.birth_month])
  // Equipos asignados a MÍ. El dueño actual es el user_id; el correo asignado solo se usa
  // como respaldo cuando el equipo aún no tiene user_id. Así, si un equipo se reasigna a otra
  // persona (cambia el user_id), deja de aparecerle al dueño anterior aunque el correo viejo siga.
  useEffect(() => {
    if (!profile?.id && !profile?.email) return
    const conds = []
    if (profile?.id) conds.push(`user_id.eq.${profile.id}`)
    if (profile?.email) conds.push(`and(user_id.is.null,assigned_to_email.ilike.${profile.email})`)
    let q = supabase.from('equipment').select('id,name,brand,model,serial_number,location,condition').is('returned_at', null).order('name')
    if (conds.length) q = q.or(conds.join(','))
    q.then(({ data }) => setEquipos(data ?? []))
  }, [profile?.id, profile?.email])

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const saveProfile = async () => {
    setSaving(true); setSaved(false)
    const fields = {
      phone: (form.phone || '').trim(),
      work_mode: form.work_mode || '',
      emergency_name: (form.emergency_name || '').trim(),
      emergency_phone: (form.emergency_phone || '').trim(),
      birth_day: form.birth_day ? Number(form.birth_day) : null,
      birth_month: form.birth_month ? Number(form.birth_month) : null,
    }
    try {
      await api('save_my_profile', {
        p_phone: fields.phone, p_work_mode: fields.work_mode,
        p_emergency_name: fields.emergency_name, p_emergency_phone: fields.emergency_phone,
        p_birth_day: fields.birth_day, p_birth_month: fields.birth_month,
      })
      // Actualización local instantánea (sin recargar roles/deptos)
      patchProfile(fields)
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch (e) { alertDialog(e.message) } finally { setSaving(false) }
  }

  const onPickFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return
    if (!file.type.startsWith('image/')) { alertDialog('Selecciona una imagen.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const base = VIEW / Math.min(img.width, img.height) // escala mínima que cubre el círculo
        setCropImg(img); setMinScale(base); setScale(base); setOff({ x: 0, y: 0 })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  // Límites para que el círculo quede siempre cubierto por la imagen
  const clampOff = useCallback((o, sc) => {
    if (!cropImg) return o
    const w = cropImg.width * sc, h = cropImg.height * sc
    const mx = Math.max(0, (w - VIEW) / 2), my = Math.max(0, (h - VIEW) / 2)
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) }
  }, [cropImg])

  const onDown = (e) => { const p = e.touches ? e.touches[0] : e; drag.current = { x: p.clientX, y: p.clientY, off: { ...off } } }
  const onMove = (e) => {
    if (!drag.current) return
    const p = e.touches ? e.touches[0] : e
    setOff(clampOff({ x: drag.current.off.x + (p.clientX - drag.current.x), y: drag.current.off.y + (p.clientY - drag.current.y) }, scale))
  }
  const onUp = () => { drag.current = null }
  const onZoom = (v) => { const sc = Number(v); setScale(sc); setOff((o) => clampOff(o, sc)) }

  const confirmCrop = async () => {
    if (!cropImg) return
    setAvatarSaving(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = OUT; canvas.height = OUT
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#1e222b'; ctx.fillRect(0, 0, OUT, OUT)
      ctx.save()
      ctx.beginPath(); ctx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2); ctx.clip()
      const k = OUT / VIEW
      const w = cropImg.width * scale * k, h = cropImg.height * scale * k
      const x = (OUT - w) / 2 + off.x * k, y = (OUT - h) / 2 + off.y * k
      ctx.drawImage(cropImg, x, y, w, h)
      ctx.restore()
      const url = canvas.toDataURL('image/png')
      await api('set_my_avatar', { p_url: url }); await refreshProfile(); setCropImg(null)
    } catch (er) { alertDialog(er.message || 'No se pudo recortar la imagen.') } finally { setAvatarSaving(false) }
  }

  const removeAvatar = async () => {
    if (!(await confirmDialog('¿Quitar tu foto de perfil?', { title: 'Quitar foto', danger: true, okText: 'Quitar' }))) return
    setAvatarSaving(true)
    try { await api('set_my_avatar', { p_url: '' }); await refreshProfile() } catch (e) { alertDialog(e.message) } finally { setAvatarSaving(false) }
  }

  const name = profile?.full_name || profile?.email || '—'
  const dirty = ['phone', 'work_mode', 'emergency_name', 'emergency_phone', 'birth_day', 'birth_month']
    .some((k) => String(form[k] ?? '') !== String(profile?.[k] ?? ''))
  const avatar = profile?.avatar_url
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const dispW = cropImg ? cropImg.width * scale : 0, dispH = cropImg ? cropImg.height * scale : 0

  return (
    <div>
      <div className="page-head"><h2>Mi perfil</h2></div>
      <div className="pf-card">
        <div className="pf-top">
          <div className="avatar-edit">
            {avatar ? <img className="big-avatar" src={avatar} alt="Foto de perfil" /> : <div className="big">{initials(name)}</div>}
            <button className="avatar-cam" title="Cambiar foto" onClick={() => fileRef.current?.click()} disabled={avatarSaving}>{avatarSaving ? '…' : <Icon n="camera" />}</button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
          </div>
          <div>
            <h3 style={{ margin: '.1em 0' }}>{name}</h3>
            <span className="muted">{roleLabel}</span>
            <div style={{ marginTop: '.4rem', display: 'flex', gap: '.4rem' }}>
              <button className="btn-sm" onClick={() => fileRef.current?.click()} disabled={avatarSaving}>{avatar ? 'Cambiar foto' : 'Subir foto'}</button>
              {avatar && <button className="btn-sm btn-danger" onClick={removeAvatar} disabled={avatarSaving}>Quitar</button>}
            </div>
          </div>
        </div>

        <h3 style={{ fontSize: '1rem', marginTop: '1rem' }}>Datos personales</h3>
        <div className="pf-fields">
          <div className="pf-field"><label>Correo electrónico</label><div className="val">{profile?.email}</div></div>
          <div className="pf-field"><label>Teléfono</label>
            <input value={form.phone} onChange={(e) => setF('phone', e.target.value)} placeholder="+56 9 ..." />
          </div>
          <div className="pf-field"><label>Modalidad de trabajo</label>
            <select value={form.work_mode} onChange={(e) => setF('work_mode', e.target.value)}>
              <option value="">— Sin definir</option>
              <option>Presencial</option>
              <option>Híbrido</option>
              <option>Remoto</option>
            </select>
          </div>
          <div className="pf-field"><label>Cumpleaños</label>
            <div className="qc" style={{ gap: '.4rem' }}>
              <select value={form.birth_day} onChange={(e) => setF('birth_day', e.target.value)} style={{ flex: '0 0 90px' }}>
                <option value="">Día</option>
                {Array.from({ length: 31 }).map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
              <select value={form.birth_month} onChange={(e) => setF('birth_month', e.target.value)} style={{ flex: 1 }}>
                <option value="">Mes</option>
                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="pf-field"><label>Contacto de emergencia · nombre</label>
            <input value={form.emergency_name} onChange={(e) => setF('emergency_name', e.target.value)} placeholder="Ej: María Pérez (madre)" />
          </div>
          <div className="pf-field"><label>Contacto de emergencia · teléfono</label>
            <input value={form.emergency_phone} onChange={(e) => setF('emergency_phone', e.target.value)} placeholder="+56 9 ..." />
          </div>
          <div className="pf-field"><label>Departamento</label><div className="val">{profile?.department || '—'} {!isAdmin && <span className="lock"><Icon n="lock" /> fijo</span>}</div></div>
          <div className="pf-field"><label>Rol</label><div className="val">{roleLabel}</div></div>
        </div>
        <div className="row" style={{ marginTop: '.9rem', justifyContent: 'flex-end' }}>
          <button className={`btn ${saved ? 'btn-ok' : 'btn-lime'}`} onClick={saveProfile}
            disabled={saving || (!dirty && !saved)} style={{ minWidth: 170, justifyContent: 'center' }}>
            {saving ? 'Guardando…' : saved ? '✓ Guardado' : 'Guardar cambios'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: '.5rem' }}>Actualiza tus datos cuando quieras. El departamento y el rol los asigna un administrador.</p>
      </div>

      {/* Recortador circular */}
      {cropImg && (
        <div className="backdrop open">
          <div className="modal" style={{ maxWidth: 360, textAlign: 'center' }}>
            <h3>Recorta tu foto</h3>
            <p className="muted" style={{ marginTop: 0 }}>Arrastra para mover y usa el control para acercar. Se guardará en forma circular.</p>
            <div className={`cropper ${avatarSaving ? 'locked' : ''}`} style={{ width: VIEW, height: VIEW }}
              onMouseDown={avatarSaving ? undefined : onDown} onMouseMove={avatarSaving ? undefined : onMove} onMouseUp={onUp} onMouseLeave={onUp}
              onTouchStart={avatarSaving ? undefined : onDown} onTouchMove={avatarSaving ? undefined : onMove} onTouchEnd={onUp}>
              <img src={cropImg.src} draggable="false" alt="" style={{
                width: dispW, height: dispH, left: (VIEW - dispW) / 2 + off.x, top: (VIEW - dispH) / 2 + off.y, position: 'absolute',
              }} />
              <div className="crop-mask" />
            </div>
            <input type="range" min={minScale} max={minScale * 4} step="0.01" value={scale} onChange={(e) => onZoom(e.target.value)} style={{ width: VIEW, marginTop: '.8rem' }} />
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => setCropImg(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmCrop} disabled={avatarSaving}>{avatarSaving ? 'Guardando…' : 'Guardar foto'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="pf-card pf-eq" style={{ marginTop: '1.2rem' }}>
        <div className="pf-eq-head">
          <span className="ico"><Icon n="monitor" /></span>
          <h3>Mis equipos asignados</h3>
          <span className="pf-eq-count">{equipos.length}</span>
        </div>
        {equipos.length === 0 ? (
          <div className="empty">No tienes equipos asignados.</div>
        ) : (
          <div className="pf-eq-list">
            {equipos.map((e) => (
              <div key={e.id} className="pf-eq-item">
                <span className="pf-eq-ic"><Icon n="monitor" /></span>
                <div className="pf-eq-body">
                  <div className="pf-eq-name"><strong>{e.name}</strong> <span className="muted">{[e.brand, e.model].filter(Boolean).join(' ')}</span></div>
                  <div className="pf-eq-meta">
                    {e.serial_number && <span><span className="muted">Serie:</span> {e.serial_number}</span>}
                    {e.location && <span><span className="muted">Ubicación:</span> {e.location}</span>}
                  </div>
                </div>
                <span className="badge">{e.condition}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
