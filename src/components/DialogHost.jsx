import { useState, useEffect, useRef } from 'react'
import { _bindDialog } from '../lib/ui'

// Renderiza los diálogos de confirmación / entrada / aviso con la estética de la app.
export default function DialogHost() {
  const [d, setD] = useState(null)
  const [val, setVal] = useState('')
  const res = useRef(null)

  useEffect(() => {
    _bindDialog((opts) => new Promise((resolve) => { res.current = resolve; setVal(opts.defaultValue || ''); setD(opts) }))
  }, [])

  if (!d) return null
  const isPrompt = d.type === 'prompt', isAlert = d.type === 'alert'
  const done = (r) => { setD(null); const f = res.current; res.current = null; if (f) f(r) }
  const onOk = () => done(isPrompt ? val : isAlert ? undefined : true)
  const onCancel = () => done(isPrompt ? null : false)

  return (
    <div className="backdrop open" style={{ zIndex: 80 }} onMouseDown={(e) => { if (e.target === e.currentTarget && !isAlert) onCancel() }}>
      <div className="modal dlg" style={{ maxWidth: 430 }}>
        <h3>{d.title || (isAlert ? 'Aviso' : isPrompt ? 'Escribe un valor' : 'Confirmar acción')}</h3>
        {d.message && <p className="dlg-msg">{d.message}</p>}
        {isPrompt && (
          <input autoFocus value={val} placeholder={d.placeholder || ''}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel() }} />
        )}
        <div className="modal-actions">
          {!isAlert && <button className="btn" onClick={onCancel}>{d.cancelText || 'Cancelar'}</button>}
          <button className={`btn ${d.danger ? 'btn-danger' : 'btn-primary'}`} onClick={onOk}>{d.okText || 'Aceptar'}</button>
        </div>
      </div>
    </div>
  )
}
