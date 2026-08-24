import { fileToResizedDataURL, readClipboardImage, imageFromPasteEvent } from '../lib/img'
import { alertDialog, viewImage } from '../lib/ui'

// Recuadro para elegir/pegar una imagen. Soporta: archivo, botón "Pegar" (portapapeles)
// y Ctrl+V directo sobre el recuadro. Llama onChange(dataUrl) o onChange('') al quitar.
export default function ImagePicker({ value, onChange, max = 480, zoom = false }) {
  const setFromFile = async (f) => {
    if (!f) return
    try { onChange(await fileToResizedDataURL(f, max)) } catch (e) { alertDialog(e.message) }
  }
  const pasteBtn = async () => {
    try { const blob = await readClipboardImage(); onChange(await fileToResizedDataURL(blob, max)) } catch (e) { alertDialog(e.message) }
  }
  const onPaste = (ev) => {
    const f = imageFromPasteEvent(ev)
    if (f) { ev.preventDefault(); setFromFile(f) }
  }
  return (
    <div className="img-pick" tabIndex={0} onPaste={onPaste} title="Puedes pegar una imagen con Ctrl+V">
      {value
        ? <img className="img-thumb" src={value} alt="" onClick={zoom ? () => viewImage(value) : undefined} style={zoom ? { cursor: 'zoom-in' } : undefined} />
        : <div className="img-ph">📷</div>}
      <input type="file" accept="image/*" onChange={(e) => { setFromFile(e.target.files?.[0]); e.target.value = '' }} />
      <button className="btn-sm" type="button" onClick={pasteBtn}>📋 Pegar</button>
      {value && <button className="btn-sm btn-danger" type="button" onClick={() => onChange('')}>Quitar</button>}
    </div>
  )
}
