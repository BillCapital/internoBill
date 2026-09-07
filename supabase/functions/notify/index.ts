// Funcion PRIVADA: solo se invoca desde el portero (gateway) con x-internal-key.
// TODO: integrar correo (Resend/SMTP) o webhook de Teams. Por ahora registra el evento.
const INTERNAL = Deno.env.get('INTERNAL_KEY') ?? ''
function json(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
}
Deno.serve(async (req) => {
  if (req.headers.get('x-internal-key') !== INTERNAL || !INTERNAL) return json(401, { error: 'forbidden' })
  const payload = await req.json().catch(() => ({}))
  console.log('notify', JSON.stringify(payload))
  return json(200, { ok: true })
})
