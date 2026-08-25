import { useState, useEffect } from 'react'
import { _bindImage } from '../lib/ui'
import { Icon } from '../lib/icons'

// Lightbox global: muestra una imagen ampliada. Se cierra al hacer clic o con Escape.
export default function ImageViewer() {
  const [url, setUrl] = useState(null)

  useEffect(() => { _bindImage((u) => setUrl(u)) }, [])
  useEffect(() => {
    if (!url) return
    const onKey = (e) => { if (e.key === 'Escape') setUrl(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [url])

  if (!url) return null
  return (
    <div className="img-viewer" onClick={() => setUrl(null)}>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
      <button className="img-viewer-x" onClick={() => setUrl(null)} title="Cerrar"><Icon n="close" /></button>
    </div>
  )
}
