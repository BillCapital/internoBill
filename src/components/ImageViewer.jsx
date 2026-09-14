import { useState, useEffect } from 'react'
import { _bindImage } from '../lib/ui'
import { Icon } from '../lib/icons'

// Lightbox global: muestra una imagen ampliada, con acercar/alejar. Se cierra al hacer clic fuera o con Escape.
export default function ImageViewer() {
  const [url, setUrl] = useState(null)
  const [zoom, setZoom] = useState(1) // 1 = ajustada a la pantalla

  useEffect(() => { _bindImage((u) => { setUrl(u); setZoom(1) }) }, [])
  useEffect(() => {
    if (!url) return
    const onKey = (e) => {
      if (e.key === 'Escape') setUrl(null)
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(1.25, +(z + 0.25).toFixed(2)))
      if (e.key === '-') setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [url])

  if (!url) return null
  const zin = () => setZoom((z) => Math.min(1.25, +(z + 0.25).toFixed(2)))
  const zout = () => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))
  return (
    <div className="img-viewer">
      <div className="iv-scroll" onClick={(e) => { if (e.target === e.currentTarget) setUrl(null) }}>
        <img src={url} alt="" style={zoom !== 1 ? { width: `${Math.round(zoom * 86)}vw`, maxWidth: 'none', maxHeight: 'none' } : undefined} />
      </div>
      <div className="iv-zoom">
        <button onClick={zout} disabled={zoom <= 1} title="Alejar">−</button>
        <button className="iv-pct" onClick={() => setZoom(1)} title="Tamaño original (ajustada a la pantalla)">{Math.round(zoom * 100)}%</button>
        <button onClick={zin} disabled={zoom >= 1.25} title="Acercar">＋</button>
      </div>
      <button className="img-viewer-x" onClick={() => setUrl(null)} title="Cerrar"><Icon n="close" /></button>
    </div>
  )
}
