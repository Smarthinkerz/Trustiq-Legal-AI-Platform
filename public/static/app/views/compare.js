import { api, download } from '../api.js'
import { html, raw, render } from '../dom.js'
import { fmtDateTime, getLang, t } from '../i18n.js'
import { aiEnabled } from '../store.js'
import { aiDisclaimer, busy, modal, showError, spinner } from '../ui.js'

// ---------------------------------------------------------------------------
// Compare two versions or two documents: redline view, Word export, AI summary.
// ---------------------------------------------------------------------------

export async function openComparePicker(doc, versions) {
  let others = []
  try {
    const q = doc.case_id ? `case_id=${doc.case_id}` : doc.client_id ? `client_id=${doc.client_id}` : ''
    others = (await api.get(`/api/documents?pageSize=50&${q}`)).items.filter((d) => d.id !== doc.id)
    if (q && others.length < 5) others = [...others, ...(await api.get('/api/documents?pageSize=50')).items.filter((d) => d.id !== doc.id && !others.some((o) => o.id === d.id))]
  } catch { /* the version option still works */ }
  const m = modal({
    title: t('cmp.title'),
    body: html`<form data-form="pick" class="space-y-4" novalidate>
      <p class="text-sm text-slate-600">${t('cmp.intro')}</p>
      <label class="flex items-start gap-2 text-sm"><input type="radio" name="mode" value="version" class="mt-1" ${versions.length ? raw('checked') : raw('disabled')} />
        <span class="flex-1"><span class="font-medium">${t('cmp.with_version')}</span>
          <select name="version" class="input mt-2" ${versions.length ? '' : raw('disabled')}>${versions.map((v) => html`<option value="${v.version}">v${v.version} · ${fmtDateTime(v.created_at)}${v.created_by_name ? ` · ${v.created_by_name}` : ''}</option>`)}</select>
          ${versions.length ? '' : html`<span class="hint block">${t('cmp.no_versions')}</span>`}</span></label>
      <label class="flex items-start gap-2 text-sm"><input type="radio" name="mode" value="doc" class="mt-1" ${versions.length ? '' : raw('checked')} ${others.length ? '' : raw('disabled')} />
        <span class="flex-1"><span class="font-medium">${t('cmp.with_document')}</span>
          <select name="other" class="input mt-2" ${others.length ? '' : raw('disabled')}>${others.map((d) => html`<option value="${d.id}">${d.title}${d.case_reference ? ` · ${d.case_reference}` : ''}</option>`)}</select>
          <span class="hint block">${t('cmp.doc_hint')}</span></span></label>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary" ${versions.length || others.length ? '' : raw('disabled')}><i class="fas fa-code-compare"></i>${t('cmp.compare')}</button>
      </div>
    </form>`,
    forms: {
      pick: (form) => {
        const mode = form.querySelector('[name=mode]:checked')?.value
        m.close()
        if (mode === 'version') openCompareView({ document_id: doc.id, version: Number(form.elements.version.value) }, { document_id: doc.id })
        else openCompareView({ document_id: doc.id }, { document_id: form.elements.other.value })
      }
    }
  })
}

const opHtml = (ops, side) => ops.map((o) => {
  if (o.t === 'eq') return html`<span>${o.s}</span>`
  if (o.t === 'ins') return side === 'left' ? '' : html`<ins class="cmp-ins">${o.s}</ins>`
  return side === 'right' ? '' : html`<del class="cmp-del">${o.s}</del>`
})

const IMPACT = { favours_client: 'bg-emerald-100 text-emerald-800', favours_other_side: 'bg-red-100 text-red-700', neutral: 'bg-slate-100 text-slate-700', unclear: 'bg-amber-100 text-amber-800' }
const SEV = { high: 'bg-red-600 text-white', medium: 'bg-amber-500 text-white', low: 'bg-slate-400 text-white' }

export async function openCompareView(left, right) {
  const m = modal({ title: t('cmp.title'), size: 'xl', body: html`<div data-cmp><div class="py-10 flex justify-center">${spinner()}</div></div>` })
  const box = m.el.querySelector('[data-cmp]')
  let state = { left, right, view: 'inline', data: null, summary: null }
  const load = async () => {
    render(box, html`<div class="py-10 flex justify-center">${spinner()}</div>`)
    try { state.data = await api.post('/api/compare', { left: state.left, right: state.right }); state.summary = null; draw() } catch (err) { m.close(); showError(err) }
  }
  const draw = () => {
    const { data: d } = state
    const dir = d.right.language === 'ar' ? 'rtl' : 'ltr'
    const pane = (side, label) => html`<div class="min-w-0"><div class="text-xs font-semibold uppercase text-slate-500 mb-2" dir="auto">${label}</div>
      <div class="cmp-pane whitespace-pre-wrap font-serif text-sm leading-7 max-h-[60vh] overflow-y-auto bg-slate-50 rounded-lg p-4" dir="${dir}">${opHtml(d.ops, side)}</div></div>`
    render(box, html`<div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="text-sm" dir="auto"><span class="text-slate-500">${t('cmp.from')}</span> <b>${d.left.label}</b> <span class="text-slate-400 mx-1">→</span> <span class="text-slate-500">${t('cmp.to')}</span> <b>${d.right.label}</b>
          <button class="btn btn-ghost btn-sm" data-act="swap" title="${t('cmp.swap')}"><i class="fas fa-right-left"></i></button></div>
        <div class="flex flex-wrap gap-2 text-xs">
          ${d.stats.identical ? html`<span class="badge bg-emerald-100 text-emerald-800">${t('cmp.identical')}</span>` : html`
            <span class="badge bg-slate-100 text-slate-700">${t('cmp.changes', { n: d.stats.changes })}</span>
            <span class="badge bg-emerald-50 text-emerald-800">+${d.stats.words_added} ${t('cmp.words')}</span>
            <span class="badge bg-red-50 text-red-700">−${d.stats.words_removed} ${t('cmp.words')}</span>`}
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
          ${['inline', 'side'].map((v) => html`<button class="px-3 py-1 rounded-md ${state.view === v ? 'bg-brand-600 text-white' : 'text-slate-600'}" data-view="${v}">${t(`cmp.view_${v}`)}</button>`)}
        </div>
        ${d.stats.identical ? '' : html`<button class="btn btn-ghost btn-sm" data-act="next"><i class="fas fa-arrow-down"></i>${t('cmp.next_change')}</button>`}
        <span class="flex-1"></span>
        <button class="btn btn-outline btn-sm" data-act="word"><i class="fas fa-file-word"></i>${t('cmp.download')}</button>
        ${aiEnabled() && !d.stats.identical ? html`<button class="btn btn-primary btn-sm" data-act="summary"><i class="fas fa-wand-magic-sparkles"></i>${t('cmp.summarise')}</button>` : ''}
      </div>
      <div data-summary>${state.summary ? summaryHtml(state.summary) : ''}</div>
      ${state.view === 'inline'
        ? html`<div class="cmp-pane whitespace-pre-wrap font-serif text-sm leading-7 max-h-[60vh] overflow-y-auto bg-slate-50 rounded-lg p-4" dir="${dir}">${opHtml(d.ops, 'both')}</div>`
        : html`<div class="grid md:grid-cols-2 gap-4">${pane('left', d.left.label)}${pane('right', d.right.label)}</div>`}
      <p class="text-xs text-slate-500"><ins class="cmp-ins">${t('cmp.legend_ins')}</ins> · <del class="cmp-del">${t('cmp.legend_del')}</del></p>
    </div>`)
  }
  const summaryHtml = (s) => html`<section class="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-3" dir="${s.lang === 'ar' ? 'rtl' : 'ltr'}">
    <h3 class="font-semibold text-sm"><i class="fas fa-wand-magic-sparkles text-violet-500"></i> ${t('cmp.summary_title')}${s.acting_for ? html` <span class="font-normal text-slate-500">· ${t('cmp.acting_for', { name: s.acting_for })}</span>` : ''}</h3>
    ${s.summary.overview ? html`<p class="text-sm leading-relaxed">${s.summary.overview}</p>` : ''}
    ${s.summary.items.length ? html`<ul class="space-y-2">${s.summary.items.map((i) => html`<li class="rounded-lg bg-white border border-slate-200 p-3">
      <div class="flex flex-wrap items-center gap-2 mb-1"><span class="badge ${SEV[i.severity]}">${t(`cmp.sev_${i.severity}`)}</span><span class="badge ${IMPACT[i.impact]}">${t(`cmp.impact_${i.impact}`)}</span>${i.clause ? html`<span class="text-xs text-slate-500">${i.clause}</span>` : ''}</div>
      <p class="text-sm">${i.change}</p>${i.recommendation ? html`<p class="text-sm text-emerald-800 mt-1"><i class="fas fa-lightbulb"></i> ${i.recommendation}</p>` : ''}</li>`)}</ul>` : ''}
    ${s.summary.questions.length ? html`<div><h4 class="text-xs font-semibold uppercase text-slate-500 mb-1">${t('cmp.questions')}</h4><ul class="list-disc ps-5 text-sm space-y-0.5">${s.summary.questions.map((q) => html`<li>${q}</li>`)}</ul></div>` : ''}
    ${s.truncated ? html`<p class="text-xs text-amber-700">${t('cmp.truncated')}</p>` : ''}
    ${aiDisclaimer('compare')}
  </section>`
  box.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]')
    if (v) { state.view = v.dataset.view; draw(); return }
    const el = e.target.closest('[data-act]')
    if (!el) return
    const act = el.dataset.act
    if (act === 'swap') { state = { ...state, left: state.right, right: state.left }; load() }
    if (act === 'word') {
      const q = new URLSearchParams({ left: state.left.document_id, right: state.right.document_id })
      if (state.left.version) q.set('lv', state.left.version)
      if (state.right.version) q.set('rv', state.right.version)
      download(`/api/compare/docx?${q}`)
    }
    if (act === 'next') {
      const marks = [...box.querySelectorAll('.cmp-ins, .cmp-del')].filter((x) => x.closest('.cmp-pane'))
      const pane = box.querySelector('.cmp-pane')
      const top = pane.getBoundingClientRect().top
      const next = marks.find((x) => x.getBoundingClientRect().top > top + 40) || marks[0]
      next?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      next?.classList.add('cmp-flash'); setTimeout(() => next?.classList.remove('cmp-flash'), 1200)
    }
    if (act === 'summary') busy(el, async () => {
      const lang = getLang()
      render(box.querySelector('[data-summary]'), html`<div class="py-6 text-center text-sm text-slate-500">${spinner()}<p class="mt-2">${t('cmp.summarising')}</p></div>`)
      try {
        const r = await api.post('/api/compare/summary', { left: state.left, right: state.right, language: lang })
        state.summary = { ...r, lang }
      } catch (err) { showError(err) }
      draw()
    })
  })
  load()
}
