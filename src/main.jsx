import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import DialogHost from './components/DialogHost'
import ImageViewer from './components/ImageViewer'
import './styles.css'

// Captura cualquier error del callback de OAuth ANTES de que Supabase consuma la URL
try {
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const err = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error')
  if (err) sessionStorage.setItem('authError', err)
} catch (e) { /* noop */ }

// Tras cada despliegue, los navegadores con la app anterior en memoria piden
// archivos que ya no existen y las páginas "no cargan". Vite avisa con este
// evento: recargamos una sola vez para tomar la versión nueva.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('bc-reloaded') === '1') return   // evita un bucle si el problema es otro
    sessionStorage.setItem('bc-reloaded', '1')
    event.preventDefault()
    window.location.reload()
  } catch { /* noop */ }
})
setTimeout(() => { try { sessionStorage.removeItem('bc-reloaded') } catch { /* noop */ } }, 5000)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider><App /><DialogHost /><ImageViewer /></AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
