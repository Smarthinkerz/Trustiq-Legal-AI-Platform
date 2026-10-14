import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, getLang, t } from '../i18n.js'
import { can, readOnly, refOptions, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Company secretarial (السجل المؤسسي): a corporate client's particulars,
// shareholders and officers, and the yearly filings kept on the calendar.
// ---------------------------------------------------------------------------

const FORMS = ['llc', 'spc', 'saog', 'saoc', 'partnership', 'branch', 'sole', 'free_zone', 'other']
const ROLES = ['shareholder', 'director', 'manager', 'signatory', 'secretary', 'auditor']
const KINDS = ['cr_renewal', 'chamber_renewal', 'licence_renewal', 'agm', 'accounts', 'tax_return', 'other']
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const monthName = (m) => new Date(Date.UTC(2026, m - 1, 1)).toLocaleDateString(getLang() === 'ar' ? 'ar-OM' : 'en-GB', { month: 'long', timeZone: 'UTC' })

// Days left as a coloured badge: overdue, due within the month, or later.
const dueBadge = (o) => o.done_on ? html`<span class="badge bg-emerald-100 text-emerald-800">${t('corp.done_on', { date: fmtDate(o.done_on, { hijri: false }) })}</span>`
  : o.days_left < 0 ? html`<span class="badge bg-red-100 text-red-700">${t('corp.overdue', { n: -o.days_left })}</span>`
    : o.days_left <= 30 ? html`<span class="badge bg-amber-100 text-amber-800">${o.days_left === 0 ? t('corp.due_today') : t('corp.days_left', { n: o.days_left })}</span>`
      : html`<span class="badge bg-slate-100 text-slate-600">${t('corp.days_left', { n: o.days_left })}</span>`

const personName = (p) => html`<span dir="auto">${p.name}</span>${p.name_ar && p.name_ar !== p.name ? html` <span class="text-slate-500" dir="rtl">${p.name_ar}</span>` : ''}`

// The card on a company client's page.
export async function corporateCard(box, { clientId }) {
  if (!box || !clientId) return
  const editable = !readOnly()
  const canDelete = can('owner', 'admin', 'lawyer')
  let d = null
  const draw = () => {
    if (!d) return render(box, html`<section class="card p-5">${spinner()}</section>`)
    const p = d.profile
    const cur = d.people.filter((x) => !x.ceased_on || x.ceased_on > d.today)
    const former = d.people.filter((x) => x.ceased_on && x.ceased_on <= d.today)
    const pct = new Map(d.ownership.holders.map((h) => [h.id, h.percent]))
    const holders = cur.filter((x) => x.role === 'shareholder')
    const officers = cur.filter((x) => x.role !== 'shareholder')
    const open = d.obligations.filter((o) => !o.done_on)
    const done = d.obligations.filter((o) => o.done_on)
    const fact = (label, value) => value ? html`<div><dt class="text-xs text-slate-500">${label}</dt><dd class="text-sm" dir="auto">${value}</dd></div>` : ''
    const personRow = (x) => html`<li class="py-2 flex flex-wrap items-start gap-2 text-sm">
      <div class="flex-1 min-w-0"><div class="font-medium">${x.is_entity ? html`<i class="fas fa-building text-slate-400 me-1"></i>` : ''}${personName(x)}</div>
        <div class="text-xs text-slate-500">${x.role === 'shareholder' ? html`${x.shares != null ? t('corp.shares_n', { n: x.shares }) : ''}${pct.get(x.id) != null ? html` · <b>${pct.get(x.id)}%</b>` : ''}`
          : html`${t(`corp.r_${x.role}`)}${x.position ? ` · ${x.position}` : ''}`}${x.nationality ? ` · ${x.nationality}` : ''}${x.id_number ? html` · <bdi dir="ltr">${x.id_number}</bdi>` : ''}${x.appointed_on ? ` · ${t('corp.since', { date: fmtDate(x.appointed_on, { hijri: false }) })}` : ''}</div>
        ${x.signing_authority ? html`<div class="text-xs text-slate-600 mt-0.5" dir="auto"><i class="fas fa-pen-nib text-slate-400"></i> ${x.signing_authority}</div>` : ''}
        ${x.ceased_on ? html`<div class="text-xs text-slate-500">${t('corp.until', { date: fmtDate(x.ceased_on, { hijri: false }) })}</div>` : ''}</div>
      ${editable ? html`<button class="btn btn-ghost btn-sm" data-c="edit-person" data-id="${x.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>` : ''}</li>`
    render(box, html`<section class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold"><i class="fas fa-building-columns text-slate-400 me-1"></i> ${t('corp.title')}</h2>
        <div class="flex flex-wrap gap-2">
          ${p || d.people.length ? html`<button class="btn btn-outline btn-sm" data-c="register"><i class="fas fa-file-word"></i>${t('corp.register_doc')}</button>` : ''}
          ${editable ? html`<button class="btn btn-outline btn-sm" data-c="profile"><i class="fas fa-pen"></i>${p ? t('corp.edit_details') : t('corp.add_details')}</button>` : ''}
        </div>
      </div>
      <div class="p-5 space-y-5">
        ${d.warnings.length && (p || d.people.length) ? html`<ul class="rounded-lg bg-amber-50 text-amber-900 p-3 text-sm space-y-1">${d.warnings.map((w) => html`<li><i class="fas fa-triangle-exclamation"></i> ${t(`corp.w_${w}`)}</li>`)}</ul>` : ''}
        ${d.suggestion && editable ? html`<div class="rounded-lg bg-sky-50 text-sky-900 p-3 text-sm flex flex-wrap items-center gap-2">
          <span class="flex-1"><i class="fas fa-lightbulb"></i> ${t('corp.suggest_cr', { date: fmtDate(d.suggestion.due_on, { hijri: false }) })}</span>
          <button class="btn btn-outline btn-sm" data-c="track-cr"><i class="fas fa-calendar-plus"></i>${t('corp.track')}</button></div>` : ''}
        ${p ? html`<dl class="grid sm:grid-cols-3 gap-3">
          ${fact(t('corp.legal_form'), t(`corp.f_${p.legal_form}`))}
          ${fact(t('corp.cr_number'), p.cr_number ? html`<bdi dir="ltr">${p.cr_number}</bdi>` : '')}
          ${fact(t('corp.registered_on'), p.registered_on ? fmtDate(p.registered_on, { hijri: false }) : '')}
          ${fact(t('corp.capital'), p.capital != null ? fmtMoney(p.capital, p.currency) : '')}
          ${fact(t('corp.total_shares'), p.total_shares != null ? String(p.total_shares) : '')}
          ${fact(t('corp.fiscal_year_end'), monthName(p.fiscal_year_end))}
          ${p.registered_address ? fact(t('corp.registered_address'), p.registered_address) : ''}
          ${p.activities ? html`<div class="sm:col-span-2">${fact(t('corp.activities'), p.activities)}</div>` : ''}
        </dl>` : html`<p class="text-sm text-slate-500">${t('corp.no_details')}</p>`}
        <div class="grid lg:grid-cols-2 gap-5">
          <div><div class="flex items-center justify-between"><h3 class="font-semibold text-sm">${t('corp.shareholders')} <span class="text-slate-400 font-normal">(${holders.length})</span></h3>
            ${editable ? html`<button class="btn btn-ghost btn-sm" data-c="add-person" data-role="shareholder"><i class="fas fa-plus"></i>${t('corp.add')}</button>` : ''}</div>
            ${holders.length ? html`<ul class="divide-y divide-slate-100">${holders.map(personRow)}</ul>` : html`<p class="text-xs text-slate-500 py-2">${t('corp.none')}</p>`}</div>
          <div><div class="flex items-center justify-between"><h3 class="font-semibold text-sm">${t('corp.officers')} <span class="text-slate-400 font-normal">(${officers.length})</span></h3>
            ${editable ? html`<button class="btn btn-ghost btn-sm" data-c="add-person" data-role="manager"><i class="fas fa-plus"></i>${t('corp.add')}</button>` : ''}</div>
            ${officers.length ? html`<ul class="divide-y divide-slate-100">${officers.map(personRow)}</ul>` : html`<p class="text-xs text-slate-500 py-2">${t('corp.none')}</p>`}</div>
        </div>
        ${former.length ? html`<details class="text-sm"><summary class="cursor-pointer text-slate-500 text-xs">${t('corp.former', { n: former.length })}</summary><ul class="divide-y divide-slate-100 opacity-70">${former.map(personRow)}</ul></details>` : ''}
        <div><div class="flex items-center justify-between"><h3 class="font-semibold text-sm">${t('corp.filings')} <span class="text-slate-400 font-normal">(${open.length})</span></h3>
          ${editable ? html`<button class="btn btn-ghost btn-sm" data-c="add-filing"><i class="fas fa-plus"></i>${t('corp.add_filing')}</button>` : ''}</div>
          ${open.length ? html`<ul class="divide-y divide-slate-100">${open.map((o) => html`<li class="py-2 flex flex-wrap items-center gap-2 text-sm">
            <div class="flex-1 min-w-0"><div class="font-medium" dir="auto">${o.title}</div>
              <div class="text-xs text-slate-500">${fmtDate(o.due_on)}${o.recurs_yearly ? html` · <i class="fas fa-rotate"></i> ${t('corp.yearly')}` : ''}${o.notes ? html` · <span dir="auto">${o.notes}</span>` : ''}</div></div>
            ${dueBadge(o)}
            ${editable ? html`<button class="btn btn-outline btn-sm" data-c="done" data-id="${o.id}"><i class="fas fa-check"></i>${t('corp.mark_done')}</button>
              <button class="btn btn-ghost btn-sm" data-c="edit-filing" data-id="${o.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>` : ''}</li>`)}</ul>`
            : html`<p class="text-xs text-slate-500 py-2">${t('corp.no_filings')}</p>`}
          ${done.length ? html`<details class="text-xs mt-1"><summary class="cursor-pointer text-slate-500">${t('corp.completed', { n: done.length })}</summary>
            <ul class="mt-1 space-y-0.5">${done.map((o) => html`<li><span dir="auto">${o.title}</span> · ${fmtDate(o.due_on, { hijri: false })} · ${dueBadge(o)}</li>`)}</ul></details>` : ''}
        </div>
      </div>
    </section>`)
  }
  const load = async () => {
    try {
      d = await api.get(`/api/corporate/client/${clientId}`)
      if (document.body.contains(box)) draw()
    } catch (err) { showError(err) }
  }
  // A signed resolution can change the record (new manager, new address).
  const onChanged = () => (document.body.contains(box) ? load() : window.removeEventListener('corporate:changed', onChanged))
  window.addEventListener('corporate:changed', onChanged)
  box.onclick = async (e) => {
    const el = e.target.closest('[data-c]')
    if (!el) return
    const act = el.dataset.c
    if (act === 'register') download(`/api/corporate/client/${clientId}/register`)
    if (act === 'profile') profileForm(clientId, d.profile, load)
    if (act === 'add-person') personForm(clientId, { role: el.dataset.role }, load, false)
    if (act === 'edit-person') personForm(clientId, d.people.find((x) => x.id === el.dataset.id), load, canDelete)
    if (act === 'add-filing') filingForm(clientId, null, load, false)
    if (act === 'edit-filing') filingForm(clientId, d.obligations.find((x) => x.id === el.dataset.id), load, canDelete)
    if (act === 'track-cr') filingForm(clientId, { kind: 'cr_renewal', due_on: d.suggestion.due_on, recurs_yearly: true }, load, false, true)
    if (act === 'done') doneForm(d.obligations.find((x) => x.id === el.dataset.id), load)
  }
  draw()
  await load()
}

function profileForm(clientId, p, done) {
  const currencies = store.ref?.currencies ?? ['OMR']
  const m = modal({
    title: t('corp.details'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'legal_form', label: t('corp.legal_form'), options: FORMS.map((f) => ({ value: f, label: t(`corp.f_${f}`) })), value: p?.legal_form ?? 'llc' })}
        ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: refOptions('jurisdictions'), value: p?.jurisdiction ?? store.me?.org?.default_jurisdiction, empty: '' })}
        ${inputField({ name: 'cr_number', label: t('corp.cr_number'), value: p?.cr_number ?? '', attrs: 'maxlength="100" dir="ltr"' })}
      </div>
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'registered_on', label: t('corp.registered_on'), type: 'date', value: p?.registered_on ?? '' })}
        ${inputField({ name: 'capital', label: t('corp.capital'), type: 'number', value: p?.capital ?? '', attrs: 'min="0" step="0.001"' })}
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: p?.currency ?? store.me?.org?.default_currency })}
        ${inputField({ name: 'total_shares', label: t('corp.total_shares'), type: 'number', value: p?.total_shares ?? '', attrs: 'min="0" step="any"', hint: t('corp.total_shares_hint') })}
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'fiscal_year_end', label: t('corp.fiscal_year_end'), options: Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthName(i + 1) })), value: p?.fiscal_year_end ?? 12 })}
        ${inputField({ name: 'registered_address', label: t('corp.registered_address'), value: p?.registered_address ?? '', attrs: 'maxlength="1000" dir="auto"', cls: 'sm:col-span-2' })}
      </div>
      ${textareaField({ name: 'activities', label: t('corp.activities'), value: p?.activities ?? '', rows: 2 })}
      ${textareaField({ name: 'notes', label: t('clients.notes'), value: p?.notes ?? '', rows: 2 })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        try {
          await api.put(`/api/corporate/client/${clientId}`, { ...b, fiscal_year_end: Number(b.fiscal_year_end) })
          m.close(); toast(t('common.saved')); done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function personForm(clientId, x, done, canDelete) {
  const editing = !!x?.id
  const m = modal({
    title: editing ? t('corp.edit_person') : t('corp.add_person'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'role', label: t('corp.role'), options: ROLES.map((r) => ({ value: r, label: t(`corp.r_${r}`) })), value: x?.role ?? 'shareholder' })}
        ${inputField({ name: 'name', label: t('corp.name'), value: x?.name ?? '', required: true, attrs: 'maxlength="300" dir="auto"' })}
        ${inputField({ name: 'name_ar', label: t('corp.name_ar'), value: x?.name_ar ?? '', attrs: 'maxlength="300" dir="rtl"' })}
      </div>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="is_entity" ${x?.is_entity ? 'checked' : ''} /> ${t('corp.is_entity')}</label>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'nationality', label: t('corp.nationality'), value: x?.nationality ?? '', attrs: 'maxlength="100" dir="auto"' })}
        ${inputField({ name: 'id_number', label: t('corp.id_number'), value: x?.id_number ?? '', attrs: 'maxlength="100" dir="ltr"' })}
        ${inputField({ name: 'shares', label: t('corp.shares'), type: 'number', value: x?.shares ?? '', attrs: 'min="0" step="any"', hint: t('corp.shares_hint') })}
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'position', label: t('corp.position'), value: x?.position ?? '', attrs: 'maxlength="200" dir="auto"', placeholder: t('corp.position_placeholder') })}
        ${inputField({ name: 'appointed_on', label: t('corp.appointed_on'), type: 'date', value: x?.appointed_on ?? '' })}
        ${inputField({ name: 'ceased_on', label: t('corp.ceased_on'), type: 'date', value: x?.ceased_on ?? '', hint: t('corp.ceased_hint') })}
      </div>
      ${textareaField({ name: 'signing_authority', label: t('corp.signing_authority'), value: x?.signing_authority ?? '', rows: 2, placeholder: t('corp.signing_placeholder') })}
      <div class="flex flex-wrap justify-between gap-2">
        <div>${editing && canDelete ? html`<button type="button" class="btn btn-danger-ghost" data-action="remove">${t('common.delete')}</button>` : ''}</div>
        <div class="flex gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
      </div>
    </form>`,
    actions: {
      remove: async () => {
        if (!(await confirmDialog(t('corp.delete_person')))) return
        try { await api.del(`/api/corporate/people/${x.id}`); m.close(); done() } catch (err) { showError(err) }
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        try {
          if (editing) await api.patch(`/api/corporate/people/${x.id}`, b)
          else await api.post(`/api/corporate/client/${clientId}/people`, b)
          m.close(); toast(t('common.saved')); done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function filingForm(clientId, o, done, canDelete, prefilled = false) {
  const editing = !!o?.id
  const m = modal({
    title: editing ? t('corp.edit_filing') : t('corp.add_filing'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${selectField({ name: 'kind', label: t('corp.filing_type'), options: KINDS.map((k) => ({ value: k, label: t(`corp.k_${k}`) })), value: o?.kind ?? 'cr_renewal' })}
      ${inputField({ name: 'title', label: t('corp.filing_title'), value: editing ? o.title : '', attrs: 'maxlength="300" dir="auto"', hint: t('corp.filing_title_hint') })}
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'due_on', label: t('corp.due_on'), type: 'date', value: o?.due_on ?? '', required: true })}
        <label class="flex items-center gap-2 text-sm sm:mt-7"><input type="checkbox" name="recurs_yearly" ${o?.recurs_yearly ?? true ? 'checked' : ''} /> ${t('corp.recurs')}</label>
      </div>
      ${textareaField({ name: 'notes', label: t('clients.notes'), value: o?.notes ?? '', rows: 2 })}
      ${prefilled ? html`<p class="text-xs text-slate-500">${t('corp.check_date')}</p>` : ''}
      <div class="flex flex-wrap justify-between gap-2">
        <div>${editing && canDelete ? html`<button type="button" class="btn btn-danger-ghost" data-action="remove">${t('common.delete')}</button>` : ''}</div>
        <div class="flex gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-calendar-plus"></i>${t('common.save')}</button></div>
      </div>
    </form>`,
    actions: {
      remove: async () => {
        if (!(await confirmDialog(t('corp.delete_filing')))) return
        try { await api.del(`/api/corporate/obligations/${o.id}`); m.close(); done() } catch (err) { showError(err) }
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        // A blank title takes the filing type's name in the user's language.
        if (!b.title) b.title = t(`corp.k_${b.kind}`)
        try {
          if (editing) await api.patch(`/api/corporate/obligations/${o.id}`, b)
          else await api.post(`/api/corporate/client/${clientId}/obligations`, b)
          m.close(); toast(t('corp.filing_saved')); done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function doneForm(o, done) {
  const m = modal({
    title: t('corp.mark_done'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm" dir="auto"><b>${o.title}</b> · ${fmtDate(o.due_on, { hijri: false })}</p>
      ${inputField({ name: 'done_on', label: t('corp.done_date'), type: 'date', value: today(), required: true, attrs: `max="${today()}"` })}
      ${o.recurs_yearly ? html`<p class="text-xs text-slate-500"><i class="fas fa-rotate"></i> ${t('corp.rolls_forward')}</p>` : ''}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-check"></i>${t('corp.mark_done')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        try {
          const r = await api.post(`/api/corporate/obligations/${o.id}/done`, { done_on: formData(form).done_on })
          m.close()
          toast(r.next ? t('corp.done_next', { date: fmtDate(r.next.due_on, { hijri: false }) }) : t('corp.done'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

// Firm-wide list of corporate filings.
export async function corporateRegisterView(root, { query, isCurrent }) {
  const state = { show: ['due', 'open', 'all'].includes(query.get('show')) ? query.get('show') : 'open' }
  render(root, html`${pageHeader(t('corp.register'), t('corp.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/corporate/register?show=${state.show}`)
    if (!isCurrent()) return
    const stat = (n, label, tone) => html`<div class="card card-pad"><div class="text-2xl font-bold ${n ? tone : ''}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`
    render(root.querySelector('[data-reg]'), html`
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">${stat(d.counts.companies, t('corp.companies'), 'text-slate-800')}${stat(d.counts.open, t('corp.open'), 'text-slate-800')}
        ${stat(d.counts.due_soon, t('corp.due_soon'), 'text-amber-700')}${stat(d.counts.overdue, t('corp.overdue_n'), 'text-red-700')}</div>
      <div class="flex gap-1 mb-3">${['due', 'open', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`corp.show_${s}`)}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('corp.company')}</th><th>${t('corp.filing')}</th><th>${t('corp.due_on')}</th><th>${t('common.status')}</th></tr></thead>
        <tbody>${d.items.map((o) => html`<tr class="clickable" data-action="open" data-client="${o.client_id}">
          <td><div class="text-sm font-medium" dir="auto">${o.client_name}</div>${o.cr_number ? html`<div class="text-xs text-slate-500">${t('corp.cr_short')} <bdi dir="ltr">${o.cr_number}</bdi></div>` : ''}</td>
          <td class="text-sm"><div dir="auto">${o.title}</div><div class="text-xs text-slate-500">${o.title !== t(`corp.k_${o.kind}`) ? html`${t(`corp.k_${o.kind}`)} · ` : ''}${o.recurs_yearly ? html`<i class="fas fa-rotate"></i> ${t('corp.yearly')}` : ''}</div></td>
          <td class="text-sm whitespace-nowrap">${fmtDate(o.due_on)}</td>
          <td>${dueBadge(o)}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-building-columns', t(`corp.empty_${state.show}`), t('corp.empty_help'))}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/corporate/register?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/clients/${el.dataset.client}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/corporate${state.show === 'open' ? '' : `?show=${state.show}`}`); load().catch(showError) }
    }
  })
  await load()
}
