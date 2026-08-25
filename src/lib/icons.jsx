// Set de íconos de línea (rediseño 2026 · sin emojis)
// Uso: import { Icon } from '../lib/icons'  →  <Icon n="clock" />
// Todos heredan color vía stroke:currentColor y se dimensionan con la clase contenedora.

const P = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 20 3M17 6l2 2M14 9l2 2" /></>,
  box: <><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></>,
  wrench: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.2-.6-.6-2.2Z" /></>,
  tray: <><path d="M3 12h5l2 3h4l2-3h5" /><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  download: <><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" /></>,
  alert: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17.5v.5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.5-3.3 3-5 5.5-5s5 1.7 5.5 5" /><path d="M17 8.5a3 3 0 0 1 0 5" /><path d="M18.5 20c-.2-2-1-3.4-2.3-4.3" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-3.6 3.3-6 7-6s6.4 2.4 7 6" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  pin: <><path d="M12 21s7-6.3 7-11a7 7 0 0 0-14 0c0 4.7 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2Z" /><path d="M8 3v18" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
  chat: <><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2Z" /></>,
  hourglass: <><path d="M6 3h12M6 21h12M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9" /></>,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  inbox: <><path d="M3 12h5l2 3h4l2-3h5" /><path d="M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>,
  printer: <><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 17h10v4H7z" /><circle cx="17.5" cy="12" r=".6" /></>,
  mouse: <><rect x="7" y="3" width="10" height="18" rx="5" /><path d="M12 7v3" /></>,
  phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  cpu: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14-4.5L3 9" /><path d="M4 13a8 8 0 0 0 14 4.5L21 15" /><path d="M3 5v4h4M21 19v-4h-4" /></>,
  eye: <><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="2.6" /></>,
  eyeOff: <><path d="M10.5 6.2A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a15 15 0 0 1-3 3.5M6.3 6.4A15 15 0 0 0 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4-.85" /><path d="M9.7 9.9a2.6 2.6 0 0 0 3.6 3.7M3 3l18 18" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="M14 6l4 4" /></>,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  star: <><path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.9 6.7 19.6l1.1-6L3.4 9.4l6-.8L12 3Z" /></>,
  link: <><path d="M9 15l6-6" /><path d="M11 6.5 12.5 5a4 4 0 0 1 5.6 5.6l-1.5 1.5M12.5 17.5 11 19a4 4 0 0 1-5.6-5.6l1.5-1.5" /></>,
  tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
  cart: <><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /><path d="M3 4h2l2.2 11.2a1 1 0 0 0 1 .8h8.4a1 1 0 0 0 1-.8L20 8H6" /></>,
  camera: <><path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h5l1 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><circle cx="12" cy="12.5" r="3.2" /></>,
  upload: <><path d="M12 20V8" /><path d="m7 12 5-5 5 5" /><path d="M5 4h14" /></>,
  file: <><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4" /></>,
  save: <><path d="M5 3h11l3 3v15H5V3Z" /><path d="M8 3v5h7M8 21v-6h8v6" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m5 18 5-5 4 3 2-2 3 3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.8 5.8 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.8-3.8-9S9.5 5.5 12 3Z" /></>,
  dice: <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1" /><circle cx="15" cy="15" r="1" /><circle cx="12" cy="12" r="1" /></>,
  send: <><path d="M4 12 21 4l-7 17-3-7-7-2Z" /></>,
  clipboard: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2H9V4Z" /></>,
  chip: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  megaphone: <><path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1Z" /><path d="M18 9a3 3 0 0 1 0 6" /></>,
  wifi: <><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8 15.5a5 5 0 0 1 8 0" /><circle cx="12" cy="19" r=".6" /></>,
}

// Elige un ícono de línea para una sección/equipo guardado en BD (evita emojis)
export function sectionIconName(name = '') {
  const s = (name || '').toLowerCase()
  if (/comput|laptop|note|\bpc\b|equipo/.test(s)) return 'monitor'
  if (/impres|printer/.test(s)) return 'printer'
  if (/monitor|pantalla/.test(s)) return 'monitor'
  if (/perif|mouse|tecla|rat[oó]n/.test(s)) return 'mouse'
  if (/tel[eé]f|phone|cel|m[oó]vil|sim/.test(s)) return 'phone'
  if (/correo|mail|cuenta|email|outlook/.test(s)) return 'mail'
  if (/wifi|wi-fi|red inal|inalamb/.test(s)) return 'wifi'
  if (/stock|insumo|almac/.test(s)) return 'layers'
  if (/servicio|servidor|server/.test(s)) return 'gear'
  if (/clave|acces|cred|contrase|password/.test(s)) return 'lock'
  if (/red|network/.test(s)) return 'cpu'
  return 'box'
}

export function Icon({ n, size }) {
  return (
    <svg className="licon" viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {P[n] || null}
    </svg>
  )
}

export default Icon
