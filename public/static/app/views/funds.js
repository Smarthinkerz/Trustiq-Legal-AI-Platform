import { api, download } from '../api.js'
import { html, raw, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { can, readOnly } from '../store.js'
import { busy, emptyState, inputField, modal, showError, spinner, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Client funds: advances / retainers / court-fee deposits held for a client.
// ---------------------------------------------------------------------------

const KIND_ICON = { deposit: 'fa-arrow-down text-emerald-600', disbursement: 'fa-arrow-up text-amber-600', applied: 'fa-file-invoice-dollar text-brand-600', refund: 'fa-rotate-left text-slate-500' }
const METHODS = ['bank_transfer', 'cash', 'cheque', 'card', 'other']
const CURRENCIES = ['OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'USD', 'EUR', 'GBP']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date())

const entryRows = (entries, { staff }) => entries.map((e) => {
  const d = Number(e.delta)
  const reversed = !!e.reversed_by
  return html`<tr class="${reversed ? 'opacity-50' : ''}">
    <td class="text-xs whitespace-nowrap">${fmtDate(e.entry_date, { hijri: false })}</td>
    <td><div class="flex items-start gap-2"><i class="fas ${e.reversal_of ? 'fa-arrow-rotate-left text-slate-400' : KIND_ICON[e.kind]} mt-1 text-xs"></i>
      <div><div class="text-sm ${reversed ? 'line-through' : ''}" dir="auto">${e.description}</div>
        <div class="text-xs text-slate-500">${t(`funds.kind_${e.kind}`)}${e.case_reference ? ` · ${e.case_reference}` : ''}${e.invoice_number ? ` · ${e.invoice_number}` : ''}${e.receipt_no ? ` · ${e.receipt_no}` : ''}${e.method ? ` · ${t(`funds.method_${e.method}`)}` : ''}${e.reference ? ` · ${e.reference}` : ''}${staff && e.created_by_name ? ` · ${e.created_by_name}` : ''}</div></div></div></td>
    <td class="text-end whitespace-nowrap font-medium ${d >= 0 ? 'text-emerald-700' : 'text-slate-700'}" dir="ltr">${d >= 0 ? '+' : '−'}${fmtMoney(Math.abs(d), e.currency)}</td>
    ${staff ? html`<td class="text-end whitespace-nowrap">
      ${e.kind === 'deposit' && !e.reversal_of ? html`<button class="btn btn-ghost btn-sm" data-action="fund-receipt" data-id="${e.id}" title="${t('funds.receipt')}"><i class="fas fa-file-word"></i></button>` : ''}
      ${can('owner', 'admin') && !readOnly() && !e.reversal_of && !reversed && e.kind !== 'applied' ? html`<button class="btn btn-ghost btn-sm" data-action="fund-reverse" data-id="${e.id}" title="${t('funds.reverse')}"><i class="fas fa-arrow-rotate-left"></i></button>` : ''}</td>` : ''}
  </tr>`
})

export const balanceChips = (balances) => balances.length
  ? balances.map((b) => html`<span class="badge ${b.balance > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'} text-sm" dir="ltr">${fmtMoney(b.balance, b.currency)}</span>`)
  : html`<span class="badge bg-slate-100 text-slate-600 text-sm">${fmtMoney(0, 'OMR')}</span>`

export function fundsCard(d, { ro } = {}) {
  const canMove = !ro && can('owner', 'admin', 'lawyer')
  return html`<section class="card" id="funds">
    <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
      <div><h2 class="font-semibold"><i class="fas fa-vault text-brand-500"></i> ${t('funds.title')}</h2>
        <p class="text-xs text-slate-500 mt-0.5">${t('funds.subtitle')}</p></div>
      <div class="flex flex-wrap items-center gap-2">${balanceChips(d.balances)}</div>
    </div>
    ${canMove ? html`<div class="px-5 pt-4 flex flex-wrap gap-2">
      <button class="btn btn-primary btn-sm" data-action="fund-entry" data-kind="deposit"><i class="fas fa-arrow-down"></i>${t('funds.receive')}</button>
      <button class="btn btn-outline btn-sm" data-action="fund-entry" data-kind="disbursement"><i class="fas fa-arrow-up"></i>${t('funds.pay_out')}</button>
      ${can('owner', 'admin') ? html`${d.open_invoices.length ? html`<button class="btn btn-outline btn-sm" data-action="fund-apply"><i class="fas fa-file-invoice-dollar"></i>${t('funds.apply')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-action="fund-entry" data-kind="refund"><i class="fas fa-rotate-left"></i>${t('funds.refund')}</button>` : ''}
    </div>` : ''}
    ${d.entries.length ? html`<div class="overflow-x-auto mt-2"><table class="table"><tbody>${entryRows(d.entries, { staff: true })}</tbody></table></div>`
      : html`<p class="px-5 py-6 text-sm text-slate-500">${t('funds.empty')}</p>`}
  </section>`
}

export function fundsActions({ client, cases, data, onChange }) {
  return {
    'fund-entry': (el) => openEntryForm({ client, cases, kind: el.dataset.kind, data, onSaved: onChange }),
    'fund-apply': () => openApplyForm({ client, data, onSaved: onChange }),
    'fund-receipt': (el) => download(`/api/funds/entries/${el.dataset.id}/receipt`),
    'fund-reverse': (el) => {
      const e = data.entries.find((x) => x.id === el.dataset.id)
      const m = modal({
        title: t('funds.reverse'),
        size: 'sm',
        body: html`<form data-form="rev" class="space-y-4" novalidate>
          <p class="text-sm">${t('funds.reverse_help', { what: e.description, amount: fmtMoney(Math.abs(Number(e.delta)), e.currency) })}</p>
          ${textareaField({ name: 'reason', label: t('funds.reason'), rows: 2, required: true })}
          <div class="flex justify-end gap-2"><button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
            <button type="submit" class="btn btn-danger">${t('funds.reverse')}</button></div></form>`,
        forms: {
          rev: (form) => busy(form.querySelector('[type=submit]'), async () => {
            try { await api.post(`/api/funds/entries/${e.id}/reverse`, { reason: form.elements.reason.value.trim() }); m.close(); toast(t('funds.reversed')); onChange() } catch (err) { showError(err, form) }
          })
        }
      })
    }
  }
}

function openEntryForm({ client, cases, kind, data, onSaved }) {
  const cur = data.balances[0]?.currency || data.default_currency || 'OMR'
  const m = modal({
    title: t(`funds.form_${kind}`, { name: client.name }),
    body: html`<form data-form="entry" class="space-y-4" novalidate>
      ${kind !== 'deposit' ? html`<p class="text-sm rounded-lg bg-slate-50 p-3">${t('funds.available')}: ${balanceChips(data.balances)}</p>` : ''}
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'amount', label: t('funds.amount'), type: 'number', required: true, attrs: 'min="0.001" step="0.001" inputmode="decimal"', dir: 'ltr' })}
        <div><label class="label" for="fe-cur">${t('funds.currency')}</label><select id="fe-cur" name="currency" class="input">${CURRENCIES.map((c) => html`<option ${c === cur ? raw('selected') : ''}>${c}</option>`)}</select></div>
        ${inputField({ name: 'entry_date', label: t('funds.date'), type: 'date', value: today(), attrs: `max="${today()}"` })}
      </div>
      ${inputField({ name: 'description', label: t('funds.description'), required: true, placeholder: t(`funds.placeholder_${kind}`), attrs: 'maxlength="500" dir="auto"' })}
      <div class="grid sm:grid-cols-2 gap-4">
        ${kind === 'deposit' || kind === 'refund' ? html`<div><label class="label" for="fe-m">${t('funds.method')}</label><select id="fe-m" name="method" class="input">${METHODS.map((x) => html`<option value="${x}">${t(`funds.method_${x}`)}</option>`)}</select></div>` : ''}
        ${inputField({ name: 'reference', label: t('funds.reference'), placeholder: t('funds.reference_placeholder'), attrs: 'maxlength="100"' })}
      </div>
      ${cases.length ? html`<div><label class="label" for="fe-case">${t('cases.matter')}</label><select id="fe-case" name="case_id" class="input"><option value="">—</option>${cases.map((k) => html`<option value="${k.id}">${k.reference} · ${k.title}</option>`)}</select></div>` : ''}
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('common.save')}</button>
      </div>
    </form>`,
    forms: {
      entry: (form) => busy(form.querySelector('[type=submit]'), async () => {
        const el = form.elements
        try {
          const r = await api.post(`/api/funds/client/${client.id}/entries`, {
            kind, amount: Number(el.amount.value), currency: el.currency.value, entry_date: el.entry_date.value || undefined,
            description: el.description.value.trim(), method: el.method?.value || null, reference: el.reference.value.trim(), case_id: el.case_id?.value || null
          })
          m.close()
          toast(t('funds.saved', { balance: fmtMoney(r.balance, el.currency.value) }))
          if (kind === 'deposit') download(`/api/funds/entries/${r.entry_id}/receipt`)
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function openApplyForm({ client, data, onSaved }) {
  const inv = data.open_invoices
  const m = modal({
    title: t('funds.apply'),
    body: html`<form data-form="apply" class="space-y-4" novalidate>
      <p class="text-sm rounded-lg bg-slate-50 p-3">${t('funds.available')}: ${balanceChips(data.balances)}</p>
      <div><label class="label" for="fa-inv">${t('funds.invoice')}</label><select id="fa-inv" name="invoice_id" class="input" data-inv>
        ${inv.map((i) => html`<option value="${i.id}" data-out="${i.outstanding}" data-cur="${i.currency}">${i.number} · ${t('funds.outstanding')} ${fmtMoney(Number(i.outstanding), i.currency)}</option>`)}</select></div>
      ${inputField({ name: 'amount', label: t('funds.amount'), type: 'number', required: true, value: inv[0] ? Math.min(Number(inv[0].outstanding), data.balances.find((b) => b.currency === inv[0].currency)?.balance ?? 0) : '', attrs: 'min="0.001" step="0.001"', dir: 'ltr' })}
      <p class="hint">${t('funds.apply_help')}</p>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-check"></i>${t('funds.apply_go')}</button>
      </div>
    </form>`,
    forms: {
      apply: (form) => busy(form.querySelector('[type=submit]'), async () => {
        try {
          const r = await api.post(`/api/funds/client/${client.id}/apply`, { invoice_id: form.elements.invoice_id.value, amount: Number(form.elements.amount.value) })
          m.close()
          toast(r.invoice_status === 'paid' ? t('funds.applied_paid') : t('funds.applied_part'))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
  m.el.querySelector('[data-inv]')?.addEventListener('change', (e) => {
    const o = e.target.selectedOptions[0]
    const bal = data.balances.find((b) => b.currency === o.dataset.cur)?.balance ?? 0
    m.el.querySelector('[name=amount]').value = Math.min(Number(o.dataset.out), bal)
  })
}

// Billing > Client funds: what the firm holds for each client.
export async function fundsReport(root, { isCurrent }) {
  render(root, spinner())
  const r = await api.get('/api/funds/report')
  if (!isCurrent()) return
  render(root, html`<div class="space-y-4">
    <div class="flex flex-wrap gap-3">${Object.entries(r.totals).map(([cur, v]) => html`<div class="card card-pad"><div class="text-xs text-slate-500">${t('funds.total_held', { cur })}</div><div class="text-xl font-bold" dir="ltr">${fmtMoney(v, cur)}</div></div>`)}</div>
    <div class="card">${r.items.length ? html`<div class="overflow-x-auto"><table class="table">
      <thead><tr><th>${t('cases.client')}</th><th class="text-end">${t('funds.balance')}</th><th>${t('funds.last_movement')}</th></tr></thead>
      <tbody>${r.items.map((i) => html`<tr class="clickable" data-action="open-client" data-id="${i.client_id}"><td class="font-medium" dir="auto">${i.name}</td>
        <td class="text-end whitespace-nowrap" dir="ltr">${fmtMoney(i.balance, i.currency)}</td><td class="text-xs">${fmtDate(i.last_movement, { hijri: false })}</td></tr>`)}</tbody></table></div>`
      : emptyState('fa-vault', t('funds.report_empty'), t('funds.report_empty_text'))}</div>
  </div>`)
  root.addEventListener('click', (e) => { const el = e.target.closest('[data-action=open-client]'); if (el) location.hash = `#/clients/${el.dataset.id}` })
}

// Client portal: the client's own statement.
export function portalFundsCard(f) {
  if (!f.entries.length) return ''
  return html`<section class="card">
    <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold"><i class="fas fa-vault text-brand-500"></i> ${t('funds.portal_title')}</h2>
      <div class="flex flex-wrap gap-2 mt-2">${balanceChips(f.balances)}</div>
      <p class="text-xs text-slate-500 mt-2">${t('funds.portal_help')}</p></div>
    <div class="overflow-x-auto"><table class="table"><tbody>${entryRows(f.entries.slice(0, 20), { staff: false })}</tbody></table></div>
  </section>`
}
