import { api, download } from '../api.js'
import { bind, formData, html, qs, raw, render } from '../dom.js'
import { fmtBytes, fmtDateTime, fmtRelative, getLang, t } from '../i18n.js'
import { aiEnabled, can, canDelete, readOnly, refLabel, refOptions, store } from '../store.js'
import {
  aiDisclaimer, busy, clearFieldErrors, confirmDialog, debounce, emptyState, formActions, inputField, modal, pageHeader,
  pagination, selectField, severityBadge, showError, spinner, statusBadge, submitButton, textareaField, toast
} from '../ui.js'
import { searchPicker, wirePickers } from './pickers.js'
import { setLeaveGuard } from '../main.js'
import { openSignatureDialog } from './signatures.js'

const DOC_STATUSES = ['draft', 'review', 'final']
const OTHER_TYPES = ['contract', 'correspondence', 'evidence', 'court_filing', 'other']

export const docTypeOptions = () => [
  ...refOptions('templates'),
  ...OTHER_TYPES.map((id) => ({ value: id, label: t(`doctype.${id}`) }))
]
export const docTypeLabel = (id) => (OTHER_TYPES.includes(id) ? t(`doctype.${id}`) : refLabel('templates', id))
const langOptions = () => [{ value: 'en', label: t('common.english') }, { value: 'ar', label: t('common.arabic') }]

export function openUploadForm({ caseId, caseLabel, clientId, onSaved } = {}) {
  const maxMb = 15
  const m = modal({
    title: t('docs.upload'),
    body: html`
      <form data-form="upload" class="space-y-4" novalidate>
        <div>
          <label class="label" for="f-file">${t('docs.file')} <span class="text-red-500">*</span></label>
          <input id="f-file" name="file" type="file" required accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            class="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:font-semibold file:text-brand-700 hover:file:bg-brand-100" />
          <p class="hint">${t('docs.upload_hint', { mb: maxMb })}</p>
        </div>
        ${inputField({ name: 'title', label: t('docs.title'), hint: t('docs.title_hint') })}
        <div class="grid sm:grid-cols-2 gap-4">
          ${selectField({ name: 'doc_type', label: t('docs.type'), options: docTypeOptions(), value: 'contract' })}
          ${selectField({ name: 'language', label: t('docs.language'), options: langOptions(), value: getLang() })}
        </div>
        ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: refOptions('jurisdictions'), value: store.me.org.default_jurisdiction, empty: '—' })}
        ${searchPicker({ name: 'case_id', label: t('docs.case'), value: caseId, valueLabel: caseLabel })}
        ${clientId ? html`<input type="hidden" name="client_id" value="${clientId}" />` : ''}
        ${formActions(t('docs.upload'))}
      </form>`,
    onMount: (el) => wirePickers(el),
    forms: {
      upload: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const file = form.elements.file.files[0]
        if (!file) return toast(t('docs.choose_file'), 'error')
        if (file.size > maxMb * 1048576) return toast(t('error.file_too_large'), 'error')
        const fd = new FormData()
        fd.set('file', file)
        for (const [k, v] of Object.entries(formData(form))) if (v != null) fd.set(k, v)
        try {
          const res = await api.upload('/api/documents/upload', fd)
          m.close()
          toast(res.warning === 'little_text' ? t('docs.uploaded_no_text') : res.ocr ? t('docs.uploaded_ocr') : t('docs.uploaded'), res.warning ? 'info' : 'success')
          onSaved?.(res.document)
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export function openDraftForm({ caseId, caseLabel, clientId, jurisdiction, onSaved } = {}) {
  const m = modal({
    title: t('docs.ai_draft'),
    size: 'lg',
    body: html`
      <form data-form="draft" class="space-y-4" novalidate>
        <div class="grid sm:grid-cols-2 gap-4">
          ${selectField({ name: 'template', label: t('docs.template'), options: refOptions('templates'), required: true })}
          ${selectField({ name: 'language', label: t('docs.language'), options: langOptions(), value: getLang() })}
          ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: refOptions('jurisdictions'), value: jurisdiction || store.me.org.default_jurisdiction, required: true })}
          ${inputField({ name: 'title', label: t('docs.title'), hint: t('docs.title_optional') })}
        </div>
        ${textareaField({ name: 'parties', label: t('docs.parties'), rows: 2, placeholder: t('docs.parties_placeholder') })}
        ${textareaField({ name: 'instructions', label: t('docs.instructions'), rows: 6, required: true, placeholder: t('docs.instructions_placeholder') })}
        ${searchPicker({ name: 'case_id', label: t('docs.case'), value: caseId, valueLabel: caseLabel })}
        ${clientId ? html`<input type="hidden" name="client_id" value="${clientId}" />` : ''}
        ${aiDisclaimer()}
        <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-wand-magic-sparkles"></i>${t('docs.generate')}</button>
        </div>
      </form>`,
    onMount: (el) => wirePickers(el),
    forms: {
      draft: (form) => {
        const btn = submitButton(form)
        return busy(btn, async () => {
          clearFieldErrors(form)
          btn.insertAdjacentHTML('beforebegin', `<span class="text-sm text-slate-500 self-center" data-drafting>${t('docs.drafting')}</span>`)
          try {
            const res = await api.post('/api/ai/draft', formData(form))
            m.close()
            toast(t('docs.drafted'))
            onSaved?.(res.document)
          } catch (err) {
            showError(err, form)
          } finally {
            form.querySelector('[data-drafting]')?.remove()
          }
        })
      }
    }
  })
}

function openNewDocumentForm({ onSaved }) {
  const m = modal({
    title: t('docs.new_blank'),
    body: html`<form data-form="create" class="space-y-4" novalidate>
      ${inputField({ name: 'title', label: t('docs.title'), required: true })}
      <div class="grid sm:grid-cols-2 gap-4">
        ${selectField({ name: 'doc_type', label: t('docs.type'), options: docTypeOptions(), value: 'other' })}
        ${selectField({ name: 'language', label: t('docs.language'), options: langOptions(), value: getLang() })}
      </div>
      ${searchPicker({ name: 'case_id', label: t('docs.case') })}
      ${formActions(t('common.create'))}
    </form>`,
    onMount: (el) => wirePickers(el),
    forms: {
      create: (form) => busy(submitButton(form), async () => {
        try {
          const res = await api.post('/api/documents', { ...formData(form), content: '' })
          m.close()
          onSaved(res.document)
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function documentsListView(root, { query, isCurrent }) {
  const state = { page: Number(query.get('page')) || 1, q: query.get('q') || '', status: query.get('status') || '' }
  const ro = readOnly()
  render(root, html`
    ${pageHeader(t('nav.documents'), t('docs.subtitle'), ro ? '' : html`
      <button class="btn btn-outline" data-action="new-blank"><i class="fas fa-file-circle-plus"></i>${t('docs.new_blank')}</button>
      <button class="btn btn-outline" data-action="upload"><i class="fas fa-upload"></i>${t('docs.upload')}</button>
      ${aiEnabled() ? html`<button class="btn btn-primary" data-action="draft"><i class="fas fa-pen-nib"></i>${t('docs.ai_draft')}</button>` : ''}`)}
    <div class="card">
      <div class="p-4 border-b border-slate-100 flex flex-wrap gap-3">
        <div class="relative flex-1 min-w-52">
          <i class="fas fa-magnifying-glass absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm"></i>
          <input type="search" class="input ps-9" data-search placeholder="${t('docs.search_placeholder')}" value="${state.q}" aria-label="${t('common.search')}" />
        </div>
        ${selectField({ name: 'status', options: DOC_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })), value: state.status, empty: t('docs.any_status'), cls: 'w-40', attrs: `data-change="filter" aria-label="${t('common.status')}"` })}
      </div>
      <div id="results">${spinner()}</div>
    </div>`)
  const results = root.querySelector('#results')
  const load = async () => {
    const res = await api.get('/api/documents' + qs({ page: state.page, q: state.q, status: state.status }))
    if (!isCurrent()) return
    render(results, res.items.length ? html`
      <div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('docs.title')}</th><th>${t('docs.type')}</th><th>${t('docs.case')}</th><th>${t('common.status')}</th><th>${t('docs.risk')}</th><th>${t('common.updated')}</th></tr></thead>
        <tbody>${res.items.map((d) => html`<tr class="clickable" data-action="open" data-id="${d.id}">
          <td><div class="flex items-center gap-2">
            <i class="fas ${d.source === 'ai' ? 'fa-wand-magic-sparkles text-violet-500' : d.source === 'upload' ? 'fa-file-arrow-up text-sky-500' : 'fa-file-lines text-slate-400'}" title="${t(`docs.source_${d.source}`)}"></i>
            <div class="min-w-0"><div class="font-medium truncate max-w-md" dir="auto">${d.title}</div>
            <div class="text-xs text-slate-400">${d.file_name ? html`${d.file_name} · ${fmtBytes(d.file_size)}` : html`v${d.version}`}${d.language === 'ar' ? ' · ' + t('common.arabic') : ''}</div></div></div></td>
          <td class="text-slate-600 text-xs">${docTypeLabel(d.doc_type)}</td>
          <td class="text-xs">${d.case_id ? html`<span class="font-mono text-slate-500">${d.case_reference}</span>` : d.client_name || '—'}</td>
          <td>${statusBadge(d.status)}</td>
          <td>${d.last_risk_score != null ? riskPill(d.last_risk_score) : html`<span class="text-slate-300">—</span>`}</td>
          <td class="text-xs text-slate-500 whitespace-nowrap">${fmtRelative(d.updated_at)}</td>
        </tr>`)}</tbody></table></div>
      ${pagination(res)}`
      : state.q || state.status
        ? emptyState('fa-magnifying-glass', t('common.no_results'), '')
        : emptyState('fa-file-lines', t('docs.empty_title'), t('docs.empty_text'), ro ? '' : html`<button class="btn btn-primary" data-action="upload">${t('docs.upload')}</button>`))
  }
  const reload = () => {
    history.replaceState(null, '', '#/documents' + qs({ q: state.q, status: state.status, page: state.page > 1 ? state.page : '' }))
    load().catch(showError)
  }
  const go = (d) => (location.hash = `#/documents/${d.id}`)
  bind(root, {
    actions: {
      upload: () => openUploadForm({ onSaved: go }),
      draft: () => openDraftForm({ onSaved: go }),
      'new-blank': () => openNewDocumentForm({ onSaved: go }),
      open: (el) => (location.hash = `#/documents/${el.dataset.id}`),
      page: (el) => { state.page = Number(el.dataset.page); reload() }
    },
    changes: { filter: (el) => { state[el.name] = el.value; state.page = 1; reload() } }
  })
  root.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; reload() }))
  await load()
}

const riskColor = (score) => (score >= 75 ? 'bg-red-100 text-red-700' : score >= 50 ? 'bg-orange-100 text-orange-800' : score >= 25 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')
const riskPill = (score) => html`<span class="badge ${riskColor(score)}">${score}</span>`

function analysisCard(a, expanded) {
  const r = a.result
  const dir = a.language === 'ar' ? 'rtl' : 'ltr'
  return html`<details class="card overflow-hidden" ${expanded ? raw('open') : ''}>
    <summary class="px-5 py-4 cursor-pointer flex flex-wrap items-center gap-3 hover:bg-slate-50">
      <span class="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${riskColor(r.risk_score)}">${r.risk_score}</span>
      <div class="flex-1 min-w-0">
        <div class="font-semibold">${t(`analysis.type_${a.analysis_type}`)}</div>
        <div class="text-xs text-slate-500">${fmtDateTime(a.created_at)} · ${a.created_by_name || ''} · ${refLabel('jurisdictions', a.jurisdiction)}</div>
      </div>
      ${severityBadge(r.risk_level)}
    </summary>
    <div class="px-5 pb-5 space-y-5 border-t border-slate-100 pt-4" dir="${dir}">
      ${r.summary ? html`<div><h4 class="text-xs font-semibold uppercase text-slate-500 mb-1">${t('analysis.summary')}</h4><p class="text-sm leading-relaxed whitespace-pre-wrap">${r.summary}</p></div>` : ''}
      ${r.parties?.length ? html`<div><h4 class="text-xs font-semibold uppercase text-slate-500 mb-1">${t('analysis.parties')}</h4><p class="text-sm">${r.parties.join(' · ')}</p></div>` : ''}
      ${r.key_terms?.length ? html`<div><h4 class="text-xs font-semibold uppercase text-slate-500 mb-2">${t('analysis.key_terms')}</h4>
        <dl class="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">${r.key_terms.map((k) => html`<div><dt class="text-slate-500 text-xs">${k.label}</dt><dd>${k.value}</dd></div>`)}</dl></div>` : ''}
      ${r.issues?.length ? html`<div><h4 class="text-xs font-semibold uppercase text-slate-500 mb-2">${t('analysis.issues')} (${r.issues.length})</h4>
        <ul class="space-y-3">${[...r.issues].sort((x, y) => sevRank(y.severity) - sevRank(x.severity)).map((i) => html`<li class="rounded-lg border border-slate-200 p-3">
          <div class="flex flex-wrap items-center gap-2 mb-1">${severityBadge(i.severity)}${i.clause ? html`<span class="text-xs font-medium text-slate-500">${i.clause}</span>` : ''}</div>
          <p class="text-sm text-slate-800">${i.issue}</p>
          ${i.recommendation ? html`<p class="text-sm text-emerald-800 mt-1"><i class="fas fa-lightbulb"></i> ${i.recommendation}</p>` : ''}
        </li>`)}</ul></div>` : ''}
      ${r.missing_clauses?.length ? html`<div><h4 class="text-xs font-semibold uppercase text-slate-500 mb-1">${t('analysis.missing')}</h4><ul class="list-disc ps-5 text-sm space-y-0.5">${r.missing_clauses.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''}
      ${r.next_steps?.length ? html`<div><h4 class="text-xs font-semibold uppercase text-slate-500 mb-1">${t('analysis.next_steps')}</h4><ol class="list-decimal ps-5 text-sm space-y-0.5">${r.next_steps.map((x) => html`<li>${x}</li>`)}</ol></div>` : ''}
    </div>
  </details>`
}
const sevRank = (s) => ({ low: 0, medium: 1, high: 2, critical: 3 })[s] ?? 1

export async function documentDetailView(root, { params, isCurrent, rerender }) {
  const { document: d, versions, analyses } = await api.get(`/api/documents/${params.id}`)
  if (!isCurrent()) return
  const ro = readOnly()
  const advanced = store.me.plan.advancedAnalysis
  const dir = d.language === 'ar' ? 'rtl' : 'ltr'

  render(root, html`
    <nav class="text-sm text-slate-500 mb-3"><a href="#/documents" class="hover:underline">${t('nav.documents')}</a>
      ${d.case_id ? html` <i class="fas fa-chevron-right text-xs mx-1 rtl:rotate-180"></i> <a class="hover:underline font-mono" href="#/cases/${d.case_id}">${d.case_reference}</a>` : ''}</nav>
    <div class="flex flex-wrap items-start justify-between gap-4 mb-4">
      <div class="min-w-0 flex-1">
        ${ro ? html`<h1 class="text-2xl font-bold" dir="auto">${d.title}</h1>`
          : html`<input class="text-2xl font-bold w-full bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-500 focus:outline-none px-0" dir="auto" data-title value="${d.title}" aria-label="${t('docs.title')}" maxlength="300" />`}
        <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-500">
          ${statusBadge(d.status)}
          <span>${docTypeLabel(d.doc_type)}</span><span>·</span>
          <span>${t(`docs.source_${d.source}`)}</span><span>·</span>
          <span>v${d.version}</span><span>·</span>
          <span>${t('common.updated')} ${fmtRelative(d.updated_at)}</span>
          ${d.client_id ? html`<span>·</span><a class="text-brand-600 hover:underline" href="#/clients/${d.client_id}">${d.client_name}</a>` : ''}
          ${d.ocr ? html`<span>·</span><span title="${t('docs.ocr_help')}"><i class="fas fa-eye"></i> ${t('docs.ocr')}</span>` : ''}
          ${d.uploaded_by_client ? html`<span class="badge bg-sky-100 text-sky-800">${t('docs.from_client')}</span>` : ''}
        </div>
        ${d.client_id && !ro ? html`<label class="inline-flex items-center gap-2 text-sm mt-3 text-slate-700"><input type="checkbox" data-change="share" ${d.shared_with_client ? raw('checked') : ''} />
          <i class="fas fa-door-open text-slate-400"></i>${t('docs.share_with_client')}</label>` : ''}
      </div>
      <div class="flex flex-wrap gap-2">
        ${ro ? '' : selectField({ name: 'status', options: DOC_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })), value: d.status, cls: 'w-32', attrs: `data-change="status" aria-label="${t('common.status')}"` })}
        <button class="btn btn-outline" data-action="export"><i class="fas fa-file-word"></i>${t('docs.export_word')}</button>
        ${!ro && can('owner', 'admin', 'lawyer') ? html`<button class="btn btn-outline" data-action="sign"><i class="fas fa-signature"></i>${t('sig.send_for_signature')}</button>` : ''}
        ${d.file_name ? html`<button class="btn btn-outline" data-action="original" title="${d.file_name}"><i class="fas fa-download"></i>${t('docs.original')}</button>` : ''}
        ${canDelete() && !ro ? html`<button class="btn btn-danger-ghost" data-action="delete" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>

    <div class="grid xl:grid-cols-5 gap-6">
      <div class="xl:col-span-3 space-y-3">
        <textarea class="doc-editor" data-editor dir="${dir}" ${ro ? raw('readonly') : ''} spellcheck="true" aria-label="${t('docs.content')}" placeholder="${t('docs.content_placeholder')}">${d.content}</textarea>
        ${ro ? '' : html`<div class="flex items-center justify-between gap-3">
          <span class="text-xs text-slate-500" data-save-state>${t('docs.all_saved')}</span>
          <button class="btn btn-primary" data-action="save" disabled><i class="fas fa-floppy-disk"></i>${t('common.save')}</button>
        </div>`}
      </div>

      <div class="xl:col-span-2 space-y-6">
        <section class="card card-pad">
          <h2 class="font-semibold mb-3"><i class="fas fa-magnifying-glass-chart text-violet-500"></i> ${t('analysis.title')}</h2>
          ${!aiEnabled() ? html`<p class="text-sm text-slate-500">${t('ai.not_configured_banner')}</p>` : ro ? '' : html`
            <form data-form="analyze" class="grid grid-cols-2 gap-3">
              ${selectField({ name: 'type', label: t('analysis.type'), options: ['review', 'risk', 'compliance', 'summary'].map((x) => ({ value: x, label: t(`analysis.type_${x}`) + (x !== 'summary' && !advanced ? ' 🔒' : '') })), value: advanced ? 'review' : 'summary' })}
              ${selectField({ name: 'language', label: t('analysis.output_language'), options: langOptions(), value: getLang() })}
              <button type="submit" class="btn btn-primary col-span-2"><i class="fas fa-wand-magic-sparkles"></i>${t('analysis.run')}</button>
              ${!advanced ? html`<p class="hint col-span-2">${t('analysis.upgrade_hint')}</p>` : ''}
            </form>
            <div class="mt-3">${aiDisclaimer()}</div>`}
        </section>
        <div class="space-y-3" data-analyses>
          ${analyses.map((a, i) => analysisCard(a, i === 0))}
        </div>
        ${versions.length ? html`<section class="card">
          <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('docs.history')}</h2></div>
          <ul class="divide-y divide-slate-100">${versions.map((v) => html`<li class="px-5 py-3 flex items-center justify-between gap-3 text-sm">
            <div><span class="font-medium">v${v.version}</span> <span class="text-xs text-slate-500">${fmtDateTime(v.created_at)} · ${v.created_by_name || ''}</span></div>
            <button class="btn btn-ghost btn-sm" data-action="version" data-version="${v.version}">${t('docs.view')}</button></li>`)}</ul>
        </section>` : ''}
      </div>
    </div>`)

  const editor = root.querySelector('[data-editor]')
  const saveBtn = root.querySelector('[data-action="save"]')
  const saveState = root.querySelector('[data-save-state]')
  const titleInput = root.querySelector('[data-title]')
  let dirty = false
  const markDirty = () => {
    dirty = editor.value !== d.content || (titleInput && titleInput.value.trim() !== d.title)
    if (saveBtn) saveBtn.disabled = !dirty
    if (saveState) saveState.textContent = dirty ? t('docs.unsaved') : t('docs.all_saved')
  }
  editor.addEventListener('input', markDirty)
  titleInput?.addEventListener('input', markDirty)
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
  })
  // Warn before losing unsaved edits, both on tab close and on in-app navigation.
  window.onbeforeunload = (e) => {
    if (dirty && isCurrent()) { e.preventDefault(); e.returnValue = '' }
  }
  setLeaveGuard(() => !dirty || window.confirm(t('docs.discard_changes')))

  async function save() {
    if (!dirty || !saveBtn) return
    await busy(saveBtn, async () => {
      const body = {}
      if (editor.value !== d.content) body.content = editor.value
      if (titleInput && titleInput.value.trim() && titleInput.value.trim() !== d.title) body.title = titleInput.value.trim()
      try {
        await api.patch(`/api/documents/${d.id}`, body)
        dirty = false
        toast(t('common.saved'))
        rerender()
      } catch (err) { showError(err) }
    })
  }

  const confirmLeaveUnsaved = async () => !dirty || confirmDialog(t('docs.discard_changes'), { confirmLabel: t('docs.discard') })

  bind(root, {
    actions: {
      save,
      export: async () => {
        if (dirty && !(await confirmLeaveUnsaved())) return
        download(`/api/documents/${d.id}/export?format=docx`)
      },
      original: () => download(`/api/documents/${d.id}/file`),
      sign: async () => {
        if (dirty && !(await confirmLeaveUnsaved())) return
        openSignatureDialog(d)
      },
      delete: async () => {
        if (!(await confirmDialog(t('docs.confirm_delete', { title: d.title })))) return
        try {
          await api.del(`/api/documents/${d.id}`)
          dirty = false
          toast(t('common.deleted'))
          location.hash = d.case_id ? `#/cases/${d.case_id}` : '#/documents'
        } catch (err) { showError(err) }
      },
      version: async (el) => {
        try {
          const { version: v } = await api.get(`/api/documents/${d.id}/versions/${el.dataset.version}`)
          const m = modal({
            title: `${t('docs.version')} ${v.version} · ${fmtDateTime(v.created_at)}`,
            size: 'xl',
            body: html`<pre class="whitespace-pre-wrap font-serif text-sm leading-6 max-h-[60vh] overflow-y-auto bg-slate-50 rounded-lg p-4" dir="${dir}">${v.content}</pre>
              ${ro ? '' : html`<div class="flex justify-end gap-2 mt-4"><button class="btn btn-outline" data-action="close-modal">${t('common.close')}</button>
                <button class="btn btn-primary" data-action="restore"><i class="fas fa-clock-rotate-left"></i>${t('docs.restore')}</button></div>`}`,
            actions: {
              restore: async (btn) => busy(btn, async () => {
                try {
                  await api.patch(`/api/documents/${d.id}`, { content: v.content })
                  m.close()
                  dirty = false
                  toast(t('docs.restored', { v: v.version }))
                  rerender()
                } catch (err) { showError(err) }
              })
            }
          })
        } catch (err) { showError(err) }
      }
    },
    forms: {
      analyze: (form) => busy(submitButton(form), async () => {
        if (dirty) {
          toast(t('docs.save_before_analysis'), 'info')
          return
        }
        try {
          const { analysis } = await api.post(`/api/ai/documents/${d.id}/analyze`, formData(form))
          const list = root.querySelector('[data-analyses]')
          list.querySelectorAll('details').forEach((x) => x.removeAttribute('open'))
          list.insertAdjacentHTML('afterbegin', analysisCard({ ...analysis, created_by_name: store.me.user.name }, true).toString())
          toast(t('analysis.done'))
        } catch (err) { showError(err) }
      })
    },
    changes: {
      share: async (el) => {
        try {
          await api.patch(`/api/documents/${d.id}`, { shared_with_client: el.checked })
          toast(el.checked ? t('docs.shared_toast') : t('docs.unshared_toast'))
        } catch (err) { el.checked = !el.checked; showError(err) }
      },
      status: async (el) => {
        try {
          await api.patch(`/api/documents/${d.id}`, { status: el.value })
          d.status = el.value
          toast(t('common.saved'))
        } catch (err) { el.value = d.status; showError(err) }
      }
    }
  })
}
