import { supabase } from './supabase'

// Lista de respaldo por si la tabla aún no responde (mismo orden semilla)
export const DEFAULT_DEPTS = [
  'Presidente Directorio', 'Gerencia General', 'Gerencia de Riesgo', 'Gerencia de Cobranzas',
  'Gerencia Legal', 'Gerencia de Administración y Finanzas',
  'Gerencia de Financiación y Mercado de Capitales', 'Gerencia de TI',
  'Gerencia de Productos', 'Gerencia Comercial y Marketing',
]

// Departamentos que NO pueden solicitar insumos (no aparecen al pedir).
export const NON_REQUESTING_DEPTS = ['Mic']

const bySortName = (a, b) => (a.sort - b.sort) || (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })

// Cache de profundidad por nombre (para etiquetar con sangría en los desplegables)
let depthByName = {}
let parentByName = {}
function setDepthCache(tree) {
  const m = {}, p = {}
  tree.forEach((d) => { m[d.name] = d.depth || 0; p[d.name] = d.parent || '' })
  depthByName = m; parentByName = p
}

// Devuelve el departamento raíz (de nivel superior) al que pertenece un depto/subdepto.
// Hoy las 10 gerencias son de nivel superior; se mantiene por si vuelven a existir subdepartamentos.
export function rootDeptOf(name) {
  let cur = name || '', guard = 0
  while (cur && parentByName[cur] && guard++ < 10) cur = parentByName[cur]
  return cur || name || ''
}

// Etiqueta con sangría: los subdepartamentos se muestran "↳ Nombre" bajo su padre
export function deptIndentLabel(name) {
  const depth = depthByName[name] || 0
  // Los <select> nativos colapsan los espacios normales; usamos espacios duros
  // para que la sangria de los subdepartamentos se vea en el desplegable.
  return depth > 0 ? '    ↳ ' + (name || '') : (name || '')
}

// Ordena los departamentos por jerarquía: cada padre seguido de sus subdepartamentos
export function orderDeptTree(rows) {
  const list = rows ?? []
  const parents = list.filter((d) => !d.parent).sort(bySortName)
  const childrenOf = {}
  list.filter((d) => d.parent).forEach((d) => { (childrenOf[d.parent] = childrenOf[d.parent] || []).push(d) })
  const out = []
  parents.forEach((p) => {
    out.push({ ...p, depth: 0 })
    ;(childrenOf[p.name] || []).sort(bySortName).forEach((c) => out.push({ ...c, depth: 1 }))
  })
  // Huérfanos (padre inexistente) al final, sin indentar
  const parentNames = new Set(parents.map((p) => p.name))
  list.filter((d) => d.parent && !parentNames.has(d.parent)).sort(bySortName).forEach((c) => out.push({ ...c, depth: 0 }))
  return out
}

// Devuelve solo los nombres de departamento, en orden jerárquico (subdepartamentos tras su padre)
export async function loadDeptNames() {
  const { data } = await supabase.from('departments').select('name,sort,parent')
  const tree = orderDeptTree(data ?? [])
  setDepthCache(tree)
  const names = tree.map((d) => d.name).filter(Boolean)
  return names.length ? names : DEFAULT_DEPTS
}

// Solo los nombres de departamento de NIVEL SUPERIOR (sin subdepartamentos).
// Se usa donde se pide "por departamento" (ej: quién puede solicitar un insumo).
export async function loadRootDeptNames() {
  const { data } = await supabase.from('departments').select('name,sort,parent')
  const tree = orderDeptTree(data ?? [])
  setDepthCache(tree)
  const roots = tree.filter((d) => (d.depth || 0) === 0).map((d) => d.name)
    .filter(Boolean).filter((n) => !NON_REQUESTING_DEPTS.includes(n))
  return roots.length ? roots : DEFAULT_DEPTS
}

// Devuelve las filas completas (id, name, sort, parent) en orden jerárquico con profundidad
export async function loadDepts() {
  const { data } = await supabase.from('departments').select('id,name,sort,parent')
  const tree = orderDeptTree(data ?? [])
  setDepthCache(tree)
  return tree
}
