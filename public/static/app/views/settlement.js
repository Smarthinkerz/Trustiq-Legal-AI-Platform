import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { can, readOnly, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Settlement negotiations (التسوية الودية): offers both ways, the client's
// instructions (internal only) and offer expiries.
// ---------------------------------------------------------------------------

const TONE = { open: 'bg-sky-100 text-sky-800', accepted: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-100 text-red-700', countered: 'bg-amber-100 text-amber-800', expired: 'bg-slate-200 text-slate-600', withdrawn: 'bg-slate-100 text-slate-500' }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })

function expiryLine(o) {
  if (!o.expires_on || o.status !== 'open') return o.expires_on ? html`<span class="text-slate-500">${t('stl.expired_on', { date: fmtDate(o.expires_on) })}</span>` : ''
  const tone = o.days_left < 0 ? 'text-red-700 font-semibold' : o.days_left <= 3 ? 'text-amber-800 font-semibold' : 'text-slate-600'
  return html`<span class="${tone}"><i class="fas fa-hourglass-half"></i> ${t('stl.expires', { date: fmtDate(o.expires_on) })} · ${o.days_left < 0 ? t('stl.lapsed') : t('stl.days_left', { n: o.days_left })}</span>`
}

export async function caseSettlementCard(box, kase, { documents = [] } = {}) {
  if (!box || !can('owner', 'admin', 'lawyer', 'staff')) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  let d = null
  const draw = () => {
    const a = d?.authority
    const s = d?.standing
    render(box, html`<section class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold"><i class="fas fa-handshake-angle text-slate-400 me-1"></i> ${t('stl.title')} <span class="text-slate-400 font-normal">(${d?.offers.length ?? 0})</span></h2>
        ${editable ? html`<div class="flex gap-2">
          <button class="btn btn-ghost btn-sm" data-s="authority"><i class="fas fa-lock"></i>${t('stl.instructions')}</button>
          <button class="btn btn-outline btn-sm" data-s="add"><i class="fas fa-plus"></i>${t('stl.add')}</button></div>` : ''}
      </div>
      ${!d ? html`<div class="p-5">${spinner()}</div>` : html`
      <div class="px-5 py-3 border-b border-slate-100 bg-slate-50 text-sm flex flex-wrap gap-x-6 gap-y-1">
        ${a ? html`<span title="${t('stl.internal')}"><i class="fas fa-lock text-slate-400"></i> ${t(`stl.auth_${a.position}`)}: <b>${a.amount != null ? fmtMoney(a.amount, a.currency) : t('stl.no_figure')}</b>${a.given_on ? html` <span class="text-xs text-slate-500">(${fmtDate(a.given_on)})</span>` : ''}</span>`
          : html`<span class="text-slate-500"><i class="fas fa-lock"></i> ${t('stl.no_instructions')}</span>`}
        ${s?.ours ? html`<span>${t('stl.our_latest')}: <b>${fmtMoney(s.ours.amount, s.ours.currency)}</b></span>` : ''}
        ${s?.theirs ? html`<span>${t('stl.their_latest')}: <b>${fmtMoney(s.theirs.amount, s.theirs.currency)}</b></span>` : ''}
        ${s?.settled ? html`<span class="text-emerald-700 font-semibold"><i class="fas fa-circle-check"></i> ${t('stl.settled')}</span>`
          : s?.gap != null ? html`<span class="${s.crossed ? 'text-emerald-700' : 'text-amber-800'}">${s.crossed ? t('stl.crossed') : t('stl.gap', { amount: fmtMoney(s.gap, s.ours.currency) })}</span>` : ''}
      </div>
      ${d.offers.length ? html`<ol class="divide-y divide-slate-100">${d.offers.map((o) => html`<li class="px-5 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="badge ${o.direction === 'ours' ? 'bg-brand-100 text-brand-800' : 'bg-violet-100 text-violet-800'}"><i class="fas ${o.direction === 'ours' ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> ${t(`stl.d_${o.direction}`)}</span>
          <b class="text-sm">${fmtMoney(o.amount, o.currency)}</b>
          <span class="badge ${TONE[o.status]}">${t(`stl.s_${o.status}`)}</span>
          ${o.outside_authority ? html`<span class="badge bg-red-100 text-red-700"><i class="fas fa-triangle-exclamation"></i> ${t('stl.outside')}</span>` : ''}
          ${o.without_prejudice ? html`<span class="text-xs text-slate-500">${t('stl.wp')}</span>` : ''}
          <span class="text-xs text-slate-500 ms-auto">${fmtDate(o.made_on)}</span>
        </div>
        ${o.terms ? html`<p class="text-sm text-slate-700 mt-1 whitespace-pre-wrap" dir="auto">${o.terms}</p>` : ''}
        <div class="text-xs mt-1 flex flex-wrap gap-x-3">${expiryLine(o)}
          ${o.responded_on && o.status !== 'open' ? html`<span class="text-slate-500">${t('stl.responded', { date: fmtDate(o.responded_on) })}</span>` : ''}
          ${o.document_id ? html`<a class="text-brand-600 hover:underline" href="#/documents/${o.document_id}"><i class="fas fa-file-lines"></i> <span dir="auto">${o.document_title}</span></a>` : ''}</div>
        ${editable ? html`<div class="flex flex-wrap gap-1 mt-2">
          ${o.status === 'open' && o.direction === 'theirs' ? html`<button class="btn btn-outline btn-sm" data-s="accept" data-id="${o.id}"><i class="fas fa-check"></i>${t('stl.accept')}</button>
            <button class="btn btn-ghost btn-sm" data-s="counter" data-id="${o.id}"><i class="fas fa-right-left"></i>${t('stl.counter')}</button>
            <button class="btn btn-ghost btn-sm" data-s="reject" data-id="${o.id}"><i class="fas fa-xmark"></i>${t('stl.reject')}</button>` : ''}
          ${o.status === 'open' && o.direction === 'ours' ? html`<button class="btn btn-outline btn-sm" data-s="they-accepted" data-id="${o.id}"><i class="fas fa-check"></i>${t('stl.they_accepted')}</button>
            <button class="btn btn-ghost btn-sm" data-s="they-countered" data-id="${o.id}"><i class="fas fa-right-left"></i>${t('stl.they_countered')}</button>
            <button class="btn btn-ghost btn-sm" data-s="withdraw" data-id="${o.id}"><i class="fas fa-rotate-left"></i>${t('stl.withdraw')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-s="edit" data-id="${o.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger-ghost btn-sm" data-s="delete" data-id="${o.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>
        </div>` : ''}
      </li>`)}</ol>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('stl.none')}</p>`}`}
    </section>`)
  }
  const load = async () => {
    try { d = await api.get(`/api/settlement/case/${kase.id}`); if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  const setStatus = async (o, status, extra = {}) => {
    try {
      await api.patch(`/api/settlement/${o.id}`, { status, ...extra })
      toast(t('common.saved'))
      load()
    } catch (err) {
      if (err.code === 'outside_authority' && (await confirmDialog(t('stl.confirm_outside'), { danger: true, confirmLabel: t('stl.accept_anyway') }))) return setStatus(o, status, { confirm_outside_authority: true })
      showError(err)
    }
  }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-s]')
    if (!el) return
    const o = d.offers.find((x) => x.id === el.dataset.id)
    const act = el.dataset.s
    if (act === 'authority') openAuthorityForm(kase, d.authority, load)
    if (act === 'add') openOfferForm(kase, null, documents, load)
    if (act === 'edit') openOfferForm(kase, o, documents, load)
    if (act === 'accept' && (await confirmDialog(t('stl.confirm_accept', { amount: fmtMoney(o.amount, o.currency) }), { danger: false }))) setStatus(o, 'accepted')
    if (act === 'reject') setStatus(o, 'rejected')
    if (act === 'withdraw') setStatus(o, 'withdrawn')
    if (act === 'they-accepted') setStatus(o, 'accepted')
    // A counter-offer closes this one and opens the form for the reply.
    if (act === 'counter' || act === 'they-countered') {
      try { await api.patch(`/api/settlement/${o.id}`, { status: 'countered' }) } catch (err) { return showError(err) }
      load()
      openOfferForm(kase, null, documents, load, { direction: o.direction === 'theirs' ? 'ours' : 'theirs', currency: o.currency })
    }
    if (act === 'delete' && (await confirmDialog(t('stl.confirm_delete')))) {
      try { await api.del(`/api/settlement/${o.id}`); toast(t('common.deleted')); load() } catch (err) { showError(err) }
    }
  }
  draw()
  await load()
}

function openAuthorityForm(kase, a, done) {
  const currencies = store.ref?.currencies ?? ['OMR']
  const m = modal({
    title: t('stl.instructions'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm text-slate-600"><i class="fas fa-lock text-slate-400"></i> ${t('stl.instructions_help')}</p>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'position', label: t('stl.position'), options: ['receive', 'pay'].map((p) => ({ value: p, label: t(`stl.pos_${p}`) })), value: a?.position ?? 'receive' })}
        ${inputField({ name: 'amount', label: t('stl.limit'), type: 'number', value: a?.amount ?? '', attrs: 'min="0" step="0.001"' })}
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: a?.currency ?? kase.currency })}
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'given_on', label: t('stl.given_on'), type: 'date', value: a?.given_on ?? today() })}
        ${inputField({ name: 'note', label: t('stl.source'), value: a?.note ?? '', cls: 'sm:col-span-2', attrs: 'maxlength="2000" dir="auto"', placeholder: t('stl.source_placeholder') })}
      </div>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-floppy-disk"></i>${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        const b = formData(form)
        try { await api.put(`/api/settlement/case/${kase.id}/authority`, { ...b, amount: b.amount ?? '', note: b.note ?? '' }); m.close(); toast(t('common.saved')); done() } catch (err) { showError(err, form) }
      })
    }
  })
}

function openOfferForm(kase, o, documents, done, preset = {}) {
  const v = { direction: 'theirs', made_on: today(), without_prejudice: true, ...preset, ...(o || {}) }
  const currencies = store.ref?.currencies ?? ['OMR']
  const m = modal({
    title: o ? t('stl.edit') : t('stl.add'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'direction', label: t('stl.direction'), options: ['theirs', 'ours'].map((x) => ({ value: x, label: t(`stl.d_${x}`) })), value: v.direction })}
        ${inputField({ name: 'amount', label: t('stl.amount'), type: 'number', value: v.amount ?? '', required: true, attrs: 'min="0" step="0.001"' })}
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: v.currency ?? kase.currency })}
      </div>
      ${textareaField({ name: 'terms', label: t('stl.terms'), value: v.terms ?? '', rows: 3, placeholder: t('stl.terms_placeholder') })}
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'made_on', label: t('stl.made_on'), type: 'date', value: v.made_on, required: true })}
        ${inputField({ name: 'expires_on', label: t('stl.expires_on'), type: 'date', value: v.expires_on ?? '' })}
        ${selectField({ name: 'document_id', label: t('stl.document'), options: documents.map((x) => ({ value: x.id, label: x.title })), value: v.document_id ?? '', empty: t('ntc.no_document') })}
      </div>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="without_prejudice" ${v.without_prejudice ? 'checked' : ''} /> ${t('stl.wp_label')}</label>
      ${textareaField({ name: 'notes', label: t('stl.notes'), value: v.notes ?? '', rows: 2 })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-floppy-disk"></i>${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        b.without_prejudice = form.elements.without_prejudice.checked
        for (const k of ['terms', 'expires_on', 'document_id', 'notes']) if (b[k] == null) b[k] = ''
        try {
          if (o) await api.patch(`/api/settlement/${o.id}`, b)
          else await api.post(`/api/settlement/case/${kase.id}`, b)
          m.close()
          toast(t('common.saved'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

// Firm-wide list of open offers by expiry.
export async function settlementRegisterView(root, { query, isCurrent }) {
  const state = { show: query.get('show') === 'all' ? 'all' : 'open' }
  render(root, html`${pageHeader(t('stl.register'), t('stl.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/settlement/register?show=${state.show}`)
    if (!isCurrent()) return
    const stat = (n, label, tone) => html`<div class="card card-pad"><div class="text-2xl font-bold ${n ? tone : ''}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`
    render(root.querySelector('[data-reg]'), html`
      <div class="grid grid-cols-3 gap-4 mb-6">${stat(d.counts.open, t('stl.open'), '')}${stat(d.counts.expiring, t('stl.expiring'), 'text-amber-700')}${stat(d.counts.lapsed, t('stl.lapsed_count'), 'text-red-700')}</div>
      <div class="flex gap-1 mb-3">${['open', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`stl.show_${s}`)}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.reference')}</th><th>${t('stl.direction')}</th><th class="text-end">${t('stl.amount')}</th><th>${t('stl.made_on')}</th><th>${t('stl.expires_on')}</th><th>${t('common.status')}</th></tr></thead>
        <tbody>${d.items.map((o) => html`<tr class="clickable" data-action="open" data-id="${o.case_id}">
          <td class="font-mono text-xs">${o.reference}<div class="font-sans text-slate-500" dir="auto">${o.case_title}</div></td>
          <td class="text-sm">${t(`stl.d_${o.direction}`)}${o.outside_authority ? html` <i class="fas fa-triangle-exclamation text-red-600" title="${t('stl.outside')}"></i>` : ''}</td>
          <td class="text-end font-semibold whitespace-nowrap">${fmtMoney(o.amount, o.currency)}</td>
          <td class="text-sm whitespace-nowrap">${fmtDate(o.made_on, { hijri: false })}</td>
          <td class="text-xs">${expiryLine(o) || html`<span class="text-slate-400">—</span>`}</td>
          <td><span class="badge ${TONE[o.status]}">${t(`stl.s_${o.status}`)}</span></td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-handshake-angle', t(`stl.empty_${state.show}`), '')}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/settlement/register?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/settlement${state.show === 'all' ? '?show=all' : ''}`); load().catch(showError) }
    }
  })
  await load()
}
