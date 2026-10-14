import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { aiEnabled, can, readOnly, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Arbitration (التحكيم): institution, seat and tribunal for a matter, and its
// procedural timetable on the calendar, read from a procedural order by AI.
// ---------------------------------------------------------------------------

const INSTITUTIONS = ['ocac', 'diac', 'arbitratead', 'scca', 'qicca', 'bcdr', 'kcac', 'gcc_cac', 'icc', 'lcia', 'ad_hoc', 'other']
const ROLES = ['sole', 'chair', 'co_arbitrator', 'secretary', 'expert']
const NOMINATORS = ['us', 'them', 'institution', 'co_arbitrators', 'agreed']
const KINDS = ['submission', 'document_production', 'hearing', 'deposit', 'order', 'award', 'other']
const PARTIES = ['us', 'them', 'both', 'tribunal']
const RESULTS = ['won', 'partly', 'lost', 'settled', 'withdrawn']
const KIND_ICON = { submission: 'fa-file-pen', document_production: 'fa-folder-open', hearing: 'fa-gavel', deposit: 'fa-coins', order: 'fa-scroll', award: 'fa-award', other: 'fa-circle-dot' }
const PARTY_TONE = { us: 'bg-brand-100 text-brand-800', them: 'bg-slate-100 text-slate-600', both: 'bg-violet-100 text-violet-800', tribunal: 'bg-amber-100 text-amber-800' }
const STAGE_TONE = { commenced: 'bg-sky-100 text-sky-800', constituted: 'bg-violet-100 text-violet-800', awarded: 'bg-emerald-100 text-emerald-800', ended: 'bg-slate-200 text-slate-600' }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const opts = (list, prefix) => list.map((v) => ({ value: v, label: t(`arb.${prefix}${v}`) }))

const dueBadge = (s) => s.done_on ? html`<span class="badge bg-emerald-100 text-emerald-800"><i class="fas fa-check"></i> ${fmtDate(s.done_on, { hijri: false })}</span>`
  : s.days_left < 0 ? html`<span class="badge bg-red-100 text-red-700">${t('arb.overdue', { n: -s.days_left })}</span>`
    : s.days_left === 0 ? html`<span class="badge bg-amber-100 text-amber-800">${t('arb.today')}</span>`
      : html`<span class="badge ${s.days_left <= 7 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">${t('arb.days_left', { n: s.days_left })}</span>`

export async function caseArbitrationCard(box, kase, { documents = [] } = {}) {
  if (!box) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  let d = null
  const draw = () => {
    if (!d) return
    const a = d.arbitration
    if (!a) {
      // Offered on arbitration matters only, to keep other matters uncluttered.
      if (kase.practice_area !== 'arbitration' || !editable) return render(box, '')
      return render(box, html`<section class="card card-pad flex flex-wrap items-center gap-3">
        <i class="fas fa-scale-unbalanced-flip text-slate-400 text-xl"></i>
        <div class="flex-1 min-w-0"><div class="font-semibold">${t('arb.title')}</div><div class="text-xs text-slate-500">${t('arb.start_help')}</div></div>
        <button class="btn btn-primary btn-sm" data-a="details"><i class="fas fa-plus"></i>${t('arb.start')}</button></section>`)
    }
    const fact = (label, value) => value ? html`<div><dt class="text-xs text-slate-500">${label}</dt><dd class="text-sm" dir="auto">${value}</dd></div>` : ''
    const open = d.steps.filter((s) => !s.done_on)
    const done = d.steps.filter((s) => s.done_on)
    const stepRow = (s) => html`<li class="py-2 flex flex-wrap items-center gap-2 text-sm ${s.done_on ? 'opacity-70' : ''}">
      <i class="fas ${KIND_ICON[s.kind]} text-slate-400 w-4 text-center"></i>
      <span class="w-28 shrink-0 text-xs">${fmtDate(s.due_on, { hijri: false })}</span>
      <span class="flex-1 min-w-0" dir="auto">${s.title}${s.amount != null ? html` · <b>${fmtMoney(s.amount, s.currency)}</b>` : ''}${s.source === 'ai' ? html` <i class="fas fa-wand-magic-sparkles text-violet-400 text-xs" title="${t('arb.from_ai')}"></i>` : ''}</span>
      <span class="badge ${PARTY_TONE[s.party]}">${t(`arb.p_${s.party}`)}</span>
      ${dueBadge(s)}
      ${editable ? html`<span class="flex gap-1">${s.done_on ? '' : html`<button class="btn btn-ghost btn-sm" data-a="step-done" data-id="${s.id}" aria-label="${t('arb.mark_done')}" title="${t('arb.mark_done')}"><i class="fas fa-check"></i></button>`}
        <button class="btn btn-ghost btn-sm" data-a="step-edit" data-id="${s.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button></span>` : ''}</li>`
    render(box, html`<section class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold flex items-center gap-2"><i class="fas fa-scale-unbalanced-flip text-slate-400"></i> ${t('arb.title')} <span class="badge ${STAGE_TONE[a.stage]}">${t(`arb.st_${a.stage}`)}</span></h2>
        ${editable ? html`<button class="btn btn-outline btn-sm" data-a="details"><i class="fas fa-pen"></i>${t('arb.edit')}</button>` : ''}
      </div>
      <div class="p-5 space-y-5">
        <dl class="grid sm:grid-cols-3 gap-3">
          ${fact(t('arb.institution'), t(`arb.i_${a.institution}`))}
          ${fact(t('arb.institution_ref'), a.institution_ref ? html`<bdi dir="ltr">${a.institution_ref}</bdi>` : '')}
          ${fact(t('arb.our_side'), t(`arb.side_${a.our_side}`))}
          ${fact(t('arb.seat'), a.seat)}${fact(t('arb.language'), a.language)}${fact(t('arb.rules'), a.rules)}
          ${fact(t('arb.amount_claimed'), a.amount_claimed != null ? fmtMoney(a.amount_claimed, a.currency) : '')}
          ${fact(t('arb.counterclaim'), a.counterclaim != null ? fmtMoney(a.counterclaim, a.currency) : '')}
          ${fact(t('arb.governing_law'), a.governing_law)}
          ${fact(t('arb.commenced_on'), a.commenced_on ? fmtDate(a.commenced_on) : '')}
          ${fact(t('arb.constituted_on'), a.constituted_on ? fmtDate(a.constituted_on) : '')}
          ${fact(t('arb.award'), a.award_result ? html`<b>${t(`arb.r_${a.award_result}`)}</b>${a.award_on ? ` · ${fmtDate(a.award_on)}` : ''}` : '')}
        </dl>
        ${d.next_step ? html`<div class="rounded-lg ${d.next_step.days_left < 0 ? 'bg-red-50 text-red-800' : 'bg-sky-50 text-sky-900'} p-3 text-sm">
          <i class="fas fa-hourglass-half"></i> ${t('arb.next')} <bdi dir="auto" class="font-medium">${d.next_step.title}</bdi> · <bdi>${fmtDate(d.next_step.due_on)}</bdi> · ${dueBadge(d.next_step)}</div>` : ''}
        <div><div class="flex items-center justify-between"><h3 class="font-semibold text-sm">${t('arb.tribunal')} <span class="text-slate-400 font-normal">(${d.members.length})</span></h3>
          ${editable ? html`<button class="btn btn-ghost btn-sm" data-a="member-add"><i class="fas fa-plus"></i>${t('arb.add_member')}</button>` : ''}</div>
          ${d.members.length ? html`<ul class="divide-y divide-slate-100">${d.members.map((m) => html`<li class="py-2 flex flex-wrap items-center gap-2 text-sm">
            <span class="font-medium" dir="auto">${m.name}</span><span class="text-xs text-slate-500">${t(`arb.m_${m.role}`)}${m.nominated_by ? ` · ${t('arb.nominated', { by: t(`arb.n_${m.nominated_by}`) })}` : ''}${m.appointed_on ? ` · ${fmtDate(m.appointed_on, { hijri: false })}` : ''}</span>
            ${m.contact ? html`<span class="text-xs text-slate-500" dir="auto">${m.contact}</span>` : ''}
            <span class="flex-1"></span>${editable ? html`<button class="btn btn-ghost btn-sm" data-a="member-edit" data-id="${m.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>` : ''}</li>`)}</ul>`
            : html`<p class="text-xs text-slate-500 py-2">${t('arb.no_tribunal')}</p>`}</div>
        <div><div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold text-sm">${t('arb.timetable')} <span class="text-slate-400 font-normal">(${open.length})</span></h3>
          ${editable ? html`<div class="flex gap-1">${aiEnabled() ? html`<button class="btn btn-outline btn-sm" data-a="read"><i class="fas fa-wand-magic-sparkles"></i>${t('arb.read_order')}</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-a="step-add"><i class="fas fa-plus"></i>${t('arb.add_step')}</button></div>` : ''}</div>
          ${open.length ? html`<ul class="divide-y divide-slate-100">${open.map(stepRow)}</ul>` : html`<p class="text-xs text-slate-500 py-2">${t('arb.no_steps')}</p>`}
          ${done.length ? html`<details class="mt-1"><summary class="cursor-pointer text-xs text-slate-500">${t('arb.done_steps', { n: done.length })}</summary><ul class="divide-y divide-slate-100">${done.map(stepRow)}</ul></details>` : ''}
        </div>
      </div>
    </section>`)
  }
  const load = async () => {
    try { d = await api.get(`/api/arbitration/case/${kase.id}`); if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-a]')
    if (!el) return
    const act = el.dataset.a
    const step = d.steps.find((s) => s.id === el.dataset.id)
    if (act === 'details') detailsForm(kase, d.arbitration, load)
    if (act === 'member-add') memberForm(kase, null, load)
    if (act === 'member-edit') memberForm(kase, d.members.find((m) => m.id === el.dataset.id), load)
    if (act === 'step-add') stepForm(kase, null, load)
    if (act === 'step-edit') stepForm(kase, step, load)
    if (act === 'read') readOrder(kase, documents, load)
    if (act === 'step-done') {
      try { await api.patch(`/api/arbitration/steps/${step.id}`, { done_on: today() }); toast(t('arb.step_done')); load() } catch (err) { showError(err) }
    }
  }
  await load()
}

function detailsForm(kase, a, done) {
  const currencies = store.ref?.currencies ?? ['OMR']
  const m = modal({
    title: t('arb.details'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'institution', label: t('arb.institution'), options: opts(INSTITUTIONS, 'i_'), value: a?.institution ?? 'ocac' })}
        ${inputField({ name: 'institution_ref', label: t('arb.institution_ref'), value: a?.institution_ref ?? '', attrs: 'maxlength="100" dir="ltr"' })}
        ${selectField({ name: 'our_side', label: t('arb.our_side'), options: [{ value: 'claimant', label: t('arb.side_claimant') }, { value: 'respondent', label: t('arb.side_respondent') }], value: a?.our_side ?? 'claimant' })}
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'seat', label: t('arb.seat'), value: a?.seat ?? '', attrs: 'maxlength="200" dir="auto"', placeholder: t('arb.seat_placeholder') })}
        ${inputField({ name: 'language', label: t('arb.language'), value: a?.language ?? '', attrs: 'maxlength="100" dir="auto"' })}
        ${inputField({ name: 'rules', label: t('arb.rules'), value: a?.rules ?? '', attrs: 'maxlength="300" dir="auto"', placeholder: t('arb.rules_placeholder') })}
      </div>
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'amount_claimed', label: t('arb.amount_claimed'), type: 'number', value: a?.amount_claimed ?? '', attrs: 'min="0" step="0.001"' })}
        ${inputField({ name: 'counterclaim', label: t('arb.counterclaim'), type: 'number', value: a?.counterclaim ?? '', attrs: 'min="0" step="0.001"' })}
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: a?.currency ?? kase.currency })}
        ${inputField({ name: 'governing_law', label: t('arb.governing_law'), value: a?.governing_law ?? '', attrs: 'maxlength="200" dir="auto"' })}
      </div>
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'commenced_on', label: t('arb.commenced_on'), type: 'date', value: a?.commenced_on ?? '' })}
        ${inputField({ name: 'constituted_on', label: t('arb.constituted_on'), type: 'date', value: a?.constituted_on ?? '' })}
        ${inputField({ name: 'award_on', label: t('arb.award_on'), type: 'date', value: a?.award_on ?? '' })}
        ${selectField({ name: 'award_result', label: t('arb.result'), options: opts(RESULTS, 'r_'), value: a?.award_result ?? '', empty: t('arb.pending') })}
      </div>
      ${textareaField({ name: 'notes', label: t('clients.notes'), value: a?.notes ?? '', rows: 2 })}
      <div class="flex flex-wrap justify-between gap-2">
        <div>${a ? html`<button type="button" class="btn btn-danger-ghost" data-action="remove">${t('common.delete')}</button>` : ''}</div>
        <div class="flex gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
      </div>
    </form>`,
    actions: {
      remove: async () => {
        if (!(await confirmDialog(t('arb.delete_confirm')))) return
        try { await api.del(`/api/arbitration/case/${kase.id}`); m.close(); done() } catch (err) { showError(err) }
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        try { await api.put(`/api/arbitration/case/${kase.id}`, formData(form)); m.close(); toast(t('common.saved')); done() } catch (err) { showError(err, form) }
      })
    }
  })
}

function memberForm(kase, x, done) {
  const m = modal({
    title: x ? t('arb.edit_member') : t('arb.add_member'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${inputField({ name: 'name', label: t('corp.name'), value: x?.name ?? '', required: true, attrs: 'maxlength="300" dir="auto"' })}
      <div class="grid sm:grid-cols-2 gap-4">
        ${selectField({ name: 'role', label: t('arb.role'), options: opts(ROLES, 'm_'), value: x?.role ?? 'co_arbitrator' })}
        ${selectField({ name: 'nominated_by', label: t('arb.nominated_by'), options: opts(NOMINATORS, 'n_'), value: x?.nominated_by ?? '', empty: '' })}
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'appointed_on', label: t('arb.appointed_on'), type: 'date', value: x?.appointed_on ?? '' })}
        ${inputField({ name: 'contact', label: t('arb.contact'), value: x?.contact ?? '', attrs: 'maxlength="300" dir="auto"' })}
      </div>
      <div class="flex flex-wrap justify-between gap-2">
        <div>${x ? html`<button type="button" class="btn btn-danger-ghost" data-action="remove">${t('common.delete')}</button>` : ''}</div>
        <div class="flex gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
      </div>
    </form>`,
    actions: {
      remove: async () => {
        if (!(await confirmDialog(t('arb.delete_member')))) return
        try { await api.del(`/api/arbitration/members/${x.id}`); m.close(); done() } catch (err) { showError(err) }
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        try {
          if (x) await api.patch(`/api/arbitration/members/${x.id}`, b)
          else await api.post(`/api/arbitration/case/${kase.id}/members`, b)
          m.close(); toast(t('common.saved')); done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function stepForm(kase, s, done) {
  const currencies = store.ref?.currencies ?? ['OMR']
  const m = modal({
    title: s ? t('arb.edit_step') : t('arb.add_step'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${inputField({ name: 'title', label: t('arb.step_title'), value: s?.title ?? '', required: true, attrs: 'maxlength="300" dir="auto"', placeholder: t('arb.step_placeholder') })}
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'kind', label: t('arb.kind'), options: opts(KINDS, 'k_'), value: s?.kind ?? 'submission' })}
        ${selectField({ name: 'party', label: t('arb.party'), options: opts(PARTIES, 'p_'), value: s?.party ?? 'us' })}
        ${inputField({ name: 'due_on', label: t('arb.due_on'), type: 'date', value: s?.due_on ?? '', required: true })}
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'amount', label: t('arb.amount'), type: 'number', value: s?.amount ?? '', attrs: 'min="0" step="0.001"', hint: t('arb.amount_hint') })}
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: s?.currency ?? kase.currency })}
        ${inputField({ name: 'done_on', label: t('arb.done_on'), type: 'date', value: s?.done_on ?? '', attrs: `max="${today()}"` })}
      </div>
      ${textareaField({ name: 'notes', label: t('clients.notes'), value: s?.notes ?? '', rows: 2 })}
      <div class="flex flex-wrap justify-between gap-2">
        <div>${s ? html`<button type="button" class="btn btn-danger-ghost" data-action="remove">${t('common.delete')}</button>` : ''}</div>
        <div class="flex gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-calendar-plus"></i>${t('common.save')}</button></div>
      </div>
    </form>`,
    actions: {
      remove: async () => {
        if (!(await confirmDialog(t('arb.delete_step')))) return
        try { await api.del(`/api/arbitration/steps/${s.id}`); m.close(); done() } catch (err) { showError(err) }
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        try {
          if (s) await api.patch(`/api/arbitration/steps/${s.id}`, b)
          else await api.post(`/api/arbitration/case/${kase.id}/steps`, { steps: [b] })
          m.close(); toast(t('arb.step_saved')); done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

// Paste a procedural order (or pick a matter document); AI proposes steps to confirm.
function readOrder(kase, documents, done) {
  let proposed = null
  const m = modal({
    title: t('arb.read_order'),
    size: 'lg',
    body: html`<div data-read></div>`,
    actions: {
      back: () => { proposed = null; draw() }
    },
    forms: {
      read: (form) => busy(submitButton(form), async () => {
        const b = formData(form)
        try {
          proposed = await api.post(`/api/arbitration/case/${kase.id}/timetable/read`, b.document_id ? { document_id: b.document_id } : { text: b.text ?? '' })
          draw()
        } catch (err) { showError(err, form) }
      }),
      confirm: (form) => busy(submitButton(form), async () => {
        const steps = proposed.steps.map((s, i) => ({ ...s, title: form.elements[`title_${i}`].value.trim(), due_on: form.elements[`due_${i}`].value, party: form.elements[`party_${i}`].value, keep: form.elements[`keep_${i}`].checked }))
          .filter((s) => s.keep && s.title && s.due_on).map(({ keep, ...s }) => s)
        if (!steps.length) return toast(t('arb.none_selected'), 'error')
        try {
          await api.post(`/api/arbitration/case/${kase.id}/steps`, { steps, source: 'ai' })
          m.close(); toast(t('arb.timetable_saved', { n: steps.length })); done()
        } catch (err) { showError(err) }
      })
    }
  })
  const box = m.el.querySelector('[data-read]')
  const draw = () => {
    if (!proposed) {
      return render(box, html`<form data-form="read" class="space-y-4" novalidate>
        <p class="text-sm text-slate-600">${t('arb.read_help')}</p>
        ${documents.length ? selectField({ name: 'document_id', label: t('arb.from_document'), options: documents.map((x) => ({ value: x.id, label: x.title })), empty: t('arb.paste_instead') }) : ''}
        ${textareaField({ name: 'text', label: t('arb.order_text'), rows: 10, placeholder: t('arb.order_placeholder') })}
        <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
          <button class="btn btn-primary"><i class="fas fa-wand-magic-sparkles"></i>${t('arb.read')}</button></div></form>`)
    }
    render(box, html`<form data-form="confirm" class="space-y-4" novalidate>
      <p class="text-sm rounded-lg bg-violet-50 text-violet-800 p-2"><i class="fas fa-wand-magic-sparkles"></i> ${t('arb.check_ai')}</p>
      ${proposed.steps.length ? html`<div class="overflow-x-auto"><table class="table text-sm"><thead><tr><th></th><th>${t('arb.due_on')}</th><th>${t('arb.step_title')}</th><th>${t('arb.party')}</th></tr></thead>
        <tbody>${proposed.steps.map((s, i) => html`<tr>
          <td><input type="checkbox" name="keep_${i}" checked aria-label="${t('arb.keep')}" /></td>
          <td><input type="date" class="input py-1 text-sm w-40" name="due_${i}" value="${s.due_on}" aria-label="${t('arb.due_on')}" /></td>
          <td><input class="input py-1 text-sm" name="title_${i}" value="${s.title}" dir="auto" maxlength="300" aria-label="${t('arb.step_title')}" />
            <div class="text-xs text-slate-500 mt-0.5"><i class="fas ${KIND_ICON[s.kind]}"></i> ${t(`arb.k_${s.kind}`)}${s.notes ? html` · <span dir="auto">${s.notes}</span>` : ''}</div></td>
          <td><select class="input py-1 text-sm" name="party_${i}" aria-label="${t('arb.party')}">${PARTIES.map((p) => html`<option value="${p}" ${p === s.party ? 'selected' : ''}>${t(`arb.p_${p}`)}</option>`)}</select></td>
        </tr>`)}</tbody></table></div>` : html`<p class="text-sm text-slate-500">${t('arb.nothing_found')}</p>`}
      ${proposed.skipped.length ? html`<div class="text-xs text-amber-800 rounded-lg bg-amber-50 p-2"><b>${t('arb.skipped')}</b><ul class="list-disc ps-5 mt-1">${proposed.skipped.map((x) => html`<li dir="auto">${x}</li>`)}</ul></div>` : ''}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="back">${t('arb.back')}</button>
        ${proposed.steps.length ? html`<button class="btn btn-primary"><i class="fas fa-calendar-plus"></i>${t('arb.add_to_calendar')}</button>` : ''}</div></form>`)
  }
  draw()
}

// Firm-wide register of arbitrations.
export async function arbitrationRegisterView(root, { query, isCurrent }) {
  const state = { show: query.get('show') === 'all' ? 'all' : 'active' }
  render(root, html`${pageHeader(t('arb.register'), t('arb.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/arbitration/register?show=${state.show}`)
    if (!isCurrent()) return
    const stat = (n, label, tone) => html`<div class="card card-pad"><div class="text-2xl font-bold ${n ? tone : ''}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`
    render(root.querySelector('[data-reg]'), html`
      <div class="grid grid-cols-3 gap-4 mb-6">${stat(d.counts.active, t('arb.active'), 'text-slate-800')}${stat(d.counts.due_soon, t('arb.due_week'), 'text-amber-700')}${stat(d.counts.overdue, t('arb.overdue_n'), 'text-red-700')}</div>
      <div class="flex gap-1 mb-3">${['active', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`arb.show_${s}`)}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.matter')}</th><th>${t('arb.institution')}</th><th>${t('arb.tribunal')}</th><th>${t('arb.next_col')}</th><th>${t('common.status')}</th></tr></thead>
        <tbody>${d.items.map((r) => html`<tr class="clickable" data-action="open" data-id="${r.case_id}">
          <td><div class="text-sm font-medium"><bdi dir="ltr" class="font-mono text-xs text-slate-500">${r.reference}</bdi> <span dir="auto">${r.case_title}</span></div>
            <div class="text-xs text-slate-500">${r.client_name ? html`<span dir="auto">${r.client_name}</span> · ` : ''}${t(`arb.side_${r.our_side}`)}${r.amount_claimed != null ? html` · ${fmtMoney(r.amount_claimed, r.currency)}` : ''}</div></td>
          <td class="text-sm">${t(`arb.i_${r.institution}`)}${r.institution_ref ? html`<div class="text-xs text-slate-500"><bdi dir="ltr">${r.institution_ref}</bdi>${r.seat ? html` · <span dir="auto">${r.seat}</span>` : ''}</div>` : ''}</td>
          <td class="text-xs" dir="auto">${r.tribunal || html`<span class="text-slate-400">${t('arb.not_constituted')}</span>`}</td>
          <td class="text-sm">${r.next_step ? html`<div dir="auto">${r.next_step.title}</div><div class="text-xs text-slate-500">${fmtDate(r.next_step.due_on, { hijri: false })} · ${dueBadge(r.next_step)}</div>` : html`<span class="text-xs text-slate-400">—</span>`}</td>
          <td><span class="badge ${STAGE_TONE[r.stage]}">${t(`arb.st_${r.stage}`)}</span>${r.award_result ? html`<div class="text-xs mt-1">${t(`arb.r_${r.award_result}`)}</div>` : ''}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-scale-unbalanced-flip', t(`arb.empty_${state.show}`), t('arb.empty_help'))}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/arbitration/register?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/arbitration${state.show === 'all' ? '?show=all' : ''}`); load().catch(showError) }
    }
  })
  await load()
}
