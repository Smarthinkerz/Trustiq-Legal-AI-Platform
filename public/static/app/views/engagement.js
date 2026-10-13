import { api } from '../api.js'
import { formData, html, raw, render } from '../dom.js'
import { fmtDate, getLang, t } from '../i18n.js'
import { aiEnabled, can, readOnly, refOptions, store } from '../store.js'
import { busy, clearFieldErrors, inputField, modal, selectField, showError, submitButton, textareaField, toast } from '../ui.js'
import { openSignatureDialog } from './signatures.js'

// ---------------------------------------------------------------------------
// Engagement letter on a matter: prepare from the fee terms, send for
// e-signature, and show whether the client has signed.
// ---------------------------------------------------------------------------

const ARRANGEMENTS = ['hourly', 'fixed', 'capped', 'contingency']

export async function caseEngagementBanner(box, kase, { onChange }) {
  if (!box || !kase.client_id || kase.status === 'closed') return
  let data
  try { data = await api.get(`/api/engagements/case/${kase.id}`) } catch { return }
  if (!document.body.contains(box)) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  const latest = data.letters[0]
  const signed = data.letters.find((l) => l.status === 'signed')
  if (signed && latest === signed) {
    render(box, html`<div class="text-xs text-emerald-700 mb-4 flex flex-wrap items-center gap-2"><i class="fas fa-handshake"></i>
      ${t('eng.signed_on', { date: fmtDate(signed.completed_at || signed.created_at) })}
      <a class="text-brand-700 hover:underline" href="#/documents/${signed.document_id}">${t('eng.open')}</a>
      ${editable ? html`<button class="text-brand-700 hover:underline" data-eng="prepare">${t('eng.new_version')}</button>` : ''}</div>`)
  } else {
    const status = latest?.status ?? 'none'
    const tone = status === 'sent' ? 'border-sky-200 bg-sky-50 text-sky-900' : status === 'declined' || status === 'expired' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'
    render(box, html`<div class="rounded-xl border ${tone} p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="text-sm"><i class="fas ${status === 'sent' ? 'fa-paper-plane' : 'fa-handshake'}"></i> ${t(`eng.status_${status}`)}
        ${signed ? html`<span class="text-xs opacity-80"> · ${t('eng.earlier_signed')}</span>` : ''}</div>
      <div class="flex flex-wrap gap-2">
        ${latest?.document_id ? html`<a class="btn btn-ghost btn-sm" href="#/documents/${latest.document_id}"><i class="fas fa-file-lines"></i>${t('eng.open')}</a>` : ''}
        ${editable && latest?.document_id && status !== 'sent' ? html`<button class="btn btn-outline btn-sm" data-eng="send"><i class="fas fa-signature"></i>${t('eng.send')}</button>` : ''}
        ${editable ? html`<button class="btn ${latest ? 'btn-ghost' : 'btn-primary'} btn-sm" data-eng="prepare"><i class="fas fa-file-pen"></i>${latest ? t('eng.new_version') : t('eng.prepare')}</button>` : ''}
      </div>
    </div>`)
  }
  box.onclick = async (e) => {
    const act = e.target.closest('[data-eng]')?.dataset.eng
    if (act === 'prepare') openEngagementForm(kase, data, onChange)
    if (act === 'send') {
      try {
        const { document: doc } = await api.get(`/api/documents/${latest.document_id}`)
        openSignatureDialog(doc, { onSent: onChange })
      } catch (err) { showError(err) }
    }
  }
}

function openEngagementForm(kase, data, onChange) {
  const d = data.defaults
  const num = (v) => (v == null ? '' : String(v))
  const lang = data.language || getLang()
  const m = modal({
    title: t('eng.prepare_title'),
    size: 'xl',
    body: html`<form data-form="eng" class="space-y-5" novalidate>
      <p class="text-sm text-slate-600">${t('eng.intro', { client: data.case.client_name })}</p>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'language', label: t('eng.language'), options: [{ value: 'en', label: t('common.english') }, { value: 'ar', label: t('common.arabic') }], value: lang })}
        ${selectField({ name: 'law', label: t('eng.law'), options: refOptions('jurisdictions'), value: d.law })}
        ${inputField({ name: 'signatory_name', label: t('eng.signatory'), value: d.signatory_name, attrs: 'maxlength="200" dir="auto"' })}
      </div>
      <div>
        <div class="flex items-center justify-between gap-2 mb-1"><span class="label mb-0">${t('eng.scope')} <span class="text-red-500">*</span></span>
          ${aiEnabled() ? html`<button type="button" class="btn btn-ghost btn-sm" data-action="ai-scope"><i class="fas fa-wand-magic-sparkles"></i>${t('eng.ai_scope')}</button>` : ''}</div>
        <textarea name="scope" rows="6" class="input" dir="auto" required placeholder="${t('eng.scope_placeholder')}">${d.scope || ''}</textarea>
        <p class="hint">${t('eng.scope_hint')}</p>
      </div>
      ${textareaField({ name: 'exclusions', label: t('eng.exclusions'), value: d.exclusions, rows: 3, hint: t('eng.exclusions_hint') })}
      <fieldset class="rounded-xl border border-slate-200 p-4 space-y-4">
        <legend class="px-1 text-sm font-semibold">${t('eng.fees')}</legend>
        <div class="grid sm:grid-cols-3 gap-4">
          ${selectField({ name: 'fee_arrangement', label: t('fees.arrangement'), options: ARRANGEMENTS.map((a) => ({ value: a, label: t(`fees.arr_${a}`) })), value: d.fee_arrangement, attrs: 'data-arr' })}
          ${selectField({ name: 'currency', label: t('cases.currency'), options: (store.ref?.currencies ?? ['OMR']).map((c) => ({ value: c, label: c })), value: d.currency })}
          ${inputField({ name: 'hourly_rate', label: t('eng.hourly_rate'), type: 'number', value: num(d.hourly_rate), attrs: 'min="0" step="0.001" data-for="hourly capped"' })}
          ${inputField({ name: 'fixed_fee', label: t('eng.fixed_fee'), type: 'number', value: num(d.fixed_fee), attrs: 'min="0" step="0.001" data-for="fixed contingency"' })}
          ${inputField({ name: 'cap_amount', label: t('eng.cap_amount'), type: 'number', value: num(d.cap_amount), attrs: 'min="0" step="0.001" data-for="capped"' })}
          ${inputField({ name: 'contingency_percent', label: t('eng.contingency_percent'), type: 'number', value: num(d.contingency_percent), attrs: 'min="0" max="100" step="0.5" data-for="contingency"' })}
        </div>
        <p class="hint" data-contingency-hint>${t('eng.contingency_hint')}</p>
        <div class="grid sm:grid-cols-3 gap-4">
          ${inputField({ name: 'retainer_amount', label: t('eng.retainer'), type: 'number', value: num(d.retainer_amount), hint: t('eng.retainer_hint'), attrs: 'min="0" step="0.001"' })}
          ${inputField({ name: 'payment_terms_days', label: t('eng.payment_days'), type: 'number', value: num(d.payment_terms_days ?? 30), attrs: 'min="0" max="365"' })}
          ${inputField({ name: 'vat_rate', label: t('eng.vat_rate'), type: 'number', value: num(d.vat_rate ?? 0), attrs: 'min="0" max="30" step="0.01"' })}
        </div>
      </fieldset>
      ${textareaField({ name: 'notes', label: t('eng.notes'), value: d.notes, rows: 2 })}
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="update_case" checked /> ${t('eng.update_case')}</label>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-file-signature"></i>${t('eng.generate')}</button>
      </div>
    </form>`,
    actions: {
      'ai-scope': (btn) => busy(btn, async () => {
        const form = m.el.querySelector('form')
        try {
          const r = await api.post(`/api/engagements/case/${kase.id}/scope`, { language: form.elements.language.value })
          form.elements.scope.value = r.scope
          if (r.exclusions) form.elements.exclusions.value = r.exclusions
          toast(t('eng.ai_review'))
        } catch (err) { showError(err) }
      })
    },
    forms: {
      eng: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        const terms = { ...b }
        delete terms.language
        delete terms.update_case
        // Only the amounts that belong to the chosen arrangement are sent.
        const arr = b.fee_arrangement
        for (const el of form.querySelectorAll('[data-for]')) if (!el.dataset.for.split(' ').includes(arr)) terms[el.name] = ''
        try {
          const r = await api.post(`/api/engagements/case/${kase.id}`, { language: b.language, terms, update_case: form.elements.update_case.checked })
          m.close()
          toast(t('eng.created'))
          onChange?.()
          openSignatureDialog(r.document, { onSent: onChange })
        } catch (err) {
          // Field errors arrive as terms.<field>; map them onto the inputs.
          if (Array.isArray(err.details)) err.details = err.details.map((x) => ({ ...x, path: String(x.path).replace(/^terms\./, '') }))
          showError(err, form)
        }
      })
    }
  })
  const form = m.el.querySelector('form')
  const sync = () => {
    const arr = form.elements.fee_arrangement.value
    for (const el of form.querySelectorAll('[data-for]')) el.closest('div').hidden = !el.dataset.for.split(' ').includes(arr)
    form.querySelector('[data-contingency-hint]').hidden = arr !== 'contingency'
  }
  form.elements.fee_arrangement.addEventListener('change', sync)
  sync()
}
