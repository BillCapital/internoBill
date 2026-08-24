// Convierte un archivo de imagen a data URL redimensionado (para no llenar la base de datos)
export function fileToResizedDataURL(file, max = 480, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) { reject(new Error('Selecciona una imagen válida.')); return }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
        const c = document.createElement('canvas'); c.width = w; c.height = h
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h)
        try { resolve(c.toDataURL('image/jpeg', quality)) } catch (e) { reject(e) }
      }
      img.onerror = () => reject(new Error('No se pudo leer la imagen.'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })
}

// Lee una imagen del portapapeles del sistema (para el botón "Pegar").
// Devuelve un Blob de imagen o lanza un error legible.
export async function readClipboardImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    throw new Error('Tu navegador no permite leer el portapapeles. Usa Ctrl+V sobre el recuadro de la imagen.')
  }
  let items
  try { items = await navigator.clipboard.read() } catch (e) {
    throw new Error('No se pudo acceder al portapapeles. Permite el acceso o usa Ctrl+V sobre el recuadro.')
  }
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith('image/'))
    if (type) return await it.getType(type)
  }
  throw new Error('No hay ninguna imagen en el portapapeles.')
}

// Extrae un archivo de imagen desde un evento onPaste (Ctrl+V). Devuelve File o null.
export function imageFromPasteEvent(ev) {
  const items = ev.clipboardData?.items || []
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) return it.getAsFile()
  }
  return null
}
