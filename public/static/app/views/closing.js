import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { can } from '../store.js'
import { busy, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Closing a matter (إغلاق الملف): what is still open, the outcome, the
// retention date and an optional closing letter; and the retention register.
// ---------------------------------------------------------------------------

const OUTCOMES = ['won', 'partly_won', 'lost', 'settled', 'withdrawn', 'advice_given', 'transaction_completed', 'other']
// Where each open item is dealt with.
const LINKS = { unbilled: (k) => `#/billing?tab=time`, outstanding: () => '#/billing?tab=invoices', funds: (k) => k.client_id ? `#/clients/${k.client_id}` : null, collections: () => '#/judgments' }

function itemLine(i, k) {
  const href = LINKS[i.key]?.(k)
  const amounts = (i.amounts ?? []).map((a) => fmtMoney(a.amount, a.currency)).join(', ')
  return html`<li class="flex items-start gap-2 py-1.5">
    <i class="fas ${i.ok ? 'fa-circle-check text-emerald-600' : 'fa-triangle-exclamation text-amber-600'} mt-0.5"></i>
    <div class="flex-1 text-sm"><span class="${i.ok ? 'text-slate-500' : 'font-medium'}">${t(`close.i_${i.key}`)}</span>
      ${!i.ok ? html`<span class="text-xs text-amber-800"> · ${amounts || t('close.count', { n: i.count })}</span>` : ''}</div>
    ${!i.ok && href ? html`<a class="text-xs text-brand-600 hover:underline" href="${href}" data-action="close-modal">${t('close.open_link')}</a>` : ''}
  </li>`
}

export async function openClosingDialog(kase, { onDone, onCancel } = {}) {
  let d
  try { d = await api.get(`/api/closing/case/${kase.id}`) } catch (err) { showError(err); onCancel?.(); return }
  let done = false
  const m = modal({
    title: t('close.title', { ref: kase.reference }),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="rounded-xl border ${d.ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'} p-4">
        <p class="text-sm font-semibold ${d.ready ? 'text-emerald-800' : 'text-amber-900'}">${d.ready ? t('close.ready') : t('close.not_ready')}</p>
        <ul class="mt-2 divide-y divide-white/60">${d.checklist.map((i) => itemLine(i, kase))}</ul>
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        ${selectField({ name: 'outcome', label: t('close.outcome'), options: OUTCOMES.map((o) => ({ value: o, label: t(`close.o_${o}`) })), value: 'settled', required: true })}
        ${inputField({ name: 'retain_until', label: t('close.retain_until'), type: 'date', value: d.suggested_retain_until, hint: t('close.retain_hint', { n: d.retention_years }) })}
      </div>
      ${textareaField({ name: 'note', label: t('close.note'), rows: 3, hint: t('close.note_hint') })}
      ${kase.client_id ? html`<fieldset class="rounded-xl border border-slate-200 p-4 space-y-2"><legend class="px-1 text-sm font-semibold">${t('close.letter')}</legend>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="letter" checked /> ${t('close.letter_make')}</label>
        <div class="grid sm:grid-cols-2 gap-3 items-end">
          ${selectField({ name: 'letter_language', label: t('cu.language'), options: [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }], value: kase.client_language || 'ar' })}
          <label class="flex items-center gap-2 text-sm pb-2"><input type="checkbox" name="share" /> ${t('close.letter_share')}</label>
        </div></fieldset>` : ''}
      ${d.ready ? '' : html`<label class="flex items-start gap-2 text-sm text-amber-900"><input type="checkbox" name="override" class="mt-1" /> ${t('close.override')}</label>`}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-box-archive"></i>${t('close.submit')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        const b = formData(form)
        if (!d.ready && !form.elements.override.checked) { form.elements.override.focus(); return toast(t('close.need_override'), 'error') }
        const letter = form.elements.letter?.checked ? { language: b.letter_language, share_with_client: !!form.elements.share?.checked } : null
        try {
          const r = await api.post(`/api/closing/case/${kase.id}`, { outcome: b.outcome, note: b.note ?? '', retain_until: b.retain_until || undefined, override: !d.ready, letter })
          done = true
          m.close()
          toast(t('close.closed'))
          if (r.document) location.hash = `#/documents/${r.document.id}`
          else onDone?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
  // Closing the dialog without closing the matter puts the status menu back.
  const observer = new MutationObserver(() => { if (!document.body.contains(m.el)) { observer.disconnect(); if (!done) onCancel?.() } })
  observer.observe(document.getElementById('modal-root'), { childList: true })
}

// Shown on a closed matter.
export function closedBanner(k) {
  if (k.status !== 'closed') return ''
  return html`<div class="card card-pad mb-6 border-slate-300 bg-slate-50 text-sm">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1"><span class="font-semibold"><i class="fas fa-box-archive text-slate-500 me-1"></i>${t('close.closed_on', { date: k.closed_on ? fmtDate(k.closed_on) : '—' })}</span>
      ${k.closing_outcome ? html`<span>${t('close.outcome')}: <b>${t(`close.o_${k.closing_outcome}`)}</b></span>` : ''}
      ${k.retain_until ? html`<span class="text-slate-600">${t('close.kept_until', { date: fmtDate(k.retain_until) })}</span>` : ''}</div>
    ${k.closing_note ? html`<p class="mt-2 text-slate-700 whitespace-pre-wrap" dir="auto">${k.closing_note}</p>` : ''}
  </div>`
}

// Closed files by retention date.
export async function retentionView(root, { query, isCurrent }) {
  const state = { show: query.get('show') === 'all' ? 'all' : 'due' }
  const admin = can('owner', 'admin')
  render(root, html`${pageHeader(t('close.register'), t('close.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/closing/retention?show=${state.show}`)
    if (!isCurrent()) return
    render(root.querySelector('[data-reg]'), html`
      <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div class="flex gap-1">${['due', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`close.show_${s}`)}</button>`)}</div>
        ${admin ? html`<form data-form="years" class="flex items-end gap-2" novalidate>
          ${inputField({ name: 'retention_years', label: t('close.years'), type: 'number', value: String(d.retention_years), cls: 'w-40', attrs: 'min="1" max="50"' })}
          <button class="btn btn-outline btn-sm mb-0.5">${t('common.save')}</button></form>` : html`<p class="text-xs text-slate-500">${t('close.years_value', { n: d.retention_years })}</p>`}
      </div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.reference')}</th><th>${t('onb.matter')}</th><th>${t('close.closed_col')}</th><th>${t('close.outcome')}</th><th>${t('close.retain_until')}</th><th></th></tr></thead>
        <tbody>${d.items.map((r) => html`<tr class="clickable" data-action="open" data-id="${r.id}">
          <td class="font-mono text-xs">${r.reference}</td>
          <td><div class="font-medium" dir="auto">${r.title}</div><div class="text-xs text-slate-500" dir="auto">${r.client_name || ''}</div></td>
          <td class="text-sm whitespace-nowrap">${r.closed_on ? fmtDate(r.closed_on, { hijri: false }) : '—'}</td>
          <td class="text-sm">${r.closing_outcome ? t(`close.o_${r.closing_outcome}`) : '—'}</td>
          <td class="text-sm whitespace-nowrap ${r.due ? 'text-red-700 font-semibold' : ''}">${r.retain_until ? fmtDate(r.retain_until, { hijri: false }) : '—'}</td>
          <td class="text-xs">${r.due ? html`<span class="badge bg-red-100 text-red-700">${t('close.due')}</span>` : ''}
            ${r.originals_held ? html`<span class="badge bg-amber-100 text-amber-800"><i class="fas fa-vault"></i> ${t('close.originals_held', { n: r.originals_held })}</span>` : ''}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-box-archive', t(`close.empty_${state.show}`), t('close.empty_help'))}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/closing/retention?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/retention${state.show === 'all' ? '?show=all' : ''}`); load().catch(showError) }
    },
    forms: {
      years: (form) => busy(submitButton(form), async () => {
        try { await api.put('/api/closing/settings', { retention_years: formData(form).retention_years }); toast(t('common.saved')); load() } catch (err) { showError(err, form) }
      })
    }
  })
  await load()
}
