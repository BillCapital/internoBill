// Diálogos propios de la app (reemplazan window.confirm / prompt / alert nativos de Chrome).
// Se usan como funciones async desde cualquier parte; el modal lo renderiza <DialogHost/>.
let handler = null
export function _bindDialog(h) { handler = h }

export function confirmDialog(message, opts = {}) {
  return handler ? handler({ type: 'confirm', message, ...opts }) : Promise.resolve(window.confirm(message))
}
export function promptDialog(message, opts = {}) {
  return handler ? handler({ type: 'prompt', message, ...opts }) : Promise.resolve(window.prompt(message, opts.defaultValue || ''))
}
export function alertDialog(message, opts = {}) {
  return handler ? handler({ type: 'alert', message, ...opts }) : Promise.resolve(window.alert(message))
}

// Visor de imágenes (lightbox)
let imgHandler = null
export function _bindImage(h) { imgHandler = h }
export function viewImage(url) { if (imgHandler && url) imgHandler(url) }
