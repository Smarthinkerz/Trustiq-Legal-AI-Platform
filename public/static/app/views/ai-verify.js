import { api } from '../api.js'
import { html, render } from '../dom.js'
import { fmtDateTime, getLang, t } from '../i18n.js'
import { can } from '../store.js'
import { showError, toast } from '../ui.js'

// Result of the automatic citation check shown under an AI answer.
const STATUS_STYLE = {
  passed: ['bg-emerald-50 text-emerald-700', 'fa-circle-check', 'verify.passed'],
  passed_with_warnings: ['bg-amber-50 text-amber-800', 'fa-triangle-exclamation', 'verify.passed_with_warnings'],
  failed: ['bg-red-50 text-red-700', 'fa-circle-xmark', 'verify.failed'],
  unverified: ['bg-slate-100 text-slate-600', 'fa-circle-info', 'verify.unverified']
}

export function verificationBadge(v) {
  if (!v) return ''
  const [cls, icon, key] = STATUS_STYLE[v.status] ?? STATUS_STYLE.unverified
  return html`<span class="badge ${cls}"><i class="fas ${icon}"></i> ${t(key)}</span>`
}

export function verificationPanel(v) {
  if (!v) return ''
  const findings = (v.checks ?? []).filter((c) => c.severity !== 'info')
  const ok = (v.checks ?? []).filter((c) => c.severity === 'info').length
  return html`<details class="mt-2 max-w-3xl w-full text-xs" ${v.status === 'failed' ? 'open' : ''}>
    <summary class="cursor-pointer select-none flex flex-wrap items-center gap-2">${verificationBadge(v)}
      <span class="text-slate-500">${t('verify.summary', { citations: v.citations, errors: v.errors, warnings: v.warnings, date: v.as_of })}</span></summary>
    <ul class="mt-2 space-y-1">
      ${findings.map((c) => html`<li class="flex gap-2 ${c.severity === 'error' ? 'text-red-700' : 'text-amber-800'}">
        <i class="fas ${c.severity === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation'} mt-0.5"></i>
        <span dir="auto">${c.ref ? html`<b>[${c.ref}]</b> ` : ''}${c.detail}${c.text ? html` <q class="text-slate-500" dir="auto">${c.text}</q>` : ''}</span></li>`)}
      ${ok ? html`<li class="text-slate-500"><i class="fas fa-check"></i> ${t('verify.ok_checks', { n: ok })}</li>` : ''}
    </ul>
    <p class="text-slate-400 mt-1">${t('verify.note')}</p>
  </details>`
}

// Records that the signed-in lawyer checked an AI output against the primary sources.
export async function markReviewed(logId) {
  const note = prompt(t('verify.review_prompt')) // eslint-disable-line no-alert
  if (note === null) return false
  try {
    await api.post(`/api/ai/log/${logId}/review`, { note: note.trim() || null })
    toast(t('verify.reviewed_toast'))
    return true
  } catch (err) {
    showError(err)
    return false
  }
}

const FEATURE_KEYS = { chat: 'ai_feature.chat', draft: 'ai_feature.draft', brief: 'verify.feature_brief' }
const featureLabel = (f) => (FEATURE_KEYS[f] ? t(FEATURE_KEYS[f]) : f.startsWith('analysis:') ? `${t('ai_feature.analysis')} (${t(`analysis.type_${f.slice(9)}`)})` : f)

export function exportLinks(filter) {
  const q = new URLSearchParams(filter).toString()
  return html`<div class="flex flex-wrap gap-2 text-xs">
    <a class="btn btn-outline btn-sm" href="/api/ai/log/export?${q}&format=txt&lang=${getLang()}" download><i class="fas fa-file-lines"></i>${t('verify.export_statement')}</a>
    <a class="btn btn-ghost btn-sm" href="/api/ai/log/export?${q}&format=csv" download><i class="fas fa-file-csv"></i>CSV</a>
    <a class="btn btn-ghost btn-sm" href="/api/ai/log/export?${q}&format=json" download><i class="fas fa-file-code"></i>JSON</a>
  </div>`
}

// "AI use and verification log" card for a document (QICDRC disclosure record).
export async function mountAiLog(container, filter) {
  let items
  try {
    ({ items } = await api.get(`/api/ai/log?${new URLSearchParams(filter)}`))
  } catch { return }
  const draw = () => render(container, html`<section class="card">
    <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold"><i class="fas fa-clipboard-check text-violet-500"></i> ${t('verify.log_title')}</h2>
      ${items.length ? exportLinks(filter) : ''}
    </div>
    ${items.length ? html`<ul class="divide-y divide-slate-100">${items.map((e) => html`<li class="px-5 py-3 text-sm space-y-1">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-medium">${featureLabel(e.feature)}</span>
        ${e.verification ? verificationBadge(e.verification) : html`<span class="text-xs text-slate-400">${t('verify.not_checked')}</span>`}
      </div>
      <div class="text-xs text-slate-500">${fmtDateTime(e.created_at)}${e.user_name ? ` · ${e.user_name}` : ''}${e.model ? ` · ${e.model}` : ''}</div>
      ${e.sources?.length ? html`<div class="text-xs text-slate-600" dir="auto">${e.sources.map((s) => s.citation).join(' · ')}</div>` : ''}
      ${e.reviewed_at
        ? html`<div class="text-xs text-emerald-700"><i class="fas fa-user-check"></i> ${t('verify.reviewed_by', { name: e.reviewed_by_name || '', date: fmtDateTime(e.reviewed_at) })}${e.review_note ? html` – <span dir="auto">${e.review_note}</span>` : ''}</div>`
        : can('owner', 'admin', 'lawyer') ? html`<button class="btn btn-outline btn-sm" data-review="${e.id}"><i class="fas fa-user-check"></i>${t('verify.mark_reviewed')}</button>` : ''}
    </li>`)}</ul>` : html`<p class="px-5 py-4 text-sm text-slate-500">${t('verify.log_empty')}</p>`}
  </section>`)
  draw()
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-review]')
    if (!btn) return
    e.preventDefault()
    if (await markReviewed(btn.dataset.review)) {
      ({ items } = await api.get(`/api/ai/log?${new URLSearchParams(filter)}`))
      draw()
    }
  })
}
