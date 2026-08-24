import { useState, useRef, useEffect } from 'react'

// Botón "Filtrar" con panel desplegable. `active` resalta cuando hay filtros aplicados.
// Los campos de filtro se pasan como children.
export default function FilterControl({ active, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <span className="filter-ctl" ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className={`btn-sm ${active ? 'btn-lime' : ''}`} onClick={() => setOpen((o) => !o)}>
        ⣿ Filtrar ▾
      </button>
      {open && <div className="filter-pop">{children}</div>}
    </span>
  )
}
