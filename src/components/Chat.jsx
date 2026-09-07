import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { alertDialog } from '../lib/ui'
import { Icon } from '../lib/icons'

const fmt = (iso) => new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
// ¿el cuerpo del mensaje es una URL de imagen? (adjuntos antiguos de soporte)
const isImgUrl = (s) => { const t = (s || '').trim(); return /^https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp)(\?.*)?$/i.test(t) || /\/storage\/v1\/object\/public\/soporte\//i.test(t) }
// Adjunto nuevo: ruta dentro del bucket privado de soporte ("soporte:<ruta>")
const isSoportePath = (s) => /^soporte:.+/.test((s || '').trim())

// Imagen del bucket privado: se resuelve con URL firmada temporal (solo usuarios con sesión)
function SignedImg({ path }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    supabase.storage.from('soporte').createSignedUrl(path, 3600)
      .then(({ data }) => { if (alive) setUrl(data?.signedUrl || '') })
      .catch(() => {})
    return () => { alive = false }
  }, [path])
  if (!url) return <span className="muted">Cargando imagen…</span>
  return <img className="chat-img" src={url} alt="imagen adjunta" loading="lazy" onClick={() => window.open(url, '_blank')} />
}

export default function Chat({ type, id, locked = false }) {
  const { user } = useAuth()
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [imgs, setImgs] = useState([]) // imágenes pendientes de enviar [{file, preview}]
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('messages').select('*')
      .eq('thread_type', type).eq('thread_id', id).order('created_at')
    setMsgs(data ?? [])
  }, [type, id])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [msgs])
  // Al cambiar de hilo, descartar imágenes pendientes (y liberar las miniaturas)
  useEffect(() => () => { setImgs((cur) => { cur.forEach((im) => { try { URL.revokeObjectURL(im.preview) } catch { /* noop */ } }); return [] }) }, [type, id])

  const addFiles = (files) => {
    const arr = Array.from(files || []).filter((f) => f.type && f.type.startsWith('image/'))
    if (arr.length) setImgs((cur) => [...cur, ...arr.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))])
  }
  // Ctrl+V con una imagen en el portapapeles: se agrega como adjunto pendiente
  const onPaste = (e) => {
    const items = e.clipboardData?.items || []
    const files = []
    for (const it of items) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f) } }
    if (files.length) { e.preventDefault(); addFiles(files) }
  }
  const removeImg = (i) => setImgs((cur) => { try { URL.revokeObjectURL(cur[i]?.preview) } catch { /* noop */ } return cur.filter((_, j) => j !== i) })

  const send = async () => {
    if (busy) return // Enter repetido no debe duplicar el mensaje
    const body = text.trim()
    if (!body && !imgs.length) return
    setBusy(true)
    try {
      // Primero las imágenes (bucket privado; el chat las muestra con URL firmada)
      for (const im of imgs) {
        const path = `chat/${type}/${id}/${Date.now()}_${(im.file.name || 'img.png').replace(/[^\w.\-]+/g, '_')}`
        const { error } = await supabase.storage.from('soporte').upload(path, im.file, { contentType: im.file.type || undefined })
        if (error) throw new Error('No se pudo subir la imagen: ' + error.message)
        await api('post_message', { p_type: type, p_id: id, p_body: 'soporte:' + path })
      }
      if (body) await api('post_message', { p_type: type, p_id: id, p_body: body })
      imgs.forEach((im) => { try { URL.revokeObjectURL(im.preview) } catch { /* noop */ } })
      setImgs([]); setText('')
      await load()
    } catch (e) { alertDialog(e.message) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="chat" ref={ref}>
        {msgs.map((m) => {
          if (m.is_system) return <div className="bubble b-system" key={m.id}>{m.body} · {fmt(m.created_at)}</div>
          const mine = m.sender_id === user?.id
          const img = isImgUrl(m.body) || isSoportePath(m.body)
          return (
            <div className={`bubble ${mine ? 'b-user' : 'b-support'} ${img ? 'b-img' : ''}`} key={m.id}>
              <span className="meta">{fmt(m.created_at)}</span>
              {isSoportePath(m.body)
                ? <SignedImg path={m.body.trim().slice('soporte:'.length)} />
                : isImgUrl(m.body)
                  ? <img className="chat-img" src={m.body.trim()} alt="imagen adjunta" loading="lazy" onClick={() => window.open(m.body.trim(), '_blank')} />
                  : m.body}
            </div>
          )
        })}
      </div>
      {!locked && (
        <>
          {imgs.length > 0 && (
            <div className="chat-pending">
              {imgs.map((im, i) => (
                <span className="chat-thumb" key={i}>
                  <img src={im.preview} alt="" />
                  <button type="button" title="Quitar" onClick={() => removeImg(i)} disabled={busy}><Icon n="close" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="chat-in">
            <button type="button" className="chat-attach" title="Adjuntar imagen (o pega con Ctrl+V)" disabled={busy} onClick={() => fileRef.current?.click()}><Icon n="image" /></button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
            <input type="text" value={text} placeholder="Escribe un mensaje o pega una imagen…"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} onPaste={onPaste} />
            <button className="btn btn-primary" onClick={send} disabled={busy || (!text.trim() && !imgs.length)}>{busy ? 'Enviando…' : 'Enviar'}</button>
          </div>
        </>
      )}
    </>
  )
}
