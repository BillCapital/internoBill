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
  const { profile, role, roleLabel, isAdmin, refreshProfile } = useAuth()
  const [equipos, setEquipos] = useState([])
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const fileRef = useRef(null)

  // Estado del recortador
  const [cropImg, setCropImg] = useState(null) // HTMLImageElement
  const [scale, setScale] = useState(1)
  const [minScale, setMinScale] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef(null)

  useEffect(() => { setPhone(profile?.phone || '') }, [profile?.phone])
  useEffect(() => {
    if (isAdmin) return
    supabase.from('equipment').select('id,name,brand,model,serial_number,location,condition').is('returned_at', null)
      .then(({ data }) => setEquipos(data ?? []))
  }, [isAdmin])

  const savePhone = async () => {
    setSaving(true)
    try { await api('set_my_phone', { p_phone: phone.trim() }); await refreshProfile() } catch (e) { alertDialog(e.message) } finally { setSaving(false) }
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
  const dirty = (phone || '') !== (profile?.phone || '')
  const avatar = profile?.avatar_url
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
            <div className="qc phone-edit">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+56 9 ..." />
              <button className="btn-sm btn-lime" onClick={savePhone} disabled={!dirty || saving}>{saving ? '…' : 'Guardar'}</button>
            </div>
          </div>
          <div className="pf-field"><label>Departamento</label><div className="val">{profile?.department || '—'} {role !== 'admin' && <span className="lock"><Icon n="lock" /> fijo</span>}</div></div>
          <div className="pf-field"><label>Rol</label><div className="val">{roleLabel}</div></div>
        </div>
        <p className="muted" style={{ marginTop: '.7rem' }}>Puedes actualizar tu teléfono y tu foto cuando quieras. El departamento lo asigna un administrador.</p>
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

      {!isAdmin && (
        <div className={`section ${open ? 'open' : ''}`} style={{ marginTop: '1.2rem' }}>
          <button className="sec-head compact" onClick={() => setOpen((v) => !v)}>
            <span className="ico"><Icon n="monitor" /></span><span className="t"><strong>Mis equipos asignados</strong><br /><span className="muted">{equipos.length} equipos · toca para {open ? 'ocultar' : 'ver'}</span></span><span className="chev">▾</span>
          </button>
          {open && <div className="sec-body">
            {equipos.length === 0 ? <div className="empty">No tienes equipos asignados.</div> : (
              <table><thead><tr><th>Equipo</th><th>Serie</th><th>Ubicación</th><th>Estado</th></tr></thead>
                <tbody>{equipos.map((e) => <tr key={e.id}><td><strong>{e.name}</strong> {e.brand} {e.model}</td><td>{e.serial_number}</td><td>{e.location}</td><td><span className="badge">{e.condition}</span></td></tr>)}</tbody>
              </table>
            )}
          </div>}
        </div>
      )}
    </div>
  )
}
