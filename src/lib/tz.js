// Zonas horarias por país (para reuniones entre países)
export const TZ_BY_COUNTRY = { Chile: 'America/Santiago', Colombia: 'America/Bogota', 'Perú': 'America/Lima', Peru: 'America/Lima' }
export const DEFAULT_TZ = 'America/Santiago'
export const tzOf = (country) => TZ_BY_COUNTRY[country] || DEFAULT_TZ
export const countryOfTz = (tz) => Object.keys(TZ_BY_COUNTRY).find((c) => TZ_BY_COUNTRY[c] === tz) || 'Chile'
// Hora HH:MM de una fecha en una zona
export const fmtTz = (dt, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(dt)
// Fecha corta dd/mm en una zona (para cuando el cambio de zona cruza medianoche)
export const fmtDayTz = (dt, tz) => new Intl.DateTimeFormat('es-CL', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(dt)
// Diferencia en horas de tzB respecto a tzA para una fecha dada (ej. Bogotá vs Santiago = -2 en horario de verano chileno)
export function tzDiffHours(tzA, tzB, dt = new Date()) {
  const parts = (tz) => {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const o = Object.fromEntries(f.formatToParts(dt).map((p) => [p.type, p.value]))
    return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute)
  }
  return Math.round(((parts(tzB) - parts(tzA)) / 3600000) * 2) / 2
}
export const diffLabel = (h) => (h === 0 ? 'misma hora' : `${h > 0 ? '+' : '−'}${Math.abs(h)} h`)
// Rango "HH:MM–HH:MM" en una zona; agrega el día si cambia respecto a la zona base
export function rangeTz(start, end, tz, baseTz) {
  const s = fmtTz(start, tz), e = fmtTz(end, tz)
  const dayDiff = baseTz && fmtDayTz(start, tz) !== fmtDayTz(start, baseTz) ? ` (${fmtDayTz(start, tz)})` : ''
  return `${s}–${e}${dayDiff}`
}
