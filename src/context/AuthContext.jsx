import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { alertDialog } from '../lib/ui'

const AuthContext = createContext(null)

// Etiquetas de respaldo por si falla la lectura de la tabla de roles
const FALLBACK_ROLE_LABELS = { user: 'Usuario', pedidos: 'Gestora de pedidos', admin: 'Administrador', mic: 'Mic', sistema: 'Cuentas de servicio',
  presidente_directorio: 'Presidente Directorio', gerente_general: 'Gerente General', gerente_riesgo: 'Gerente de Riesgo',
  gerente_cobranza: 'Gerente de Cobranzas', gerente_legal: 'Gerente Legal', gerente_admin_finanzas: 'Gerente de Administración y Finanzas',
  gerente_financiacion: 'Gerente de Financiación y Mercado de Capitales', gerente_ti: 'Gerente TI',
  gerente_producto: 'Gerente de Productos', gerente_comercial: 'Gerente Comercial y Marketing' }

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [perms, setPerms] = useState({})
  const [roleLabel, setRoleLabel] = useState('')
  const [managedDepts, setManagedDepts] = useState([]) // departamentos donde el usuario es gerente de área
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (uid) => {
    if (!uid) { setProfile(null); setPerms({}); setRoleLabel(''); setManagedDepts([]); return }
    const { data } = await supabase.from('profiles')
      .select('id, role, full_name, email, department, phone, inventory_access, avatar_url, active, country, app_access, work_mode, emergency_name, emergency_phone, birth_day, birth_month').eq('id', uid).single()
    // Cuenta deshabilitada: sin acceso (persona que ya no forma parte de la empresa)
    if (data && data.active === false) {
      setProfile(null); setPerms({}); setRoleLabel(''); setManagedDepts([])
      alertDialog('Tu cuenta está deshabilitada. Contacta con el administrador si crees que es un error.')
      await supabase.auth.signOut()
      return
    }
    // Cuenta solo de organización (sin acceso a la app): existe para inventario/directorio, no para iniciar sesión
    if (data && data.app_access === false) {
      setProfile(null); setPerms({}); setRoleLabel(''); setManagedDepts([])
      alertDialog('Esta cuenta no tiene acceso a la aplicación.')
      await supabase.auth.signOut()
      return
    }
    setProfile(data ?? null)
    // Registra el último acceso real (la sesión SSO persiste, así que last_sign_in_at de auth queda viejo)
    if (data) { try { api('touch_seen').catch(() => {}) } catch { /* noop */ } }
    const roleKey = data?.role ?? 'user'
    const { data: r } = await supabase.from('roles').select('label, permissions').eq('key', roleKey).single()
    // Salvaguarda: el admin nunca pierde acceso total aunque falle la lectura
    const p = r?.permissions ?? (roleKey === 'admin' ? { full_admin: true } : {})
    setPerms(p)
    setRoleLabel(r?.label ?? (FALLBACK_ROLE_LABELS[roleKey] || roleKey))
    // Departamentos que gerencia (2ª/3ª llave de las compras de su área)
    const { data: md } = await supabase.from('departments').select('name').eq('manager_id', uid)
    setManagedDepts((md || []).map((d) => d.name))
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      loadProfile(data.session?.user?.id).finally(() => setLoading(false))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadProfile(s?.user?.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const role = profile?.role ?? 'user'
  const full = perms.full_admin === true
  // Dos niveles por apartado: "ver" (entrar y consultar) y "gestionar" (actuar).
  // Gestionar incluye ver. full_admin incluye todo.
  const canEdit = (mod) => full || perms[`manage_${mod}`] === true
  const canView = (mod) => canEdit(mod) || perms[`view_${mod}`] === true
  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    role,
    roleLabel,
    perms,
    isAdmin: full,
    isSuper: perms.super_admin === true,
    canEdit,
    canView,
    canManageOrders: canEdit('orders'),
    canManageRooms: canEdit('rooms'),
    canManageSupplies: canEdit('supplies'),
    canManageInventory: canEdit('inventory'),
    canManageUsers: canEdit('users'),
    canManageSupport: canEdit('support'),
    canManageLists: canEdit('lists'),
    canManageExpenses: canEdit('expenses'),
    canManageRoles: full,
    canViewOrders: canView('orders'),
    canViewRooms: canView('rooms'),
    canViewSupplies: canView('supplies'),
    canViewInventory: canView('inventory'),
    canViewUsers: canView('users'),
    canViewSupport: canView('support'),
    canViewLists: canView('lists'),
    canViewExpenses: canView('expenses'),
    canViewLogs: canView('logs'),
    canManageLogs: canEdit('logs'),
    managedDepts,
    isAreaManager: managedDepts.length > 0,
    hasInventory: canView('inventory') || profile?.inventory_access === true,
    refreshProfile: () => loadProfile(session?.user?.id),
    // Actualiza campos del perfil en memoria (sin recargar roles/deptos): guardado instantáneo
    patchProfile: (fields) => setProfile((p) => (p ? { ...p, ...fields } : p)),
    signInMicrosoft: async () => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          scopes: 'email openid profile offline_access',
          redirectTo: window.location.origin,
          skipBrowserRedirect: true,
          // Muestra siempre el selector de cuenta de Microsoft (para poder entrar con otra cuenta)
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) { alertDialog('Error al iniciar sesión: ' + error.message); return }
      if (data?.url) window.location.href = data.url
    },
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
