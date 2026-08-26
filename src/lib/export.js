// Exporta filas a un archivo CSV que Excel abre correctamente:
//  - BOM UTF-8 para que los acentos no se rompan
//  - separador ';' (el que espera Excel en configuración regional es-CL)
// columns: [{ label, value }] donde value es una clave o una función (fila) => valor
export function exportCsv(filename, columns, rows) {
  const sep = ';'
  const esc = (v) => {
    if (v === null || v === undefined) return ''
    let s = String(v)
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const cell = (c, r) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])
  const header = columns.map((c) => esc(c.label)).join(sep)
  const body = (rows || []).map((r) => columns.map((c) => cell(c, r)).join(sep)).join('\r\n')
  const csv = '﻿' + header + '\r\n' + body
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
