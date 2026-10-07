import { api, download } from '../api.js'
import { html, raw, render } from '../dom.js'
import { fmtNumber, t } from '../i18n.js'
import { refLabel } from '../store.js'
import { busy, modal, showError, toast } from '../ui.js'

// Fields shown in the preview table for each import type.
const PREVIEW_COLUMNS = {
  clients: ['name', 'name_ar', 'kind', 'email', 'phone'],
  cases: ['title', 'client', 'jurisdiction', 'status', 'opened_on']
}

// Three-step import from Excel or CSV: choose a file, check the column mapping, import.
export function openImportDialog(type, { onDone } = {}) {
  let file = null
  let preview = null
  const m = modal({ title: t(`import_xl.title_${type}`), size: 'xl', body: html`<div data-step></div>` })
  const step = m.el.querySelector('[data-step]')

  const showChoose = () => render(step, html`
    <div class="space-y-4">
      <p class="text-sm text-slate-600">${t(`import_xl.intro_${type}`)}</p>
      <div>
        <label class="label" for="f-import-file">${t('import_xl.file')}</label>
        <input id="f-import-file" type="file" class="input" accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-file />
        <p class="hint">${t('import_xl.file_hint')}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-act="template"><i class="fas fa-download"></i>${t('import_xl.template')}</button>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="button" class="btn btn-primary" data-act="preview"><i class="fas fa-magnifying-glass"></i>${t('import_xl.check')}</button>
      </div>
    </div>`)

  const cellText = (v) => (v == null || v === '' ? '—' : String(v))

  const showPreview = () => {
    const p = preview
    const headerOptions = (key) => html`<option value="">${t('import_xl.not_in_file')}</option>${p.headers.map((h, i) => html`<option value="${i}" ${p.mapping[key] === i ? raw('selected') : ''}>${h || `#${i + 1}`}</option>`)}`
    const errorsCount = p.total - p.valid
    render(step, html`
      <div class="space-y-5">
        <div class="flex flex-wrap gap-3 text-sm">
          <span class="badge bg-slate-100 text-slate-700">${t('import_xl.rows', { n: fmtNumber(p.total) })}</span>
          <span class="badge bg-emerald-100 text-emerald-800">${t('import_xl.ready', { n: fmtNumber(p.valid) })}</span>
          ${errorsCount ? html`<span class="badge bg-red-100 text-red-700">${t('import_xl.will_skip', { n: fmtNumber(errorsCount) })}</span>` : ''}
        </div>
        <section>
          <h3 class="font-semibold text-sm mb-2">${t('import_xl.columns')}</h3>
          <p class="text-xs text-slate-500 mb-3">${t('import_xl.columns_hint')}</p>
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${p.fields.map((f) => html`<label class="text-sm">
              <span class="block text-slate-600 mb-1">${t(`import_xl.field_${f.key}`)}${f.required ? html` <span class="text-red-500">*</span>` : ''}</span>
              <select class="input ${f.required && p.mapping[f.key] == null ? 'border-red-400' : ''}" data-map="${f.key}">${headerOptions(f.key)}</select>
            </label>`)}
          </div>
        </section>
        <section>
          <h3 class="font-semibold text-sm mb-2">${t('import_xl.sample')}</h3>
          <div class="overflow-x-auto border border-slate-100 rounded-lg"><table class="table text-sm">
            <thead><tr><th>#</th>${PREVIEW_COLUMNS[type].map((k) => html`<th>${t(`import_xl.field_${k}`)}</th>`)}<th></th></tr></thead>
            <tbody>${p.sample.map((r) => html`<tr class="${r.errors.length ? 'bg-red-50' : ''}">
              <td class="text-slate-400">${r.row}</td>
              ${PREVIEW_COLUMNS[type].map((k) => html`<td dir="auto" class="max-w-[14rem] truncate">${k === 'kind' ? t(`clients.${r.values[k]}`) : k === 'status' ? t(`status.${r.values[k]}`) : k === 'jurisdiction' ? refLabel('jurisdictions', r.values[k]) : cellText(r.values[k])}</td>`)}
              <td class="text-xs ${r.errors.length ? 'text-red-600' : 'text-amber-700'}">${[...r.errors, ...r.warnings].join(' · ')}</td>
            </tr>`)}</tbody>
          </table></div>
        </section>
        ${p.problems.length ? html`<details class="text-sm"><summary class="cursor-pointer text-slate-600">${t('import_xl.problems', { n: p.problems.length })}</summary>
          <ul class="mt-2 space-y-1 max-h-48 overflow-y-auto">${p.problems.map((x) => html`<li><span class="text-slate-400">${t('import_xl.row', { n: x.row })}</span> ${[...x.errors, ...x.warnings].join(' · ')}</li>`)}</ul></details>` : ''}
        ${type === 'cases' ? html`<label class="flex items-center gap-2 text-sm"><input type="checkbox" data-create-clients checked />${t('import_xl.create_clients')}</label>` : ''}
        <div class="flex flex-wrap justify-between gap-2 pt-4 border-t border-slate-100">
          <button type="button" class="btn btn-outline" data-act="back"><i class="fas fa-arrow-left rtl:rotate-180"></i>${t('import_xl.other_file')}</button>
          <div class="flex gap-2">
            <button type="button" class="btn btn-outline" data-act="recheck"><i class="fas fa-rotate"></i>${t('import_xl.recheck')}</button>
            <button type="button" class="btn btn-primary" data-act="import" ${p.missing.length || !p.valid ? raw('disabled') : ''}><i class="fas fa-file-import"></i>${t('import_xl.import_n', { n: fmtNumber(p.valid) })}</button>
          </div>
        </div>
      </div>`)
  }

  const showResult = (r) => render(step, html`
    <div class="space-y-4">
      <div class="rounded-xl bg-emerald-50 border border-emerald-200 p-5">
        <div class="text-2xl font-bold text-emerald-800">${t(`import_xl.created_${type}`, { n: fmtNumber(r.created) })}</div>
        ${r.clients_created ? html`<div class="text-emerald-700 mt-1">${t('import_xl.clients_created', { n: fmtNumber(r.clients_created) })}</div>` : ''}
      </div>
      ${r.skipped_count ? html`<div><h3 class="font-semibold text-sm mb-2">${t('import_xl.skipped', { n: fmtNumber(r.skipped_count) })}</h3>
        <ul class="text-sm space-y-1 max-h-60 overflow-y-auto">${r.skipped.map((s) => html`<li><span class="text-slate-400">${t('import_xl.row', { n: s.row })}</span> ${s.reason === 'Already exists' ? t('import_xl.already_exists') : s.reason}</li>`)}</ul></div>` : ''}
      <div class="flex justify-end pt-4 border-t border-slate-100"><button type="button" class="btn btn-primary" data-action="close-modal">${t('common.done')}</button></div>
    </div>`)

  const formFor = (withMapping) => {
    const form = new FormData()
    form.set('type', type)
    form.set('file', file)
    if (withMapping) {
      const mapping = {}
      step.querySelectorAll('[data-map]').forEach((s) => { mapping[s.dataset.map] = s.value === '' ? null : Number(s.value) })
      form.set('mapping', JSON.stringify(mapping))
    }
    return form
  }

  step.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.dataset.act
    if (act === 'template') return download(`/api/import/template/${type}`)
    if (act === 'back') { file = null; preview = null; return showChoose() }
    if (act === 'preview' || act === 'recheck') {
      if (act === 'preview') {
        file = step.querySelector('[data-file]')?.files?.[0] ?? null
        if (!file) return toast(t('import_xl.choose_file'), 'error')
      }
      return busy(btn, async () => {
        try { preview = await api.upload('/api/import/preview', formFor(act === 'recheck')); showPreview() } catch (err) { showError(err) }
      })
    }
    if (act === 'import') {
      return busy(btn, async () => {
        const form = formFor(true)
        if (type === 'cases') form.set('create_missing_clients', step.querySelector('[data-create-clients]')?.checked ? 'true' : 'false')
        try {
          const r = await api.upload('/api/import', form)
          showResult(r)
          onDone?.()
        } catch (err) { showError(err) }
      })
    }
  })

  showChoose()
  return m
}
