// Control de orden: menú de criterio + flecha para invertir (ascendente/descendente)
export default function SortControl({ fields, field, dir, onField, onToggleDir }) {
  return (
    <span className="sort-ctl" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
      Ordenar:
      <select value={field} onChange={(e) => onField(e.target.value)}>
        {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      <button type="button" className="btn-sm" title={dir === 'asc' ? 'Ascendente — clic para invertir' : 'Descendente — clic para invertir'}
        onClick={onToggleDir} style={{ padding: '.15rem .45rem', lineHeight: 1 }}>
        {dir === 'asc' ? '↓' : '↑'}
      </button>
    </span>
  )
}
