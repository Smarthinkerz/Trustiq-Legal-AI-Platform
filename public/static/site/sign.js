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
  // The stored signature is a stamp: the drawing (or the typed name in handwriting style)
  // above a line with the signer's name. It is made here because browsers lay out Arabic
  // names correctly, which the server's PDF writer cannot.
  const makeStamp = (name) => {
    const W = 600, H = 220
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    const g = out.getContext('2d')
    const rtl = canvas.dataset.lang === 'ar' || /[\u0600-\u06FF]/.test(name)
    g.direction = rtl ? 'rtl' : 'ltr'
    if (drawn) {
      const scale = Math.min((W - 20) / canvas.width, 140 / canvas.height)
      const w = canvas.width * scale, h = canvas.height * scale
      g.drawImage(canvas, (W - w) / 2, 10 + (140 - h) / 2, w, h)
    } else {
      g.fillStyle = '#0f172a'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      let size = 64
      const family = rtl ? '"Noto Naskh Arabic", "Geeza Pro", "Times New Roman", serif' : '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive'
      do { g.font = `italic ${size}px ${family}`; size -= 4 } while (g.measureText(name).width > W - 40 && size > 20)
      g.fillText(name, W / 2, 85)
    }
    g.strokeStyle = '#94a3b8'
    g.lineWidth = 2
    g.beginPath(); g.moveTo(30, 160); g.lineTo(W - 30, 160); g.stroke()
    g.fillStyle = '#334155'
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.font = 'bold 22px system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif'
    g.fillText(name, W / 2, 190, W - 40)
    g.fillStyle = '#64748b'
    g.font = '16px system-ui, -apple-system, "Segoe UI", Tahoma, Arial, sans-serif'
    g.fillText(canvas.dataset.stampLabel || 'Signed electronically', W / 2, 212, W - 40)
    return out.toDataURL('image/png')
  }

  form.addEventListener('submit', () => {
    const name = (form.querySelector('[name=signed_name]')?.value || '').trim()
    field.value = name ? makeStamp(name) : ''
  })
  resize()
  window.addEventListener('resize', () => { if (!drawn) resize() })
})()
