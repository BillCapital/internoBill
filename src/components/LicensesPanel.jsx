import { useEffect, useState } from 'react'
import { alertDialog } from '../lib/ui'
import { Icon } from '../lib/icons'
import { skuName, buyUrl, msUsers } from '../lib/m365'

// Licencias Microsoft 365: asientos comprados, en uso y disponibles, con compra guiada.
// Vive en Inventario (pestaña Licencias). La asignación por persona sigue en la ficha de cada usuario.
export default function LicensesPanel({ defaultOpen = true }) {
  const [licPanelOpen, setLicPanelOpen] = useState(defaultOpen)
  const [panelSkus, setPanelSkus] = useState(null)
  const [panelBusy, setPanelBusy] = useState(false)
  const M365_SUBS_URL = 'https://admin.microsoft.com/Adminportal/Home#/subscriptions'
  const loadPanelSkus = async () => {
    if (panelSkus || panelBusy) return
    setPanelBusy(true)
    try { const r = await msUsers('listSkus'); setPanelSkus(r?.skus || []) }
    catch (e) { setPanelSkus([]); alertDialog('No se pudieron cargar las licencias: ' + e.message) }
    finally { setPanelBusy(false) }
  }
  const openLicPanel = async () => { const willOpen = !licPanelOpen; setLicPanelOpen(willOpen); if (willOpen) loadPanelSkus() }
  useEffect(() => { if (defaultOpen) loadPanelSkus() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
      <div id="lic-panel" className={`section ${licPanelOpen ? 'open' : ''}`}>
        <button className="sec-head compact" onClick={openLicPanel}>
          <span className="ico"><Icon n="shield" /></span>
          <span className="t"><strong>Licencias Microsoft 365</strong><br /><span className="muted">Licencias compradas, usadas y disponibles · comprar</span></span>
          <span className="chev">▾</span>
        </button>
        {licPanelOpen && <div className="sec-body">
          {panelBusy && <p className="muted">Cargando licencias…</p>}
          {!panelBusy && panelSkus && panelSkus.length === 0 && <p className="muted">No se pudieron leer las licencias del tenant.</p>}
          {!panelBusy && panelSkus && panelSkus.length > 0 && (() => {
            // Ocultar planes vacíos (0 asientos: trials/exploratorios que no importan).
            // "De pago" = con asientos finitos; se excluyen los gratis/ilimitados del total para que sea real.
            const isFree = (s) => /gratis/i.test(skuName(s.skuPartNumber)) || (s.total || 0) >= 100000
            const shown = panelSkus.filter((s) => (s.total || 0) > 0)
            const paid = shown.filter((s) => !isFree(s))
            const tot = paid.reduce((a, s) => a + (s.total || 0), 0)
            const used = paid.reduce((a, s) => a + (s.used || 0), 0)
            const avail = paid.reduce((a, s) => a + (s.available || 0), 0)
            const noStock = paid.filter((s) => s.available <= 0).length
            const sorted = shown.slice().sort((a, b) => (isFree(a) - isFree(b)) || (a.available - b.available) || (b.total - a.total))
            return (<>
              {/* Resumen general + compra (solo licencias de pago) */}
              <div className="lic-summary">
                <div className="lic-sum-stats">
                  <div className="lic-stat"><span className="lic-stat-n">{tot}</span><span className="lic-stat-l">Licencias de pago</span></div>
                  <div className="lic-stat"><span className="lic-stat-n">{used}</span><span className="lic-stat-l">En uso</span></div>
                  <div className="lic-stat"><span className={`lic-stat-n ${avail <= 0 ? 'danger' : 'ok'}`}>{avail}</span><span className="lic-stat-l">Disponibles</span></div>
                </div>
                <div className="lic-sum-actions">
                  {noStock > 0 && <span className="lic-warn"><Icon n="alert" /> {noStock} plan(es) sin cupo</span>}
                  <button type="button" className="btn btn-lime" onClick={() => window.open(M365_SUBS_URL, '_blank', 'noopener')} title="Abre el Centro de administración de Microsoft 365 para comprar o agregar asientos">＋ Comprar / administrar en M365</button>
                </div>
              </div>
              <div className="lic-grid">
                {sorted.map((s) => {
                  const disp = s.available
                  const pct = s.total ? Math.min(100, Math.round((s.used / s.total) * 100)) : 0
                  const full = disp <= 0
                  return (
                    <div className={`lic-card ${full ? 'is-full' : ''}`} key={s.skuId}>
                      <div className="lic-card-top">
                        <span className="lic-name">{skuName(s.skuPartNumber)}</span>
                        <span className={`lic-pill ${full ? 'danger' : 'ok'}`}>{full ? 'Sin cupo' : `${disp} libre${disp === 1 ? '' : 's'}`}</span>
                      </div>
                      <div className="lic-bar" title={`${s.used} de ${s.total} usados`}><span className={full ? 'full' : ''} style={{ width: `${pct}%` }} /></div>
                      <div className="lic-meta"><span className="lic-frac">{s.used}<span className="muted"> / {s.total}</span> usados</span><span className="muted">{pct}%</span></div>
                      <button type="button" className={`lic-buy ${full ? 'is-full' : ''}`} title={`Abre la página de compra de ${skuName(s.skuPartNumber)} en M365`} onClick={() => window.open(buyUrl(s.skuPartNumber), '_blank', 'noopener')}>{full ? 'Comprar licencias' : 'Agregar licencias'}</button>
                    </div>
                  )
                })}
              </div>
              <p className="muted pf-hint">El pago se finaliza en el Centro de administración de Microsoft 365 (Microsoft no permite comprar por API). Al terminar, asigna la licencia desde la ficha de la persona; el cupo nuevo se refleja al reabrir este panel.</p>
            </>)
          })()}
        </div>}
      </div>
  )
}
