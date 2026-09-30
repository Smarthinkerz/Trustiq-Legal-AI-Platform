import { api, download } from '../api.js'
import { bind, formData, html, qs, raw, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { can, readOnly, store } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, emptyState, formActions, inputField, modal, pageHeader, pagination, selectField,
  showError, spinner, submitButton, textareaField, toast
} from '../ui.js'
import { searchPicker, wirePickers } from './pickers.js'

const TABS = [
  ['invoices', 'fa-file-invoice-dollar', () => true],
  ['time', 'fa-stopwatch', () => true],
  ['expenses', 'fa-receipt', () => true],
  ['settings', 'fa-sliders', () => can('owner', 'admin')]
]
const today = () => new Date().toISOString().slice(0, 10)
const isoDay = (v) => (v ? String(v).slice(0, 10) : '')
export const fmtHours = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

const INVOICE_COLORS = { draft: 'bg-slate-100 text-slate-700', issued: 'bg-sky-100 text-sky-800', paid: 'bg-emerald-100 text-emerald-800', void: 'bg-slate-100 text-slate-400 line-through' }
export const invoiceBadge = (inv) => inv.overdue
  ? html`<span class="badge bg-red-100 text-red-700">${t('invoice_status.overdue')}</span>`
  : html`<span class="badge ${INVOICE_COLORS[inv.status] || ''}">${t(`invoice_status.${inv.status}`)}</span>`

// Parses "1:30", "1.5" or "90m" into minutes.
function parseDuration(v) {
  const s = String(v || '').trim().toLowerCase()
  let m
  if ((m = s.match(/^(\d+):([0-5]?\d)$/))) return Number(m[1]) * 60 + Number(m[2])
  if ((m = s.match(/^(\d+)\s*m(in)?$/))) return Number(m[1])
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h?$/))) return Math.round(Number(m[1]) * 60)
  return NaN
}

export function openTimeForm({ entry, caseId, caseLabel, onSaved } = {}) {
  const e = entry || {}
  const m = modal({
    title: entry ? t('billing.edit_time') : t('billing.log_time'),
    body: html`<form data-form="save" class="grid sm:grid-cols-2 gap-4" novalidate>
      <div class="sm:col-span-2">${searchPicker({ name: 'case_id', label: t('cases.matter'), value: e.case_id || caseId, valueLabel: e.case_reference ? `${e.case_reference} · ${e.case_title}` : caseLabel })}</div>
      ${inputField({ name: 'work_date', label: t('billing.date'), type: 'date', value: isoDay(e.work_date) || today(), required: true })}
      ${inputField({ name: 'duration', label: t('billing.duration'), value: e.minutes ? fmtHours(e.minutes) : '', required: true, placeholder: '1:30', hint: t('billing.duration_hint'), attrs: 'dir="ltr" inputmode="decimal"' })}
      ${textareaField({ name: 'description', label: t('common.description'), value: e.description, rows: 3, required: true, cls: 'sm:col-span-2' })}
      ${inputField({ name: 'rate', label: t('billing.rate'), type: 'number', value: e.rate, attrs: 'data-type="number" min="0" step="0.001"', hint: t('billing.rate_hint') })}
      <label class="flex items-center gap-2 text-sm mt-7"><input type="checkbox" name="billable" ${e.billable === false ? '' : raw('checked')} />${t('billing.billable')}</label>
      <div class="sm:col-span-2">${formActions(t('common.save'))}</div>
    </form>`,
    onMount: (el) => wirePickers(el),
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const d = formData(form)
        const minutes = parseDuration(d.duration)
        if (!d.case_id) return toast(t('billing.pick_case'), 'error')
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return toast(t('billing.bad_duration'), 'error')
        const body = { case_id: d.case_id, work_date: d.work_date, minutes, description: d.description, billable: d.billable, rate: d.rate }
        try {
          if (entry) await api.patch(`/api/billing/time/${entry.id}`, body)
          else await api.post('/api/billing/time', body)
          m.close()
          toast(t('common.saved'))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export function openExpenseForm({ caseId, caseLabel, onSaved } = {}) {
  const m = modal({
    title: t('billing.add_expense'),
    body: html`<form data-form="save" class="grid sm:grid-cols-2 gap-4" novalidate>
      <div class="sm:col-span-2">${searchPicker({ name: 'case_id', label: t('cases.matter'), value: caseId, valueLabel: caseLabel })}</div>
      ${inputField({ name: 'incurred_on', label: t('billing.date'), type: 'date', value: today(), required: true })}
      ${inputField({ name: 'amount', label: t('billing.amount'), type: 'number', required: true, attrs: 'data-type="number" min="0" step="0.001"' })}
      ${textareaField({ name: 'description', label: t('common.description'), rows: 2, required: true, cls: 'sm:col-span-2', placeholder: t('billing.expense_placeholder') })}
      <label class="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="billable" checked />${t('billing.billable')}</label>
      <div class="sm:col-span-2">${formActions(t('common.save'))}</div>
    </form>`,
    onMount: (el) => wirePickers(el),
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const d = formData(form)
        if (!d.case_id) return toast(t('billing.pick_case'), 'error')
        try {
          await api.post('/api/billing/expenses', d)
          m.close()
          toast(t('common.saved'))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function openInvoiceWizard({ clientId, clientName, caseId, onCreated } = {}) {
  const currencies = store.ref.currencies || []
  const m = modal({
    title: t('billing.new_invoice'),
    size: 'xl',
    body: html`<form data-form="create" class="space-y-5" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        <div class="sm:col-span-2">${searchPicker({ name: 'client_id', label: t('cases.client'), value: clientId, valueLabel: clientName })}</div>
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: store.me.org.default_currency })}
      </div>
      <div data-unbilled class="text-sm text-slate-500">${t('billing.pick_client_first')}</div>
      <div>
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold text-sm">${t('billing.fixed_fees')}</h3>
          <button type="button" class="btn btn-outline btn-sm" data-action="add-line"><i class="fas fa-plus"></i>${t('billing.add_line')}</button>
        </div>
        <div data-lines class="space-y-2"></div>
      </div>
      ${textareaField({ name: 'notes', label: t('billing.invoice_notes'), rows: 2 })}
      ${formActions(t('billing.create_draft'))}
    </form>`,
    onMount: (el) => {
      wirePickers(el)
      const select = el.querySelector('[data-picker="client_id"]')
      const loadUnbilled = async () => {
        const box = el.querySelector('[data-unbilled]')
        if (!select.value) { render(box, t('billing.pick_client_first')); return }
        render(box, spinner())
        try {
          const u = await api.get('/api/billing/unbilled' + qs({ client_id: select.value, case_id: caseId }))
          render(box, u.time.length || u.expenses.length ? html`
            <div class="grid lg:grid-cols-2 gap-4">
              <div class="border border-slate-200 rounded-lg">
                <div class="px-4 py-2 border-b border-slate-100 flex items-center justify-between text-sm font-semibold">${t('billing.unbilled_time')}<label class="font-normal text-xs flex items-center gap-1"><input type="checkbox" data-all="time" checked />${t('billing.select_all')}</label></div>
                <ul class="max-h-64 overflow-y-auto divide-y divide-slate-100">${u.time.map((x) => html`<li class="px-4 py-2 flex items-start gap-2 text-sm">
                  <input type="checkbox" name="time" value="${x.id}" checked class="mt-1" />
                  <div class="flex-1 min-w-0"><div class="truncate" dir="auto">${x.description}</div><div class="text-xs text-slate-500">${fmtDate(isoDay(x.work_date))} · ${x.case_reference} · ${x.user_name || ''} · ${fmtHours(x.minutes)}</div></div>
                  <span class="whitespace-nowrap">${fmtMoney(x.amount, x.currency)}</span></li>`)}</ul>
              </div>
              <div class="border border-slate-200 rounded-lg">
                <div class="px-4 py-2 border-b border-slate-100 flex items-center justify-between text-sm font-semibold">${t('billing.unbilled_expenses')}<label class="font-normal text-xs flex items-center gap-1"><input type="checkbox" data-all="expense" checked />${t('billing.select_all')}</label></div>
                <ul class="max-h-64 overflow-y-auto divide-y divide-slate-100">${u.expenses.map((x) => html`<li class="px-4 py-2 flex items-start gap-2 text-sm">
                  <input type="checkbox" name="expense" value="${x.id}" checked class="mt-1" />
                  <div class="flex-1 min-w-0"><div class="truncate" dir="auto">${x.description}</div><div class="text-xs text-slate-500">${fmtDate(isoDay(x.incurred_on))} · ${x.case_reference}</div></div>
                  <span class="whitespace-nowrap">${fmtMoney(x.amount, x.currency)}</span></li>`)}</ul>
              </div>
            </div>` : html`<p class="text-sm text-slate-500">${t('billing.nothing_unbilled')}</p>`)
          for (const all of box.querySelectorAll('[data-all]')) {
            all.addEventListener('change', () => box.querySelectorAll(`input[name="${all.dataset.all}"]`).forEach((c) => { c.checked = all.checked }))
          }
        } catch (err) { showError(err) }
      }
      select.addEventListener('change', loadUnbilled)
      if (clientId) loadUnbilled()
    },
    actions: {
      'add-line': (el) => {
        const lines = el.closest('form').querySelector('[data-lines]')
        const row = document.createElement('div')
        row.className = 'grid grid-cols-[1fr_5rem_8rem_auto] gap-2'
        render(row, html`<input class="input" data-line="description" placeholder="${t('billing.line_description')}" aria-label="${t('billing.line_description')}" dir="auto" />
          <input class="input" data-line="quantity" type="number" min="0" step="0.01" value="1" aria-label="${t('billing.quantity')}" />
          <input class="input" data-line="unit_price" type="number" min="0" step="0.001" placeholder="${t('billing.unit_price')}" aria-label="${t('billing.unit_price')}" />
          <button type="button" class="btn btn-ghost btn-sm" data-action="remove-line" aria-label="${t('common.delete')}"><i class="fas fa-xmark"></i></button>`)
        lines.appendChild(row)
        row.querySelector('input').focus()
      },
      'remove-line': (el) => el.closest('div.grid').remove()
    },
    forms: {
      create: (form) => busy(submitButton(form), async () => {
        const clientIdValue = form.elements.client_id.value
        if (!clientIdValue) return toast(t('billing.pick_client_first'), 'error')
        const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((c) => c.value)
        const fixed = [...form.querySelectorAll('[data-lines] > div')].map((row) => ({
          description: row.querySelector('[data-line=description]').value.trim(),
          quantity: Number(row.querySelector('[data-line=quantity]').value || 1),
          unit_price: Number(row.querySelector('[data-line=unit_price]').value)
        })).filter((l) => l.description && Number.isFinite(l.unit_price))
        try {
          const res = await api.post('/api/billing/invoices', {
            client_id: clientIdValue, case_id: caseId || null, currency: form.elements.currency.value,
            time_entry_ids: checked('time'), expense_ids: checked('expense'), fixed_lines: fixed, notes: form.elements.notes.value.trim() || null
          })
          m.close()
          toast(t('billing.draft_created'))
          onCreated ? onCreated(res.invoice) : (location.hash = `#/billing/invoices/${res.invoice.id}`)
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function billingView(root, ctx) {
  const tabs = TABS.filter(([, , ok]) => ok())
  const active = tabs.find(([k]) => k === ctx.query.get('tab'))?.[0] || 'invoices'
  const ro = readOnly()
  const buttons = ro ? '' : html`
    <button class="btn btn-outline" data-action="log-time"><i class="fas fa-stopwatch"></i>${t('billing.log_time')}</button>
    <button class="btn btn-outline" data-action="add-expense"><i class="fas fa-receipt"></i>${t('billing.add_expense')}</button>
    ${can('owner', 'admin', 'lawyer') ? html`<button class="btn btn-primary" data-action="new-invoice"><i class="fas fa-plus"></i>${t('billing.new_invoice')}</button>` : ''}`
  render(root, html`
    ${pageHeader(t('nav.billing'), t('billing.subtitle'), buttons)}
    <div class="flex gap-1 overflow-x-auto border-b border-slate-200 mb-6" role="tablist">
      ${tabs.map(([k, icon]) => html`<a href="#/billing?tab=${k}" role="tab" aria-selected="${k === active}" class="tab ${k === active ? 'active' : ''}"><i class="fas ${icon} me-1.5"></i>${t(`billing.tab_${k}`)}</a>`)}
    </div>
    <div id="tab-body">${spinner()}</div>`)
  const body = root.querySelector('#tab-body')
  const reload = () => ctx.rerender()
  bind(root, {
    actions: {
      'log-time': () => openTimeForm({ onSaved: reload }),
      'add-expense': () => openExpenseForm({ onSaved: reload }),
      'new-invoice': () => openInvoiceWizard()
    }
  })
  await ({ invoices, time, expenses, settings })[active](body, ctx)
}

async function invoices(root, { query, isCurrent }) {
  const state = { status: query.get('status') || '', page: Number(query.get('page')) || 1 }
  const res = await api.get('/api/billing/invoices' + qs(state))
  if (!isCurrent()) return
  render(root, html`<div class="card">
    <div class="p-4 border-b border-slate-100 flex gap-3">
      ${selectField({ name: 'status', options: ['draft', 'outstanding', 'overdue', 'paid', 'void'].map((s) => ({ value: s, label: t(`invoice_status.${s}`) })), value: state.status, empty: t('billing.all_invoices'), cls: 'w-48', attrs: `data-change="filter" aria-label="${t('common.status')}"` })}
    </div>
    ${res.items.length ? html`<div class="overflow-x-auto"><table class="table">
      <thead><tr><th>${t('billing.number')}</th><th>${t('cases.client')}</th><th>${t('billing.issued')}</th><th>${t('billing.due')}</th><th class="text-end">${t('billing.total')}</th><th class="text-end">${t('billing.balance')}</th><th>${t('common.status')}</th></tr></thead>
      <tbody>${res.items.map((i) => html`<tr class="clickable" data-action="open" data-id="${i.id}">
        <td class="font-mono text-xs">${i.number || html`<span class="text-slate-400">${t('invoice_status.draft')}</span>`}</td>
        <td><div class="font-medium">${i.client_name}</div>${i.case_reference ? html`<div class="text-xs text-slate-500">${i.case_reference}</div>` : ''}</td>
        <td class="text-sm">${i.issue_date ? fmtDate(isoDay(i.issue_date)) : '—'}</td>
        <td class="text-sm">${i.due_date ? fmtDate(isoDay(i.due_date)) : '—'}</td>
        <td class="text-end whitespace-nowrap">${fmtMoney(Number(i.total), i.currency)}</td>
        <td class="text-end whitespace-nowrap">${i.status === 'issued' ? fmtMoney(Number(i.total) - Number(i.amount_paid), i.currency) : '—'}</td>
        <td>${invoiceBadge(i)}</td>
      </tr>`)}</tbody></table></div>${pagination(res)}`
      : emptyState('fa-file-invoice-dollar', t('billing.no_invoices'), t('billing.no_invoices_text'))}
  </div>`)
  bind(root, {
    actions: {
      open: (el) => (location.hash = `#/billing/invoices/${el.dataset.id}`),
      page: (el) => (location.hash = '#/billing' + qs({ tab: 'invoices', status: state.status, page: el.dataset.page }))
    },
    changes: { filter: (el) => (location.hash = '#/billing' + qs({ tab: 'invoices', status: el.value })) }
  })
}

async function time(root, { query, isCurrent, rerender }) {
  const state = { unbilled: query.get('unbilled') || '', page: Number(query.get('page')) || 1 }
  const res = await api.get('/api/billing/time' + qs(state))
  if (!isCurrent()) return
  const me = store.me.user
  const mayEdit = (x) => !x.invoice_id && !readOnly() && (x.user_id === me.id || can('owner', 'admin'))
  render(root, html`<div class="card">
    <div class="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-change="unbilled" ${state.unbilled ? raw('checked') : ''} />${t('billing.only_unbilled')}</label>
      <div class="text-sm text-slate-600">${t('billing.summary', { hours: fmtHours(res.summary.minutes), billable: fmtHours(res.summary.billable_minutes) })}</div>
    </div>
    ${res.items.length ? html`<div class="overflow-x-auto"><table class="table">
      <thead><tr><th>${t('billing.date')}</th><th>${t('cases.matter')}</th><th>${t('common.description')}</th><th>${t('billing.by')}</th><th class="text-end">${t('billing.hours')}</th><th class="text-end">${t('billing.amount')}</th><th></th></tr></thead>
      <tbody>${res.items.map((x) => html`<tr>
        <td class="text-sm whitespace-nowrap">${fmtDate(isoDay(x.work_date))}</td>
        <td class="text-xs"><a class="text-brand-600 hover:underline" href="#/cases/${x.case_id}">${x.case_reference}</a></td>
        <td class="text-sm max-w-md"><div class="line-clamp-2" dir="auto">${x.description}</div>${x.billable ? '' : html`<span class="badge bg-slate-100 text-slate-500">${t('billing.non_billable')}</span>`}</td>
        <td class="text-sm whitespace-nowrap">${x.user_name || '—'}</td>
        <td class="text-end font-mono text-sm">${fmtHours(x.minutes)}</td>
        <td class="text-end whitespace-nowrap text-sm">${x.billable ? fmtMoney(x.amount, x.currency) : '—'}</td>
        <td class="text-end whitespace-nowrap">${x.invoice_id ? html`<a class="text-xs text-brand-600 hover:underline" href="#/billing/invoices/${x.invoice_id}">${x.invoice_number || t('invoice_status.draft')}</a>`
          : mayEdit(x) ? html`<button class="btn btn-ghost btn-sm" data-action="edit" data-id="${x.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button><button class="btn btn-ghost btn-sm" data-action="delete" data-id="${x.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}</td>
      </tr>`)}</tbody></table></div>${pagination(res)}`
      : emptyState('fa-stopwatch', t('billing.no_time'), t('billing.no_time_text'))}
  </div>`)
  bind(root, {
    actions: {
      edit: (el) => openTimeForm({ entry: res.items.find((x) => x.id === el.dataset.id), onSaved: rerender }),
      delete: async (el) => {
        if (!(await confirmDialog(t('billing.confirm_delete_entry')))) return
        try { await api.del(`/api/billing/time/${el.dataset.id}`); rerender() } catch (err) { showError(err) }
      },
      page: (el) => (location.hash = '#/billing' + qs({ tab: 'time', unbilled: state.unbilled, page: el.dataset.page }))
    },
    changes: { unbilled: (el) => (location.hash = '#/billing' + qs({ tab: 'time', unbilled: el.checked ? 'true' : '' })) }
  })
}

async function expenses(root, { query, isCurrent, rerender }) {
  const page = Number(query.get('page')) || 1
  const res = await api.get('/api/billing/expenses' + qs({ page }))
  if (!isCurrent()) return
  render(root, html`<div class="card">
    ${res.items.length ? html`<div class="overflow-x-auto"><table class="table">
      <thead><tr><th>${t('billing.date')}</th><th>${t('cases.matter')}</th><th>${t('common.description')}</th><th class="text-end">${t('billing.amount')}</th><th></th></tr></thead>
      <tbody>${res.items.map((x) => html`<tr>
        <td class="text-sm whitespace-nowrap">${fmtDate(isoDay(x.incurred_on))}</td>
        <td class="text-xs"><a class="text-brand-600 hover:underline" href="#/cases/${x.case_id}">${x.case_reference}</a></td>
        <td class="text-sm" dir="auto">${x.description}${x.billable ? '' : html` <span class="badge bg-slate-100 text-slate-500">${t('billing.non_billable')}</span>`}</td>
        <td class="text-end whitespace-nowrap text-sm">${fmtMoney(Number(x.amount), x.currency)}</td>
        <td class="text-end">${x.invoice_id ? html`<a class="text-xs text-brand-600 hover:underline" href="#/billing/invoices/${x.invoice_id}">${x.invoice_number || t('invoice_status.draft')}</a>`
          : readOnly() ? '' : html`<button class="btn btn-ghost btn-sm" data-action="delete" data-id="${x.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>`}</td>
      </tr>`)}</tbody></table></div>${pagination(res)}`
      : emptyState('fa-receipt', t('billing.no_expenses'), t('billing.no_expenses_text'))}
  </div>`)
  bind(root, {
    actions: {
      delete: async (el) => {
        if (!(await confirmDialog(t('billing.confirm_delete_entry')))) return
        try { await api.del(`/api/billing/expenses/${el.dataset.id}`); rerender() } catch (err) { showError(err) }
      },
      page: (el) => (location.hash = '#/billing' + qs({ tab: 'expenses', page: el.dataset.page }))
    }
  })
}

async function settings(root, { isCurrent, rerender }) {
  const { settings: s, rates } = await api.get('/api/billing/settings')
  if (!isCurrent()) return
  const jurisdictionVat = s.vat_rate == null ? s.effective_vat_rate : null
  render(root, html`<div class="grid lg:grid-cols-2 gap-6 max-w-5xl">
    <section class="card card-pad">
      <h2 class="font-semibold mb-1">${t('billing.invoice_settings')}</h2>
      <p class="text-sm text-slate-500 mb-4">${t('billing.invoice_settings_help')}</p>
      <form data-form="settings" class="grid sm:grid-cols-2 gap-4" novalidate>
        ${inputField({ name: 'vat_number', label: t('billing.vat_number'), value: s.vat_number, attrs: 'dir="ltr"' })}
        ${inputField({ name: 'vat_rate', label: t('billing.vat_rate'), type: 'number', value: s.vat_rate, attrs: 'data-type="number" min="0" max="100" step="0.01"', hint: jurisdictionVat != null ? t('billing.vat_default', { rate: jurisdictionVat }) : t('billing.vat_blank_hint') })}
        ${inputField({ name: 'payment_terms_days', label: t('billing.payment_terms'), type: 'number', value: s.payment_terms_days ?? 30, attrs: 'data-type="number" min="0" max="365"' })}
        ${inputField({ name: 'default_hourly_rate', label: t('billing.default_rate'), type: 'number', value: s.default_hourly_rate, attrs: 'data-type="number" min="0" step="0.001"' })}
        ${textareaField({ name: 'bank_details', label: t('billing.bank_details'), value: s.bank_details, rows: 3, cls: 'sm:col-span-2', placeholder: t('billing.bank_placeholder') })}
        ${inputField({ name: 'invoice_footer', label: t('billing.invoice_footer'), value: s.invoice_footer, cls: 'sm:col-span-2' })}
        <div class="sm:col-span-2 flex justify-end"><button type="submit" class="btn btn-primary">${t('common.save')}</button></div>
      </form>
    </section>
    <section class="card">
      <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('billing.hourly_rates')}</h2><p class="text-xs text-slate-500">${t('billing.hourly_rates_help')}</p></div>
      <ul class="divide-y divide-slate-100">${rates.map((r) => html`<li class="px-5 py-3 flex items-center gap-3">
        <div class="flex-1 min-w-0"><div class="text-sm font-medium truncate">${r.name}</div><div class="text-xs text-slate-500">${t(`role.${r.role}`)}</div></div>
        <input type="number" class="input w-32" min="0" step="0.001" value="${r.hourly_rate ?? ''}" placeholder="${s.default_hourly_rate ?? ''}" data-change="rate" data-id="${r.id}" aria-label="${t('billing.rate')} – ${r.name}" />
        <span class="text-xs text-slate-500 w-10">${store.me.org.default_currency}</span>
      </li>`)}</ul>
    </section>
  </div>`)
  bind(root, {
    forms: {
      settings: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const d = formData(form)
        try { await api.put('/api/billing/settings', { ...d, payment_terms_days: d.payment_terms_days ?? 30 }); toast(t('common.saved')); rerender() } catch (err) { showError(err, form) }
      })
    },
    changes: {
      rate: async (el) => {
        try { await api.put(`/api/billing/rates/${el.dataset.id}`, { hourly_rate: el.value === '' ? null : Number(el.value) }); toast(t('common.saved')) } catch (err) { showError(err) }
      }
    }
  })
}

export async function invoiceView(root, { params, isCurrent, rerender }) {
  const { invoice: inv, lines } = await api.get(`/api/billing/invoices/${params.id}`)
  if (!isCurrent()) return
  const ro = readOnly()
  const money = (n) => fmtMoney(Number(n), inv.currency)
  const balance = Number(inv.total) - Number(inv.amount_paid)
  const manage = can('owner', 'admin')
  const edit = can('owner', 'admin', 'lawyer') && !ro
  render(root, html`
    <nav class="text-sm text-slate-500 mb-3"><a href="#/billing" class="hover:underline">${t('nav.billing')}</a></nav>
    <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold flex items-center gap-3">${inv.number || t('billing.draft_invoice')} ${invoiceBadge(inv)}</h1>
        <p class="text-slate-600 mt-1"><a class="hover:underline" href="#/clients/${inv.client_id}">${inv.client_name}</a>${inv.case_reference ? html` · <a class="hover:underline" href="#/cases/${inv.case_id}">${inv.case_reference}</a>` : ''}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-outline" data-action="export" data-lang="en"><i class="fas fa-file-word"></i>${t('billing.download_en')}</button>
        <button class="btn btn-outline" data-action="export" data-lang="ar"><i class="fas fa-file-word"></i>${t('billing.download_ar')}</button>
        ${edit && inv.status === 'draft' ? html`<button class="btn btn-primary" data-action="issue"><i class="fas fa-paper-plane"></i>${t('billing.issue')}</button>` : ''}
        ${manage && !ro && inv.status === 'issued' ? html`<button class="btn btn-primary" data-action="payment"><i class="fas fa-money-bill"></i>${t('billing.record_payment')}</button>` : ''}
        ${manage && !ro && inv.status === 'issued' && Number(inv.amount_paid) === 0 ? html`<button class="btn btn-danger-ghost" data-action="void">${t('billing.void')}</button>` : ''}
        ${edit && inv.status === 'draft' ? html`<button class="btn btn-danger-ghost" data-action="delete" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>
    <div class="grid lg:grid-cols-3 gap-6">
      <section class="card lg:col-span-2">
        <div class="overflow-x-auto"><table class="table">
          <thead><tr><th>${t('common.description')}</th><th class="text-end">${t('billing.quantity')}</th><th class="text-end">${t('billing.unit_price')}</th><th class="text-end">${t('billing.amount')}</th></tr></thead>
          <tbody>${lines.map((l) => html`<tr>
            <td class="text-sm" dir="auto">${l.description}</td>
            <td class="text-end text-sm">${Number(l.quantity)}${l.kind === 'time' ? ' h' : ''}</td>
            <td class="text-end text-sm whitespace-nowrap">${money(l.unit_price)}</td>
            <td class="text-end text-sm whitespace-nowrap">${money(l.amount)}</td></tr>`)}</tbody>
          <tfoot class="text-sm">
            <tr><td colspan="3" class="text-end">${t('billing.subtotal')}</td><td class="text-end whitespace-nowrap">${money(inv.subtotal)}</td></tr>
            <tr><td colspan="3" class="text-end">${t('billing.vat')} (${Number(inv.vat_rate)}%)</td><td class="text-end whitespace-nowrap">${money(inv.vat_amount)}</td></tr>
            <tr class="font-bold"><td colspan="3" class="text-end">${t('billing.total')}</td><td class="text-end whitespace-nowrap">${money(inv.total)}</td></tr>
            ${Number(inv.amount_paid) > 0 ? html`<tr><td colspan="3" class="text-end">${t('billing.paid')}</td><td class="text-end whitespace-nowrap">${money(inv.amount_paid)}</td></tr>
              <tr class="font-semibold"><td colspan="3" class="text-end">${t('billing.balance')}</td><td class="text-end whitespace-nowrap">${money(balance)}</td></tr>` : ''}
          </tfoot>
        </table></div>
      </section>
      <section class="card card-pad space-y-4">
        <dl class="grid grid-cols-2 gap-3 text-sm">
          <div><dt class="text-xs text-slate-500">${t('billing.issued')}</dt><dd>${inv.issue_date ? fmtDate(isoDay(inv.issue_date)) : '—'}</dd></div>
          <div><dt class="text-xs text-slate-500">${t('billing.due')}</dt><dd class="${inv.overdue ? 'text-red-600 font-semibold' : ''}">${inv.due_date ? fmtDate(isoDay(inv.due_date)) : '—'}</dd></div>
          <div><dt class="text-xs text-slate-500">${t('cases.currency')}</dt><dd>${inv.currency}</dd></div>
          <div><dt class="text-xs text-slate-500">${t('billing.vat')}</dt><dd>${Number(inv.vat_rate)}%</dd></div>
        </dl>
        ${edit && ['draft', 'issued'].includes(inv.status) ? html`<form data-form="meta" class="space-y-3 pt-4 border-t border-slate-100" novalidate>
          ${inv.status === 'draft' ? inputField({ name: 'vat_rate', label: t('billing.vat_rate'), type: 'number', value: Number(inv.vat_rate), attrs: 'data-type="number" min="0" max="100" step="0.01"' }) : ''}
          ${inputField({ name: 'due_date', label: t('billing.due'), type: 'date', value: isoDay(inv.due_date) })}
          ${textareaField({ name: 'notes', label: t('billing.invoice_notes'), value: inv.notes, rows: 3 })}
          <div class="flex justify-end"><button type="submit" class="btn btn-outline btn-sm">${t('common.save')}</button></div>
        </form>` : inv.notes ? html`<p class="text-sm whitespace-pre-wrap" dir="auto">${inv.notes}</p>` : ''}
      </section>
    </div>`)
  const post = (path, body) => async () => {
    try { await api.post(`/api/billing/invoices/${inv.id}/${path}`, body); toast(t('common.saved')); rerender() } catch (err) { showError(err) }
  }
  bind(root, {
    actions: {
      export: (el) => download(`/api/billing/invoices/${inv.id}/export?lang=${el.dataset.lang}`),
      issue: async (el) => {
        if (!(await confirmDialog(t('billing.confirm_issue'), { danger: false, confirmLabel: t('billing.issue') }))) return
        busy(el, post('issue'))
      },
      void: async () => { if (await confirmDialog(t('billing.confirm_void'))) post('void')() },
      delete: async () => {
        if (!(await confirmDialog(t('billing.confirm_delete')))) return
        try { await api.del(`/api/billing/invoices/${inv.id}`); toast(t('common.deleted')); location.hash = '#/billing' } catch (err) { showError(err) }
      },
      payment: () => {
        const m = modal({
          title: t('billing.record_payment'),
          size: 'sm',
          body: html`<form data-form="pay" class="space-y-4" novalidate>
            ${inputField({ name: 'amount', label: `${t('billing.amount')} (${inv.currency})`, type: 'number', value: balance, required: true, attrs: `data-type="number" min="0" step="0.001" max="${balance}"` })}
            ${formActions(t('billing.record_payment'))}
          </form>`,
          forms: {
            pay: (form) => busy(submitButton(form), async () => {
              try { await api.post(`/api/billing/invoices/${inv.id}/payments`, formData(form)); m.close(); toast(t('common.saved')); rerender() } catch (err) { showError(err, form) }
            })
          }
        })
      }
    },
    forms: {
      meta: (form) => busy(submitButton(form), async () => {
        const d = formData(form)
        const body = { notes: d.notes, due_date: d.due_date || undefined }
        if (d.vat_rate != null) body.vat_rate = d.vat_rate
        try { await api.patch(`/api/billing/invoices/${inv.id}`, body); toast(t('common.saved')); rerender() } catch (err) { showError(err, form) }
      })
    }
  })
}
