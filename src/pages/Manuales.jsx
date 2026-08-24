import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { confirmDialog, alertDialog } from '../lib/ui'

const BUCKET = 'manuales'
const fmtSize = (n) => {
  if (!n) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
const iconFor = (m, name = '') => {
  const s = (m + ' ' + name).toLowerCase()
  if (s.includes('pdf')) return '📕'
  if (s.includes('word') || s.includes('doc')) return '📘'
  if (s.includes('sheet') || s.includes('excel') || s.includes('xls') || s.includes('csv')) return '📗'
  if (s.includes('presentation') || s.includes('ppt')) return '📙'
  if (s.includes('image')) return '🖼️'
  return '📄'
}
const safeName = (n) => (n || 'archivo').replace(/[^\w.\-]+/g, '_')

export default function Manuales() {
  const { profile, isAdmin, canManageUsers } = useAuth()
  const canManage = isAdmin || canManageUsers
  const [rows, setRows] = useState([])
  const [cat, setCat] = useState('')          // filtro por categoría
  const [q, setQ] = useState('')
  const [form, setForm] = useState(null)       // { title, description, category, file }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('manuals').select('*').order('category').order('created_at', { ascending: false })
    setRows(data ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const publicUrl = useCallback((path) => {
    try { return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl } catch { return '#' }
  }, [])

  // Descarga real: baja el archivo como blob y lo guarda con su nombre (el atributo
  // download no funciona sobre URLs públicas de otro origen, por eso se hace así).
  const downloadFile = useCallback(async (m) => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(m.file_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url; a.download = m.file_name || m.title || 'manual'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) { alertDialog(e.message || 'No se pudo descargar el archivo.') }
  }, [])

  const cats = useMemo(() => [...new Set(rows.map((r) => r.category || 'General'))].sort((a, b) => a.localeCompare(b, 'es')), [rows])
  const data = rows.filter((r) => (!cat || (r.category || 'General') === cat)
    && (!q || (r.title || '').toLowerCase().includes(q.toLowerCase()) || (r.description || '').toLowerCase().includes(q.toLowerCase())))

  const startNew = () => setForm({ title: '', description: '', category: '', file: null })

  const submit = async () => {
    if (!form.title.trim()) return alertDialog('Ponle un título al manual.')
    if (!form.file) return alertDialog('Elige el archivo (PDF, Word, etc.).')
    setBusy(true)
    try {
      const path = `${Date.now()}_${safeName(form.file.name)}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, form.file, { contentType: form.file.type || undefined, upsert: false })
      if (upErr) throw upErr
      const { error: insErr } = await supabase.from('manuals').insert({
        title: form.title.trim(), description: form.description.trim(),
        category: form.category.trim() || 'General', file_path: path,
        file_name: form.file.name, mime: form.file.type || '', size: form.file.size || 0,
        created_by: profile?.id ?? null,
      })
      if (insErr) { await supabase.storage.from(BUCKET).remove([path]); throw insErr }
      setForm(null); load()
    } catch (e) { alertDialog(e.message || 'No se pudo subir el manual.') } finally { setBusy(false) }
  }

  const del = async (m) => {
    if (!(await confirmDialog(`¿Eliminar el manual "${m.title}"? También se borra el archivo.`, { title: 'Eliminar manual', danger: true, okText: 'Eliminar' }))) return
    try {
      await supabase.storage.from(BUCKET).remove([m.file_path])
      const { error } = await supabase.from('manuals').delete().eq('id', m.id)
      if (error) throw error
      load()
    } catch (e) { alertDialog(e.message) }
  }

  return (
    <div>
      <div className="page-head"><div className="row">
        <div><h2>Manuales y guías</h2><p className="muted">Documentación interna: procedimientos, instructivos y guías paso a paso.</p></div>
        <div className="row" style={{ gap: '.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input className="search" placeholder="Buscar manual…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
          {canManage && <button className="btn btn-lime" onClick={startNew}>＋ Subir manual</button>}
        </div>
      </div></div>

      {/* Filtro por categoría */}
      <div className="kpi-grid compact kpi-sm">
        <button className={`kpi kpi-all ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>
          <span className="ico" style={{ fontSize: '1.3rem' }}>📚</span>
          <div><div className="num">{rows.length}</div><div className="lbl">Todos</div></div>
        </button>
        {cats.map((c) => (
          <button key={c} className={`kpi ${cat === c ? 'active' : ''}`} onClick={() => setCat(cat === c ? '' : c)}>
            <div className="ico">🗂️</div><div className="num">{rows.filter((r) => (r.category || 'General') === c).length}</div><div className="lbl">{c}</div>
          </button>
        ))}
      </div>

      {data.length === 0 && <div className="conv"><div className="empty">{rows.length === 0 ? 'Aún no hay manuales cargados.' : 'No hay manuales para este filtro.'}</div></div>}

      <div className="man-grid">
        {data.map((m) => (
          <div className="man-card" key={m.id}>
            <div className="man-ico">{iconFor(m.mime, m.file_name)}</div>
            <div className="man-body">
              <strong>{m.title}</strong>
              {m.description ? <p className="muted">{m.description}</p> : null}
              <div className="man-meta"><span className="badge">{m.category || 'General'}</span>{m.size ? <span className="muted"> · {fmtSize(m.size)}</span> : null}</div>
              <div className="man-actions">
                <a className="btn-sm" href={publicUrl(m.file_path)} target="_blank" rel="noreferrer">👁 Ver</a>
                <button className="btn-sm btn-lime" type="button" onClick={() => downloadFile(m)}>⬇ Descargar</button>
                {canManage && <button className="btn-sm btn-danger" onClick={() => del(m)}>Eliminar</button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <div className="backdrop open">
          <div className="modal">
            <h3>Subir manual</h3>
            <label>Título</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej: Cómo compartir una carpeta con el equipo" autoFocus />
            <label style={{ marginTop: '.6rem' }}>Categoría</label>
            <input list="man-cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ej: TI, RR.HH., Operaciones… (por defecto: General)" />
            <datalist id="man-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
            <label style={{ marginTop: '.6rem' }}>Descripción <span className="muted">(opcional)</span></label>
            <textarea style={{ width: '100%', minHeight: 60 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Breve resumen del contenido." />
            <label style={{ marginTop: '.6rem' }}>Archivo <span className="muted">(PDF, Word, Excel, imagen…)</span></label>
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,image/*,application/pdf" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} />
            {form.file && <p className="muted" style={{ margin: '.3rem 0 0' }}>{iconFor(form.file.type, form.file.name)} {form.file.name} · {fmtSize(form.file.size)}</p>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setForm(null)} disabled={busy}>Cancelar</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Subiendo…' : 'Subir'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
