// Skeletons de carga (rediseño 2026). Ocupan el lugar del contenido real
// mientras se traen los datos, con un brillo animado que recorre las tarjetas.

// Rejilla de tarjetas KPI vacías (misma medida que .kpi-grid.compact.kpi-sm)
export function SkeletonKpis({ n = 6 }) {
  return (
    <div className="kpi-grid compact kpi-sm" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div className="kpi" key={i}>
          <div className="sk sk-ico" />
          <div className="sk sk-num" />
          <div className="sk sk-lbl" />
        </div>
      ))}
    </div>
  )
}

// Filas de lista vacías (tipo .conv / .section con ícono, textos y pill)
export function SkeletonRows({ n = 3, pill = true }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div className="conv" style={{ padding: '.85rem 1rem', marginBottom: '.5rem' }} key={i}>
          <div className="sk-row">
            <div className="sk sk-ico" />
            <div className="sk-txt">
              <div className="sk sk-line" style={{ width: '38%' }} />
              <div className="sk sk-line" style={{ width: '62%' }} />
            </div>
            {pill && <div className="sk sk-pill" />}
          </div>
        </div>
      ))}
    </div>
  )
}

// Filas de tabla vacías (para tablas de Usuarios/Inventario)
export function SkeletonTableRows({ rows = 6, cols = 4 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}><div className="sk sk-line" style={{ width: c === 0 ? '80%' : '55%' }} /></td>
          ))}
        </tr>
      ))}
    </>
  )
}

export default SkeletonKpis
