import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Icon } from '../lib/icons'

// Recordatorio para completar el perfil. Aparece una vez por sesión si faltan datos clave.
// Es un recordatorio (se puede posponer con "Ahora no"), no bloquea.
export default function ProfilePrompt() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('pf-prompt-dismiss') === '1' } catch { return false }
  })

  if (!profile || dismissed) return null

  const missing = []
  if (!profile.phone) missing.push('teléfono')
  if (!profile.work_mode) missing.push('modalidad de trabajo')
  if (!profile.emergency_phone) missing.push('contacto de emergencia')
  if (!profile.birth_month) missing.push('cumpleaños')
  if (!missing.length) return null

  const close = () => { try { sessionStorage.setItem('pf-prompt-dismiss', '1') } catch { /* noop */ } setDismissed(true) }

  return (
    <div className="backdrop open">
      <div className="modal" style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.4rem' }}>
          <span style={{ color: 'var(--lime)', display: 'flex' }}><Icon n="user" /></span>
          <h3 style={{ margin: 0 }}>Completa tu perfil</h3>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Nos faltan algunos datos tuyos: <strong style={{ color: 'var(--text)' }}>{missing.join(', ')}</strong>. Tomarte un minuto ayuda a mantener la información del equipo al día.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={close}>Ahora no</button>
          <button className="btn btn-primary" onClick={() => { close(); nav('/perfil') }}>Completar ahora</button>
        </div>
      </div>
    </div>
  )
}
