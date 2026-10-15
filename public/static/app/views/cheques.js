import { api, download } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtMoney, t } from '../i18n.js'
import { can, readOnly, store } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Returned cheques (الشيكات المرتجعة): cheques on a collection matter, the
// bank's return, the complaint, recoveries and a bilingual demand letter.
// ---------------------------------------------------------------------------

const REASONS = ['insufficient_funds', 'account_closed', 'signature', 'stopped', 'irregular', 'other']
const TONE = {
  held: 'bg-slate-100 text-slate-700', presented: 'bg-sky-100 text-sky-800', returned: 'bg-red-100 text-red-700', part_paid: 'bg-amber-100 text-amber-800',
  complaint: 'bg-violet-100 text-violet-800', paid: 'bg-emerald-100 text-emerald-800', written_off: 'bg-slate-200 text-slate-600'
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const totalsLine = (totals) => Object.entries(totals).filter(([, v]) => v.outstanding > 0).map(([cur, v]) => fmtMoney(v.outstanding, cur)).join(' + ')

export async function caseChequesCard(box, kase) {
  if (!box) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer', 'staff')
  const canDelete = !readOnly() && can('owner', 'admin', 'lawyer')
  let d = null
  const draw = () => {
    if (!d) return
    const owed = totalsLine(d.totals)
    // Drawers who can be sent a demand: unpaid cheques the bank has returned.
    const drawers = [...new Set(d.items.filter((x) => x.returned_on && x.outstanding > 0).map((x) => x.drawer))]
    if (!d.items.length) {
      return render(box, html`<section class="card px-5 py-3 flex flex-wrap items-center gap-2">
        <h2 class="font-semibold flex-1"><i class="fas fa-money-check text-slate-400 me-1"></i> ${t('chq.title')} <span class="text-slate-400 font-normal">(0)</span></h2>
        ${editable ? html`<button class="btn btn-ghost btn-sm" data-q="add"><i class="fas fa-plus"></i>${t('chq.add')}</button>` : ''}</section>`)
    }
    render(box, html`<section class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold"><i class="fas fa-money-check text-slate-400 me-1"></i> ${t('chq.title')} <span class="text-slate-400 font-normal">(${d.items.length})</span></h2>
        <div class="flex flex-wrap gap-2">
          ${drawers.map((name) => html`<button class="btn btn-outline btn-sm" data-q="demand" data-drawer="${name}"><i class="fas fa-file-word"></i>${t('chq.demand_to', { name })}</button>`)}
          ${editable ? html`<button class="btn btn-outline btn-sm" data-q="add"><i class="fas fa-plus"></i>${t('chq.add')}</button>` : ''}
        </div>
      </div>
      ${owed ? html`<div class="px-5 py-2 bg-red-50 text-red-800 text-sm"><i class="fas fa-scale-unbalanced"></i> ${t('chq.owed')} <b>${owed}</b></div>` : ''}
      <ul class="divide-y divide-slate-100">${d.items.map((x) => html`<li class="px-5 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-xs"><bdi dir="ltr">${x.cheque_no}</bdi></span>
          <span class="text-sm font-medium flex-1 min-w-0" dir="auto">${x.drawer} <span class="text-xs text-slate-500 font-normal">· ${x.bank}</span></span>
          <b class="text-sm">${fmtMoney(x.amount, x.currency)}</b>
          <span class="badge ${TONE[x.status]}">${t(`chq.s_${x.status}`)}</span>
        </div>
        <div class="text-xs text-slate-500 mt-1">${t('chq.dated', { date: fmtDate(x.cheque_date, { hijri: false }) })}
          ${x.returned_on ? html` · <span class="text-red-700">${t('chq.returned_on', { date: fmtDate(x.returned_on, { hijri: false }) })}${x.return_reason ? ` (${t(`chq.r_${x.return_reason}`)})` : ''}</span>` : ''}
          ${x.complaint_on ? html` · ${t('chq.complaint_on', { date: fmtDate(x.complaint_on, { hijri: false }) })}${x.complaint_ref ? html` <bdi dir="ltr">${x.complaint_ref}</bdi>` : ''}` : ''}
          ${x.recovered > 0 ? html` · <span class="text-emerald-700">${t('chq.recovered', { amount: fmtMoney(x.recovered, x.currency) })}</span>` : ''}
          ${x.outstanding > 0 && x.recovered > 0 ? html` · <b>${t('chq.left', { amount: fmtMoney(x.outstanding, x.currency) })}</b>` : ''}
          ${x.original_id ? html` · <i class="fas fa-vault"></i> ${t('chq.original_held')}` : ''}</div>
        ${x.status === 'returned' && x.days_since_return >= 7 ? html`<div class="text-xs text-red-700 mt-1 font-semibold"><i class="fas fa-triangle-exclamation"></i> ${t('chq.no_action', { n: x.days_since_return })}</div>` : ''}
        ${editable ? html`<div class="flex flex-wrap gap-1 mt-2">
          ${x.outstanding > 0 && x.returned_on ? html`<button class="btn btn-outline btn-sm" data-q="pay" data-id="${x.id}"><i class="fas fa-coins"></i>${t('chq.record_payment')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-q="edit" data-id="${x.id}"><i class="fas fa-pen"></i>${t('common.edit')}</button>
          ${canDelete ? html`<button class="btn btn-danger-ghost btn-sm" data-q="delete" data-id="${x.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}</div>` : ''}
      </li>`)}</ul>
    </section>`)
  }
  const load = async () => {
    try { d = await api.get(`/api/cheques/case/${kase.id}`); if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-q]')
    if (!el) return
    const x = d.items.find((r) => r.id === el.dataset.id)
    const act = el.dataset.q
    if (act === 'add' || act === 'edit') chequeForm(kase, act === 'edit' ? x : null, d.items, load)
    if (act === 'pay') payForm(x, load)
    if (act === 'demand') demandForm(kase, el.dataset.drawer)
    if (act === 'delete') {
      if (!(await confirmDialog(t('chq.delete_confirm', { no: x.cheque_no })))) return
      try { await api.del(`/api/cheques/${x.id}`); load() } catch (err) { showError(err) }
    }
  }
  await load()
}

async function chequeForm(kase, x, items, done) {
  const currencies = store.ref?.currencies ?? ['OMR']
  // Original cheques the firm holds for this client can be linked.
  let originals = []
  if (kase.client_id) { try { originals = (await api.get(`/api/originals?client_id=${kase.client_id}`)).items.filter((o) => o.kind === 'cheque') } catch { /* optional */ } }
  const drawers = [...new Set(items.map((r) => r.drawer))]
  const last = items.at(-1)
  const m = modal({
    title: x ? t('chq.edit') : t('chq.add'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'drawer', label: t('chq.drawer'), value: x?.drawer ?? last?.drawer ?? '', required: true, attrs: 'maxlength="300" dir="auto" list="chq-drawers"' })}
        ${inputField({ name: 'drawer_id_number', label: t('chq.drawer_id'), value: x?.drawer_id_number ?? last?.drawer_id_number ?? '', attrs: 'maxlength="100" dir="ltr"' })}
        ${inputField({ name: 'bank', label: t('chq.bank'), value: x?.bank ?? last?.bank ?? '', required: true, attrs: 'maxlength="200" dir="auto"' })}
      </div>
      <datalist id="chq-drawers">${drawers.map((n) => html`<option value="${n}"></option>`)}</datalist>
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'cheque_no', label: t('chq.cheque_no'), value: x?.cheque_no ?? '', required: true, attrs: 'maxlength="50" dir="ltr"' })}
        ${inputField({ name: 'account_no', label: t('chq.account_no'), value: x?.account_no ?? last?.account_no ?? '', attrs: 'maxlength="60" dir="ltr"' })}
        ${inputField({ name: 'amount', label: t('chq.amount'), type: 'number', value: x?.amount ?? '', required: true, attrs: 'min="0.001" step="0.001"' })}
        ${selectField({ name: 'currency', label: t('cases.currency'), options: currencies.map((c) => ({ value: c, label: c })), value: x?.currency ?? kase.currency })}
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'cheque_date', label: t('chq.cheque_date'), type: 'date', value: x?.cheque_date ?? '', required: true })}
        ${inputField({ name: 'presented_on', label: t('chq.presented_on'), type: 'date', value: x?.presented_on ?? '' })}
        ${inputField({ name: 'returned_on', label: t('chq.returned_date'), type: 'date', value: x?.returned_on ?? '' })}
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        ${selectField({ name: 'return_reason', label: t('chq.reason'), options: REASONS.map((r) => ({ value: r, label: t(`chq.r_${r}`) })), value: x?.return_reason ?? '', empty: '' })}
        ${inputField({ name: 'complaint_on', label: t('chq.complaint_date'), type: 'date', value: x?.complaint_on ?? '' })}
        ${inputField({ name: 'complaint_ref', label: t('chq.complaint_ref'), value: x?.complaint_ref ?? '', attrs: 'maxlength="100" dir="ltr"' })}
      </div>
      ${originals.length ? selectField({ name: 'original_id', label: t('chq.original'), options: originals.map((o) => ({ value: o.id, label: `${o.receipt} · ${o.description}` })), value: x?.original_id ?? '', empty: t('chq.no_original') }) : ''}
      ${textareaField({ name: 'notes', label: t('clients.notes'), value: x?.notes ?? '', rows: 2 })}
      ${x ? html`<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="written_off" ${x.written_off ? 'checked' : ''} /> ${t('chq.written_off')}</label>` : ''}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        try {
          if (x) await api.patch(`/api/cheques/${x.id}`, b)
          else await api.post(`/api/cheques/case/${kase.id}`, b)
          m.close(); toast(t('common.saved')); done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function payForm(x, done) {
  const m = modal({
    title: t('chq.record_payment'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm"><bdi dir="ltr">${x.cheque_no}</bdi> · <span dir="auto">${x.drawer}</span> · ${t('chq.left', { amount: fmtMoney(x.outstanding, x.currency) })}</p>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'amount', label: t('chq.amount_paid'), type: 'number', value: x.outstanding, required: true, attrs: `min="0.001" max="${x.outstanding}" step="0.001"` })}
        ${inputField({ name: 'on', label: t('chq.paid_on'), type: 'date', value: today(), required: true, attrs: `max="${today()}"` })}
      </div>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-coins"></i>${t('chq.record_payment')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        try {
          const r = await api.post(`/api/cheques/${x.id}/recovered`, formData(form))
          m.close(); toast(r.cheque.outstanding ? t('chq.part_saved', { amount: fmtMoney(r.cheque.outstanding, r.cheque.currency) }) : t('chq.paid_saved')); done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function demandForm(kase, drawer) {
  const m = modal({
    title: t('chq.demand'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm">${t('chq.demand_help', { name: drawer })}</p>
      ${inputField({ name: 'days', label: t('chq.days_to_pay'), type: 'number', value: '7', required: true, attrs: 'min="1" max="90"' })}
      <p class="text-xs text-slate-500">${t('chq.demand_review')}</p>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-file-word"></i>${t('chq.download')}</button></div>
    </form>`,
    forms: {
      save: (form) => {
        download(`/api/cheques/case/${kase.id}/demand?drawer=${encodeURIComponent(drawer)}&days=${encodeURIComponent(formData(form).days || 7)}`)
        m.close()
      }
    }
  })
}

// Firm-wide register.
export async function chequesRegisterView(root, { query, isCurrent }) {
  const state = { show: ['open', 'unactioned', 'all'].includes(query.get('show')) ? query.get('show') : 'open' }
  render(root, html`${pageHeader(t('chq.register'), t('chq.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/cheques/register?show=${state.show}`)
    if (!isCurrent()) return
    const owed = Object.entries(d.outstanding).map(([cur, n]) => fmtMoney(n, cur)).join(' + ') || '0'
    const stat = (n, label, tone) => html`<div class="card card-pad"><div class="text-2xl font-bold ${n && n !== '0' ? tone : ''}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`
    render(root.querySelector('[data-reg]'), html`
      <div class="grid sm:grid-cols-3 gap-4 mb-6">${stat(owed, t('chq.outstanding_total'), 'text-red-700')}${stat(d.counts.open, t('chq.open'), 'text-slate-800')}${stat(d.counts.unactioned, t('chq.unactioned'), 'text-red-700')}</div>
      <div class="flex gap-1 mb-3">${['open', 'unactioned', 'all'].map((s) => html`<button class="px-3 py-1.5 rounded-md text-sm ${state.show === s ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="show" data-show="${s}">${t(`chq.show_${s}`)}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('chq.cheque')}</th><th>${t('chq.drawer')}</th><th>${t('cases.matter')}</th><th class="text-end">${t('chq.outstanding')}</th><th>${t('common.status')}</th></tr></thead>
        <tbody>${d.items.map((x) => html`<tr class="clickable" data-action="open" data-id="${x.case_id}">
          <td class="text-sm"><bdi dir="ltr" class="font-mono">${x.cheque_no}</bdi><div class="text-xs text-slate-500">${x.bank} · ${fmtDate(x.cheque_date, { hijri: false })}</div></td>
          <td class="text-sm" dir="auto">${x.drawer}</td>
          <td class="text-sm"><bdi dir="ltr" class="font-mono text-xs text-slate-500">${x.reference}</bdi> <span dir="auto">${x.client_name || x.case_title}</span></td>
          <td class="text-sm text-end whitespace-nowrap"><b>${fmtMoney(x.outstanding, x.currency)}</b>${x.recovered > 0 ? html`<div class="text-xs text-slate-500">${t('chq.of', { amount: fmtMoney(x.amount, x.currency) })}</div>` : ''}</td>
          <td><span class="badge ${TONE[x.status]}">${t(`chq.s_${x.status}`)}</span>${x.unactioned ? html`<div class="text-xs text-red-700 mt-1">${t('chq.no_action', { n: x.days_since_return })}</div>` : ''}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-money-check', t(`chq.empty_${state.show}`), t('chq.empty_help'))}</div>`)
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/cheques/register?show=${state.show}&format=csv`),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/cheques${state.show === 'open' ? '' : `?show=${state.show}`}`); load().catch(showError) }
    }
  })
  await load()
}
