import { api, download } from '../api.js'
import { formData, html, raw, render } from '../dom.js'
import { fmtDate, fmtRelative, t } from '../i18n.js'
import { can, readOnly } from '../store.js'
import { busy, confirmDialog, formActions, inputField, modal, showError, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Document requests (firm side): ask a client for documents, then review what
// they upload in the portal. Used on the client and case pages.
// ---------------------------------------------------------------------------

const PRESETS = ['passport', 'civil_id', 'cr', 'trade_licence', 'poa', 'contract', 'bank_statement', 'correspondence']
const ITEM_BADGE = {
  pending: 'bg-slate-100 text-slate-700', uploaded: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-100 text-red-700'
}
const REQUEST_BADGE = { open: 'bg-brand-50 text-brand-700', completed: 'bg-emerald-100 text-emerald-800', cancelled: 'bg-slate-200 text-slate-600' }
const isoDay = (v) => (v ? String(v).slice(0, 10) : '')

// The portal uses the client's point of view ("Needed", "Sent") instead of the firm's.
export const itemBadge = (s, { client = false } = {}) => html`<span class="badge ${ITEM_BADGE[s]}">${t(`${client ? 'portal.docs_item' : 'docreq.item'}_${s}`)}</span>`
const requestBadge = (s) => html`<span class="badge ${REQUEST_BADGE[s]}">${t(`docreq.status_${s}`)}</span>`

export function requestsCard(requests, { canRequest = true } = {}) {
  const editable = canRequest && !readOnly() && can('owner', 'admin', 'lawyer')
  return html`<section class="card">
    <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
      <h2 class="font-semibold"><i class="fas fa-file-circle-question text-slate-400 me-1"></i>${t('docreq.title')} <span class="text-slate-400 font-normal">(${requests.length})</span></h2>
      ${editable ? html`<button class="btn btn-outline btn-sm" data-action="request-docs"><i class="fas fa-plus"></i>${t('docreq.new')}</button>` : ''}
    </div>
    ${requests.length ? html`<ul class="divide-y divide-slate-100">${requests.map((r) => html`<li><button class="w-full text-start px-5 py-3 flex flex-wrap items-center gap-3 hover:bg-slate-50" data-action="open-request" data-id="${r.id}">
      <div class="flex-1 min-w-0"><div class="text-sm font-medium truncate" dir="auto">${r.title}</div>
        <div class="text-xs text-slate-500">${t('docreq.progress', { done: r.accepted, total: r.items })}${r.to_review ? html` · <span class="text-amber-700 font-semibold">${t('docreq.to_review', { n: r.to_review })}</span>` : ''}${r.due_date ? ` · ${t('docreq.due')}: ${fmtDate(isoDay(r.due_date))}` : ''}${r.case_reference ? ` · ${r.case_reference}` : ''}</div></div>
      ${requestBadge(r.status)}</button></li>`)}</ul>`
      : html`<p class="px-5 py-6 text-sm text-slate-500">${t('docreq.none')}</p>`}
  </section>`
}

export function openRequestForm({ clientId, caseId = null, cases = [], onSaved }) {
  const m = modal({
    title: t('docreq.new'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${inputField({ name: 'title', label: t('docreq.request_title'), required: true, placeholder: t('docreq.title_placeholder') })}
      ${!caseId && cases.length ? html`<div><label class="label" for="dr-case">${t('cases.matter')}</label>
        <select id="dr-case" name="case_id" class="input"><option value="">—</option>${cases.map((k) => html`<option value="${k.id}">${k.reference} · ${k.title}</option>`)}</select></div>` : ''}
      <div>
        ${textareaField({ name: 'items', label: t('docreq.items'), rows: 5, required: true, hint: t('docreq.items_hint') })}
        <div class="flex flex-wrap gap-1.5 mt-2">${PRESETS.map((p) => html`<button type="button" class="badge bg-slate-100 text-slate-700 hover:bg-brand-50" data-action="preset" data-label="${t(`docreq.preset_${p}`)}"><i class="fas fa-plus text-[10px]"></i> ${t(`docreq.preset_${p}`)}</button>`)}</div>
      </div>
      <div class="grid sm:grid-cols-2 gap-4">${inputField({ name: 'due_date', label: t('docreq.due'), type: 'date' })}</div>
      ${textareaField({ name: 'message', label: t('docreq.message'), rows: 3 })}
      ${formActions(t('docreq.send'))}
    </form>`,
    actions: {
      preset: (el) => {
        const ta = m.el.querySelector('[name=items]')
        const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean)
        if (!lines.includes(el.dataset.label)) ta.value = [...lines, el.dataset.label].join('\n') + '\n'
        ta.focus()
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        const d = formData(form)
        const items = (d.items || '').split('\n').map((l) => l.trim()).filter(Boolean).map((label) => ({ label }))
        try {
          const res = await api.post('/api/document-requests', { client_id: clientId, case_id: caseId || d.case_id, title: d.title, due_date: d.due_date, message: d.message, items })
          m.close()
          toast(res.portal_users ? t('docreq.sent') : t('docreq.sent_no_portal'), res.portal_users ? 'success' : 'error')
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function openRequest(id, { onChange } = {}) {
  let data
  const m = modal({ title: t('docreq.title'), size: 'lg', body: html`<div data-body></div>` })
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  // The page behind is refreshed once the dialog closes (refreshing it now would close the dialog).
  let changed = false
  const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (changed) onChange?.() } })
  obs.observe(document.getElementById('modal-root'), { childList: true })
  const draw = () => {
    const r = data.request
    const open = r.status === 'open'
    render(m.el.querySelector('[data-body]'), html`<div class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div><h3 class="font-semibold text-lg" dir="auto">${r.title}</h3>
          <p class="text-xs text-slate-500">${r.client_name}${r.case_reference ? ` · ${r.case_reference}` : ''}${r.due_date ? ` · ${t('docreq.due')}: ${fmtDate(isoDay(r.due_date))}` : ''} · ${fmtRelative(r.created_at)}</p></div>
        ${requestBadge(r.status)}
      </div>
      ${!data.portal_users ? html`<p class="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-3 text-sm">${t('docreq.no_portal')}</p>` : ''}
      ${r.message ? html`<p class="text-sm whitespace-pre-wrap rounded-lg bg-slate-50 p-3" dir="auto">${r.message}</p>` : ''}
      <ul class="divide-y divide-slate-100 border border-slate-200 rounded-lg">${data.items.map((i) => html`<li class="p-3 flex flex-wrap items-center gap-3">
        <div class="flex-1 min-w-0"><div class="text-sm font-medium" dir="auto">${i.label}</div>
          ${i.note ? html`<div class="text-xs text-slate-500" dir="auto">${i.note}</div>` : ''}
          ${i.document_id ? html`<div class="text-xs text-slate-500 truncate">${i.file_name || ''}${i.uploaded_at ? ` · ${fmtRelative(i.uploaded_at)}` : ''}</div>` : ''}
          ${i.status === 'rejected' && i.reject_reason ? html`<div class="text-xs text-red-700">${t('docreq.returned_reason')}: ${i.reject_reason}</div>` : ''}</div>
        ${itemBadge(i.status)}
        ${i.document_id ? html`<button class="btn btn-ghost btn-sm" data-action="download" data-id="${i.document_id}" aria-label="${t('portal.download')}"><i class="fas fa-download"></i></button>
          <a class="btn btn-ghost btn-sm" href="#/documents/${i.document_id}" data-action="go" aria-label="${t('docreq.open_document')}"><i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}
        ${editable && r.status !== 'cancelled' && i.status === 'uploaded' ? html`
          <button class="btn btn-primary btn-sm" data-action="accept" data-id="${i.id}"><i class="fas fa-check"></i>${t('docreq.accept')}</button>
          <button class="btn btn-outline btn-sm" data-action="return" data-id="${i.id}">${t('docreq.return')}</button>` : ''}
      </li>`)}</ul>
      ${editable && open ? html`<div class="flex flex-wrap justify-between gap-2 pt-3 border-t border-slate-100">
        <button class="btn btn-danger-ghost btn-sm" data-action="cancel-request">${t('docreq.cancel')}</button>
        <button class="btn btn-outline btn-sm" data-action="remind" ${data.items.some((i) => ['pending', 'rejected'].includes(i.status)) ? '' : raw('disabled')}><i class="fas fa-bell"></i>${t('docreq.remind')}</button>
      </div>` : ''}
    </div>`)
  }
  const reload = async () => { data = await api.get(`/api/document-requests/${id}`); draw() }
  const review = async (itemId, body) => {
    try { data = { ...data, ...(await api.post(`/api/document-requests/${id}/items/${itemId}/review`, body)) }; changed = true; draw() } catch (err) { showError(err) }
  }
  m.el.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]')
    if (!el || !m.el.contains(el)) return
    const a = el.dataset.action
    if (a === 'download') download(`/api/documents/${el.dataset.id}/file`)
    else if (a === 'go') m.close()
    else if (a === 'accept') busy(el, () => review(el.dataset.id, { accepted: true }))
    else if (a === 'return') {
      const reason = window.prompt(t('docreq.return_prompt'))
      if (reason !== null) await review(el.dataset.id, { accepted: false, reason: reason.trim() || null })
    } else if (a === 'remind') busy(el, async () => {
      try { const r = await api.post(`/api/document-requests/${id}/remind`); toast(r.emailed ? t('docreq.reminded') : t('docreq.sent_no_portal'), r.emailed ? 'success' : 'error'); await reload() } catch (err) { showError(err) }
    })
    else if (a === 'cancel-request') {
      if (!(await confirmDialog(t('docreq.cancel_confirm')))) return
      try { await api.post(`/api/document-requests/${id}/cancel`); changed = true; await reload() } catch (err) { showError(err) }
    }
  })
  try { await reload() } catch (err) { m.close(); showError(err) }
}
