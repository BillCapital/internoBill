import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { user, loading, signInMicrosoft } = useAuth()
  if (loading) return <div className="page-loader">Cargando…</div>
  if (user) return <Navigate to="/" replace />
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="mark">B</div>
        <h1>BillCapital · Sistema Interno</h1>
        <p className="muted">Inicia sesión con tu cuenta corporativa</p>
        <div className="role-btns">
          <button className="role-btn" style={{ borderColor: 'var(--lime)' }} onClick={signInMicrosoft}>
            <span className="ico">🔐</span>
            <span><strong>Continuar con Microsoft 365</strong><span className="muted">Con tu cuenta @billcapital.com</span></span>
          </button>
        </div>
        <p className="hint muted">Acceso restringido al dominio corporativo. El departamento se define al registrarte y solo lo cambia un administrador.</p>
      </div>
    </div>
  )
}
