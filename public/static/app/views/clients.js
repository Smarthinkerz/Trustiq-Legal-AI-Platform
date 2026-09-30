import { api } from '../api.js'
import { bind, formData, html, qs, render } from '../dom.js'
import { fmtDate, fmtMoney, fmtRelative, t } from '../i18n.js'
import { can, canDelete, readOnly, refLabel } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, debounce, emptyState, formActions, inputField, modal, pageHeader, pagination,
  selectField, showError, spinner, statusBadge, submitButton, textareaField, toast
} from '../ui.js'
import { openCaseForm } from './cases.js'
import { invoiceBadge, openInvoiceWizard } from './billing.js'
import { messageThread } from './portal.js'

// Warns about possible conflicts of interest while a new client's name is typed.
async function checkConflicts(name, box, excludeId) {
  if (!name || name.trim().length < 3) { render(box, ''); return }
  try {
    const r = await api.get('/api/workspace/conflicts' + qs({ name: name.trim(), exclude_client_id: excludeId }))
    if (!r.clients.length && !r.cases.length) {
      render(box, html`<p class="text-xs text-emerald-700"><i class="fas fa-circle-check"></i> ${t('conflicts.none')}</p>`)
      return
    }
    render(box, html`<div class="rounded-lg ${r.conflict ? 'bg-red-50 text-red-800 border-red-200' : 'bg-amber-50 text-amber-900 border-amber-200'} border p-3 text-sm">
      <p class="font-semibold mb-1"><i class="fas fa-triangle-exclamation"></i> ${r.conflict ? t('conflicts.opposing') : t('conflicts.similar')}</p>
      <ul class="list-disc ps-5 space-y-0.5">
        ${r.clients.map((c) => html`<li>${t('conflicts.existing_client')}: <a class="underline" href="#/clients/${c.id}" target="_blank" rel="noopener">${c.name}</a></li>`)}
        ${r.cases.map((k) => html`<li>${k.reference} · ${k.title}${k.opposing_party ? html` – ${t('cases.opposing_party')}: <strong>${k.opposing_party}</strong>` : ''}${k.client_name ? ` (${k.client_name})` : ''}</li>`)}
      </ul></div>`)
  } catch { render(box, '') }
}

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
        <div class="sm:col-span-2" data-conflicts></div>
        ${inputField({ name: 'email', label: t('clients.email'), type: 'email', value: c.email, attrs: 'dir="ltr"' })}
        ${inputField({ name: 'phone', label: t('clients.phone'), type: 'tel', value: c.phone, attrs: 'dir="ltr"' })}
        ${textareaField({ name: 'address', label: t('clients.address'), value: c.address, rows: 2, cls: 'sm:col-span-2' })}
        ${textareaField({ name: 'notes', label: t('clients.notes'), value: c.notes, rows: 3, cls: 'sm:col-span-2' })}
        <div class="sm:col-span-2">${formActions(client ? t('common.save') : t('clients.create'))}</div>
      </form>`,
    onMount: (el) => {
      const box = el.querySelector('[data-conflicts]')
      const run = debounce(() => checkConflicts(el.querySelector('[name=name]').value || el.querySelector('[name=name_ar]').value, box, client?.id), 500)
      for (const n of ['name', 'name_ar', 'id_number']) el.querySelector(`[name=${n}]`).addEventListener('input', run)
    },
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
            <div><div class="font-medium">${c.name}${c.unread_messages ? html` <span class="badge bg-brand-600 text-white ms-1" title="${t('clients.unread_messages')}"><i class="fas fa-envelope"></i> ${c.unread_messages}</span>` : ''}</div>${c.name_ar ? html`<div class="text-xs text-slate-500" dir="rtl">${c.name_ar}</div>` : ''}</div></div></td>
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
  const [{ client: c, cases, documents }, portal, messages, invoices] = await Promise.all([
    api.get(`/api/clients/${params.id}`),
    api.get(`/api/clients/${params.id}/portal`),
    api.get(`/api/clients/${params.id}/messages`),
    api.get(`/api/billing/invoices?client_id=${params.id}&pageSize=10`)
  ])
  if (!isCurrent()) return
  const canInvite = can('owner', 'admin', 'lawyer')
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
        <div class="pt-4 border-t border-slate-100">
          <h3 class="font-semibold text-sm mb-1"><i class="fas fa-door-open text-slate-400"></i> ${t('clients.portal')}</h3>
          <p class="text-xs text-slate-500 mb-3">${t('clients.portal_help')}</p>
          ${portal.users.length ? html`<ul class="space-y-2 mb-3">${portal.users.map((u) => html`<li class="flex items-center gap-2 text-sm ${u.deactivated_at ? 'opacity-50' : ''}">
            <div class="flex-1 min-w-0"><div class="truncate">${u.name}</div><div class="text-xs text-slate-500 truncate" dir="ltr">${u.email}</div></div>
            ${!u.deactivated_at && canInvite && !ro ? html`<button class="btn btn-danger-ghost btn-sm" data-action="remove-portal-user" data-id="${u.id}" data-name="${u.name}">${t('settings.remove')}</button>` : ''}</li>`)}</ul>` : ''}
          ${portal.invites.length ? html`<p class="text-xs text-slate-500 mb-3">${t('clients.portal_pending', { emails: portal.invites.map((i) => i.email).join(', ') })}</p>` : ''}
          ${canInvite && !ro ? html`<button class="btn btn-outline btn-sm w-full" data-action="portal-invite"><i class="fas fa-user-plus"></i>${t('clients.portal_invite')}</button>` : ''}
        </div>
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
          <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <h2 class="font-semibold">${t('portal.messages')}</h2>
            <span class="text-xs text-slate-500">${portal.users.filter((u) => !u.deactivated_at).length ? t('clients.portal_active') : t('clients.portal_none')}</span>
          </div>
          <div class="p-5 space-y-4 bg-slate-50 max-h-96 overflow-y-auto" data-thread>${messageThread(messages.items, { mineIsClient: false })}</div>
          ${ro ? '' : html`<form data-form="message" class="p-4 border-t border-slate-100 flex gap-2 items-end">
            <textarea name="body" rows="2" class="input flex-1" dir="auto" required maxlength="10000" placeholder="${t('clients.message_placeholder')}" aria-label="${t('clients.message_placeholder')}"></textarea>
            <button type="submit" class="btn btn-primary" aria-label="${t('ai.send')}"><i class="fas fa-paper-plane rtl:-scale-x-100"></i></button>
          </form>`}
        </section>
        <section class="card">
          <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
            <h2 class="font-semibold">${t('portal.invoices')} <span class="text-slate-400 font-normal">(${invoices.total})</span></h2>
            ${ro || !canInvite ? '' : html`<button class="btn btn-outline btn-sm" data-action="invoice"><i class="fas fa-plus"></i>${t('billing.new_invoice')}</button>`}
          </div>
          ${invoices.items.length ? html`<ul class="divide-y divide-slate-100">${invoices.items.map((i) => html`<li><a href="#/billing/invoices/${i.id}" class="px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
            <span class="font-mono text-xs w-28">${i.number || t('invoice_status.draft')}</span><span class="flex-1 text-sm">${fmtMoney(Number(i.total), i.currency)}</span>${invoiceBadge(i)}</a></li>`)}</ul>`
            : html`<p class="px-5 py-6 text-sm text-slate-500">${t('billing.no_invoices')}</p>`}
        </section>
        <section class="card">
          <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('nav.documents')} <span class="text-slate-400 font-normal">(${documents.length})</span></h2></div>
          ${documents.length ? html`<ul class="divide-y divide-slate-100">${documents.map((d) => html`<li><a href="#/documents/${d.id}" class="px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
            <i class="fas fa-file-lines text-slate-400"></i><span class="flex-1 truncate text-sm">${d.title}</span>${statusBadge(d.status)}<span class="text-xs text-slate-400">${fmtRelative(d.updated_at)}</span></a></li>`)}</ul>`
            : html`<p class="px-5 py-6 text-sm text-slate-500">${t('clients.no_documents')}</p>`}
        </section>
      </div>
    </div>`)
  const thread = root.querySelector('[data-thread]')
  if (thread) thread.scrollTop = thread.scrollHeight
  bind(root, {
    forms: {
      message: (form) => busy(submitButton(form), async () => {
        try {
          await api.post(`/api/clients/${c.id}/messages`, { body: form.elements.body.value.trim() })
          form.elements.body.value = ''
          const fresh = await api.get(`/api/clients/${c.id}/messages`)
          render(thread, messageThread(fresh.items, { mineIsClient: false }))
          thread.scrollTop = thread.scrollHeight
        } catch (err) { showError(err, form) }
      })
    },
    actions: {
      invoice: () => openInvoiceWizard({ clientId: c.id, clientName: c.name }),
      'portal-invite': () => {
        const m = modal({
          title: t('clients.portal_invite'),
          size: 'sm',
          body: html`<form data-form="invite" class="space-y-4" novalidate>
            <p class="text-sm text-slate-600">${t('clients.portal_invite_help')}</p>
            ${inputField({ name: 'email', label: t('auth.email'), type: 'email', value: c.email, required: true, attrs: 'dir="ltr"' })}
            ${formActions(t('settings.send_invite'))}
          </form>`,
          forms: {
            invite: (form) => busy(submitButton(form), async () => {
              try {
                const res = await api.post(`/api/clients/${c.id}/portal-invite`, formData(form))
                render(form, html`<div class="space-y-3">
                  <p class="text-sm ${res.emailed ? 'text-emerald-700' : 'text-slate-700'}">${res.emailed ? t('settings.invite_emailed') : t('settings.invite_share')}</p>
                  <input class="input font-mono text-xs" dir="ltr" readonly value="${res.invite_url}" />
                  <div class="flex justify-end"><button type="button" class="btn btn-primary" data-action="done">${t('common.done')}</button></div></div>`)
              } catch (err) { showError(err, form) }
            })
          },
          actions: { done: () => { m.close(); rerender() } }
        })
      },
      'remove-portal-user': async (el) => {
        if (!(await confirmDialog(t('clients.portal_remove_confirm', { name: el.dataset.name })))) return
        try { await api.del(`/api/clients/${c.id}/portal-users/${el.dataset.id}`); rerender() } catch (err) { showError(err) }
      },
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
