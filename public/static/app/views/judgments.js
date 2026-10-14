import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { can, readOnly, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Judgments and enforcement (الأحكام والتنفيذ): a card on the matter and a
// firm-wide register of appeal deadlines and amounts still to collect.
// ---------------------------------------------------------------------------

const DEGREES = ['first_instance', 'appeal', 'supreme', 'arbitration', 'other']
const RESULTS = ['won', 'partial', 'lost', 'other']
const APPEAL = ['pending', 'appeal', 'no_appeal', 'appealed_by_other']
const ENFORCEMENT = ['not_started', 'filed', 'in_progress', 'collected', 'unenforceable', 'closed']
const RESULT_TONE = { won: 'bg-emerald-100 text-emerald-800', partial: 'bg-sky-100 text-sky-800', lost: 'bg-red-100 text-red-700', other: 'bg-slate-100 text-slate-700' }
const ENF_TONE = { not_started: 'bg-slate-100 text-slate-700', filed: 'bg-sky-100 text-sky-800', in_progress: 'bg-amber-100 text-amber-800', collected: 'bg-emerald-100 text-emerald-800', unenforceable: 'bg-red-100 text-red-700', closed: 'bg-slate-200 text-slate-600' }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const opts = (list, prefix) => list.map((v) => ({ value: v, label: t(`${prefix}${v}`) }))

function appealLine(j) {
  if (!j.appeal_deadline) return ''
  const closed = j.appeal_decision === 'no_appeal' || j.appeal_decision === 'appealed_by_other'
  const late = j.appeal_days_left < 0
  const tone = closed ? 'text-slate-500' : late ? 'text-slate-500' : j.appeal_days_left <= 7 ? 'text-red-700 font-semibold' : 'text-amber-800'
  return html`<div class="text-xs ${tone}"><i class="fas fa-hourglass-half"></i> ${t('jdg.appeal_by', { date: fmtDate(j.appeal_deadline) })}
    ${!closed && !late ? html` · ${t('jdg.days_left', { n: j.appeal_days_left })}` : ''} · ${t(`jdg.ap_${j.appeal_decision}`)}</div>`
}

export async function caseJudgmentsCard(box, kase, { onChange } = {}) {
  if (!box) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  let items = []
  const draw = () => render(box, html`<section class="card">
    <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold"><i class="fas fa-scale-balanced text-slate-400 me-1"></i> ${t('jdg.title')} <span class="text-slate-400 font-normal">(${items.length})</span></h2>
      ${editable ? html`<button class="btn btn-outline btn-sm" data-j="add"><i class="fas fa-plus"></i>${t('jdg.add')}</button>` : ''}
    </div>
    ${items.length ? html`<ul class="divide-y divide-slate-100">${items.map((j) => html`<li class="px-5 py-4 space-y-2">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2"><span class="badge ${RESULT_TONE[j.result]}">${t(`jdg.r_${j.result}`)}</span>
            <span class="text-sm font-medium">${t(`jdg.d_${j.degree}`)}</span><span class="text-xs text-slate-500">${fmtDate(j.judgment_date)}${j.judgment_no ? ` · ${t('jdg.no')} ${j.judgment_no}` : ''}${j.court ? ` · ${j.court}` : ''}</span></div>
          ${j.summary ? html`<p class="text-sm text-slate-700 mt-1 whitespace-pre-wrap" dir="auto">${j.summary}</p>` : ''}
          ${appealLine(j)}
        </div>
        ${editable ? html`<div class="flex gap-1"><button class="btn btn-ghost btn-sm" data-j="edit" data-id="${j.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger-ghost btn-sm" data-j="delete" data-id="${j.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button></div>` : ''}
      </div>
      ${j.result === 'won' || j.result === 'partial' ? html`<div class="rounded-lg bg-slate-50 p-3 text-sm">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span>${t('jdg.awarded')}: <b>${fmtMoney(j.amount_awarded + j.costs_awarded, j.currency)}</b>${j.costs_awarded ? html` <span class="text-xs text-slate-500">(${t('jdg.incl_costs', { amount: fmtMoney(j.costs_awarded, j.currency) })})</span>` : ''}</span>
          <span>${t('jdg.collected')}: <b class="text-emerald-700">${fmtMoney(j.collected, j.currency)}</b></span>
          <span>${t('jdg.outstanding')}: <b class="${j.outstanding ? 'text-red-700' : ''}">${fmtMoney(j.outstanding, j.currency)}</b></span>
          <span class="badge ${ENF_TONE[j.enforcement_status]}">${t(`jdg.e_${j.enforcement_status}`)}</span>
          ${j.enforcement_file_no ? html`<span class="text-xs text-slate-500">${t('jdg.file')} ${j.enforcement_file_no}${j.enforcement_court ? ` · ${j.enforcement_court}` : ''}</span>` : ''}
        </div>
        ${j.collections.length ? html`<ul class="mt-2 text-xs text-slate-600 space-y-0.5">${j.collections.map((x) => html`<li class="flex items-center gap-2">
          <i class="fas fa-circle-check text-emerald-600"></i>${fmtDate(x.collected_on)} · ${fmtMoney(x.amount, j.currency)}${x.source ? ` · ${x.source}` : ''}
          ${editable ? html`<button class="text-red-600 hover:underline ms-auto" data-j="undo" data-id="${x.id}">${t('jdg.remove')}</button>` : ''}</li>`)}</ul>` : ''}
        ${editable && j.outstanding > 0 ? html`<button class="btn btn-primary btn-sm mt-2" data-j="collect" data-id="${j.id}"><i class="fas fa-hand-holding-dollar"></i>${t('jdg.record_collection')}</button>` : ''}
      </div>` : ''}
    </li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('jdg.none')}</p>`}
  </section>`)
  const load = async () => {
    try { items = (await api.get(`/api/judgments/case/${kase.id}`)).items; if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  const reload = () => { load(); onChange?.() }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-j]')
    if (!el) return
    const j = items.find((x) => x.id === el.dataset.id)
    const act = el.dataset.j
    if (act === 'add') openJudgmentForm(kase, null, load)
    if (act === 'edit') openJudgmentForm(kase, j, load)
    if (act === 'collect') openCollectionForm(j, load)
    if (act === 'delete' && (await confirmDialog(t('jdg.confirm_delete')))) {
      try { await api.del(`/api/judgments/${j.id}`); toast(t('common.deleted')); reload() } catch (err) { showError(err) }
    }
    if (act === 'undo' && (await confirmDialog(t('jdg.confirm_undo')))) {
      try { await api.del(`/api/judgments/collections/${el.dataset.id}`); load() } catch (err) { showError(err) }
    }
  }
  draw()
  await load()
}

function openJudgmentForm(kase, j, done) {
  const currencies = store.ref?.currencies ?? ['OMR']
  const m = modal({
    title: j ? t('jdg.edit') : t('jdg.add'),
    size: 'xl',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'judgment_date', label: t('jdg.date'), type: 'date', value: j?.judgment_date ?? today(), required: true })}
        ${selectField({ name: 'degree', label: t('jdg.degree'), options: opts(DEGREES, 'jdg.d_'), value: j?.degree ?? 'first_instance' })}
        ${selectField({ name: 'result', label: t('jdg.result'), options: opts(RESULTS, 'jdg.r_'), value: j?.result ?? 'won' })}
        ${inputField({ name: 'judgment_no', label: t('jdg.number'), value: j?.judgment_no, attrs: 'maxlength="100" dir="auto"' })}
      </div>
      ${inputField({ name: 'court', label: t('cases.court'), value: j ? j.court : kase.court, attrs: 'maxlength="300" dir="auto"' })}
      ${textareaField({ name: 'summary', label: t('jdg.summary'), value: j?.summary, rows: 2 })}
      <fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('jdg.amounts')}</legend>
        <div class="grid sm:grid-cols-3 gap-4">
          ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: j?.currency ?? kase.currency })}
          ${inputField({ name: 'amount_awarded', label: t('jdg.amount'), type: 'number', value: j?.amount_awarded ?? 0, attrs: 'min="0" step="0.001"' })}
          ${inputField({ name: 'costs_awarded', label: t('jdg.costs'), type: 'number', value: j?.costs_awarded ?? 0, attrs: 'min="0" step="0.001"' })}
        </div></fieldset>
      <fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('jdg.appeal')}</legend>
        <div class="grid sm:grid-cols-3 gap-4">
          ${j ? '' : inputField({ name: 'appeal_days', label: t('jdg.appeal_days'), type: 'number', value: '30', hint: t('jdg.appeal_days_hint'), attrs: 'min="1" max="365"' })}
          ${inputField({ name: 'appeal_deadline', label: t('jdg.appeal_deadline'), type: 'date', value: j?.appeal_deadline ?? '', hint: j ? '' : t('jdg.appeal_date_hint') })}
          ${selectField({ name: 'appeal_decision', label: t('jdg.appeal_decision'), options: opts(APPEAL, 'jdg.ap_'), value: j?.appeal_decision ?? 'pending' })}
        </div>
        <p class="hint mt-2">${t('jdg.appeal_warning')}</p></fieldset>
      <fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('jdg.enforcement')}</legend>
        <div class="grid sm:grid-cols-3 gap-4">
          ${selectField({ name: 'enforcement_status', label: t('common.status'), options: opts(ENFORCEMENT, 'jdg.e_'), value: j?.enforcement_status ?? 'not_started' })}
          ${inputField({ name: 'enforcement_file_no', label: t('jdg.file_no'), value: j?.enforcement_file_no, attrs: 'maxlength="100" dir="auto"' })}
          ${inputField({ name: 'enforcement_court', label: t('jdg.enforcement_court'), value: j?.enforcement_court, attrs: 'maxlength="300" dir="auto"' })}
        </div></fieldset>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('common.save')}</button>
      </div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        // A date typed in wins over the number of days.
        if (b.appeal_deadline) delete b.appeal_days
        for (const k of ['court', 'summary', 'judgment_no', 'enforcement_file_no', 'enforcement_court', 'appeal_deadline']) if (j && b[k] == null) b[k] = ''
        try {
          if (j) await api.patch(`/api/judgments/${j.id}`, b)
          else await api.post(`/api/judgments/case/${kase.id}`, b)
          m.close()
          toast(j ? t('common.saved') : t('jdg.saved_new'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function openCollectionForm(j, done) {
  const m = modal({
    title: t('jdg.record_collection'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm text-slate-600">${t('jdg.outstanding')}: <b>${fmtMoney(j.outstanding, j.currency)}</b></p>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'collected_on', label: t('jdg.collected_on'), type: 'date', value: today(), required: true })}
        ${inputField({ name: 'amount', label: `${t('jdg.amount_collected')} (${j.currency})`, type: 'number', value: String(j.outstanding), required: true, attrs: 'min="0.001" step="0.001"' })}
      </div>
      ${inputField({ name: 'source', label: t('jdg.source'), placeholder: t('jdg.source_placeholder'), attrs: 'maxlength="200" dir="auto"' })}
      ${inputField({ name: 'note', label: t('jdg.note'), attrs: 'maxlength="1000" dir="auto"' })}
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('common.save')}</button>
      </div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        try {
          const r = await api.post(`/api/judgments/${j.id}/collections`, formData(form))
          m.close()
          toast(r.judgment.outstanding ? t('common.saved') : t('jdg.fully_collected'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function judgmentsRegisterView(root, { query, isCurrent }) {
  const state = { show: query.get('show') === 'all' ? 'all' : 'open' }
  render(root, html`${pageHeader(t('jdg.register'), t('jdg.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/judgments/register?show=${state.show}`)
    if (!isCurrent()) return
    const totals = Object.entries(d.totals)
    render(root.querySelector('[data-reg]'), html`
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        ${totals.length ? totals.map(([cur, x]) => html`<div class="card card-pad">
          <div class="text-xs text-slate-500 mb-1">${cur}</div>
          <div class="text-2xl font-bold ${x.outstanding ? 'text-red-700' : 'text-emerald-700'}">${fmtMoney(x.outstanding, cur)}</div>
          <div class="text-xs text-slate-500">${t('jdg.outstanding')} · ${t('jdg.collected')} ${fmtMoney(x.collected, cur)} / ${fmtMoney(x.awarded, cur)}</div></div>`)
          : html`<div class="card card-pad text-sm text-slate-500">${t('jdg.no_awards')}</div>`}
        <div class="card card-pad"><div class="text-2xl font-bold ${d.appeals_due ? 'text-amber-700' : ''}">${d.appeals_due}</div><div class="text-xs text-slate-500">${t('jdg.appeals_due')}</div></div>
      </div>
      <div class="flex gap-1 mb-3">${['open', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`jdg.show_${s}`)}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.reference')}</th><th>${t('onb.matter')}</th><th>${t('jdg.judgment')}</th><th>${t('jdg.appeal')}</th><th class="text-end">${t('jdg.outstanding')}</th><th>${t('jdg.enforcement')}</th></tr></thead>
        <tbody>${d.items.map((j) => html`<tr class="clickable" data-action="open" data-id="${j.case_id}">
          <td class="font-mono text-xs">${j.reference}</td>
          <td><div class="font-medium" dir="auto">${j.case_title}</div><div class="text-xs text-slate-500" dir="auto">${j.client_name || ''}${j.opposing_party ? ` ${t('roll.versus')} ${j.opposing_party}` : ''}</div></td>
          <td class="text-xs"><span class="badge ${RESULT_TONE[j.result]}">${t(`jdg.r_${j.result}`)}</span><div class="mt-1">${t(`jdg.d_${j.degree}`)} · ${fmtDate(j.judgment_date, { hijri: false })}</div></td>
          <td>${appealLine(j) || html`<span class="text-slate-400">—</span>`}</td>
          <td class="text-end whitespace-nowrap font-semibold ${j.outstanding ? 'text-red-700' : 'text-slate-400'}">${fmtMoney(j.outstanding, j.currency)}</td>
          <td class="text-xs"><span class="badge ${ENF_TONE[j.enforcement_status]}">${t(`jdg.e_${j.enforcement_status}`)}</span>${j.enforcement_file_no ? html`<div class="mt-1 text-slate-500">${j.enforcement_file_no}</div>` : ''}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-scale-balanced', state.show === 'open' ? t('jdg.nothing_open') : t('jdg.none'), '')}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/judgments/register?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/judgments${state.show === 'all' ? '?show=all' : ''}`); load().catch(showError) }
    }
  })
  await load()
}

