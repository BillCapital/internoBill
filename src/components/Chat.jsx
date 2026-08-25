import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { alertDialog } from '../lib/ui'

const fmt = (iso) => new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

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
          return (
            <div className={`bubble ${mine ? 'b-user' : 'b-support'}`} key={m.id}>
              <span className="meta">{fmt(m.created_at)}</span>{m.body}
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
