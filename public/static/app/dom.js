// Safe HTML templating: every interpolated value is escaped unless wrapped in raw() / html``.
class Raw {
  constructor(s) { this.s = s }
  toString() { return this.s }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c])
export const raw = (s) => new Raw(String(s ?? ''))

function fmt(v) {
  if (v == null || v === false) return ''
  if (v instanceof Raw) return v.s
  if (Array.isArray(v)) return v.map(fmt).join('')
  return escapeHtml(v)
}

export function html(strings, ...values) {
  let out = strings[0]
  for (let i = 0; i < values.length; i++) out += fmt(values[i]) + strings[i + 1]
  return new Raw(out)
}

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

export function render(el, content) {
  el.innerHTML = fmt(content)
}

// Delegated handlers: elements declare data-action="name"; forms declare data-form="name".
export function bind(root, { actions = {}, forms = {}, changes = {} } = {}) {
  root.onclick = (e) => {
    const el = e.target.closest('[data-action]')
    if (!el || !root.contains(el)) return
    const fn = actions[el.dataset.action]
    if (fn) {
      e.preventDefault()
      fn(el, e)
    }
  }
  root.onsubmit = (e) => {
    const form = e.target.closest('form[data-form]')
    if (!form) return
    const fn = forms[form.dataset.form]
    if (fn) {
      e.preventDefault()
      fn(form, e)
    }
  }
  root.onchange = (e) => {
    const el = e.target.closest('[data-change]')
    if (!el || !root.contains(el)) return
    const fn = changes[el.dataset.change]
    if (fn) fn(el, e)
  }
}

// Reads a form into a plain object. Empty strings become null; data-type="number" / checkbox handled.
export function formData(form) {
  const out = {}
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue
    if (el.type === 'checkbox') out[el.name] = el.checked
    else if (el.type === 'file') continue
    else if (el.dataset.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value)
    else out[el.name] = el.value.trim() === '' ? null : el.value.trim()
  }
  return out
}

export const qs = (params) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v)
  const s = u.toString()
  return s ? `?${s}` : ''
}

// Minimal, safe Markdown-ish renderer for AI replies: escape first, then add light structure.
export function renderRichText(text) {
  const lines = escapeHtml(text).split('\n')
  const out = []
  let list = null
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
  const close = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const line of lines) {
    const t = line.trim()
    let m
    if (!t) { close(); continue }
    if ((m = t.match(/^#{1,6}\s+(.*)$/))) { close(); out.push(`<h4>${inline(m[1])}</h4>`); continue }
    if ((m = t.match(/^[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul' } out.push(`<li>${inline(m[1])}</li>`); continue }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol' } out.push(`<li>${inline(m[1])}</li>`); continue }
    close()
    out.push(`<p>${inline(t)}</p>`)
  }
  close()
  return raw(out.join(''))
}
