import { useRef, useState } from 'react'
import { fileToResizedDataURL, readClipboardImage, imageFromPasteEvent } from '../lib/img'
import { alertDialog, viewImage } from '../lib/ui'
import { Icon } from '../lib/icons'

// Recuadro para elegir una imagen. Soporta: subir archivo, botón "Pegar"
// (portapapeles), arrastrar y soltar, y Ctrl+V directo sobre el recuadro.
// Llama onChange(dataUrl) o onChange('') al quitar.
export default function ImagePicker({ value, onChange, max = 480, zoom = false }) {
  const fileRef = useRef(null)
  const [drag, setDrag] = useState(false)

  const setFromFile = async (f) => {
    if (!f) return
    if (!/^image\//.test(f.type || '')) return alertDialog('El archivo debe ser una imagen.')
    try { onChange(await fileToResizedDataURL(f, max)) } catch (e) { alertDialog(e.message) }
  }
  const pasteBtn = async () => {
    try { const blob = await readClipboardImage(); onChange(await fileToResizedDataURL(blob, max)) } catch (e) { alertDialog(e.message) }
  }
  const onPaste = (ev) => {
    const f = imageFromPasteEvent(ev)
    if (f) { ev.preventDefault(); setFromFile(f) }
  }
  const onDrop = (ev) => {
    ev.preventDefault(); setDrag(false)
    const f = ev.dataTransfer?.files?.[0]
    if (f) setFromFile(f)
  }

  return (
    <div className={`img-pick2${drag ? ' drag' : ''}`} tabIndex={0} onPaste={onPaste}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}>
      <input ref={fileRef} type="file" accept="image/*" hidden
        onChange={(e) => { setFromFile(e.target.files?.[0]); e.target.value = '' }} />

      <button type="button" className="ip-drop" onClick={() => fileRef.current?.click()}
        title="Haz clic para elegir una imagen, o arrástrala aquí">
        {value
          ? <img className="ip-thumb" src={value} alt=""
              onClick={zoom ? (e) => { e.stopPropagation(); viewImage(value) } : undefined}
              style={zoom ? { cursor: 'zoom-in' } : undefined} />
          : <span className="ip-ph"><Icon n="camera" /><span>Subir o pegar imagen</span></span>}
      </button>

      <div className="ip-actions">
        <button className="btn-sm" type="button" onClick={() => fileRef.current?.click()}><Icon n="image" /> Subir foto</button>
        <button className="btn-sm" type="button" onClick={pasteBtn}><Icon n="clipboard" /> Pegar</button>
        {value && <button className="btn-sm btn-danger" type="button" onClick={() => onChange('')}><Icon n="trash" /> Quitar</button>}
      </div>
    </div>
  )
}
