import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { alertDialog } from '../lib/ui'

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
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('messages').select('*')
      .eq('thread_type', type).eq('thread_id', id).order('created_at')
    setMsgs(data ?? [])
  }, [type, id])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [msgs])

  const send = async () => {
    if (busy) return // Enter repetido no debe duplicar el mensaje
    const body = text.trim(); if (!body) return
    setBusy(true)
    try { await api('post_message', { p_type: type, p_id: id, p_body: body }); setText(''); await load() }
    catch (e) { alertDialog(e.message) } finally { setBusy(false) }
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
        <div className="chat-in">
          <input type="text" value={text} placeholder="Escribe un mensaje…"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="btn btn-primary" onClick={send} disabled={busy}>Enviar</button>
        </div>
      )}
    </>
  )
}
