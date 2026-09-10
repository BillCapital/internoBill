import { supabase } from './supabase'

// Nombres amigables de licencias M365 (skuPartNumber → nombre)
export const SKU_NAMES = {
  O365_BUSINESS_ESSENTIALS: 'Microsoft 365 Empresa Básico', O365_BUSINESS_PREMIUM: 'Microsoft 365 Empresa Estándar',
  O365_BUSINESS: 'Microsoft 365 Aplicaciones para Empresas', SPB: 'Microsoft 365 Empresa Premium',
  SPE_E3: 'Microsoft 365 E3', SPE_E5: 'Microsoft 365 E5', ENTERPRISEPACK: 'Office 365 E3', ENTERPRISEPREMIUM: 'Office 365 E5',
  STANDARDPACK: 'Office 365 E1', EXCHANGESTANDARD: 'Exchange Online (Plan 1)', EXCHANGEENTERPRISE: 'Exchange Online (Plan 2)',
  POWER_BI_STANDARD: 'Power BI (gratis)', FLOW_FREE: 'Power Automate (gratis)', TEAMS_EXPLORATORY: 'Teams Exploratory',
}
export const skuName = (part) => SKU_NAMES[part] || (part || '').replace(/_/g, ' ')
// Página de COMPRA de cada producto en el marketplace del centro de administración
// (skuPartNumber → id de producto comercial). A diferencia de "Sus productos", el
// marketplace no depende del filtro de cuenta de facturación, así que Exchange sí aparece.
export const BUY_PRODUCT = {
  O365_BUSINESS_PREMIUM: ['microsoft-365-business-standard', 'CFQ7TTC0LDPB'],
  O365_BUSINESS_ESSENTIALS: ['microsoft-365-business-basic', 'CFQ7TTC0LH18'],
  EXCHANGESTANDARD: ['exchange-online-plan-1', 'CFQ7TTC0LH16'],
  Microsoft_365_Copilot: ['microsoft-365-copilot', 'CFQ7TTC0MM8R'],
}
export const buyUrl = (part) => {
  const p = BUY_PRODUCT[part]
  return p
    ? `https://admin.cloud.microsoft/?#/catalog/m/offer-details/${p[0]}/${p[1]}`
    : 'https://admin.cloud.microsoft/?#/catalog'
}
// Llama a la función de gestión de usuarios de Microsoft 365 (ms-users)
export async function msUsers(op, payload = {}) {
  const { data, error } = await supabase.functions.invoke('ms-users', { body: { op, ...payload } })
  if (error) {
    let msg = error.message || 'Error'
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (data && data.error) throw new Error(data.error)
  return data
}

