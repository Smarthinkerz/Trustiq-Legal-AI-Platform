import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { readOnly, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Originals register (سجل الأصول): clients' original documents held by the
// firm, their movements, and bilingual receipts in and out.
// ---------------------------------------------------------------------------

const KINDS = ['cheque', 'contract', 'title_deed', 'poa', 'id_document', 'certificate', 'court_document', 'other']
const KIND_ICON = { cheque: 'fa-money-check', contract: 'fa-file-contract', title_deed: 'fa-house-chimney', poa: 'fa-stamp', id_document: 'fa-id-card', certificate: 'fa-certificate', court_document: 'fa-gavel', other: 'fa-file' }
const STATUS_TONE = { held: 'bg-emerald-100 text-emerald-800', lodged: 'bg-amber-100 text-amber-800', returned: 'bg-slate-200 text-slate-600' }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const receiptUrl = (ids, type) => `/api/originals/receipt?ids=${ids.join(',')}&type=${type}`

function whereLine(o) {
  if (o.status === 'lodged') return html`<i class="fas fa-building-columns"></i> ${t('orig.lodged_with')} <span dir="auto">${o.lodged_with}</span>`
  if (o.status === 'returned') return html`<i class="fas fa-reply"></i> ${t('orig.returned_to', { date: fmtDate(o.returned_on) })} <span dir="auto">${o.returned_to}</span>`
  return o.location ? html`<i class="fas fa-vault"></i> <span dir="auto">${o.location}</span>` : html`<i class="fas fa-vault"></i> ${t('orig.no_location')}`
}

// The card on a client page (all their originals) or a matter page (that matter's).
export async function originalsCard(box, { clientId, caseId = null, cases = [], title } = {}) {
  if (!box || !clientId) return
  const editable = !readOnly()
  let items = null
  const draw = () => {
    const held = (items ?? []).filter((o) => o.status !== 'returned')
    render(box, html`<section class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold"><i class="fas fa-vault text-slate-400 me-1"></i> ${title ?? t('orig.title')} <span class="text-slate-400 font-normal">(${held.length}/${items?.length ?? 0})</span></h2>
        ${editable ? html`<div class="flex gap-2">
          ${held.length ? html`<button class="btn btn-outline btn-sm" data-o="return"><i class="fas fa-reply"></i>${t('orig.return')}</button>` : ''}
          <button class="btn btn-outline btn-sm" data-o="receive"><i class="fas fa-plus"></i>${t('orig.receive')}</button></div>` : ''}
      </div>
      ${!items ? html`<div class="p-5">${spinner()}</div>` : items.length ? html`<ul class="divide-y divide-slate-100">${items.map((o) => html`<li class="px-5 py-3 ${o.status === 'returned' ? 'opacity-70' : ''}">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-xs text-slate-500">${o.receipt}</span>
          <i class="fas ${KIND_ICON[o.kind]} text-slate-400"></i>
          <span class="text-sm font-medium flex-1 min-w-0" dir="auto">${o.description}</span>
          <span class="badge ${STATUS_TONE[o.status]}">${t(`orig.s_${o.status}`)}</span>
        </div>
        <div class="text-xs text-slate-500 mt-1">${t(`orig.k_${o.kind}`)}${o.reference_no ? html` · <bdi dir="ltr">${o.reference_no}</bdi>` : ''}${o.amount != null ? html` · <b>${fmtMoney(o.amount, o.currency)}</b>` : ''}${o.copies > 1 ? ` · ×${o.copies}` : ''}
          · ${t('orig.received', { date: fmtDate(o.received_on) })}${!caseId && o.reference ? html` · <a class="text-brand-600 hover:underline" href="#/cases/${o.case_id}" dir="ltr">${o.reference}</a>` : ''}</div>
        <div class="text-xs mt-1 text-slate-600">${whereLine(o)}</div>
        <details class="text-xs mt-1"><summary class="cursor-pointer text-slate-500">${t('orig.history', { n: o.movements.length })}</summary>
          <ol class="mt-1 space-y-0.5">${o.movements.map((m) => html`<li><bdi>${fmtDate(m.on_date)}</bdi> · <b>${t(`orig.m_${m.action}`)}</b>${m.party ? html` · <span dir="auto">${m.party}</span>` : ''}${m.location ? html` · <span dir="auto">${m.location}</span>` : ''}${m.note ? html` · <span dir="auto">${m.note}</span>` : ''}${m.user_name ? ` · ${m.user_name}` : ''}</li>`)}</ol></details>
        <div class="flex flex-wrap gap-1 mt-2">
          <button class="btn btn-ghost btn-sm" data-o="receipt" data-id="${o.id}"><i class="fas fa-file-word"></i>${t('orig.receipt')}</button>
          ${o.status === 'returned' ? html`<button class="btn btn-ghost btn-sm" data-o="return-receipt" data-id="${o.id}"><i class="fas fa-file-word"></i>${t('orig.return_receipt')}</button>` : ''}
          ${editable && o.status === 'held' ? html`<button class="btn btn-ghost btn-sm" data-o="moved" data-id="${o.id}"><i class="fas fa-arrows-left-right"></i>${t('orig.m_moved')}</button>
            <button class="btn btn-ghost btn-sm" data-o="lodged" data-id="${o.id}"><i class="fas fa-building-columns"></i>${t('orig.lodge')}</button>` : ''}
          ${editable && o.status === 'lodged' ? html`<button class="btn btn-ghost btn-sm" data-o="retrieved" data-id="${o.id}"><i class="fas fa-rotate-left"></i>${t('orig.retrieve')}</button>` : ''}
        </div>
      </li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('orig.none')}</p>`}
    </section>`)
  }
  const load = async () => {
    try {
      items = (await api.get(`/api/originals?${caseId ? `case_id=${caseId}` : `client_id=${clientId}`}`)).items
      if (document.body.contains(box)) draw()
    } catch { /* card stays empty */ }
  }
  box.onclick = (e) => {
    const el = e.target.closest('[data-o]')
    if (!el) return
    const act = el.dataset.o
    const o = items.find((x) => x.id === el.dataset.id)
    if (act === 'receive') openReceiveForm({ clientId, caseId, cases }, load)
    if (act === 'return') openReturnForm(items.filter((x) => x.status !== 'returned'), load)
    if (act === 'receipt') download(receiptUrl([o.id], 'receipt'))
    if (act === 'return-receipt') {
      // Everything returned together on one receipt.
      const same = items.filter((x) => x.status === 'returned' && x.returned_on === o.returned_on && x.returned_to === o.returned_to)
      download(receiptUrl(same.map((x) => x.id), 'return'))
    }
    if (['moved', 'lodged', 'retrieved'].includes(act)) openMoveForm(o, act, load)
  }
  draw()
  await load()
}

function itemRow(n) {
  const currencies = store.ref?.currencies ?? ['OMR']
  return html`<fieldset class="rounded-xl border border-slate-200 p-4 space-y-3" data-item="${n}"><legend class="px-1 text-sm font-semibold">${t('orig.item', { n: n + 1 })}</legend>
    <div class="grid sm:grid-cols-4 gap-3">
      ${selectField({ name: `kind_${n}`, label: t('orig.kind'), options: KINDS.map((k) => ({ value: k, label: t(`orig.k_${k}`) })), value: 'cheque' })}
      ${inputField({ name: `description_${n}`, label: t('orig.description'), required: true, cls: 'sm:col-span-3', attrs: 'maxlength="1000" dir="auto"', placeholder: t('orig.description_placeholder') })}
    </div>
    <div class="grid sm:grid-cols-4 gap-3">
      ${inputField({ name: `reference_no_${n}`, label: t('orig.reference_no'), attrs: 'maxlength="200" dir="auto"' })}
      ${inputField({ name: `amount_${n}`, label: t('orig.amount'), type: 'number', attrs: 'min="0" step="0.001"' })}
      ${selectField({ name: `currency_${n}`, label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: store.me?.org?.default_currency ?? currencies[0] })}
      ${inputField({ name: `copies_${n}`, label: t('orig.copies'), type: 'number', value: '1', attrs: 'min="1" max="999"' })}
    </div></fieldset>`
}

function openReceiveForm({ clientId, caseId, cases }, done) {
  let count = 1
  const m = modal({
    title: t('orig.receive'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'received_on', label: t('orig.received_on'), type: 'date', value: today(), required: true })}
        ${inputField({ name: 'received_from', label: t('orig.received_from'), attrs: 'maxlength="300" dir="auto"', hint: t('orig.received_from_hint') })}
        ${inputField({ name: 'location', label: t('orig.location'), attrs: 'maxlength="300" dir="auto"', placeholder: t('orig.location_placeholder') })}
      </div>
      ${caseId ? html`<input type="hidden" name="case_id" value="${caseId}" />` : cases.length ? selectField({ name: 'case_id', label: t('cases.matter'), options: cases.map((k) => ({ value: k.id, label: `${k.reference} · ${k.title}` })), empty: t('orig.no_matter') }) : ''}
      <div data-items class="space-y-3">${itemRow(0)}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="add-item"><i class="fas fa-plus"></i>${t('orig.add_item')}</button>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-file-word"></i>${t('orig.save_receipt')}</button></div>
    </form>`,
    actions: {
      'add-item': () => {
        if (count >= 20) return
        m.el.querySelector('[data-items]').insertAdjacentHTML('beforeend', String(itemRow(count)))
        count++
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const d = formData(form)
        const items = []
        for (let n = 0; n < count; n++) {
          if (!d[`description_${n}`]) continue
          items.push({ kind: d[`kind_${n}`], description: d[`description_${n}`], reference_no: d[`reference_no_${n}`] ?? '', amount: d[`amount_${n}`] ?? '',
            currency: d[`currency_${n}`], copies: d[`copies_${n}`] || 1 })
        }
        if (!items.length) { form.querySelector('[name=description_0]').focus(); return toast(t('orig.need_item'), 'error') }
        try {
          const r = await api.post('/api/originals', { client_id: clientId, case_id: d.case_id || null, received_on: d.received_on, received_from: d.received_from ?? '', location: d.location ?? '', items })
          m.close()
          toast(t('orig.saved', { n: r.items.length }))
          download(receiptUrl(r.items.map((x) => x.id), 'receipt'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function openMoveForm(o, action, done) {
  const needsParty = action === 'lodged'
  const m = modal({
    title: `${t(`orig.m_${action}`)} – ${o.receipt}`,
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm" dir="auto">${o.description}</p>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'on_date', label: t('orig.date'), type: 'date', value: today(), required: true })}
        ${needsParty ? inputField({ name: 'party', label: t('orig.lodged_where'), required: true, attrs: 'maxlength="300" dir="auto"', placeholder: t('orig.lodged_placeholder') })
          : inputField({ name: 'location', label: t('orig.location'), value: o.location ?? '', required: action === 'moved', attrs: 'maxlength="300" dir="auto"' })}
      </div>
      ${textareaField({ name: 'note', label: t('orig.note'), rows: 2 })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-check"></i>${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        const b = formData(form)
        try { await api.post(`/api/originals/${o.id}/move`, { action, ...b }); m.close(); toast(t('common.saved')); done() } catch (err) { showError(err, form) }
      })
    }
  })
}

function openReturnForm(held, done) {
  const m = modal({
    title: t('orig.return'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm text-slate-600">${t('orig.return_help')}</p>
      <ul class="rounded-xl border border-slate-200 divide-y divide-slate-100">${held.map((o) => html`<li class="px-3 py-2"><label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="pick" value="${o.id}" ${o.status === 'held' ? 'checked' : ''} />
        <span class="font-mono text-xs text-slate-500">${o.receipt}</span><span dir="auto" class="flex-1">${o.description}</span>
        ${o.status === 'lodged' ? html`<span class="badge ${STATUS_TONE.lodged}">${t('orig.s_lodged')}</span>` : ''}</label></li>`)}</ul>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'on_date', label: t('orig.date'), type: 'date', value: today(), required: true })}
        ${inputField({ name: 'party', label: t('orig.returned_to_who'), required: true, attrs: 'maxlength="300" dir="auto"' })}
      </div>
      ${textareaField({ name: 'note', label: t('orig.note'), rows: 2 })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-file-word"></i>${t('orig.return_and_receipt')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const ids = [...form.querySelectorAll('[name=pick]:checked')].map((x) => x.value)
        if (!ids.length) return toast(t('orig.pick_some'), 'error')
        const b = formData(form)
        try {
          await api.post('/api/originals/return', { ids, on_date: b.on_date, party: b.party ?? '', note: b.note ?? '' })
          m.close()
          toast(t('orig.returned_toast', { n: ids.length }))
          download(receiptUrl(ids, 'return'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

// Firm-wide register.
export async function originalsRegisterView(root, { query, isCurrent }) {
  const state = { show: ['held', 'to_return', 'all'].includes(query.get('show')) ? query.get('show') : 'held' }
  render(root, html`${pageHeader(t('orig.register'), t('orig.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/originals/register?show=${state.show}`)
    if (!isCurrent()) return
    const stat = (n, label, tone) => html`<div class="card card-pad"><div class="text-2xl font-bold ${n ? tone : ''}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`
    render(root.querySelector('[data-reg]'), html`
      <div class="grid grid-cols-3 gap-4 mb-6">${stat(d.counts.held, t('orig.held'), 'text-emerald-700')}${stat(d.counts.lodged, t('orig.lodged'), 'text-amber-700')}${stat(d.counts.to_return, t('orig.to_return'), 'text-red-700')}</div>
      <div class="flex gap-1 mb-3">${['held', 'to_return', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`orig.show_${s}`)}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('orig.receipt_no')}</th><th>${t('orig.description')}</th><th>${t('nav.clients')}</th><th>${t('orig.received_on')}</th><th>${t('orig.where')}</th><th>${t('common.status')}</th></tr></thead>
        <tbody>${d.items.map((o) => html`<tr class="clickable" data-action="open" data-client="${o.client_id}">
          <td class="font-mono text-xs">${o.receipt}</td>
          <td><div class="text-sm font-medium" dir="auto"><i class="fas ${KIND_ICON[o.kind]} text-slate-400 me-1"></i>${o.description}</div>
            <div class="text-xs text-slate-500">${t(`orig.k_${o.kind}`)}${o.reference_no ? html` · <bdi dir="ltr">${o.reference_no}</bdi>` : ''}${o.amount != null ? ` · ${fmtMoney(o.amount, o.currency)}` : ''}</div></td>
          <td class="text-sm"><div dir="auto">${o.client_name}</div>${o.reference ? html`<div class="text-xs text-slate-500"><bdi dir="ltr">${o.reference}</bdi>${o.case_status === 'closed' ? ` · ${t('orig.closed_matter')}` : ''}</div>` : ''}</td>
          <td class="text-sm whitespace-nowrap">${fmtDate(o.received_on, { hijri: false })}</td>
          <td class="text-xs">${whereLine(o)}</td>
          <td><span class="badge ${STATUS_TONE[o.status]}">${t(`orig.s_${o.status}`)}</span>${o.to_return ? html`<div class="text-xs text-red-700 mt-1"><i class="fas fa-reply"></i> ${t('orig.due_back')}</div>` : ''}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-vault', t(`orig.empty_${state.show}`), '')}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/originals/register?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/clients/${el.dataset.client}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/originals${state.show === 'held' ? '' : `?show=${state.show}`}`); load().catch(showError) }
    }
  })
  await load()
}
