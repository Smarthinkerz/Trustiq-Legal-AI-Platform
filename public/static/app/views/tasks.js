import { api } from '../api.js'
import { bind, formData, html, qs, raw, render } from '../dom.js'
import { fmtDate, getLang, t } from '../i18n.js'
import { readOnly, store } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, emptyState, formActions, inputField, modal, pageHeader, pagination, priorityBadge,
  selectField, showError, spinner, submitButton, textareaField, toast
} from '../ui.js'
import { loadMembers, memberSelect, searchPicker, wirePickers } from './pickers.js'
import { PRIORITIES } from './cases.js'

export const TASK_STATUSES = ['open', 'in_progress', 'done']

export async function openTaskForm({ task, caseId, caseLabel, onSaved } = {}) {
  const members = await loadMembers().catch(() => [])
  const x = task || {}
  const m = modal({
    title: task ? t('tasks.edit') : t('tasks.new'),
    body: html`<form data-form="save" class="grid sm:grid-cols-2 gap-4" novalidate>
      ${inputField({ name: 'title', label: t('tasks.title'), value: x.title, required: true, cls: 'sm:col-span-2' })}
      <div class="sm:col-span-2">${searchPicker({ name: 'case_id', label: t('cases.matter'), value: x.case_id || caseId, valueLabel: x.case_reference ? `${x.case_reference} · ${x.case_title}` : caseLabel })}</div>
      ${memberSelect({ label: t('cases.assigned_to'), value: task ? x.assigned_to : store.me.user.id, members })}
      ${inputField({ name: 'due_date', label: t('tasks.due'), type: 'date', value: x.due_date ? String(x.due_date).slice(0, 10) : '' })}
      ${selectField({ name: 'priority', label: t('cases.priority'), options: PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) })), value: x.priority || 'medium' })}
      ${selectField({ name: 'status', label: t('common.status'), options: TASK_STATUSES.map((s) => ({ value: s, label: t(`task_status.${s}`) })), value: x.status || 'open' })}
      ${textareaField({ name: 'description', label: t('common.description'), value: x.description, rows: 3, cls: 'sm:col-span-2' })}
      <div class="sm:col-span-2 flex items-center gap-2 pt-4 mt-2 border-t border-slate-100">
        ${task ? html`<button type="button" class="btn btn-danger-ghost btn-sm" data-action="delete-task"><i class="fas fa-trash"></i>${t('common.delete')}</button>` : ''}
        <span class="flex-1"></span>
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('common.save')}</button>
      </div>
    </form>`,
    onMount: (el) => wirePickers(el),
    actions: {
      'delete-task': async () => {
        m.close()
        await deleteTask(task.id, onSaved)
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        try {
          const data = formData(form)
          const res = task ? await api.patch(`/api/tasks/${task.id}`, data) : await api.post('/api/tasks', data)
          m.close()
          toast(t('common.saved'))
          onSaved?.(res.task)
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export function openChecklistForm({ caseId, onSaved }) {
  const m = modal({
    title: t('tasks.apply_checklist'),
    size: 'sm',
    body: html`<form data-form="apply" class="space-y-4" novalidate>
      <p class="text-sm text-slate-600">${t('tasks.checklist_help')}</p>
      ${selectField({ name: 'checklist', label: t('tasks.checklist'), options: (store.ref.checklists || []).map((k) => ({ value: k, label: t(`checklist.${k}`) })), required: true })}
      ${formActions(t('tasks.add_steps'))}
    </form>`,
    forms: {
      apply: (form) => busy(submitButton(form), async () => {
        try {
          const res = await api.post('/api/tasks/apply-checklist', { case_id: caseId, checklist: form.elements.checklist.value, language: getLang() })
          m.close()
          toast(t('tasks.steps_added', { n: res.created }))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

// Compact task list used on the tasks page and on case pages.
export function taskRows(items, { showCase = true } = {}) {
  const ro = readOnly()
  return html`<ul class="divide-y divide-slate-100">${items.map((x) => html`
    <li class="px-5 py-3 flex items-start gap-3 ${x.status === 'done' ? 'opacity-60' : ''}">
      <input type="checkbox" class="mt-1 w-4 h-4" data-change="toggle-task" data-id="${x.id}" ${x.status === 'done' ? raw('checked') : ''} ${ro ? raw('disabled') : ''} aria-label="${t('tasks.mark_done')}" />
      <button class="flex-1 min-w-0 text-start" data-action="edit-task" data-id="${x.id}">
        <div class="text-sm font-medium ${x.status === 'done' ? 'line-through' : ''}" dir="auto">${x.title}</div>
        <div class="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
          ${showCase && x.case_reference ? html`<span><i class="fas fa-folder-open"></i> ${x.case_reference}</span>` : ''}
          ${x.assignee_name ? html`<span><i class="fas fa-user"></i> ${x.assignee_name}</span>` : ''}
          ${x.due_date ? html`<span class="${x.overdue ? 'text-red-600 font-semibold' : ''}"><i class="fas fa-calendar"></i> ${fmtDate(String(x.due_date).slice(0, 10))}${x.overdue ? ` · ${t('events.overdue')}` : ''}</span>` : ''}
          ${x.status === 'in_progress' ? html`<span class="text-sky-700">${t('task_status.in_progress')}</span>` : ''}
        </div>
      </button>
      ${x.priority !== 'medium' ? priorityBadge(x.priority) : ''}
    </li>`)}</ul>`
}

// Handlers shared by every task list; `items` resolves the task objects shown.
export function taskHandlers(items, refresh) {
  return {
    actions: {
      'edit-task': (el) => {
        if (readOnly()) return
        openTaskForm({ task: items().find((x) => x.id === el.dataset.id), onSaved: refresh })
      }
    },
    changes: {
      'toggle-task': async (el) => {
        try {
          await api.patch(`/api/tasks/${el.dataset.id}`, { status: el.checked ? 'done' : 'open' })
          refresh()
        } catch (err) { el.checked = !el.checked; showError(err) }
      }
    }
  }
}

export async function tasksView(root, { query, isCurrent }) {
  const state = { scope: query.get('scope') || 'mine', status: query.get('status') || 'active', page: Number(query.get('page')) || 1 }
  const ro = readOnly()
  render(root, html`
    ${pageHeader(t('nav.tasks'), t('tasks.subtitle'), ro ? '' : html`<button class="btn btn-primary" data-action="new"><i class="fas fa-plus"></i>${t('tasks.new')}</button>`)}
    <div class="card">
      <div class="p-4 border-b border-slate-100 flex flex-wrap gap-3">
        ${selectField({ name: 'scope', options: [{ value: 'mine', label: t('tasks.mine') }, { value: 'all', label: t('tasks.everyone') }], value: state.scope, cls: 'w-44', attrs: `data-change="filter" aria-label="${t('tasks.scope')}"` })}
        ${selectField({ name: 'status', options: [{ value: 'active', label: t('tasks.active') }, ...TASK_STATUSES.map((s) => ({ value: s, label: t(`task_status.${s}`) }))], value: state.status, cls: 'w-44', attrs: `data-change="filter" aria-label="${t('common.status')}"` })}
      </div>
      <div id="task-results">${spinner()}</div>
    </div>`)
  const results = root.querySelector('#task-results')
  let items = []
  const load = async () => {
    const res = await api.get('/api/tasks' + qs({ scope: state.scope, status: state.status, page: state.page }))
    if (!isCurrent()) return
    items = res.items
    render(results, items.length ? html`${taskRows(items)}${pagination(res)}`
      : emptyState('fa-list-check', t('tasks.empty_title'), t('tasks.empty_text'), ro ? '' : html`<button class="btn btn-primary" data-action="new">${t('tasks.new')}</button>`))
  }
  const reload = () => {
    history.replaceState(null, '', '#/tasks' + qs({ scope: state.scope === 'mine' ? '' : state.scope, status: state.status === 'active' ? '' : state.status, page: state.page > 1 ? state.page : '' }))
    load().catch(showError)
  }
  const shared = taskHandlers(() => items, reload)
  bind(root, {
    actions: {
      ...shared.actions,
      new: () => openTaskForm({ onSaved: reload }),
      page: (el) => { state.page = Number(el.dataset.page); reload() }
    },
    changes: {
      ...shared.changes,
      filter: (el) => { state[el.name] = el.value; state.page = 1; reload() }
    }
  })
  await load()
}

export async function deleteTask(id, onDone) {
  if (!(await confirmDialog(t('tasks.confirm_delete')))) return
  try { await api.del(`/api/tasks/${id}`); onDone?.() } catch (err) { showError(err) }
}
