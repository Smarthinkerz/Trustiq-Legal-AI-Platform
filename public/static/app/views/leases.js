import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { can, readOnly, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Leases (عقود الإيجار): a client's tenancies, rent received and arrears,
// the notice deadline and expiry on the calendar, renewals and notices.
// ---------------------------------------------------------------------------

const USES = ['residential', 'commercial', 'industrial', 'land', 'other']
const FREQ = ['monthly', 'quarterly', 'semiannual', 'annual']
const STATUS = ['active', 'renewed', 'ended', 'terminated']
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const plusYear = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

function noticeBadge(l) {
  if (l.status !== 'active') return html`<span class="badge bg-slate-200 text-slate-600">${t(`lease.st_${l.status}`)}</span>`
  if (l.days_to_end < 0) return html`<span class="badge bg-red-100 text-red-700">${t('lease.expired')}</span>`
  if (l.notice_by && l.days_to_notice < 0) return html`<span class="badge bg-red-100 text-red-700">${t('lease.notice_passed')}</span>`
  if (l.notice_by && l.days_to_notice <= 30) return html`<span class="badge bg-amber-100 text-amber-800">${t('lease.notice_in', { n: l.days_to_notice })}</span>`
  return html`<span class="badge bg-emerald-100 text-emerald-800">${t('lease.st_active')}</span>`
}

export async function leasesCard(box, { clientId, cases = [] }) {
  if (!box) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer', 'staff')
  let d = null
  const open = new Set()
  const draw = () => {
    if (!d) return
    if (!d.items.length) {
      return render(box, html`<section class="card px-5 py-3 flex flex-wrap items-center gap-2">
        <h2 class="font-semibold flex-1"><i class="fas fa-building text-slate-400 me-1"></i> ${t('lease.title')} <span class="text-slate-400 font-normal">(0)</span></h2>
        ${editable ? html`<button class="btn btn-ghost btn-sm" data-l="add"><i class="fas fa-plus"></i>${t('lease.add')}</button>` : ''}</section>`)
    }
    render(box, html`<section class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold"><i class="fas fa-building text-slate-400 me-1"></i> ${t('lease.title')} <span class="text-slate-400 font-normal">(${d.items.length})</span></h2>
        ${editable ? html`<button class="btn btn-outline btn-sm" data-l="add"><i class="fas fa-plus"></i>${t('lease.add')}</button>` : ''}
      </div>
      <ul class="divide-y divide-slate-100">${d.items.map((l) => html`<li class="px-5 py-3 ${l.status !== 'active' ? 'opacity-70' : ''}">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium flex-1 min-w-0" dir="auto">${l.property}</span>
          <span class="badge bg-slate-100 text-slate-700">${t(`lease.role_${l.client_role}`)}</span>${noticeBadge(l)}
        </div>
        <div class="text-xs text-slate-500 mt-1"><span dir="auto">${l.counterparty}</span> · ${t('lease.term', { from: fmtDate(l.starts_on, { hijri: false }), to: fmtDate(l.ends_on, { hijri: false }) })}
          · ${fmtMoney(l.annual_rent, l.currency)} ${t('lease.per_year')} (${t(`lease.f_${l.frequency}`)})${l.registration_no ? html` · <bdi dir="ltr">${l.registration_no}</bdi>` : ''}</div>
        ${l.status === 'active' && l.notice_by ? html`<div class="text-xs mt-1 ${l.days_to_notice <= 30 ? 'text-amber-800 font-semibold' : 'text-slate-600'}"><i class="fas fa-bell"></i> ${t('lease.notice_by', { date: fmtDate(l.notice_by, { hijri: false }), n: l.notice_days })}</div>` : ''}
        ${l.arrears > 0 ? html`<div class="text-xs mt-1 text-red-700 font-semibold"><i class="fas fa-triangle-exclamation"></i> ${t('lease.arrears', { amount: fmtMoney(l.arrears, l.currency) })}</div>` : ''}
        <div class="flex flex-wrap gap-1 mt-2">
          <button class="btn btn-ghost btn-sm" data-l="toggle" data-id="${l.id}"><i class="fas fa-list"></i>${t('lease.rent')} (${l.payments.length})</button>
          ${editable && l.status === 'active' ? html`<button class="btn btn-ghost btn-sm" data-l="notice" data-id="${l.id}"><i class="fas fa-file-word"></i>${t('lease.notice')}</button>
            <button class="btn btn-ghost btn-sm" data-l="renew" data-id="${l.id}"><i class="fas fa-rotate"></i>${t('lease.renew')}</button>` : ''}
          ${editable ? html`<button class="btn btn-ghost btn-sm" data-l="edit" data-id="${l.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>` : ''}
          ${editable && can('owner', 'admin', 'lawyer') ? html`<button class="btn btn-danger-ghost btn-sm" data-l="delete" data-id="${l.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
        </div>
        ${open.has(l.id) ? html`<table class="table text-sm mt-2"><thead><tr><th>${t('lease.due')}</th><th class="text-end">${t('lease.amount')}</th><th class="text-end">${t('lease.paid')}</th><th></th></tr></thead>
          <tbody>${l.payments.map((p) => html`<tr>
            <td class="whitespace-nowrap ${p.paid < p.amount && p.days <= 0 ? 'text-red-700 font-semibold' : ''}">${fmtDate(p.due_on, { hijri: false })}</td>
            <td class="text-end">${fmtMoney(p.amount, l.currency)}</td>
            <td class="text-end">${p.paid ? html`${fmtMoney(p.paid, l.currency)}${p.paid_on ? html`<div class="text-xs text-slate-500">${fmtDate(p.paid_on, { hijri: false })}</div>` : ''}` : '–'}</td>
            <td class="text-end">${editable && p.paid < p.amount ? html`<button class="btn btn-outline btn-sm" data-l="pay" data-id="${l.id}" data-p="${p.id}">${t('lease.record')}</button>` : p.paid >= p.amount ? html`<i class="fas fa-check text-emerald-600"></i>` : ''}</td>
          </tr>`)}</tbody></table>` : ''}
      </li>`)}</ul>
    </section>`)
  }
  const load = async () => {
    try { d = await api.get(`/api/leases/client/${clientId}`); if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-l]')
    if (!el) return
    const act = el.dataset.l
    const l = d.items.find((x) => x.id === el.dataset.id)
    if (act === 'add' || act === 'edit') leaseForm(clientId, cases, act === 'edit' ? l : null, load)
    if (act === 'toggle') { open.has(l.id) ? open.delete(l.id) : open.add(l.id); draw() }
    if (act === 'pay') payForm(l, l.payments.find((p) => p.id === el.dataset.p), load)
    if (act === 'renew') renewForm(l, load)
    if (act === 'notice') noticeForm(l)
    if (act === 'delete') {
      if (!(await confirmDialog(t('lease.delete_confirm')))) return
      try { await api.del(`/api/leases/${l.id}`); load() } catch (err) { showError(err) }
    }
  }
  await load()
}

function leaseForm(clientId, cases, l, done) {
  const currencies = store.ref?.currencies ?? ['OMR']
  const start = today()
  const m = modal({
    title: l ? t('lease.edit') : t('lease.add'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'client_role', label: t('lease.client_is'), options: ['landlord', 'tenant'].map((r) => ({ value: r, label: t(`lease.role_${r}`) })), value: l?.client_role ?? 'landlord' })}
        ${selectField({ name: 'use', label: t('lease.use'), options: USES.map((u) => ({ value: u, label: t(`lease.u_${u}`) })), value: l?.use ?? 'residential' })}
        ${cases.length ? selectField({ name: 'case_id', label: t('cases.matter'), options: cases.map((k) => ({ value: k.id, label: `${k.reference} · ${k.title}` })), value: l?.case_id ?? '', empty: t('lease.no_matter') }) : html`<div></div>`}
      </div>
      ${inputField({ name: 'property', label: t('lease.property'), value: l?.property ?? '', required: true, attrs: 'maxlength="500" dir="auto"', placeholder: t('lease.property_placeholder') })}
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'counterparty', label: t('lease.counterparty'), value: l?.counterparty ?? '', required: true, attrs: 'maxlength="300" dir="auto"' })}
        ${inputField({ name: 'counterparty_id_number', label: t('lease.counterparty_id'), value: l?.counterparty_id_number ?? '', attrs: 'maxlength="100" dir="ltr"' })}
        ${inputField({ name: 'registration_no', label: t('lease.registration'), value: l?.registration_no ?? '', attrs: 'maxlength="100" dir="ltr"' })}
      </div>
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'starts_on', label: t('lease.starts'), type: 'date', value: l?.starts_on ?? start, required: true })}
        ${inputField({ name: 'ends_on', label: t('lease.ends'), type: 'date', value: l?.ends_on ?? plusYear(start), required: true })}
        ${inputField({ name: 'notice_days', label: t('lease.notice_days'), type: 'number', value: l?.notice_days ?? 90, attrs: 'min="0" max="730"', hint: t('lease.notice_days_hint') })}
        ${l ? selectField({ name: 'status', label: t('common.status'), options: STATUS.map((s) => ({ value: s, label: t(`lease.st_${s}`) })), value: l.status }) : html`<div></div>`}
      </div>
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'annual_rent', label: t('lease.annual_rent'), type: 'number', value: l?.annual_rent ?? '', required: true, attrs: 'min="0.001" step="0.001"' })}
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: l?.currency ?? store.me?.org?.default_currency })}
        ${selectField({ name: 'frequency', label: t('lease.frequency'), options: FREQ.map((f) => ({ value: f, label: t(`lease.f_${f}`) })), value: l?.frequency ?? 'monthly' })}
        ${inputField({ name: 'deposit', label: t('lease.deposit'), type: 'number', value: l?.deposit ?? '', attrs: 'min="0" step="0.001"' })}
      </div>
      ${l?.collected > 0 ? html`<p class="text-xs text-amber-800">${t('lease.terms_locked')}</p>` : ''}
      ${textareaField({ name: 'notes', label: t('clients.notes'), value: l?.notes ?? '', rows: 2 })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-calendar-plus"></i>${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        try {
          if (l) await api.patch(`/api/leases/${l.id}`, b)
          else await api.post(`/api/leases/client/${clientId}`, b)
          m.close(); toast(t('lease.saved')); done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function payForm(l, p, done) {
  const due = Math.round((p.amount - p.paid) * 1000) / 1000
  const m = modal({
    title: t('lease.record_rent'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm" dir="auto">${l.property} · ${fmtDate(p.due_on, { hijri: false })} · ${fmtMoney(due, l.currency)}</p>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'amount', label: t('lease.amount'), type: 'number', value: due, required: true, attrs: `min="0.001" max="${due}" step="0.001"` })}
        ${inputField({ name: 'paid_on', label: t('lease.paid_on'), type: 'date', value: today(), required: true, attrs: `max="${today()}"` })}
        ${inputField({ name: 'method', label: t('lease.method'), attrs: 'maxlength="40" dir="auto"', placeholder: t('lease.method_placeholder') })}
        ${inputField({ name: 'reference', label: t('lease.reference'), attrs: 'maxlength="100" dir="ltr"' })}
      </div>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary">${t('lease.record')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        try { await api.post(`/api/leases/payments/${p.id}`, formData(form)); m.close(); toast(t('lease.rent_saved')); done() } catch (err) { showError(err, form) }
      })
    }
  })
}

function renewForm(l, done) {
  const start = new Date(Date.parse(`${l.ends_on}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const m = modal({
    title: t('lease.renew'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm">${t('lease.renew_help', { date: fmtDate(start, { hijri: false }) })}</p>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'ends_on', label: t('lease.ends'), type: 'date', value: plusYear(start), required: true })}
        ${inputField({ name: 'annual_rent', label: t('lease.new_rent'), type: 'number', value: l.annual_rent, attrs: 'min="0.001" step="0.001"' })}
        ${selectField({ name: 'frequency', label: t('lease.frequency'), options: FREQ.map((f) => ({ value: f, label: t(`lease.f_${f}`) })), value: l.frequency })}
        ${inputField({ name: 'registration_no', label: t('lease.registration'), value: l.registration_no ?? '', attrs: 'maxlength="100" dir="ltr"' })}
      </div>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-rotate"></i>${t('lease.renew')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        try { await api.post(`/api/leases/${l.id}/renew`, formData(form)); m.close(); toast(t('lease.renewed')); done() } catch (err) { showError(err, form) }
      })
    }
  })
}

function noticeForm(l) {
  const m = modal({
    title: t('lease.notice'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${selectField({ name: 'kind', label: t('lease.notice_kind'), options: [{ value: 'non_renewal', label: t('lease.k_non_renewal') }, { value: 'renewal_terms', label: t('lease.k_renewal_terms') }], value: 'non_renewal' })}
      <div class="grid sm:grid-cols-2 gap-4" data-terms>
        ${inputField({ name: 'new_rent', label: t('lease.new_rent'), type: 'number', attrs: 'min="0.001" step="0.001"' })}
        ${inputField({ name: 'terms', label: t('lease.other_terms'), attrs: 'maxlength="1000" dir="auto"' })}
      </div>
      <p class="text-xs text-slate-500">${t('lease.notice_review')}</p>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-file-word"></i>${t('lease.download')}</button></div>
    </form>`,
    forms: {
      save: (form) => {
        const b = formData(form)
        if (b.kind === 'renewal_terms' && !b.new_rent && !b.terms) return toast(t('lease.need_terms'), 'error')
        const q = new URLSearchParams({ kind: b.kind })
        if (b.kind === 'renewal_terms') { if (b.new_rent) q.set('new_rent', b.new_rent); if (b.terms) q.set('terms', b.terms) }
        download(`/api/leases/${l.id}/notice?${q}`)
        m.close()
      }
    }
  })
  const form = m.el.querySelector('form')
  const sync = () => { form.querySelector('[data-terms]').hidden = form.elements.kind.value !== 'renewal_terms' }
  form.elements.kind.addEventListener('change', sync)
  sync()
}

// Firm-wide register.
export async function leasesRegisterView(root, { query, isCurrent }) {
  const state = { show: ['attention', 'active', 'all'].includes(query.get('show')) ? query.get('show') : 'attention' }
  render(root, html`${pageHeader(t('lease.register'), t('lease.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/leases/register?show=${state.show}`)
    if (!isCurrent()) return
    const arrears = Object.entries(d.arrears).map(([cur, n]) => fmtMoney(n, cur)).join(' + ') || '0'
    const stat = (n, label, tone) => html`<div class="card card-pad"><div class="text-2xl font-bold ${n && n !== '0' ? tone : ''}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`
    render(root.querySelector('[data-reg]'), html`
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">${stat(d.counts.active, t('lease.active'), 'text-slate-800')}${stat(d.counts.notice_soon, t('lease.notice_soon'), 'text-amber-700')}
        ${stat(d.counts.in_arrears, t('lease.in_arrears'), 'text-red-700')}${stat(arrears, t('lease.arrears_total'), 'text-red-700')}</div>
      <div class="flex gap-1 mb-3">${['attention', 'active', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`lease.show_${s}`)}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('lease.property')}</th><th>${t('nav.clients')}</th><th>${t('lease.ends')}</th><th class="text-end">${t('lease.annual_rent')}</th><th>${t('common.status')}</th></tr></thead>
        <tbody>${d.items.map((l) => html`<tr class="clickable" data-action="open" data-id="${l.client_id}">
          <td class="text-sm"><div dir="auto" class="font-medium">${l.property}</div><div class="text-xs text-slate-500" dir="auto">${l.counterparty}</div></td>
          <td class="text-sm"><span dir="auto">${l.client_name}</span><div class="text-xs text-slate-500">${t(`lease.role_${l.client_role}`)}</div></td>
          <td class="text-sm whitespace-nowrap">${fmtDate(l.ends_on, { hijri: false })}${l.notice_by && l.status === 'active' ? html`<div class="text-xs text-slate-500">${t('lease.notice_short', { date: fmtDate(l.notice_by, { hijri: false }) })}</div>` : ''}</td>
          <td class="text-sm text-end whitespace-nowrap">${fmtMoney(l.annual_rent, l.currency)}${l.arrears > 0 ? html`<div class="text-xs text-red-700 font-semibold">${t('lease.arrears', { amount: fmtMoney(l.arrears, l.currency) })}</div>` : ''}</td>
          <td>${noticeBadge(l)}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-building', t(`lease.empty_${state.show}`), t('lease.empty_help'))}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/leases/register?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/clients/${el.dataset.id}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/leases${state.show === 'attention' ? '' : `?show=${state.show}`}`); load().catch(showError) }
    }
  })
  await load()
}
