import { api, download } from '../api.js'
import { bind, html, qs, raw, render } from '../dom.js'
import { fmtDate, fmtNumber, t } from '../i18n.js'
import { can, readOnly, refLabel, refOptions, store } from '../store.js'
import {
  busy, confirmDialog, emptyState, inputField, modal, pageHeader, pagination, selectField, showError, spinner,
  submitButton, textareaField, toast
} from '../ui.js'

const LAW_STATUS_COLORS = { in_force: 'bg-emerald-100 text-emerald-800', amended: 'bg-amber-100 text-amber-800', repealed: 'bg-red-100 text-red-700' }
const lawStatus = (s) => html`<span class="badge ${LAW_STATUS_COLORS[s] || ''}">${t(`law_status.${s}`)}</span>`
const kindOptions = () => (store.ref.library_kinds || []).map((k) => ({ value: k, label: t(`law_kind.${k}`) }))
const canEdit = (src) => (src.shared ? store.me.is_platform_admin : can('owner', 'admin', 'lawyer')) && !readOnly()

// Highlights search terms in a passage (text is escaped first).
function highlight(text, q) {
  const escaped = String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const words = (q || '').split(/\s+/).filter((w) => w.length > 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length) return raw(escaped)
  return raw(escaped.replace(new RegExp(`(${words.join('|')})`, 'giu'), '<mark class="bg-amber-100 rounded px-0.5">$1</mark>'))
}

function openSourceForm({ source, onSaved }) {
  const s = source || {}
  const admin = store.me.is_platform_admin
  const m = modal({
    title: source ? t('library.edit') : t('library.add'),
    size: 'lg',
    body: html`<form data-form="save" class="grid sm:grid-cols-2 gap-4" novalidate>
      ${inputField({ name: 'title', label: t('library.title'), value: s.title, required: true, cls: 'sm:col-span-2', attrs: 'dir="auto"' })}
      ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: refOptions('jurisdictions'), value: s.jurisdiction || store.me.org.default_jurisdiction, required: true })}
      ${selectField({ name: 'kind', label: t('library.kind'), options: kindOptions(), value: s.kind || 'law' })}
      ${inputField({ name: 'number', label: t('library.number'), value: s.number, placeholder: '35/2003', attrs: 'dir="ltr"' })}
      ${inputField({ name: 'year', label: t('library.year'), type: 'number', value: s.year, attrs: 'min="1800" max="2100"' })}
      ${selectField({ name: 'status', label: t('common.status'), options: ['in_force', 'amended', 'repealed'].map((v) => ({ value: v, label: t(`law_status.${v}`) })), value: s.status || 'in_force' })}
      ${selectField({ name: 'language', label: t('settings.language'), options: [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }], value: s.language || 'ar' })}
      ${inputField({ name: 'source_url', label: t('library.source_url'), type: 'url', value: s.source_url, cls: 'sm:col-span-2', attrs: 'dir="ltr"', hint: t('library.source_url_hint') })}
      ${source ? '' : html`
        <div class="sm:col-span-2">
          <label class="label" for="f-file">${t('library.file')}</label>
          <input id="f-file" name="file" type="file" accept=".pdf,.docx,.txt,application/pdf" class="input" />
          <p class="hint">${t('library.file_hint')}</p>
        </div>
        ${textareaField({ name: 'text', label: t('library.or_paste'), rows: 6, cls: 'sm:col-span-2' })}
        ${admin ? selectField({ name: 'scope', label: t('library.scope'), options: [{ value: 'org', label: t('library.scope_org') }, { value: 'platform', label: t('library.scope_platform') }], value: 'org', cls: 'sm:col-span-2' }) : ''}`}
      ${textareaField({ name: 'notes', label: t('clients.notes'), value: s.notes, rows: 2, cls: 'sm:col-span-2' })}
      <div class="sm:col-span-2 flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${source ? t('common.save') : t('library.add_and_index')}</button>
      </div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        try {
          if (source) {
            const fd = Object.fromEntries(['title', 'jurisdiction', 'kind', 'number', 'year', 'status', 'language', 'source_url', 'notes'].map((k) => [k, form.elements[k].value.trim() || null]))
            if (fd.year) fd.year = Number(fd.year)
            await api.patch(`/api/library/sources/${source.id}`, fd)
            m.close()
            toast(t('common.saved'))
            onSaved?.()
            return
          }
          const fd = new FormData(form)
          const file = form.elements.file.files[0]
          if (!file) fd.delete('file')
          if (!file && !String(fd.get('text') || '').trim()) return toast(t('library.need_file_or_text'), 'error')
          const res = await api.upload('/api/library/sources', fd)
          m.close()
          toast(t('library.indexed', { n: res.passages }) + (res.ocr ? ` ${t('library.ocr_used')}` : ''))
          onSaved?.(res.source)
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function libraryView(root, { query, isCurrent }) {
  const state = {
    q: query.get('q') || '',
    jurisdiction: query.get('jurisdiction') || '',
    kind: query.get('kind') || '',
    page: Number(query.get('page')) || 1
  }
  const ro = readOnly()
  render(root, html`
    ${pageHeader(t('nav.library'), t('library.subtitle'), ro || !can('owner', 'admin', 'lawyer') ? '' : html`<button class="btn btn-primary" data-action="add"><i class="fas fa-plus"></i>${t('library.add')}</button>`)}
    <div class="card mb-6">
      <form data-form="search" class="p-4 flex flex-wrap gap-3">
        <div class="relative flex-1 min-w-60">
          <i class="fas fa-magnifying-glass absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm"></i>
          <input type="search" name="q" class="input ps-9" dir="auto" value="${state.q}" placeholder="${t('library.search_placeholder')}" aria-label="${t('common.search')}" />
        </div>
        ${selectField({ name: 'jurisdiction', options: refOptions('jurisdictions'), value: state.jurisdiction, empty: t('library.all_jurisdictions'), cls: 'w-48', attrs: `data-change="filter" aria-label="${t('common.jurisdiction')}"` })}
        <button type="submit" class="btn btn-primary">${t('common.search')}</button>
      </form>
      <div id="passages"></div>
    </div>
    <div class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <h2 class="font-semibold">${t('library.sources')}</h2>
        ${selectField({ name: 'kind', options: kindOptions(), value: state.kind, empty: t('library.all_kinds'), cls: 'w-48', attrs: `data-change="filter" aria-label="${t('library.kind')}"` })}
      </div>
      <div id="sources">${spinner()}</div>
    </div>`)

  const passages = root.querySelector('#passages')
  const sources = root.querySelector('#sources')

  const loadPassages = async () => {
    if (state.q.length < 2) { render(passages, ''); return }
    render(passages, spinner())
    const res = await api.get('/api/library/search' + qs({ q: state.q, jurisdiction: state.jurisdiction }))
    if (!isCurrent()) return
    render(passages, res.items.length ? html`<div class="border-t border-slate-100">
      <p class="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">${t('library.matching_articles', { n: res.items.length })}</p>
      <ul class="divide-y divide-slate-100">${res.items.map((p) => html`<li class="px-5 py-4">
        <div class="flex flex-wrap items-center gap-2 mb-1">
          <a href="#/library/${p.source_id}?q=${encodeURIComponent(state.q)}" class="text-sm font-semibold text-brand-700 hover:underline" dir="auto">${p.citation}</a>
          ${p.status !== 'in_force' ? lawStatus(p.status) : ''}
        </div>
        <p class="text-sm text-slate-700 whitespace-pre-wrap line-clamp-6" dir="auto">${highlight(p.text, state.q)}</p>
      </li>`)}</ul></div>`
      : html`<div class="border-t border-slate-100">${emptyState('fa-magnifying-glass', t('common.no_results'), t('library.no_matches'))}</div>`)
  }

  const loadSources = async () => {
    const res = await api.get('/api/library/sources' + qs({ jurisdiction: state.jurisdiction, kind: state.kind, page: state.page }))
    if (!isCurrent()) return
    render(sources, res.items.length ? html`
      <div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('library.title')}</th><th>${t('common.jurisdiction')}</th><th>${t('library.kind')}</th><th>${t('common.status')}</th><th>${t('library.articles')}</th></tr></thead>
        <tbody>${res.items.map((s) => html`<tr class="clickable" data-action="open" data-id="${s.id}">
          <td><div class="font-medium" dir="auto">${s.title}</div><div class="text-xs text-slate-500">${[s.number, s.year].filter(Boolean).join(' · ')}${s.shared ? html` <span class="badge bg-brand-50 text-brand-700 ms-1">${t('library.shared')}</span>` : ''}</div></td>
          <td class="text-sm">${refLabel('jurisdictions', s.jurisdiction)}</td>
          <td class="text-sm">${t(`law_kind.${s.kind}`)}</td>
          <td>${lawStatus(s.status)}</td>
          <td class="text-sm">${fmtNumber(s.articles || 0)}</td>
        </tr>`)}</tbody></table></div>
      ${pagination(res)}`
      : emptyState('fa-book-open', t('library.empty_title'), t('library.empty_text'), ro || !can('owner', 'admin', 'lawyer') ? '' : html`<button class="btn btn-primary" data-action="add">${t('library.add')}</button>`))
  }

  const sync = () => history.replaceState(null, '', '#/library' + qs({ q: state.q, jurisdiction: state.jurisdiction, kind: state.kind, page: state.page > 1 ? state.page : '' }))
  bind(root, {
    actions: {
      add: () => openSourceForm({ onSaved: (s) => (s ? (location.hash = `#/library/${s.id}`) : loadSources()) }),
      open: (el) => (location.hash = `#/library/${el.dataset.id}`),
      page: (el) => { state.page = Number(el.dataset.page); sync(); loadSources().catch(showError) }
    },
    forms: {
      search: (form) => { state.q = form.elements.q.value.trim(); sync(); loadPassages().catch(showError) }
    },
    changes: {
      filter: (el) => {
        state[el.name] = el.value
        state.page = 1
        sync()
        loadSources().catch(showError)
        if (el.name === 'jurisdiction') loadPassages().catch(showError)
      }
    }
  })
  await Promise.all([loadSources(), loadPassages()])
}

export async function librarySourceView(root, { params, query, isCurrent, rerender }) {
  const q = query.get('q') || ''
  const { source: s, chunks } = await api.get(`/api/library/sources/${params.id}` + qs({ q }))
  if (!isCurrent()) return
  const editable = canEdit(s)
  render(root, html`
    <nav class="text-sm text-slate-500 mb-3"><a href="#/library" class="hover:underline">${t('nav.library')}</a></nav>
    <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold" dir="auto">${s.title}</h1>
        <div class="flex flex-wrap items-center gap-2 mt-2 text-sm text-slate-600">
          ${lawStatus(s.status)}
          <span>${refLabel('jurisdictions', s.jurisdiction)}</span>·<span>${t(`law_kind.${s.kind}`)}</span>
          ${s.number ? html`·<span dir="ltr">${s.number}</span>` : ''}${s.year ? html`·<span>${s.year}</span>` : ''}
          ${s.shared ? html`<span class="badge bg-brand-50 text-brand-700">${t('library.shared')}</span>` : ''}
        </div>
        ${s.source_url ? html`<a href="${s.source_url}" target="_blank" rel="noopener noreferrer" class="text-xs text-brand-600 hover:underline mt-2 inline-block" dir="ltr"><i class="fas fa-arrow-up-right-from-square"></i> ${s.source_url}</a>` : ''}
      </div>
      <div class="flex flex-wrap gap-2">
        ${s.file_name ? html`<button class="btn btn-outline" data-action="file"><i class="fas fa-download"></i>${t('library.original')}</button>` : ''}
        ${store.me.features.ai ? html`<a class="btn btn-outline" href="#/assistant?q=${encodeURIComponent(s.title)}"><i class="fas fa-wand-magic-sparkles"></i>${t('library.ask_ai')}</a>` : ''}
        ${editable ? html`<button class="btn btn-outline" data-action="edit"><i class="fas fa-pen"></i>${t('common.edit')}</button>
          <button class="btn btn-danger-ghost" data-action="delete" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>
    ${s.notes ? html`<div class="card card-pad mb-6 text-sm text-slate-700 whitespace-pre-wrap" dir="auto">${s.notes}</div>` : ''}
    <div class="card">
      <form data-form="find" class="p-4 border-b border-slate-100 flex gap-2">
        <input type="search" name="q" class="input flex-1" dir="auto" value="${q}" placeholder="${t('library.search_in_law')}" aria-label="${t('library.search_in_law')}" />
        <button type="submit" class="btn btn-outline">${t('common.search')}</button>
      </form>
      ${chunks.length ? html`<ol class="divide-y divide-slate-100">${chunks.map((c) => html`<li class="px-5 py-4" id="c-${c.id}">
        ${c.label ? html`<h3 class="text-sm font-semibold text-slate-900 mb-1" dir="auto">${c.label}</h3>` : ''}
        <p class="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed" dir="auto">${highlight(c.text, q)}</p>
      </li>`)}</ol>` : emptyState('fa-magnifying-glass', t('common.no_results'), '')}
    </div>
    <p class="text-xs text-slate-400 mt-3">${t('library.added_on', { date: fmtDate(s.created_at) })}</p>`)
  bind(root, {
    actions: {
      file: () => download(`/api/library/sources/${s.id}/file`),
      edit: () => openSourceForm({ source: s, onSaved: rerender }),
      delete: async () => {
        if (!(await confirmDialog(t('library.confirm_delete', { title: s.title })))) return
        try { await api.del(`/api/library/sources/${s.id}`); toast(t('common.deleted')); location.hash = '#/library' } catch (err) { showError(err) }
      }
    },
    forms: {
      find: (form) => { location.hash = `#/library/${s.id}` + qs({ q: form.elements.q.value.trim() }) }
    }
  })
}
