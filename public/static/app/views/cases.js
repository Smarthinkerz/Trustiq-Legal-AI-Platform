import { api } from '../api.js'
import { bind, formData, html, qs, render } from '../dom.js'
import { fmtDate, fmtDateTime, fmtMoney, fmtRelative, t } from '../i18n.js'
import { aiEnabled, can, canDelete, readOnly, refLabel, refOptions, store } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, debounce, emptyState, eventBadge, formActions, inputField, modal, pageHeader,
  pagination, priorityBadge, selectField, showError, spinner, statusBadge, submitButton, textareaField, toast
} from '../ui.js'
import { loadMembers, memberSelect, searchPicker, wirePickers } from './pickers.js'
import { openDraftForm, openUploadForm } from './documents.js'
import { openEventForm } from './calendar.js'
import { openChecklistForm, openTaskForm, taskHandlers, taskRows } from './tasks.js'
import { fmtHours, openExpenseForm, openInvoiceWizard, openTimeForm } from './billing.js'
import { openGenerateForm } from './templates.js'
import { openImportDialog } from './import.js'

export const CASE_STATUSES = ['active', 'pending', 'under_review', 'on_hold', 'closed']
export const PRIORITIES = ['low', 'medium', 'high', 'urgent']

export async function openCaseForm({ kase, clientId, clientName, onSaved } = {}) {
  const members = await loadMembers().catch(() => [])
  const k = kase || {}
  const org = store.me.org
  const m = modal({
    title: kase ? t('cases.edit') : t('cases.new'),
    size: 'lg',
    body: html`
      <form data-form="save" class="grid sm:grid-cols-2 gap-4" novalidate>
        ${inputField({ name: 'title', label: t('cases.title_en'), value: k.title, required: true, cls: 'sm:col-span-2' })}
        ${inputField({ name: 'title_ar', label: t('cases.title_ar'), value: k.title_ar, dir: 'rtl', cls: 'sm:col-span-2' })}
        <div class="sm:col-span-2">${searchPicker({ name: 'client_id', label: t('cases.client'), value: k.client_id || clientId, valueLabel: k.client_name || clientName })}</div>
        ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: refOptions('jurisdictions'), value: k.jurisdiction || org.default_jurisdiction, required: true })}
        ${selectField({ name: 'practice_area', label: t('cases.practice_area'), options: refOptions('practice_areas'), value: k.practice_area, empty: '—' })}
        ${selectField({ name: 'status', label: t('common.status'), options: CASE_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })), value: k.status || 'active' })}
        ${selectField({ name: 'priority', label: t('cases.priority'), options: PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) })), value: k.priority || 'medium' })}
        ${inputField({ name: 'court', label: t('cases.court'), value: k.court })}
        ${inputField({ name: 'opposing_party', label: t('cases.opposing_party'), value: k.opposing_party })}
        ${memberSelect({ label: t('cases.assigned_to'), value: kase ? k.assigned_to : store.me.user.id, members })}
        ${inputField({ name: 'opened_on', label: t('cases.opened_on'), type: 'date', value: k.opened_on ? String(k.opened_on).slice(0, 10) : new Date().toISOString().slice(0, 10) })}
        <div class="grid grid-cols-3 gap-2 sm:col-span-2">
          ${inputField({ name: 'estimated_value', label: t('cases.value'), type: 'number', value: k.estimated_value, attrs: 'data-type="number" min="0" step="0.001"', cls: 'col-span-2' })}
          ${selectField({ name: 'currency', label: t('cases.currency'), options: (store.ref.currencies || []).map((c) => ({ value: c, label: c })), value: k.currency || org.default_currency })}
        </div>
        ${textareaField({ name: 'description', label: t('common.description'), value: k.description, rows: 4, cls: 'sm:col-span-2' })}
        <div class="sm:col-span-2">${formActions(kase ? t('common.save') : t('cases.create'))}</div>
      </form>`,
    onMount: (el) => wirePickers(el),
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const data = formData(form)
        if (!data.opened_on) delete data.opened_on
        try {
          const res = kase ? await api.patch(`/api/cases/${kase.id}`, data) : await api.post('/api/cases', data)
          m.close()
          toast(kase ? t('common.saved') : t('cases.created', { ref: res.case.reference }))
          onSaved?.(res.case)
        } catch (err) {
          showError(err, form)
        }
      })
    }
  })
}

export async function casesListView(root, { query, isCurrent }) {
  const state = {
    page: Number(query.get('page')) || 1,
    q: query.get('q') || '',
    status: query.get('status') === 'all' ? '' : query.get('status') || 'open',
    priority: query.get('priority') || '',
    assigned_to: query.get('assigned_to') || ''
  }
  const ro = readOnly()

  render(root, html`
    ${pageHeader(t('nav.cases'), t('cases.subtitle'), ro ? '' : html`<div class="flex flex-wrap gap-2">${can('owner', 'admin', 'lawyer') ? html`<button class="btn btn-outline" data-action="import"><i class="fas fa-file-excel"></i>${t('import_xl.button')}</button>` : ''}<button class="btn btn-primary" data-action="new"><i class="fas fa-plus"></i>${t('cases.new')}</button></div>`)}
    <div class="card">
      <div class="p-4 border-b border-slate-100 flex flex-wrap gap-3">
        <div class="relative flex-1 min-w-52">
          <i class="fas fa-magnifying-glass absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm"></i>
          <input type="search" class="input ps-9" data-search placeholder="${t('cases.search_placeholder')}" value="${state.q}" aria-label="${t('common.search')}" />
        </div>
        ${selectField({ name: 'status', options: [{ value: 'open', label: t('cases.filter_open') }, ...CASE_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))], value: state.status, empty: t('cases.filter_all'), cls: 'w-44', attrs: 'data-change="filter" aria-label="' + t('common.status') + '"' })}
        ${selectField({ name: 'priority', options: PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) })), value: state.priority, empty: t('cases.any_priority'), cls: 'w-40', attrs: 'data-change="filter" aria-label="' + t('cases.priority') + '"' })}
        ${state.assigned_to ? html`<button class="btn btn-outline btn-sm self-center" data-action="clear-assignee"><i class="fas fa-xmark"></i>${t('cases.assigned_to_me')}</button>` : ''}
      </div>
      <div id="case-results">${spinner()}</div>
    </div>`)

  const results = root.querySelector('#case-results')
  const load = async () => {
    const res = await api.get('/api/cases' + qs({ page: state.page, q: state.q, status: state.status, priority: state.priority, assigned_to: state.assigned_to }))
    if (!isCurrent()) return
    const filtered = state.q || state.priority || state.status !== 'open' || state.assigned_to
    render(results, res.items.length ? html`
      <div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.reference')}</th><th>${t('cases.matter')}</th><th>${t('cases.client')}</th><th>${t('common.status')}</th><th>${t('cases.priority')}</th><th>${t('cases.assigned_to')}</th><th>${t('common.updated')}</th></tr></thead>
        <tbody>${res.items.map((k) => html`
          <tr class="clickable" data-action="open" data-id="${k.id}">
            <td class="font-mono text-xs text-slate-500 whitespace-nowrap">${k.reference}</td>
            <td><div class="font-medium text-slate-900">${k.title}</div>${k.title_ar ? html`<div class="text-xs text-slate-500" dir="rtl">${k.title_ar}</div>` : ''}
              <div class="text-xs text-slate-400">${refLabel('jurisdictions', k.jurisdiction)}${k.practice_area ? ' · ' + refLabel('practice_areas', k.practice_area) : ''}</div></td>
            <td class="text-slate-600">${k.client_name || '—'}</td>
            <td>${statusBadge(k.status)}</td>
            <td>${priorityBadge(k.priority)}</td>
            <td class="text-slate-600 whitespace-nowrap">${k.assignee_name || '—'}</td>
            <td class="text-xs text-slate-500 whitespace-nowrap">${fmtRelative(k.updated_at)}</td>
          </tr>`)}</tbody>
      </table></div>
      ${pagination(res)}` : filtered
      ? emptyState('fa-magnifying-glass', t('common.no_results'), t('common.try_other_filters'))
      : emptyState('fa-folder-open', t('cases.empty_title'), t('cases.empty_text'), ro ? '' : html`<button class="btn btn-primary" data-action="new">${t('cases.new')}</button>`))
  }

  const syncUrl = () => history.replaceState(null, '', '#/cases' + qs({ q: state.q, status: state.status === 'open' ? '' : state.status || 'all', priority: state.priority, assigned_to: state.assigned_to, page: state.page > 1 ? state.page : '' }))
  const reload = () => { syncUrl(); load().catch(showError) }

  bind(root, {
    actions: {
      new: () => openCaseForm({ onSaved: (k) => (location.hash = `#/cases/${k.id}`) }),
      import: () => openImportDialog('cases', { onDone: reload }),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      page: (el) => { state.page = Number(el.dataset.page); reload() },
      'clear-assignee': () => { location.hash = '#/cases' }
    },
    changes: {
      filter: (el) => { state[el.name] = el.value; state.page = 1; reload() }
    }
  })
  root.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; reload() }))
  await load()
}

export async function caseDetailView(root, { params, isCurrent, rerender }) {
  const [data, tasks, time] = await Promise.all([
    api.get(`/api/cases/${params.id}`),
    api.get(`/api/tasks?case_id=${params.id}&status=active&pageSize=100`),
    api.get(`/api/billing/time?case_id=${params.id}&pageSize=10`)
  ])
  if (!isCurrent()) return
  const k = data.case
  const ro = readOnly()

  const info = (label, value) => value ? html`<div><dt class="text-xs text-slate-500">${label}</dt><dd class="text-sm font-medium text-slate-800 mt-0.5">${value}</dd></div>` : ''

  render(root, html`
    <nav class="text-sm text-slate-500 mb-3"><a href="#/cases" class="hover:underline">${t('nav.cases')}</a> <i class="fas fa-chevron-right text-xs mx-1 rtl:rotate-180"></i> <span class="font-mono">${k.reference}</span></nav>
    <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold">${k.title}</h1>
        ${k.title_ar ? html`<p class="text-slate-600 mt-1" dir="rtl">${k.title_ar}</p>` : ''}
        <div class="flex flex-wrap gap-2 mt-3">${statusBadge(k.status)} ${priorityBadge(k.priority)}</div>
      </div>
      ${ro ? '' : html`<div class="flex flex-wrap gap-2">
        ${selectField({ name: 'status', options: CASE_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })), value: k.status, cls: 'w-40', attrs: `data-change="status" aria-label="${t('common.status')}"` })}
        <button class="btn btn-outline" data-action="edit"><i class="fas fa-pen"></i>${t('common.edit')}</button>
        <button class="btn btn-outline" data-action="log-time"><i class="fas fa-stopwatch"></i>${t('billing.log_time')}</button>
        ${aiEnabled() ? html`<a class="btn btn-outline" href="#/assistant?case=${k.id}"><i class="fas fa-wand-magic-sparkles"></i>${t('cases.ask_ai')}</a>` : ''}
        ${canDelete() ? html`<button class="btn btn-danger-ghost" data-action="delete" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
      </div>`}
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <section class="card card-pad">
          <dl class="grid grid-cols-2 md:grid-cols-3 gap-4">
            ${info(t('cases.client'), k.client_id ? html`<a class="text-brand-600 hover:underline" href="#/clients/${k.client_id}">${k.client_name}</a>` : '—')}
            ${info(t('common.jurisdiction'), refLabel('jurisdictions', k.jurisdiction))}
            ${info(t('cases.practice_area'), refLabel('practice_areas', k.practice_area))}
            ${info(t('cases.court'), k.court)}
            ${info(t('cases.opposing_party'), k.opposing_party)}
            ${info(t('cases.assigned_to'), k.assignee_name)}
            ${info(t('cases.opened_on'), fmtDate(k.opened_on))}
            ${info(t('cases.closed_on'), k.closed_on ? fmtDate(k.closed_on) : '')}
            ${info(t('cases.value'), k.estimated_value != null ? fmtMoney(k.estimated_value, k.currency) : '')}
          </dl>
          ${k.description ? html`<div class="mt-5 pt-5 border-t border-slate-100"><h3 class="text-xs text-slate-500 mb-1">${t('common.description')}</h3><p class="text-sm text-slate-700 whitespace-pre-wrap" dir="auto">${k.description}</p></div>` : ''}
        </section>

        <section class="card">
          <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-slate-100">
            <h2 class="font-semibold">${t('nav.documents')} <span class="text-slate-400 font-normal">(${data.documents.length})</span></h2>
            ${ro ? '' : html`<div class="flex gap-2">
              <button class="btn btn-outline btn-sm" data-action="upload"><i class="fas fa-upload"></i>${t('docs.upload')}</button>
              <button class="btn btn-outline btn-sm" data-action="from-template"><i class="fas fa-file-signature"></i>${t('templates.use')}</button>
              ${aiEnabled() ? html`<button class="btn btn-outline btn-sm" data-action="draft"><i class="fas fa-pen-nib"></i>${t('docs.ai_draft')}</button>` : ''}
            </div>`}
          </div>
          ${data.documents.length ? html`<ul class="divide-y divide-slate-100">${data.documents.map((d) => html`
            <li><a href="#/documents/${d.id}" class="px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
              <i class="fas fa-file-lines text-slate-400"></i><span class="flex-1 min-w-0 truncate text-sm font-medium">${d.title}</span>
              ${statusBadge(d.status)}<span class="text-xs text-slate-400">${fmtRelative(d.updated_at)}</span></a></li>`)}</ul>`
            : html`<p class="px-5 py-6 text-sm text-slate-500">${t('cases.no_documents')}</p>`}
        </section>

        <section class="card">
          <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-slate-100">
            <h2 class="font-semibold">${t('nav.tasks')} <span class="text-slate-400 font-normal">(${tasks.total})</span></h2>
            ${ro ? '' : html`<div class="flex gap-2">
              <button class="btn btn-outline btn-sm" data-action="checklist"><i class="fas fa-list-ol"></i>${t('tasks.apply_checklist')}</button>
              <button class="btn btn-outline btn-sm" data-action="add-task"><i class="fas fa-plus"></i>${t('tasks.new')}</button>
            </div>`}
          </div>
          ${tasks.items.length ? taskRows(tasks.items, { showCase: false }) : html`<p class="px-5 py-6 text-sm text-slate-500">${t('tasks.none_for_case')}</p>`}
        </section>

        <section class="card">
          <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('cases.activity')}</h2></div>
          ${ro ? '' : html`<form data-form="note" class="p-5 border-b border-slate-100 space-y-2">
            <textarea name="body" rows="2" class="input" dir="auto" placeholder="${t('cases.add_note_placeholder')}" required maxlength="10000"></textarea>
            <div class="flex justify-end"><button type="submit" class="btn btn-primary btn-sm">${t('cases.add_note')}</button></div>
          </form>`}
          <ol class="p-5 space-y-4">
            ${data.activity.map((a) => html`<li class="flex gap-3">
              <div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${a.kind === 'note' ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-500'}">
                <i class="fas ${{ note: 'fa-comment', status_change: 'fa-arrows-rotate', document: 'fa-file', event: 'fa-calendar', created: 'fa-flag' }[a.kind] || 'fa-circle'} text-xs"></i></div>
              <div class="min-w-0">
                <p class="text-sm text-slate-800 whitespace-pre-wrap" dir="auto">${activityText(a)}</p>
                <p class="text-xs text-slate-400 mt-0.5">${a.user_name || ''} · ${fmtDateTime(a.created_at)}</p>
              </div></li>`)}
          </ol>
        </section>
      </div>

      <div class="space-y-6">
        <section class="card">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 class="font-semibold">${t('cases.events')}</h2>
            ${ro ? '' : html`<button class="btn btn-outline btn-sm" data-action="add-event"><i class="fas fa-plus"></i>${t('events.add')}</button>`}
          </div>
          ${data.events.length ? html`<ul class="divide-y divide-slate-100">${data.events.map((e) => html`
            <li class="px-5 py-3 ${e.completed_at ? 'opacity-50' : ''}">
              <button class="w-full text-start" data-action="edit-event" data-id="${e.id}">
                <div class="flex items-center gap-2 mb-1">${eventBadge(e.kind)}${!e.completed_at && new Date(e.starts_at) < new Date() && ['deadline', 'filing'].includes(e.kind) ? html`<span class="badge bg-red-100 text-red-700">${t('events.overdue')}</span>` : ''}</div>
                <div class="text-sm font-medium ${e.completed_at ? 'line-through' : ''}">${e.title}</div>
                <div class="text-xs text-slate-500">${e.all_day ? fmtDate(e.starts_at) : fmtDateTime(e.starts_at)}${e.location ? ' · ' + e.location : ''}</div>
              </button></li>`)}</ul>`
            : html`<p class="px-5 py-6 text-sm text-slate-500">${t('cases.no_events')}</p>`}
        </section>
        <section class="card">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 class="font-semibold">${t('billing.time_and_billing')}</h2>
            <a class="text-xs text-brand-600 hover:underline" href="#/billing?tab=time">${t('common.view_all')}</a>
          </div>
          <div class="px-5 py-4 grid grid-cols-2 gap-3 text-sm border-b border-slate-100">
            <div><div class="text-xs text-slate-500">${t('billing.hours')}</div><div class="font-semibold font-mono">${fmtHours(time.summary.minutes)}</div></div>
            <div><div class="text-xs text-slate-500">${t('reports.billable_value')}</div><div class="font-semibold">${fmtMoney(Math.round(time.summary.value * 1000) / 1000, k.currency)}</div></div>
          </div>
          ${time.items.length ? html`<ul class="divide-y divide-slate-100">${time.items.map((x) => html`<li class="px-5 py-2 text-sm flex justify-between gap-3">
            <span class="truncate" dir="auto">${x.description}</span><span class="font-mono text-xs text-slate-500 whitespace-nowrap">${fmtHours(x.minutes)}</span></li>`)}</ul>` : ''}
          ${ro ? '' : html`<div class="px-5 py-3 flex flex-wrap gap-2 border-t border-slate-100">
            <button class="btn btn-outline btn-sm" data-action="add-expense"><i class="fas fa-receipt"></i>${t('billing.add_expense')}</button>
            ${k.client_id ? html`<button class="btn btn-outline btn-sm" data-action="invoice"><i class="fas fa-file-invoice-dollar"></i>${t('billing.new_invoice')}</button>` : ''}
          </div>`}
        </section>
      </div>
    </div>`)

  const refresh = () => rerender()
  const label = `${k.reference} · ${k.title}`
  const taskShared = taskHandlers(() => tasks.items, refresh)
  bind(root, {
    actions: {
      ...taskShared.actions,
      'add-task': () => openTaskForm({ caseId: k.id, caseLabel: label, onSaved: refresh }),
      checklist: () => openChecklistForm({ caseId: k.id, onSaved: refresh }),
      'log-time': () => openTimeForm({ caseId: k.id, caseLabel: label, onSaved: refresh }),
      'add-expense': () => openExpenseForm({ caseId: k.id, caseLabel: label, onSaved: refresh }),
      invoice: () => openInvoiceWizard({ clientId: k.client_id, clientName: k.client_name, caseId: k.id }),
      'from-template': async () => {
        try {
          const { items } = await api.get('/api/workspace/templates')
          if (!items.length) return toast(t('templates.none_yet'), 'info')
          openGenerateForm({ templates: items, caseId: k.id, caseLabel: label })
        } catch (err) { showError(err) }
      },
      edit: () => openCaseForm({ kase: k, onSaved: refresh }),
      delete: async () => {
        if (!(await confirmDialog(t('cases.confirm_delete', { ref: k.reference })))) return
        try {
          await api.del(`/api/cases/${k.id}`)
          toast(t('common.deleted'))
          location.hash = '#/cases'
        } catch (err) { showError(err) }
      },
      upload: () => openUploadForm({ caseId: k.id, caseLabel: `${k.reference} · ${k.title}`, onSaved: refresh }),
      draft: () => openDraftForm({ caseId: k.id, caseLabel: `${k.reference} · ${k.title}`, clientId: k.client_id, jurisdiction: k.jurisdiction, onSaved: (d) => (location.hash = `#/documents/${d.id}`) }),
      'add-event': () => openEventForm({ caseId: k.id, caseLabel: `${k.reference} · ${k.title}`, onSaved: refresh }),
      'edit-event': (el) => {
        const e = data.events.find((x) => x.id === el.dataset.id)
        openEventForm({ event: { ...e, case_id: k.id, case_reference: k.reference, case_title: k.title }, onSaved: refresh })
      }
    },
    forms: {
      note: (form) => busy(submitButton(form), async () => {
        try {
          await api.post(`/api/cases/${k.id}/notes`, formData(form))
          refresh()
        } catch (err) { showError(err, form) }
      })
    },
    changes: {
      ...taskShared.changes,
      status: async (el) => {
        try {
          await api.patch(`/api/cases/${k.id}`, { status: el.value })
          toast(t('common.saved'))
          refresh()
        } catch (err) {
          el.value = k.status
          showError(err)
        }
      }
    }
  })
}

function activityText(a) {
  if (a.kind === 'created') return t('activity.created')
  if (a.kind === 'status_change') {
    const m = a.body.match(/from (\w+) to (\w+)/)
    if (m) return t('activity.status_change', { from: t(`status.${m[1]}`), to: t(`status.${m[2]}`) })
  }
  if (a.kind === 'document') return a.body.replace(/^Document added: /, t('activity.document') + ': ')
  return a.body
}
