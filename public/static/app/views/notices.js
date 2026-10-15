import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { aiEnabled, can, readOnly, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'
import { openDraftForm } from './documents.js'
import { readBar, wireReadBar } from './ai-read.js'

// ---------------------------------------------------------------------------
// Legal notices (الإنذارات والإخطارات): notices sent to or received from the
// other side, how they were served, and the response deadline.
// ---------------------------------------------------------------------------

const METHODS = ['notary', 'court_bailiff', 'courier', 'registered_mail', 'email', 'whatsapp', 'hand', 'other']
const STATUSES = ['sent', 'delivered', 'responded', 'no_response', 'failed', 'withdrawn', 'closed']
const OPEN = ['sent', 'delivered']
const TONE = {
  sent: 'bg-sky-100 text-sky-800', delivered: 'bg-amber-100 text-amber-800', responded: 'bg-emerald-100 text-emerald-800', no_response: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700', withdrawn: 'bg-slate-100 text-slate-600', closed: 'bg-slate-200 text-slate-600'
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
// Status words read differently for a notice we received ("received", "we replied").
const statusLabel = (n) => t(n.direction === 'incoming' && ['delivered', 'responded', 'no_response'].includes(n.status) ? `ntc.in_${n.status}` : `ntc.s_${n.status}`)
const statusBadge = (n) => html`<span class="badge ${TONE[n.status]}">${statusLabel(n)}</span>`

function dueLine(n) {
  if (!n.response_due) return ''
  const open = OPEN.includes(n.status)
  const tone = !open ? 'text-slate-500' : n.days_left < 0 ? 'text-red-700 font-semibold' : n.days_left <= 7 ? 'text-amber-800 font-semibold' : 'text-slate-600'
  const what = n.direction === 'incoming' ? t('ntc.reply_by', { date: fmtDate(n.response_due) }) : t('ntc.period_ends', { date: fmtDate(n.response_due) })
  const left = !open ? '' : n.days_left < 0 ? ` · ${t('ntc.overdue', { n: -n.days_left })}` : ` · ${t('ntc.days_left', { n: n.days_left })}`
  return html`<span class="${tone}"><i class="fas fa-hourglass-half"></i> ${what}${left}</span>`
}

export async function caseNoticesCard(box, kase, { documents = [] } = {}) {
  if (!box) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  const docs = documents.map((d) => ({ id: d.id, title: d.title }))
  let items = []
  const draw = () => render(box, html`<section class="card">
    <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold"><i class="fas fa-envelope-open-text text-slate-400 me-1"></i> ${t('ntc.title')} <span class="text-slate-400 font-normal">(${items.length})</span></h2>
      ${editable ? html`<div class="flex gap-2">
        ${aiEnabled() ? html`<button class="btn btn-outline btn-sm" data-n="draft"><i class="fas fa-wand-magic-sparkles"></i>${t('ntc.draft')}</button>` : ''}
        <button class="btn btn-outline btn-sm" data-n="add"><i class="fas fa-plus"></i>${t('ntc.add')}</button></div>` : ''}
    </div>
    ${items.length ? html`<ul class="divide-y divide-slate-100">${items.map((n) => html`<li class="px-5 py-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="badge ${n.direction === 'incoming' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'}"><i class="fas ${n.direction === 'incoming' ? 'fa-arrow-down' : 'fa-arrow-up'}"></i> ${t(`ntc.d_${n.direction}`)}</span>
            ${statusBadge(n)}<span class="text-sm font-medium" dir="auto">${n.subject}</span></div>
          <div class="text-xs text-slate-500 mt-1">${n.direction === 'incoming' ? t('ntc.from') : t('ntc.to')} <span dir="auto">${n.party}</span> · ${t(`ntc.m_${n.method}`)}${n.reference_no ? html` · <bdi dir="ltr">${n.reference_no}</bdi>` : ''} · <bdi>${fmtDate(n.notice_date)}</bdi>
            ${n.delivered_on ? html` · ${t(n.direction === 'incoming' ? 'ntc.received_on' : 'ntc.delivered_on', { date: fmtDate(n.delivered_on) })}` : ''}
            ${n.amount != null ? html` · <b>${fmtMoney(n.amount, n.currency)}</b>` : ''}</div>
          <div class="text-xs mt-1 flex flex-wrap gap-x-3">${dueLine(n)}
            ${n.document_id ? html`<a class="text-brand-600 hover:underline" href="#/documents/${n.document_id}"><i class="fas fa-file-lines"></i> <span dir="auto">${n.document_title}</span></a>` : ''}</div>
          ${n.response_on ? html`<p class="text-xs text-emerald-800 mt-1"><i class="fas fa-reply"></i> <bdi>${t('ntc.response_on', { date: fmtDate(n.response_on) })}</bdi>${n.response_summary ? html` · <span dir="auto">${n.response_summary}</span>` : ''}</p>` : ''}
        </div>
        ${editable ? html`<div class="flex gap-1">
          ${OPEN.includes(n.status) ? html`<button class="btn btn-outline btn-sm" data-n="respond" data-id="${n.id}">${n.direction === 'incoming' ? t('ntc.mark_replied') : t('ntc.record_response')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-n="edit" data-id="${n.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger-ghost btn-sm" data-n="delete" data-id="${n.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button></div>` : ''}
      </div>
    </li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('ntc.none')}</p>`}
  </section>`)
  const load = async () => {
    try { items = (await api.get(`/api/notices/case/${kase.id}`)).items; if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-n]')
    if (!el) return
    const n = items.find((x) => x.id === el.dataset.id)
    const act = el.dataset.n
    if (act === 'add') openNoticeForm(kase, null, docs, load)
    if (act === 'edit') openNoticeForm(kase, n, docs, load)
    if (act === 'respond') openResponseForm(n, load)
    if (act === 'draft') {
      openDraftForm({
        caseId: kase.id, caseLabel: `${kase.reference} · ${kase.title}`, clientId: kase.client_id, jurisdiction: kase.jurisdiction, template: 'legal_notice',
        onSaved: (d) => { docs.unshift({ id: d.id, title: d.title }); openNoticeForm(kase, null, docs, load, { document_id: d.id, subject: d.title }) }
      })
    }
    if (act === 'delete' && (await confirmDialog(t('ntc.confirm_delete')))) {
      try { await api.del(`/api/notices/${n.id}`); toast(t('common.deleted')); load() } catch (err) { showError(err) }
    }
  }
  draw()
  await load()
}

function openNoticeForm(kase, n, docs, done, preset = {}) {
  const v = { direction: 'outgoing', method: 'notary', notice_date: today(), response_days: 15, ...preset, ...(n || {}) }
  const currencies = store.ref?.currencies ?? ['OMR']
  const m = modal({
    title: n ? t('ntc.edit') : t('ntc.add'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${n ? '' : readBar(docs)}
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'direction', label: t('ntc.direction'), options: ['outgoing', 'incoming'].map((d) => ({ value: d, label: t(`ntc.d_${d}`) })), value: v.direction })}
        ${inputField({ name: 'party', label: t('ntc.party'), value: v.party ?? kase.opposing_party ?? '', required: true, cls: 'sm:col-span-2', attrs: 'maxlength="300" dir="auto"', hint: t('ntc.party_hint') })}
      </div>
      ${inputField({ name: 'subject', label: t('ntc.subject'), value: v.subject ?? '', required: true, attrs: 'maxlength="500" dir="auto"', placeholder: t('ntc.subject_placeholder') })}
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'method', label: t('ntc.method'), options: METHODS.map((x) => ({ value: x, label: t(`ntc.m_${x}`) })), value: v.method })}
        ${inputField({ name: 'reference_no', label: t('ntc.reference_no'), value: v.reference_no ?? '', attrs: 'maxlength="100" dir="auto"' })}
        ${selectField({ name: 'document_id', label: t('ntc.document'), options: docs.map((d) => ({ value: d.id, label: d.title })), value: v.document_id ?? '', empty: t('ntc.no_document') })}
      </div>
      <fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('ntc.service')}</legend>
        <div class="grid sm:grid-cols-4 gap-4">
          ${inputField({ name: 'notice_date', label: t('ntc.notice_date'), type: 'date', value: v.notice_date, required: true })}
          ${inputField({ name: 'delivered_on', label: t('ntc.delivered'), type: 'date', value: v.delivered_on ?? '', hint: t('ntc.delivered_hint') })}
          ${inputField({ name: 'response_days', label: t('ntc.response_days'), type: 'number', value: v.response_days ?? '', attrs: 'min="1" max="365"' })}
          ${inputField({ name: 'response_due', label: t('ntc.response_due'), type: 'date', value: v.response_due ?? '', hint: t('ntc.due_hint') })}
        </div>
        <p class="hint mt-2">${t('ntc.period_warning')}</p></fieldset>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'amount', label: t('ntc.amount'), type: 'number', value: v.amount ?? '', attrs: 'min="0" step="0.001"' })}
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: v.currency ?? kase.currency })}
        ${n ? selectField({ name: 'status', label: t('common.status'), options: STATUSES.map((s) => ({ value: s, label: statusLabel({ ...n, status: s }) })), value: n.status }) : ''}
      </div>
      ${textareaField({ name: 'notes', label: t('ntc.notes'), value: v.notes ?? '', rows: 2 })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-floppy-disk"></i>${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        // A deadline typed in (or changed) wins over the number of days.
        const dueTyped = (b.response_due ?? '') !== (n?.response_due ?? '')
        if (dueTyped && b.response_due) b.response_days = ''
        else delete b.response_due
        for (const k of ['reference_no', 'document_id', 'delivered_on', 'notes', 'amount', 'response_days']) if (b[k] == null) b[k] = ''
        if (b.amount === '') delete b.currency
        if (n && !dueTyped && b.response_days === '' && n.response_due) b.response_due = n.response_due
        try {
          if (n) await api.patch(`/api/notices/${n.id}`, b)
          else await api.post(`/api/notices/case/${kase.id}`, b)
          m.close()
          toast(t('common.saved'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
  // The document read is also attached to the notice.
  if (!n) wireReadBar(m.el.querySelector('form'), `/api/notices/case/${kase.id}/read`, { onFields: () => { m.el.querySelector('[name=document_id]').value = m.el.querySelector('[data-read-doc]').value } })
}

function openResponseForm(n, done) {
  const incoming = n.direction === 'incoming'
  const m = modal({
    title: incoming ? t('ntc.mark_replied') : t('ntc.record_response'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-2 gap-4">
        ${selectField({ name: 'status', label: t('common.status'), value: 'responded',
          options: ['responded', ...(incoming ? ['closed'] : ['no_response', 'closed'])].map((s) => ({ value: s, label: statusLabel({ ...n, status: s }) })) })}
        ${inputField({ name: 'response_on', label: t('ntc.response_date'), type: 'date', value: today() })}
      </div>
      ${textareaField({ name: 'response_summary', label: incoming ? t('ntc.our_reply') : t('ntc.their_response'), rows: 3 })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-check"></i>${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        const b = formData(form)
        if (b.status !== 'responded') b.response_on = b.response_on && b.response_summary ? b.response_on : ''
        try { await api.patch(`/api/notices/${n.id}`, b); m.close(); toast(t('common.saved')); done() } catch (err) { showError(err, form) }
      })
    }
  })
}

// Firm-wide register of open notices by deadline.
export async function noticesRegisterView(root, { query, isCurrent }) {
  const state = { show: query.get('show') === 'all' ? 'all' : 'open', direction: query.get('direction') || 'all' }
  render(root, html`${pageHeader(t('ntc.register'), t('ntc.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const qs = () => `show=${state.show}&direction=${state.direction}`
  const load = async () => {
    const d = await api.get(`/api/notices/register?${qs()}`)
    if (!isCurrent()) return
    const tab = (key, v, label) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state[key] === v ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="filter" data-key="${key}" data-v="${v}">${label}</button>`
    render(root.querySelector('[data-reg]'), html`
      <div class="grid grid-cols-3 gap-4 mb-6">
        <div class="card card-pad"><div class="text-2xl font-bold">${d.counts.open}</div><div class="text-xs text-slate-500">${t('ntc.open')}</div></div>
        <div class="card card-pad"><div class="text-2xl font-bold ${d.counts.due_soon ? 'text-amber-700' : ''}">${d.counts.due_soon}</div><div class="text-xs text-slate-500">${t('ntc.due_soon')}</div></div>
        <div class="card card-pad"><div class="text-2xl font-bold ${d.counts.overdue ? 'text-red-700' : ''}">${d.counts.overdue}</div><div class="text-xs text-slate-500">${t('ntc.past_due')}</div></div>
      </div>
      <div class="flex flex-wrap gap-1 mb-3">${tab('show', 'open', t('ntc.show_open'))}${tab('show', 'all', t('ntc.show_all'))}
        <span class="w-3"></span>${tab('direction', 'all', t('ntc.both'))}${tab('direction', 'outgoing', t('ntc.d_outgoing'))}${tab('direction', 'incoming', t('ntc.d_incoming'))}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.reference')}</th><th>${t('ntc.subject')}</th><th>${t('ntc.party')}</th><th>${t('ntc.notice_date')}</th><th>${t('ntc.response_due')}</th><th>${t('common.status')}</th></tr></thead>
        <tbody>${d.items.map((n) => html`<tr class="clickable" data-action="open" data-id="${n.case_id}">
          <td class="font-mono text-xs">${n.reference}<div class="font-sans text-slate-500" dir="auto">${n.case_title}</div></td>
          <td><div class="text-sm font-medium" dir="auto">${n.subject}</div><div class="text-xs text-slate-500">${t(`ntc.d_${n.direction}`)} · ${t(`ntc.m_${n.method}`)}${n.amount != null ? ` · ${fmtMoney(n.amount, n.currency)}` : ''}</div></td>
          <td class="text-sm" dir="auto">${n.party}</td>
          <td class="text-sm whitespace-nowrap">${fmtDate(n.notice_date, { hijri: false })}</td>
          <td class="text-xs">${dueLine(n) || html`<span class="text-slate-400">—</span>`}</td>
          <td>${statusBadge(n)}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-envelope-open-text', state.show === 'open' ? t('ntc.nothing_open') : t('ntc.none'), '')}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/notices/register?${qs()}&format=csv`),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      filter: (el) => { state[el.dataset.key] = el.dataset.v; history.replaceState(null, '', `#/notices?${qs()}`); load().catch(showError) }
    }
  })
  await load()
}
