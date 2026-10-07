// Website chat widget for TrustiqLegal firm sites. Builds its DOM with textContent only,
// so nothing the visitor or the assistant writes is ever parsed as HTML.
(() => {
  const root = document.getElementById('tq-chat')
  if (!root) return
  const slug = root.dataset.slug
  const lang = root.dataset.lang === 'ar' ? 'ar' : 'en'
  const color = /^#[0-9a-f]{6}$/i.test(root.dataset.color || '') ? root.dataset.color : '#1a365d'
  let t = {}
  try { t = JSON.parse(root.dataset.t || '{}') } catch { /* defaults below */ }
  const STORE = `tq-chat:${slug}`
  let messages = []
  try { messages = JSON.parse(sessionStorage.getItem(STORE) || '[]').slice(-20) } catch { messages = [] }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-20))) } catch { /* private mode */ } }

  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v
      else if (k === 'style') n.style.cssText = v
      else n.setAttribute(k, v)
    }
    for (const c of children) n.append(c)
    return n
  }

  const launcher = el('button', { type: 'button', class: 'fixed bottom-5 end-5 z-50 rounded-full shadow-lg text-white px-5 py-3 font-semibold flex items-center gap-2', style: `background:${color}`, 'aria-expanded': 'false', 'aria-controls': 'tq-chat-panel' },
    el('i', { class: 'fas fa-comments', 'aria-hidden': 'true' }), t.open || 'Chat with us')
  const log = el('div', { class: 'flex-1 overflow-y-auto p-4 space-y-3 text-sm', 'aria-live': 'polite' })
  const input = el('textarea', { rows: '2', maxlength: '1500', class: 'flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm', placeholder: t.placeholder || 'Type your question…', 'aria-label': t.placeholder || 'Message', dir: 'auto' })
  const send = el('button', { type: 'submit', class: 'rounded-lg text-white px-4 font-semibold text-sm', style: `background:${color}` }, t.send || 'Send')
  const form = el('form', { class: 'flex gap-2 p-3 border-t border-slate-200' }, input, send)
  const close = el('button', { type: 'button', class: 'text-white/90 hover:text-white px-2', 'aria-label': t.close || 'Close' }, el('i', { class: 'fas fa-xmark', 'aria-hidden': 'true' }))
  const book = el('a', { href: root.dataset.consult || '#contact', class: 'block text-center text-xs font-semibold py-2 border-t border-slate-200 hover:bg-slate-50', style: `color:${color}` }, t.book || 'Request a consultation')
  const panel = el('div', { id: 'tq-chat-panel', role: 'dialog', 'aria-label': t.title || 'Chat', class: 'fixed bottom-20 end-5 z-50 w-[calc(100vw-2.5rem)] max-w-sm h-[70vh] max-h-[34rem] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden', hidden: '' },
    el('div', { class: 'flex items-center justify-between px-4 py-3 text-white', style: `background:${color}` }, el('span', { class: 'font-semibold truncate' }, t.title || 'Chat'), close),
    log,
    el('p', { class: 'px-4 pb-2 text-[11px] text-slate-500' }, t.note || ''),
    book,
    form)
  document.body.append(panel, launcher)

  const bubble = (role, text) => {
    const mine = role === 'user'
    const b = el('div', { class: `max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-line ${mine ? 'ms-auto text-white' : 'bg-slate-100 text-slate-800'}`, dir: 'auto' })
    if (mine) b.style.background = color
    b.textContent = text
    log.append(b)
    log.scrollTop = log.scrollHeight
    return b
  }
  const draw = () => {
    log.textContent = ''
    bubble('assistant', root.dataset.greeting || t.greeting || '')
    for (const m of messages) bubble(m.role, m.content)
  }

  const toggle = (open) => {
    panel.hidden = !open
    launcher.setAttribute('aria-expanded', String(open))
    if (open) { draw(); input.focus() }
  }
  launcher.addEventListener('click', () => toggle(panel.hidden))
  close.addEventListener('click', () => { toggle(false); launcher.focus() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { toggle(false); launcher.focus() } })
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit() } })

  let busy = false
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text || busy) return
    busy = true
    send.disabled = true
    input.value = ''
    messages.push({ role: 'user', content: text.slice(0, 1500) })
    save()
    bubble('user', text)
    const typing = bubble('assistant', t.typing || '…')
    try {
      const res = await fetch(`/f/${encodeURIComponent(slug)}/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ lang, messages: messages.slice(-12) })
      })
      const data = await res.json().catch(() => ({}))
      const reply = res.ok && typeof data.reply === 'string' ? data.reply : (data.error && data.error.message) || t.error || 'Error'
      typing.textContent = reply
      if (res.ok) { messages.push({ role: 'assistant', content: reply.slice(0, 1500) }); save() }
    } catch {
      typing.textContent = t.error || 'Error'
    } finally {
      busy = false
      send.disabled = false
      input.focus()
    }
  })

  // Carry the chat into the consultation form so the firm sees what was discussed.
  const contact = document.querySelector('form[action$="/contact"]')
  if (contact) {
    contact.addEventListener('submit', (e) => {
      if (!messages.length) return
      e.preventDefault()
      const fd = new FormData(contact)
      const body = Object.fromEntries(fd.entries())
      body.transcript = messages.slice(-20).map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      fetch(contact.action, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit', body: JSON.stringify(body) })
        .then((r) => r.json().then((d) => ({ ok: r.ok && d.ok, error: d.error })))
        .then((r) => {
          const q = lang === 'ar' ? 'lang=ar&' : ''
          if (r.ok) { try { sessionStorage.removeItem(STORE) } catch { /* ignore */ } }
          location.href = `${location.pathname}?${q}${r.ok ? 'sent=1' : `error=${r.error === 'limited' ? 'limited' : '1'}`}#contact`
        })
        .catch(() => contact.submit())
    })
  }
})()
