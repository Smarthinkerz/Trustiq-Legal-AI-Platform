import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { can, readOnly, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Court-appointed experts (الخبرة القضائية): fee deposit, submissions, report
// and objections deadlines on each referral, per matter and firm-wide.
// ---------------------------------------------------------------------------

const TYPES = ['accounting', 'engineering', 'medical', 'real_estate', 'it', 'other']
const PAYERS = ['client', 'other_party', 'shared', 'court']
const RESULTS = ['favourable', 'partly', 'unfavourable']
const STAGE_TONE = {
  appointed: 'bg-sky-100 text-sky-800', in_progress: 'bg-amber-100 text-amber-800', report_filed: 'bg-violet-100 text-violet-800',
  objections_filed: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-200 text-slate-600'
}
const RESULT_TONE = { favourable: 'text-emerald-700', partly: 'text-amber-700', unfavourable: 'text-red-700' }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const opts = (list, prefix) => list.map((v) => ({ value: v, label: t(`exp.${prefix}${v}`) }))

function nextLine(r) {
  const d = r.next_deadline
  if (!d) return ''
  const tone = d.days_left < 0 ? 'text-red-700 font-semibold' : d.days_left <= 7 ? 'text-amber-800 font-semibold' : 'text-slate-600'
  const left = d.days_left < 0 ? t('exp.overdue', { n: -d.days_left }) : d.days_left === 0 ? t('exp.today') : t('exp.days_left', { n: d.days_left })
  return html`<span class="${tone}"><i class="fas fa-hourglass-half"></i> <bdi>${t(`exp.dl_${d.key}`)}: ${fmtDate(d.date)}</bdi> · ${left}</span>`
}

// The four deadlines as a small timeline: done, open or not set.
function steps(r) {
  const items = [
    ['fee', r.fee_due, r.fee_paid_on], ['memo', r.memo_due, r.report_filed_on ? r.memo_due : null],
    ['report', r.report_due, r.report_filed_on], ['objection', r.objection_due, r.objections_filed_on]
  ]
  return html`<ol class="flex flex-wrap gap-2 text-xs mt-2">${items.map(([key, due, done]) => html`<li class="rounded-md border px-2 py-1 ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : due ? 'border-slate-200' : 'border-dashed border-slate-200 text-slate-400'}">
    <i class="fas ${done ? 'fa-circle-check' : due ? 'fa-circle' : 'fa-circle-minus'} me-1"></i>${t(`exp.dl_${key}`)}${due || done ? html` · <bdi>${fmtDate(done && key !== 'memo' ? done : due)}</bdi>` : ''}</li>`)}</ol>`
}

export async function caseExpertsCard(box, kase, { documents = [] } = {}) {
  if (!box) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  let items = []
  const draw = () => render(box, html`<section class="card">
    <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold"><i class="fas fa-user-tie text-slate-400 me-1"></i> ${t('exp.title')} <span class="text-slate-400 font-normal">(${items.length})</span></h2>
      ${editable ? html`<button class="btn btn-outline btn-sm" data-x="add"><i class="fas fa-plus"></i>${t('exp.add')}</button>` : ''}
    </div>
    ${items.length ? html`<ul class="divide-y divide-slate-100">${items.map((r) => html`<li class="px-5 py-3">
      <div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2"><span class="badge ${STAGE_TONE[r.stage]}">${t(`exp.st_${r.stage}`)}</span>
            <span class="text-sm font-medium" dir="auto">${r.expert_name || t('exp.unnamed')}</span><span class="text-xs text-slate-500">${t(`exp.t_${r.expert_type}`)}</span></div>
          <div class="text-xs text-slate-500 mt-1">${t('exp.referred', { date: fmtDate(r.referral_date) })}${r.court_ref ? html` · <bdi dir="ltr">${r.court_ref}</bdi>` : ''}
            ${r.fee_amount != null ? html` · ${t('exp.fee')} <b>${fmtMoney(r.fee_amount, r.currency)}</b> (${t(`exp.p_${r.fee_payer}`)})` : ''}</div>
          ${r.scope ? html`<p class="text-sm text-slate-700 mt-1 whitespace-pre-wrap" dir="auto">${r.scope}</p>` : ''}
          ${r.closed ? '' : steps(r)}
          <div class="text-xs mt-1">${nextLine(r)}</div>
          ${r.report_filed_on ? html`<p class="text-xs mt-1"><i class="fas fa-file-lines text-slate-400"></i> ${t('exp.report_on', { date: fmtDate(r.report_filed_on) })}
            ${r.report_result ? html` · <b class="${RESULT_TONE[r.report_result]}">${t(`exp.r_${r.report_result}`)}</b>` : ''}
            ${r.report_document_id ? html` · <a class="text-brand-600 hover:underline" href="#/documents/${r.report_document_id}" dir="auto">${r.report_document_title}</a>` : ''}
            ${r.report_summary ? html`<span class="block text-slate-600 mt-0.5" dir="auto">${r.report_summary}</span>` : ''}</p>` : ''}
        </div>
        ${editable ? html`<div class="flex flex-wrap gap-1 mt-2">
          ${!r.closed && !r.fee_paid_on && r.fee_due ? html`<button class="btn btn-outline btn-sm" data-x="fee-paid" data-id="${r.id}"><i class="fas fa-check"></i>${t('exp.mark_fee_paid')}</button>` : ''}
          ${!r.closed && !r.report_filed_on ? html`<button class="btn btn-outline btn-sm" data-x="report" data-id="${r.id}"><i class="fas fa-file-circle-check"></i>${t('exp.record_report')}</button>` : ''}
          ${!r.closed && r.report_filed_on && !r.objections_filed_on ? html`<button class="btn btn-outline btn-sm" data-x="objected" data-id="${r.id}"><i class="fas fa-check"></i>${t('exp.mark_objections')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-x="edit" data-id="${r.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger-ghost btn-sm" data-x="delete" data-id="${r.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button></div>` : ''}
      </div>
    </li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('exp.none')}</p>`}
  </section>`)
  const load = async () => {
    try { items = (await api.get(`/api/experts/case/${kase.id}`)).items; if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  const patch = async (r, body, msg) => {
    try { await api.patch(`/api/experts/${r.id}`, body); toast(msg); load() } catch (err) { showError(err) }
  }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-x]')
    if (!el) return
    const r = items.find((x) => x.id === el.dataset.id)
    const act = el.dataset.x
    if (act === 'add') openExpertForm(kase, null, documents, load)
    if (act === 'edit') openExpertForm(kase, r, documents, load)
    if (act === 'report') openReportForm(r, documents, load)
    if (act === 'fee-paid') busy(el, () => patch(r, { fee_paid_on: today() }, t('common.saved')))
    if (act === 'objected') busy(el, () => patch(r, { objections_filed_on: today() }, t('common.saved')))
    if (act === 'delete' && (await confirmDialog(t('exp.confirm_delete')))) {
      try { await api.del(`/api/experts/${r.id}`); toast(t('common.deleted')); load() } catch (err) { showError(err) }
    }
  }
  draw()
  await load()
}

const docOptions = (documents) => documents.map((d) => ({ value: d.id, label: d.title }))

function openExpertForm(kase, r, documents, done) {
  const v = { expert_type: 'accounting', fee_payer: 'client', referral_date: today(), ...(r || {}) }
  const currencies = store.ref?.currencies ?? ['OMR']
  const m = modal({
    title: r ? t('exp.edit') : t('exp.add'),
    size: 'xl',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'expert_name', label: t('exp.name'), value: v.expert_name ?? '', cls: 'sm:col-span-2', attrs: 'maxlength="300" dir="auto"', hint: t('exp.name_hint') })}
        ${selectField({ name: 'expert_type', label: t('exp.type'), options: opts(TYPES, 't_'), value: v.expert_type })}
        ${inputField({ name: 'referral_date', label: t('exp.referral_date'), type: 'date', value: v.referral_date, required: true })}
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'court_ref', label: t('exp.court_ref'), value: v.court_ref ?? '', attrs: 'maxlength="100" dir="auto"' })}
        ${inputField({ name: 'expert_contact', label: t('exp.contact'), value: v.expert_contact ?? '', attrs: 'maxlength="300" dir="auto"' })}
      </div>
      ${textareaField({ name: 'scope', label: t('exp.scope'), value: v.scope ?? '', rows: 2 })}
      <fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('exp.fee_section')}</legend>
        <div class="grid sm:grid-cols-5 gap-4">
          ${inputField({ name: 'fee_amount', label: t('exp.fee_amount'), type: 'number', value: v.fee_amount ?? '', attrs: 'min="0" step="0.001"' })}
          ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: v.currency ?? kase.currency })}
          ${selectField({ name: 'fee_payer', label: t('exp.payer'), options: opts(PAYERS, 'p_'), value: v.fee_payer })}
          ${inputField({ name: 'fee_due', label: t('exp.fee_due'), type: 'date', value: v.fee_due ?? '' })}
          ${inputField({ name: 'fee_paid_on', label: t('exp.fee_paid_on'), type: 'date', value: v.fee_paid_on ?? '' })}
        </div></fieldset>
      <fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('exp.deadlines')}</legend>
        <div class="grid sm:grid-cols-2 gap-4">
          ${inputField({ name: 'memo_due', label: t('exp.memo_due'), type: 'date', value: v.memo_due ?? '', hint: t('exp.memo_hint') })}
          ${inputField({ name: 'report_due', label: t('exp.report_due'), type: 'date', value: v.report_due ?? '' })}
        </div>
        <p class="hint mt-2">${t('exp.deadline_warning')}</p></fieldset>
      ${r ? html`<fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('exp.report')}</legend>${reportFields(v, documents)}
        <label class="flex items-center gap-2 text-sm mt-3"><input type="checkbox" name="closed" ${v.closed ? 'checked' : ''} /> ${t('exp.closed')}</label></fieldset>` : ''}
      ${textareaField({ name: 'notes', label: t('exp.notes'), value: v.notes ?? '', rows: 2 })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-floppy-disk"></i>${t('common.save')}</button></div>
    </form>`,
    forms: { save: (form) => submit(form, r, kase, m, done) }
  })
}

function reportFields(v, documents) {
  return html`<div class="grid sm:grid-cols-3 gap-4">
      ${inputField({ name: 'report_filed_on', label: t('exp.report_filed_on'), type: 'date', value: v.report_filed_on ?? '' })}
      ${selectField({ name: 'report_result', label: t('exp.result'), options: opts(RESULTS, 'r_'), value: v.report_result ?? '', empty: '—' })}
      ${selectField({ name: 'report_document_id', label: t('exp.report_document'), options: docOptions(documents), value: v.report_document_id ?? '', empty: t('exp.no_document') })}
    </div>
    ${textareaField({ name: 'report_summary', label: t('exp.report_summary'), value: v.report_summary ?? '', rows: 2 })}
    <div class="grid sm:grid-cols-3 gap-4">
      ${inputField({ name: 'objection_days', label: t('exp.objection_days'), type: 'number', value: v.objection_days ?? '', attrs: 'min="1" max="365"' })}
      ${inputField({ name: 'objection_due', label: t('exp.objection_due'), type: 'date', value: v.objection_due ?? '', hint: t('exp.objection_hint') })}
      ${inputField({ name: 'objections_filed_on', label: t('exp.objections_filed_on'), type: 'date', value: v.objections_filed_on ?? '' })}
    </div>`
}

async function submit(form, r, kase, m, done) {
  return busy(submitButton(form), async () => {
    clearFieldErrors(form)
    const b = formData(form)
    if (form.elements.closed) b.closed = form.elements.closed.checked
    // A deadline typed in (or changed) wins over the number of days.
    if ('objection_due' in b) {
      const typed = (b.objection_due ?? '') !== (r?.objection_due ?? '')
      if (typed && b.objection_due) b.objection_days = ''
      else if (b.objection_days) delete b.objection_due
    }
    for (const [k, val] of Object.entries(b)) if (val == null) b[k] = ''
    if (b.fee_amount === '') delete b.currency
    try {
      if (r) await api.patch(`/api/experts/${r.id}`, b)
      else await api.post(`/api/experts/case/${kase.id}`, b)
      m.close()
      toast(t('common.saved'))
      done()
    } catch (err) { showError(err, form) }
  })
}

function openReportForm(r, documents, done) {
  const m = modal({
    title: t('exp.record_report'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${reportFields({ ...r, report_filed_on: r.report_filed_on ?? today() }, documents)}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-floppy-disk"></i>${t('common.save')}</button></div>
    </form>`,
    forms: { save: (form) => submit(form, r, null, m, done) }
  })
}

// Firm-wide register.
export async function expertsRegisterView(root, { query, isCurrent }) {
  const state = { show: query.get('show') === 'all' ? 'all' : 'open' }
  render(root, html`${pageHeader(t('exp.register'), t('exp.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/experts/register?show=${state.show}`)
    if (!isCurrent()) return
    const stat = (n, label, tone) => html`<div class="card card-pad"><div class="text-2xl font-bold ${n ? tone : ''}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`
    render(root.querySelector('[data-reg]'), html`
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        ${stat(d.counts.open, t('exp.open'), '')}${stat(d.counts.awaiting_report, t('exp.awaiting_report'), 'text-violet-700')}
        ${stat(d.counts.due_soon, t('exp.due_soon'), 'text-amber-700')}${stat(d.counts.overdue, t('exp.past_due'), 'text-red-700')}
      </div>
      <div class="flex gap-1 mb-3">${['open', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`exp.show_${s}`)}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.reference')}</th><th>${t('exp.expert')}</th><th>${t('exp.referral_date')}</th><th>${t('exp.stage')}</th><th>${t('exp.next')}</th></tr></thead>
        <tbody>${d.items.map((r) => html`<tr class="clickable" data-action="open" data-id="${r.case_id}">
          <td class="font-mono text-xs">${r.reference}<div class="font-sans text-slate-500" dir="auto">${r.case_title}</div></td>
          <td><div class="text-sm font-medium" dir="auto">${r.expert_name || t('exp.unnamed')}</div><div class="text-xs text-slate-500">${t(`exp.t_${r.expert_type}`)}${r.court_ref ? html` · <bdi dir="ltr">${r.court_ref}</bdi>` : ''}</div></td>
          <td class="text-sm whitespace-nowrap">${fmtDate(r.referral_date, { hijri: false })}</td>
          <td><span class="badge ${STAGE_TONE[r.stage]}">${t(`exp.st_${r.stage}`)}</span></td>
          <td class="text-xs">${nextLine(r) || html`<span class="text-slate-400">—</span>`}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-user-tie', state.show === 'open' ? t('exp.nothing_open') : t('exp.none'), '')}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/experts/register?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/experts${state.show === 'all' ? '?show=all' : ''}`); load().catch(showError) }
    }
  })
  await load()
}
