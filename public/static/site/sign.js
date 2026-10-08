// Signature pad for the TrustiqLegal signing page: draws with mouse, pen or finger and
// stores the drawing as a PNG data URL in the form. Drawing is optional.
(() => {
  const canvas = document.getElementById('signature-pad')
  const field = document.getElementById('signature-data')
  const form = document.getElementById('sign-form')
  if (!canvas || !field || !form) return
  const ctx = canvas.getContext('2d')
  let drawing = false
  let drawn = false
  let last = null

  const resize = () => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
    drawn = false
  }
  const point = (e) => {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true
    last = point(e)
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last = p
    drawn = true
  })
  const stop = () => { drawing = false }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
  document.getElementById('signature-clear')?.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawn = false
    field.value = ''
  })
  form.addEventListener('submit', () => {
    if (!drawn) { field.value = ''; return }
    // Downscale to keep the stored image small.
    const out = document.createElement('canvas')
    out.width = 600
    out.height = Math.round(600 * canvas.height / canvas.width)
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height)
    field.value = out.toDataURL('image/png')
  })
  resize()
  window.addEventListener('resize', () => { if (!drawn) resize() })
})()
