import { api } from '../api.js'
import { html, render } from '../dom.js'
import { fmtDateTime, getLang, t } from '../i18n.js'
import { readOnly } from '../store.js'
import { busy, modal, showError, spinner, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// AI case brief: a one-page summary of where a matter stands.
// ---------------------------------------------------------------------------

const RISK = { low: 'bg-emerald-100 text-emerald-800', medium: 'bg-amber-100 text-amber-800', high: 'bg-red-100 text-red-700' }

function briefBody(b) {
  const c = b.content
  const ar = b.language === 'ar'
  const L = (k) => t(`brief.${k}`, {}, b.language)
  const sec = (key, inner) => html`<section class="space-y-1.5"><h3 class="text-sm font-semibold text-brand-700">${L(key)}</h3>${inner}</section>`
  const ul = (items) => html`<ul class="list-disc ps-5 space-y-1 text-sm">${items.map((i) => html`<li>${i}</li>`)}</ul>`
  return html`<article class="space-y-5" dir="${ar ? 'rtl' : 'ltr'}" lang="${b.language}">
    ${sec('overview', html`<p class="text-sm leading-relaxed">${c.overview}</p>`)}
    ${c.status ? sec('status', html`<p class="text-sm leading-relaxed">${c.status}</p>`) : ''}
    ${c.parties.length ? sec('parties', html`<ul class="text-sm space-y-0.5">${c.parties.map((p) => html`<li>${p.role ? html`<span class="text-slate-500">${p.role}:</span> ` : ''}${p.name}</li>`)}</ul>`) : ''}
    ${c.key_facts.length ? sec('key_facts', ul(c.key_facts)) : ''}
    ${c.procedural_history.length ? sec('procedural_history', html`<ol class="text-sm space-y-1">${c.procedural_history.map((h) => html`<li class="flex gap-3"><span class="font-mono text-xs text-slate-500 w-24 shrink-0" dir="ltr">${h.date}</span><span>${h.event}</span></li>`)}</ol>`) : ''}
    ${c.next_steps.length ? sec('next_steps', html`<ul class="text-sm space-y-1">${c.next_steps.map((s) => html`<li class="flex gap-2"><i class="fas fa-arrow-right text-brand-500 mt-1 text-xs ${ar ? 'rotate-180' : ''}"></i><span>${s.action}${s.due ? html` <span class="text-slate-500" dir="ltr">(${s.due})</span>` : ''}${s.owner ? html` <span class="text-slate-500">– ${s.owner}</span>` : ''}</span></li>`)}</ul>`) : ''}
    ${c.deadlines.length ? sec('deadlines', html`<ul class="text-sm space-y-1">${c.deadlines.map((d) => html`<li class="flex gap-3"><span class="font-mono text-xs text-red-700 w-24 shrink-0" dir="ltr">${d.date}</span><span>${d.item}</span></li>`)}</ul>`) : ''}
    ${c.risks.length ? sec('risks', html`<ul class="text-sm space-y-1.5">${c.risks.map((r) => html`<li class="flex items-start gap-2"><span class="badge ${RISK[r.severity]} shrink-0">${L(`risk_${r.severity}`)}</span><span>${r.risk}</span></li>`)}</ul>`) : ''}
    ${c.open_questions.length ? sec('open_questions', ul(c.open_questions)) : ''}
  </article>`
}

const plainText = (root) => root.querySelector('article')?.innerText || ''

export function openCaseBrief(kase) {
  let lang = getLang()
  let state = { brief: null, stale: false }
  const m = modal({ title: t('brief.title'), size: 'lg', body: html`<div data-brief></div>` })
  const box = m.el.querySelector('[data-brief]')
  const canEdit = !readOnly()

  const draw = () => {
    const b = state.brief
    render(box, html`<div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="group" aria-label="${t('brief.language')}">
          ${['en', 'ar'].map((l) => html`<button class="px-3 py-1 rounded-md ${l === lang ? 'bg-brand-600 text-white' : 'text-slate-600'}" data-lang="${l}">${l === 'en' ? 'English' : 'العربية'}</button>`)}
        </div>
        <div class="flex flex-wrap gap-2">
          ${b ? html`<button class="btn btn-ghost btn-sm" data-act="copy"><i class="fas fa-copy"></i>${t('common.copy')}</button>
            ${canEdit ? html`<button class="btn btn-outline btn-sm" data-act="save"><i class="fas fa-file-word"></i>${b.document_id ? t('brief.open_document') : t('brief.save')}</button>` : ''}` : ''}
          ${canEdit ? html`<button class="btn btn-primary btn-sm" data-act="generate"><i class="fas fa-wand-magic-sparkles"></i>${b ? t('brief.regenerate') : t('brief.generate')}</button>` : ''}
        </div>
      </div>
      ${b ? html`<p class="text-xs text-slate-500">${t('brief.generated', { when: fmtDateTime(b.created_at), who: b.created_by_name || '' })}
        ${state.stale ? html` · <span class="text-amber-700 font-semibold"><i class="fas fa-clock-rotate-left"></i> ${t('brief.stale')}</span>` : ''}</p>
        <div class="rounded-xl border border-slate-200 p-5 max-h-[60vh] overflow-y-auto">${briefBody(b)}</div>
        <p class="text-xs text-slate-500"><i class="fas fa-circle-info"></i> ${t('brief.disclaimer')}</p>`
      : html`<div class="text-center py-10 text-slate-500"><i class="fas fa-file-lines text-3xl text-slate-300"></i><p class="mt-3 text-sm">${t('brief.empty')}</p></div>`}
    </div>`)
  }
  const load = async () => {
    render(box, html`<div class="py-10 flex justify-center">${spinner()}</div>`)
    try { state = await api.get(`/api/ai/cases/${kase.id}/brief?language=${lang}`); draw() } catch (err) { m.close(); showError(err) }
  }
  box.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-lang],[data-act]')
    if (!el) return
    if (el.dataset.lang) { if (el.dataset.lang !== lang) { lang = el.dataset.lang; load() } return }
    const act = el.dataset.act
    if (act === 'copy') { try { await navigator.clipboard.writeText(plainText(box)); toast(t('common.copied')) } catch { toast(t('error.generic'), 'error') } }
    if (act === 'generate') busy(el, async () => {
      render(box.querySelector('.rounded-xl') || box, html`<div class="py-10 text-center text-sm text-slate-500">${spinner()}<p class="mt-3">${t('brief.working')}</p></div>`)
      try { state = await api.post(`/api/ai/cases/${kase.id}/brief`, { language: lang }); draw() } catch (err) { showError(err); draw() }
    })
    if (act === 'save') {
      if (state.brief.document_id) { m.close(); location.hash = `#/documents/${state.brief.document_id}`; return }
      busy(el, async () => {
        try {
          const r = await api.post(`/api/ai/cases/${kase.id}/brief/${state.brief.id}/save`)
          toast(t('brief.saved'))
          m.close()
          location.hash = `#/documents/${r.document.id}`
        } catch (err) { showError(err) }
      })
    }
  })
  load()
}
