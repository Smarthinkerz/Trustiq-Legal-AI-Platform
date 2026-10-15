import { api } from '../api.js'
import { html, raw, render } from '../dom.js'
import { fmtDate, t } from '../i18n.js'
import { aiEnabled, can, readOnly } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, inputField, modal, showError, submitButton, textareaField, toast } from '../ui.js'
import { openRequestForm } from './doc-requests.js'
import { openPoaDraft } from './poa.js'

// ---------------------------------------------------------------------------
// Powers of attorney (وكالة) and client IDs with expiry tracking.
// ---------------------------------------------------------------------------

export const KINDS = ['power_of_attorney', 'civil_id', 'passport', 'residence', 'commercial_registration', 'trade_licence', 'other']
const ICONS = { power_of_attorney: 'fa-file-signature', civil_id: 'fa-id-card', passport: 'fa-passport', residence: 'fa-id-badge', commercial_registration: 'fa-building', trade_licence: 'fa-certificate', other: 'fa-file' }
const kindLabel = (x) => x.label || t(`cred.kind_${x.kind}`)

export function statusBadge(x) {
  const cls = { valid: 'bg-emerald-100 text-emerald-800', expiring: 'bg-amber-100 text-amber-800', expired: 'bg-red-100 text-red-700', revoked: 'bg-slate-200 text-slate-600', replaced: 'bg-slate-100 text-slate-500' }[x.status]
  const text = x.status === 'expiring' ? (x.days_left === 0 ? t('cred.expires_today') : t('cred.expires_in', { n: x.days_left }))
    : x.status === 'expired' ? t('cred.expired_ago', { n: -x.days_left })
      : x.status === 'valid' && !x.expires_on ? t('cred.no_expiry') : t(`cred.status_${x.status}`)
  return html`<span class="badge ${cls} whitespace-nowrap">${text}</span>`
}

export function credentialsCard(items, { ro } = {}) {
  const current = items.filter((x) => !['revoked', 'replaced'].includes(x.status))
  const past = items.filter((x) => ['revoked', 'replaced'].includes(x.status))
  const row = (x) => html`<li class="px-5 py-3 flex flex-wrap items-start gap-3 ${['revoked', 'replaced'].includes(x.status) ? 'opacity-60' : ''}">
    <i class="fas ${ICONS[x.kind]} text-slate-400 mt-1 w-4"></i>
    <div class="flex-1 min-w-48">
      <div class="text-sm font-medium" dir="auto">${kindLabel(x)}${x.number ? html` <span class="font-mono text-xs text-slate-500" dir="ltr">${x.number}</span>` : ''}</div>
      <div class="text-xs text-slate-500 mt-0.5">
        ${x.expires_on ? html`${t('cred.expires')} ${fmtDate(x.expires_on)}` : ''}${x.issued_by ? html` · <span dir="auto">${x.issued_by}</span>` : ''}
        ${x.kind === 'power_of_attorney' ? html` · ${x.all_cases ? t('cred.all_cases') : t('cred.only_cases', { refs: x.cases.map((k) => k.reference).join(', ') })}` : ''}
      </div>
      ${x.scope ? html`<div class="text-xs text-slate-600 mt-0.5" dir="auto">${x.scope}</div>` : ''}
      ${x.document_id ? html`<a class="text-xs text-brand-700 hover:underline" href="#/documents/${x.document_id}"><i class="fas fa-paperclip"></i> ${x.document_title || t('cred.view_document')}</a>` : ''}
    </div>
    ${statusBadge(x)}
    ${ro ? '' : html`<div class="flex flex-wrap gap-1 w-full sm:w-auto justify-end">
      ${['expiring', 'expired'].includes(x.status) ? html`<button class="btn btn-outline btn-sm" data-action="cred-ask" data-id="${x.id}"><i class="fas fa-paper-plane"></i>${t('cred.ask_client')}</button>` : ''}
      ${!['revoked', 'replaced'].includes(x.status) ? html`<button class="btn btn-ghost btn-sm" data-action="cred-renew" data-id="${x.id}"><i class="fas fa-rotate"></i>${t('cred.renew')}</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-action="cred-edit" data-id="${x.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>
      ${can('owner', 'admin', 'lawyer') && x.status !== 'replaced' ? html`<button class="btn btn-ghost btn-sm" data-action="cred-revoke" data-id="${x.id}" title="${x.status === 'revoked' ? t('cred.restore') : t('cred.revoke')}"><i class="fas ${x.status === 'revoked' ? 'fa-rotate-left' : 'fa-ban'}"></i></button>` : ''}
    </div>`}
  </li>`
  return html`<section class="card" id="credentials">
    <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
      <div><h2 class="font-semibold"><i class="fas fa-file-signature text-brand-500"></i> ${t('cred.title')}</h2>
        <p class="text-xs text-slate-500 mt-0.5">${t('cred.subtitle')}</p></div>
      ${ro ? '' : html`<div class="flex flex-wrap gap-2">${can('owner', 'admin', 'lawyer', 'staff') ? html`<button class="btn btn-ghost btn-sm" data-action="poa-draft"><i class="fas fa-file-pen"></i>${t('poa.draft')}</button>` : ''}
        <button class="btn btn-outline btn-sm" data-action="cred-add"><i class="fas fa-plus"></i>${t('cred.add')}</button></div>`}
    </div>
    ${items.length ? html`<ul class="divide-y divide-slate-100">${current.map(row)}${past.length ? html`<li class="px-5 pt-3 pb-1 text-xs font-semibold uppercase text-slate-400">${t('cred.history')}</li>${past.map(row)}` : ''}</ul>`
      : html`<p class="px-5 py-6 text-sm text-slate-500">${t('cred.empty')}</p>`}
  </section>`
}

// Wires the card's buttons on a client page.
export function credentialActions({ client, cases, documents, items, onChange }) {
  const find = (el) => items.find((x) => x.id === el.dataset.id)
  return {
    'cred-add': () => openCredentialForm({ client, cases, documents, onSaved: onChange }),
    'poa-draft': () => openPoaDraft({ clientId: client.id }),
    'cred-edit': (el) => openCredentialForm({ client, cases, documents, credential: find(el), onSaved: onChange }),
    'cred-renew': (el) => openCredentialForm({ client, cases, documents, renew: find(el), onSaved: onChange }),
    'cred-revoke': async (el) => {
      const x = find(el)
      const revoke = x.status !== 'revoked'
      if (revoke && !(await confirmDialog(t('cred.revoke_confirm', { what: kindLabel(x) })))) return
      try { await api.post(`/api/credentials/${x.id}/revoke`, { revoked: revoke }); onChange() } catch (err) { showError(err) }
    },
    'cred-ask': (el) => {
      const x = find(el)
      const caseId = x.kind === 'power_of_attorney' && !x.all_cases && x.cases.length === 1 ? x.cases[0].id : null
      openRequestForm({
        clientId: client.id, caseId, cases, onSaved: onChange,
        prefill: { title: t('cred.ask_title', { what: kindLabel(x) }), items: [t('cred.ask_item', { what: kindLabel(x) })], message: t('cred.ask_message', { what: kindLabel(x), date: fmtDate(x.expires_on, { hijri: false }) }) }
      })
    }
  }
}

export function openCredentialForm({ client, cases = [], documents = [], credential, renew, presetCaseId, onSaved }) {
  const x = credential || (renew ? { ...renew, number: '', issued_on: '', expires_on: '', document_id: null } : { kind: 'power_of_attorney', all_cases: !presetCaseId, cases: presetCaseId ? [{ id: presetCaseId }] : [] })
  const linked = new Set((x.cases || []).map((k) => k.id))
  const m = modal({
    title: credential ? t('cred.edit') : renew ? t('cred.renew_title', { what: kindLabel(renew) }) : t('cred.add_title'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${renew ? html`<p class="text-sm text-slate-600 rounded-lg bg-slate-50 p-3"><i class="fas fa-circle-info text-slate-400"></i> ${t('cred.renew_help')}</p>` : ''}
      <div class="grid sm:grid-cols-2 gap-4">
        <div><label class="label" for="cr-kind">${t('cred.kind')}</label>
          <select id="cr-kind" name="kind" class="input" data-kind>${KINDS.map((k) => html`<option value="${k}" ${k === x.kind ? raw('selected') : ''}>${t(`cred.kind_${k}`)}</option>`)}</select></div>
        ${inputField({ name: 'label', label: t('cred.label'), value: x.label, hint: t('cred.label_hint'), attrs: 'maxlength="200"' })}
        ${inputField({ name: 'number', label: t('cred.number'), value: x.number, dir: 'ltr', attrs: 'maxlength="100"' })}
        ${inputField({ name: 'issued_by', label: t('cred.issued_by'), value: x.issued_by, attrs: 'maxlength="200" dir="auto"' })}
        ${inputField({ name: 'issued_on', label: t('cred.issued_on'), type: 'date', value: x.issued_on })}
        ${inputField({ name: 'expires_on', label: t('cred.expires_on'), type: 'date', value: x.expires_on, hint: t('cred.expires_hint') })}
      </div>
      <div data-poa class="space-y-4 ${x.kind === 'power_of_attorney' ? '' : 'hidden'}">
        ${textareaField({ name: 'scope', label: t('cred.scope'), value: x.scope, rows: 2, hint: t('cred.scope_hint') })}
        <fieldset class="space-y-2">
          <legend class="label">${t('cred.covers')}</legend>
          <label class="flex items-center gap-2 text-sm"><input type="radio" name="coverage" value="all" ${x.all_cases !== false ? raw('checked') : ''} /> ${t('cred.covers_all')}</label>
          <label class="flex items-center gap-2 text-sm"><input type="radio" name="coverage" value="some" ${x.all_cases === false ? raw('checked') : ''} ${cases.length ? '' : raw('disabled')} /> ${t('cred.covers_some')}</label>
          <div data-cases class="ps-6 space-y-1 ${x.all_cases === false ? '' : 'hidden'}">${cases.map((k) => html`<label class="flex items-center gap-2 text-sm">
            <input type="checkbox" name="case_ids" value="${k.id}" ${linked.has(k.id) ? raw('checked') : ''} /><span class="font-mono text-xs text-slate-500">${k.reference}</span> <span dir="auto">${k.title}</span></label>`)}</div>
        </fieldset>
      </div>
      <div>
        <label class="label" for="cr-doc">${t('cred.document')}</label>
        <div class="flex flex-wrap gap-2">
          <select id="cr-doc" name="document_id" class="input flex-1 min-w-48" data-doc><option value="">—</option>${documents.map((d) => html`<option value="${d.id}" ${d.id === x.document_id ? raw('selected') : ''}>${d.title}</option>`)}</select>
          ${aiEnabled() ? html`<button type="button" class="btn btn-outline" data-action="read-doc" ${x.document_id ? '' : raw('disabled')}><i class="fas fa-wand-magic-sparkles"></i>${t('cred.read_doc')}</button>` : ''}
        </div>
        <p class="hint">${t('cred.document_hint')}</p>
      </div>
      ${textareaField({ name: 'notes', label: t('clients.notes'), value: x.notes, rows: 2 })}
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('common.save')}</button>
      </div>
    </form>`,
    actions: {
      'read-doc': (btn) => busy(btn, async () => {
        const form = m.el.querySelector('form')
        try {
          const { fields: f } = await api.post('/api/credentials/extract', { document_id: form.elements.document_id.value })
          const set = (name, v) => { if (v && form.elements[name]) form.elements[name].value = v }
          set('kind', f.kind); set('number', f.number); set('issued_by', f.issued_by); set('issued_on', f.issued_on); set('expires_on', f.expires_on); set('scope', f.scope)
          if (f.notes) form.elements.notes.value = [form.elements.notes.value, f.notes].filter(Boolean).join('\n')
          syncKind()
          toast(t('cred.read_done'))
        } catch (err) { showError(err) }
      })
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const el = form.elements
        const poa = el.kind.value === 'power_of_attorney'
        const some = poa && form.querySelector('[name=coverage]:checked')?.value === 'some'
        const caseIds = some ? [...form.querySelectorAll('[name=case_ids]:checked')].map((i) => i.value) : []
        if (some && !caseIds.length) return toast(t('cred.pick_case'), 'error')
        const body = {
          kind: el.kind.value, label: el.label.value.trim(), number: el.number.value.trim(), issued_by: el.issued_by.value.trim(),
          issued_on: el.issued_on.value, expires_on: el.expires_on.value, scope: poa ? el.scope.value.trim() : '',
          all_cases: !some, case_ids: caseIds, document_id: el.document_id.value || null, notes: el.notes.value.trim()
        }
        try {
          if (credential) await api.patch(`/api/credentials/${credential.id}`, body)
          else await api.post('/api/credentials', { ...body, client_id: client.id, ...(renew ? { replaces: renew.id } : {}) })
          m.close()
          toast(t('common.saved'))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
  const form = m.el.querySelector('form')
  const syncKind = () => form.querySelector('[data-poa]').classList.toggle('hidden', form.elements.kind.value !== 'power_of_attorney')
  form.addEventListener('change', (e) => {
    if (e.target.matches('[data-kind]')) syncKind()
    if (e.target.name === 'coverage') form.querySelector('[data-cases]').classList.toggle('hidden', e.target.value !== 'some')
    if (e.target.matches('[data-doc]')) { const b = form.querySelector('[data-action=read-doc]'); if (b) b.disabled = !e.target.value }
  })
}

// Banner on a case page when its power of attorney is missing, expiring or expired.
export async function casePoaBanner(box, kase, { onChange }) {
  if (!box || !kase.client_id || kase.status === 'closed') return
  let poa
  try { poa = await api.get(`/api/credentials/case/${kase.id}`) } catch { return }
  if (!document.body.contains(box)) return
  const x = poa.credential
  if (poa.status === 'valid') {
    render(box, html`<div class="text-xs text-emerald-700 mb-4"><i class="fas fa-file-signature"></i> ${t('cred.case_valid', { date: x.expires_on ? fmtDate(x.expires_on) : t('cred.no_expiry') })}</div>`)
    return
  }
  const tone = poa.status === 'expiring' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-800'
  const msg = poa.status === 'missing' ? t('cred.case_missing') : poa.status === 'expired' ? t('cred.case_expired', { date: fmtDate(x.expires_on) }) : t('cred.case_expiring', { n: x.days_left, date: fmtDate(x.expires_on) })
  render(box, html`<div class="rounded-xl border ${tone} p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
    <div class="text-sm"><i class="fas fa-triangle-exclamation"></i> ${msg}</div>
    ${readOnly() ? '' : html`<div class="flex flex-wrap gap-2"><button class="btn btn-ghost btn-sm" data-poa-draft><i class="fas fa-file-pen"></i>${t('poa.draft')}</button>
      <button class="btn btn-outline btn-sm" data-poa-act>${poa.status === 'missing' ? html`<i class="fas fa-plus"></i>${t('cred.add_poa')}` : html`<i class="fas fa-rotate"></i>${t('cred.renew')}`}</button></div>`}
  </div>`)
  box.querySelector('[data-poa-draft]')?.addEventListener('click', () => openPoaDraft({ clientId: kase.client_id, caseId: kase.id }))
  box.querySelector('[data-poa-act]')?.addEventListener('click', async () => {
    try {
      const [{ client, cases, documents }] = await Promise.all([api.get(`/api/clients/${kase.client_id}`)])
      openCredentialForm({ client, cases, documents, renew: poa.status === 'missing' ? undefined : x, presetCaseId: kase.id, onSaved: onChange })
    } catch (err) { showError(err) }
  })
}
