import { $, $$, bind, html, raw, render } from './dom.js'
import { getLang, t } from './i18n.js'
import { ApiError } from './api.js'

// ---------- Toasts ----------
export function toast(message, type = 'success') {
  const root = document.getElementById('toast-root')
  const el = document.createElement('div')
  const color = type === 'error' ? 'bg-red-600' : type === 'info' ? 'bg-slate-800' : 'bg-emerald-600'
  el.className = `pointer-events-auto ${color} text-white text-sm font-medium rounded-lg shadow-lg px-4 py-3 max-w-md flex items-start gap-2`
  el.setAttribute('role', type === 'error' ? 'alert' : 'status')
  render(el, html`<i class="fas ${type === 'error' ? 'fa-circle-exclamation' : type === 'info' ? 'fa-circle-info' : 'fa-circle-check'} mt-0.5"></i><span>${message}</span>`)
  root.appendChild(el)
  while (root.children.length > 4) root.firstElementChild.remove()
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300) }, type === 'error' ? 7000 : 3500)
}

// Maps API errors to localized, user-facing messages.
export function errorMessage(err) {
  if (!(err instanceof ApiError)) return t('error.generic')
  const byCode = {
    network: 'error.network', unauthorized: 'error.unauthorized', forbidden: 'error.forbidden', not_found: 'error.not_found',
    rate_limited: 'error.rate_limited', trial_expired: 'error.trial_expired', plan_limit_cases: 'error.plan_limit_cases',
    plan_limit_documents: 'error.plan_limit_documents', plan_limit_ai: 'error.plan_limit_ai',
    plan_feature_advanced_analysis: 'error.plan_feature_advanced_analysis', ai_not_configured: 'error.ai_not_configured',
    ai_unavailable: 'error.ai_unavailable', ai_busy: 'error.ai_busy', ai_input_too_long: 'error.ai_input_too_long',
    ai_bad_output: 'error.ai_unavailable', ai_empty: 'error.ai_unavailable', account_locked: 'error.account_locked',
    unsupported_file: 'error.unsupported_file', file_too_large: 'error.file_too_large', unreadable_file: 'error.unreadable_file',
    payload_too_large: 'error.file_too_large', internal_error: 'error.generic'
  }
  if (err.message === 'offline') return t('error.offline')
  const key = byCode[err.code]
  if (key) return t(key)
  if (err.code === 'bad_request' && err.details) return t('error.validation')
  // Server messages are English; show them in the English UI, fall back to a generic message in Arabic.
  if (getLang() === 'en' && err.message && err.status < 500) return err.message
  if (err.status === 409) return t('error.conflict')
  return err.status >= 500 ? t('error.generic') : t('error.request_failed')
}

export function showError(err, form) {
  if (form && err instanceof ApiError && err.details) setFieldErrors(form, err.details)
  let msg = errorMessage(err)
  if (err instanceof ApiError && err.status >= 500 && err.requestId) msg += ` (${t('error.reference')}: ${err.requestId.slice(0, 8)})`
  toast(msg, 'error')
}

export function setFieldErrors(form, details) {
  clearFieldErrors(form)
  for (const d of details || []) {
    const input = form.elements[d.path]
    if (!input || !input.classList) continue
    input.classList.add('invalid')
    input.setAttribute('aria-invalid', 'true')
    const msg = document.createElement('p')
    msg.className = 'field-error'
    msg.textContent = getLang() === 'en' ? d.message : t('error.invalid_value')
    input.insertAdjacentElement('afterend', msg)
  }
  form.querySelector('.invalid')?.focus()
}

export function clearFieldErrors(form) {
  $$('.field-error', form).forEach((e) => e.remove())
  $$('.invalid', form).forEach((e) => { e.classList.remove('invalid'); e.removeAttribute('aria-invalid') })
}

// Disables a button and shows a spinner while `fn` runs.
export async function busy(button, fn) {
  if (!button) return fn()
  if (button.disabled) return
  const original = button.innerHTML
  button.disabled = true
  button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>'
  try {
    return await fn()
  } finally {
    if (button.isConnected) {
      button.disabled = false
      button.innerHTML = original
    }
  }
}

export const submitButton = (form) => form.querySelector('[type=submit]')

// ---------- Modals ----------
export function modal({ title, body, size = 'md', onMount, actions, forms, changes }) {
  const root = document.getElementById('modal-root')
  const wrap = document.createElement('div')
  wrap.className = 'fixed inset-0 z-[90] flex items-start sm:items-center justify-center p-4 overflow-y-auto'
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }
  render(wrap, html`
    <div class="fixed inset-0 bg-slate-900/50" data-action="close-modal"></div>
    <div class="relative bg-white rounded-xl shadow-2xl w-full ${widths[size]} my-8" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h2 id="modal-title" class="text-lg font-semibold">${title}</h2>
        <button class="btn btn-ghost btn-sm" data-action="close-modal" aria-label="${t('common.close')}"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="p-5">${body}</div>
    </div>`)
  root.appendChild(wrap)
  const previousFocus = document.activeElement
  const close = () => {
    wrap.remove()
    document.removeEventListener('keydown', onKey)
    previousFocus?.focus?.()
  }
  const onKey = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)
  bind(wrap, { actions: { 'close-modal': close, ...(actions || {}) }, forms: forms || {}, changes: changes || {} })
  const first = wrap.querySelector('input:not([type=hidden]), select, textarea')
  ;(first || wrap.querySelector('button'))?.focus()
  onMount?.(wrap, close)
  return { el: wrap, close }
}

export function confirmDialog(message, { confirmLabel, danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false
    const m = modal({
      title: t('common.confirm'),
      size: 'sm',
      body: html`
        <p class="text-sm text-slate-700 mb-6">${message}</p>
        <div class="flex justify-end gap-2">
          <button class="btn btn-outline" data-action="no">${t('common.cancel')}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="yes">${confirmLabel || t('common.confirm')}</button>
        </div>`,
      actions: {
        yes: () => { done = true; m.close(); resolve(true) },
        no: () => { m.close(); resolve(false) }
      }
    })
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!done) resolve(false) } })
    obs.observe(document.getElementById('modal-root'), { childList: true })
  })
}

// ---------- Form fields ----------
const req = (required) => (required ? raw(' <span class="text-red-500">*</span>') : '')

export function inputField({ name, label, value = '', type = 'text', required, placeholder, hint, attrs = '', dir, cls = '' }) {
  return html`<div class="${cls}">
    <label class="label" for="f-${name}">${label}${req(required)}</label>
    <input id="f-${name}" name="${name}" type="${type}" class="input" value="${value ?? ''}" ${required ? raw('required') : ''} placeholder="${placeholder || ''}" ${dir ? raw(`dir="${dir}"`) : ''} ${raw(attrs)} />
    ${hint ? html`<p class="hint">${hint}</p>` : ''}
  </div>`
}

export function textareaField({ name, label, value = '', rows = 4, required, placeholder, hint, dir = 'auto', cls = '' }) {
  return html`<div class="${cls}">
    <label class="label" for="f-${name}">${label}${req(required)}</label>
    <textarea id="f-${name}" name="${name}" rows="${rows}" class="input" dir="${dir}" ${required ? raw('required') : ''} placeholder="${placeholder || ''}">${value ?? ''}</textarea>
    ${hint ? html`<p class="hint">${hint}</p>` : ''}
  </div>`
}

export function selectField({ name, label, options, value, required, empty, hint, cls = '', attrs = '' }) {
  return html`<div class="${cls}">
    ${label ? html`<label class="label" for="f-${name}">${label}${req(required)}</label>` : ''}
    <select id="f-${name}" name="${name}" class="input" ${required ? raw('required') : ''} ${raw(attrs)}>
      ${empty !== undefined ? html`<option value="">${empty}</option>` : ''}
      ${options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}
    </select>
    ${hint ? html`<p class="hint">${hint}</p>` : ''}
  </div>`
}

export const formActions = (submitLabel, { cancel = true } = {}) => html`
  <div class="flex justify-end gap-2 pt-4 mt-2 border-t border-slate-100">
    ${cancel ? html`<button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>` : ''}
    <button type="submit" class="btn btn-primary">${submitLabel}</button>
  </div>`

// ---------- Display helpers ----------
const STATUS_COLORS = {
  active: 'bg-emerald-100 text-emerald-800', pending: 'bg-amber-100 text-amber-800', under_review: 'bg-sky-100 text-sky-800',
  on_hold: 'bg-slate-200 text-slate-700', closed: 'bg-slate-100 text-slate-500',
  draft: 'bg-slate-100 text-slate-700', review: 'bg-amber-100 text-amber-800', final: 'bg-emerald-100 text-emerald-800'
}
const PRIORITY_COLORS = { low: 'bg-slate-100 text-slate-600', medium: 'bg-sky-100 text-sky-800', high: 'bg-orange-100 text-orange-800', urgent: 'bg-red-100 text-red-700' }
const SEVERITY_COLORS = { low: 'bg-slate-100 text-slate-700', medium: 'bg-amber-100 text-amber-800', high: 'bg-orange-100 text-orange-800', critical: 'bg-red-100 text-red-700' }
export const EVENT_COLORS = { hearing: 'bg-red-100 text-red-800', deadline: 'bg-amber-100 text-amber-800', filing: 'bg-violet-100 text-violet-800', meeting: 'bg-sky-100 text-sky-800', reminder: 'bg-slate-100 text-slate-700' }

export const statusBadge = (s) => html`<span class="badge ${STATUS_COLORS[s] || 'bg-slate-100'}">${t(`status.${s}`)}</span>`
export const priorityBadge = (p) => html`<span class="badge ${PRIORITY_COLORS[p] || ''}">${t(`priority.${p}`)}</span>`
export const severityBadge = (s) => html`<span class="badge ${SEVERITY_COLORS[s] || ''}">${t(`severity.${s}`)}</span>`
export const eventBadge = (k) => html`<span class="badge ${EVENT_COLORS[k] || ''}">${t(`event.${k}`)}</span>`

export const spinner = () => html`<div class="py-16 flex justify-center text-slate-400"><i class="fas fa-circle-notch fa-spin text-2xl"></i></div>`

export const emptyState = (icon, title, text, action) => html`
  <div class="text-center py-14 px-6">
    <div class="mx-auto w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3"><i class="fas ${icon}"></i></div>
    <h3 class="font-semibold text-slate-800">${title}</h3>
    ${text ? html`<p class="text-sm text-slate-500 mt-1 max-w-sm mx-auto">${text}</p>` : ''}
    ${action ? html`<div class="mt-4">${action}</div>` : ''}
  </div>`

export function pagination({ page, pageSize, total }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return ''
  return html`
    <div class="flex items-center justify-between px-4 py-3 text-sm text-slate-600">
      <span>${t('common.page_of', { page, pages, total })}</span>
      <div class="flex gap-2">
        <button class="btn btn-outline btn-sm" data-action="page" data-page="${page - 1}" ${page <= 1 ? raw('disabled') : ''}><i class="fas fa-chevron-left rtl:rotate-180"></i></button>
        <button class="btn btn-outline btn-sm" data-action="page" data-page="${page + 1}" ${page >= pages ? raw('disabled') : ''}><i class="fas fa-chevron-right rtl:rotate-180"></i></button>
      </div>
    </div>`
}

export const pageHeader = (title, subtitle, actions) => html`
  <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">${title}</h1>
      ${subtitle ? html`<p class="text-sm text-slate-500 mt-1">${subtitle}</p>` : ''}
    </div>
    ${actions ? html`<div class="flex flex-wrap gap-2">${actions}</div>` : ''}
  </div>`

export const aiDisclaimer = () => html`<p class="text-xs text-slate-500 flex items-start gap-1.5"><i class="fas fa-circle-info mt-0.5"></i><span>${t('ai.disclaimer')}</span></p>`

export function debounce(fn, ms = 300) {
  let h
  return (...args) => { clearTimeout(h); h = setTimeout(() => fn(...args), ms) }
}

export { $ }
