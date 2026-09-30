import { api } from '../api.js'
import { bind, formData, html, qs, render } from '../dom.js'
import { fmtDate, fmtRelative, t } from '../i18n.js'
import { canDelete, readOnly, refLabel } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, debounce, emptyState, formActions, inputField, modal, pageHeader, pagination,
  selectField, showError, spinner, statusBadge, submitButton, textareaField, toast
} from '../ui.js'
import { openCaseForm } from './cases.js'

export function openClientForm({ client, onSaved } = {}) {
  const c = client || {}
  const m = modal({
    title: client ? t('clients.edit') : t('clients.new'),
    size: 'lg',
    body: html`
      <form data-form="save" class="grid sm:grid-cols-2 gap-4" novalidate>
        ${selectField({ name: 'kind', label: t('clients.type'), options: [{ value: 'individual', label: t('clients.individual') }, { value: 'company', label: t('clients.company') }], value: c.kind || 'individual' })}
        ${inputField({ name: 'id_number', label: t('clients.id_number'), value: c.id_number, hint: t('clients.id_number_hint') })}
        ${inputField({ name: 'name', label: t('clients.name_en'), value: c.name, required: true })}
        ${inputField({ name: 'name_ar', label: t('clients.name_ar'), value: c.name_ar, dir: 'rtl' })}
        ${inputField({ name: 'email', label: t('clients.email'), type: 'email', value: c.email, attrs: 'dir="ltr"' })}
        ${inputField({ name: 'phone', label: t('clients.phone'), type: 'tel', value: c.phone, attrs: 'dir="ltr"' })}
        ${textareaField({ name: 'address', label: t('clients.address'), value: c.address, rows: 2, cls: 'sm:col-span-2' })}
        ${textareaField({ name: 'notes', label: t('clients.notes'), value: c.notes, rows: 3, cls: 'sm:col-span-2' })}
        <div class="sm:col-span-2">${formActions(client ? t('common.save') : t('clients.create'))}</div>
      </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        try {
          const res = client ? await api.patch(`/api/clients/${client.id}`, formData(form)) : await api.post('/api/clients', formData(form))
          m.close()
          toast(t('common.saved'))
          onSaved?.(res.client)
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function clientsListView(root, { query, isCurrent }) {
  const state = { page: Number(query.get('page')) || 1, q: query.get('q') || '', archived: query.get('archived') === 'true' }
  const ro = readOnly()
  render(root, html`
    ${pageHeader(t('nav.clients'), t('clients.subtitle'), ro ? '' : html`<button class="btn btn-primary" data-action="new"><i class="fas fa-plus"></i>${t('clients.new')}</button>`)}
    <div class="card">
      <div class="p-4 border-b border-slate-100 flex flex-wrap gap-3 items-center">
        <div class="relative flex-1 min-w-52">
          <i class="fas fa-magnifying-glass absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm"></i>
          <input type="search" class="input ps-9" data-search placeholder="${t('clients.search_placeholder')}" value="${state.q}" aria-label="${t('common.search')}" />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" data-change="archived" ${state.archived ? 'checked' : ''} />${t('clients.show_archived')}</label>
      </div>
      <div id="results">${spinner()}</div>
    </div>`)
  const results = root.querySelector('#results')
  const load = async () => {
    const res = await api.get('/api/clients' + qs({ page: state.page, q: state.q, archived: state.archived ? 'true' : '' }))
    if (!isCurrent()) return
    render(results, res.items.length ? html`
      <div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('clients.name')}</th><th>${t('clients.contact')}</th><th>${t('clients.id_number')}</th><th>${t('clients.open_cases')}</th><th>${t('common.created')}</th></tr></thead>
        <tbody>${res.items.map((c) => html`<tr class="clickable" data-action="open" data-id="${c.id}">
          <td><div class="flex items-center gap-2"><i class="fas ${c.kind === 'company' ? 'fa-building' : 'fa-user'} text-slate-400"></i>
            <div><div class="font-medium">${c.name}</div>${c.name_ar ? html`<div class="text-xs text-slate-500" dir="rtl">${c.name_ar}</div>` : ''}</div></div></td>
          <td class="text-slate-600"><div dir="ltr" class="text-start">${c.email || ''}</div><div dir="ltr" class="text-start text-xs">${c.phone || ''}</div></td>
          <td class="text-slate-600 text-xs">${c.id_number || '—'}</td>
          <td>${c.open_cases}</td>
          <td class="text-xs text-slate-500">${fmtDate(c.created_at)}</td>
        </tr>`)}</tbody></table></div>
      ${pagination(res)}`
      : state.q || state.archived
        ? emptyState('fa-magnifying-glass', t('common.no_results'), '')
        : emptyState('fa-address-book', t('clients.empty_title'), t('clients.empty_text'), ro ? '' : html`<button class="btn btn-primary" data-action="new">${t('clients.new')}</button>`))
  }
  const reload = () => {
    history.replaceState(null, '', '#/clients' + qs({ q: state.q, archived: state.archived ? 'true' : '', page: state.page > 1 ? state.page : '' }))
    load().catch(showError)
  }
  bind(root, {
    actions: {
      new: () => openClientForm({ onSaved: (c) => (location.hash = `#/clients/${c.id}`) }),
      open: (el) => (location.hash = `#/clients/${el.dataset.id}`),
      page: (el) => { state.page = Number(el.dataset.page); reload() }
    },
    changes: { archived: (el) => { state.archived = el.checked; state.page = 1; reload() } }
  })
  root.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; reload() }))
  await load()
}

export async function clientDetailView(root, { params, isCurrent, rerender }) {
  const { client: c, cases, documents } = await api.get(`/api/clients/${params.id}`)
  if (!isCurrent()) return
  const ro = readOnly()
  const row = (icon, value, ltr) => value ? html`<div class="flex items-start gap-3 text-sm"><i class="fas ${icon} text-slate-400 mt-1 w-4"></i><span class="whitespace-pre-wrap" ${ltr ? 'dir=ltr' : 'dir=auto'}>${value}</span></div>` : ''
  render(root, html`
    <nav class="text-sm text-slate-500 mb-3"><a href="#/clients" class="hover:underline">${t('nav.clients')}</a></nav>
    <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold flex items-center gap-2"><i class="fas ${c.kind === 'company' ? 'fa-building' : 'fa-user'} text-slate-400"></i>${c.name}</h1>
        ${c.name_ar ? html`<p class="text-slate-600 mt-1" dir="rtl">${c.name_ar}</p>` : ''}
        ${c.archived_at ? html`<span class="badge bg-slate-200 text-slate-700 mt-2">${t('clients.archived')}</span>` : ''}
      </div>
      ${ro ? '' : html`<div class="flex flex-wrap gap-2">
        <button class="btn btn-primary" data-action="new-case"><i class="fas fa-folder-plus"></i>${t('cases.new')}</button>
        <button class="btn btn-outline" data-action="edit"><i class="fas fa-pen"></i>${t('common.edit')}</button>
        <button class="btn btn-outline" data-action="archive">${c.archived_at ? t('clients.unarchive') : t('clients.archive')}</button>
        ${canDelete() ? html`<button class="btn btn-danger-ghost" data-action="delete" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
      </div>`}
    </div>
    <div class="grid lg:grid-cols-3 gap-6">
      <section class="card card-pad space-y-3">
        <h2 class="font-semibold mb-2">${t('clients.details')}</h2>
        <div class="text-xs text-slate-500">${c.kind === 'company' ? t('clients.company') : t('clients.individual')}</div>
        ${row('fa-id-card', c.id_number)}
        ${row('fa-envelope', c.email, true)}
        ${row('fa-phone', c.phone, true)}
        ${row('fa-location-dot', c.address)}
        ${c.notes ? html`<div class="pt-3 border-t border-slate-100"><h3 class="text-xs text-slate-500 mb-1">${t('clients.notes')}</h3><p class="text-sm whitespace-pre-wrap" dir="auto">${c.notes}</p></div>` : ''}
      </section>
      <div class="lg:col-span-2 space-y-6">
        <section class="card">
          <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('nav.cases')} <span class="text-slate-400 font-normal">(${cases.length})</span></h2></div>
          ${cases.length ? html`<ul class="divide-y divide-slate-100">${cases.map((k) => html`<li><a href="#/cases/${k.id}" class="px-5 py-3 flex flex-wrap items-center gap-3 hover:bg-slate-50">
            <span class="font-mono text-xs text-slate-500 w-20">${k.reference}</span><span class="flex-1 min-w-0 truncate text-sm font-medium">${k.title}</span>
            <span class="text-xs text-slate-500">${refLabel('jurisdictions', k.jurisdiction)}</span>${statusBadge(k.status)}</a></li>`)}</ul>`
            : html`<p class="px-5 py-6 text-sm text-slate-500">${t('clients.no_cases')}</p>`}
        </section>
        <section class="card">
          <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('nav.documents')} <span class="text-slate-400 font-normal">(${documents.length})</span></h2></div>
          ${documents.length ? html`<ul class="divide-y divide-slate-100">${documents.map((d) => html`<li><a href="#/documents/${d.id}" class="px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
            <i class="fas fa-file-lines text-slate-400"></i><span class="flex-1 truncate text-sm">${d.title}</span>${statusBadge(d.status)}<span class="text-xs text-slate-400">${fmtRelative(d.updated_at)}</span></a></li>`)}</ul>`
            : html`<p class="px-5 py-6 text-sm text-slate-500">${t('clients.no_documents')}</p>`}
        </section>
      </div>
    </div>`)
  bind(root, {
    actions: {
      edit: () => openClientForm({ client: c, onSaved: rerender }),
      'new-case': () => openCaseForm({ clientId: c.id, clientName: c.name, onSaved: (k) => (location.hash = `#/cases/${k.id}`) }),
      archive: async (el) => busy(el, async () => {
        try {
          await api.patch(`/api/clients/${c.id}`, { archived: !c.archived_at })
          toast(t('common.saved'))
          rerender()
        } catch (err) { showError(err) }
      }),
      delete: async () => {
        if (!(await confirmDialog(t('clients.confirm_delete', { name: c.name })))) return
        try {
          await api.del(`/api/clients/${c.id}`)
          toast(t('common.deleted'))
          location.hash = '#/clients'
        } catch (err) { showError(err) }
      }
    }
  })
}
