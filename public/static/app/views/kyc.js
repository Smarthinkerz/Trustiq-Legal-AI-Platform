import { api, download } from '../api.js'
import { bind, html, raw, render } from '../dom.js'
import { fmtDate, fmtDateTime, t } from '../i18n.js'
import { can, readOnly } from '../store.js'
import { busy, emptyState, modal, pageHeader, showError, spinner, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Client due diligence (KYC / AML): risk-rated file per client, partner approval,
// periodic review and a firm-wide register for inspections.
// ---------------------------------------------------------------------------

const RISK_CLS = { low: 'bg-emerald-100 text-emerald-800', medium: 'bg-amber-100 text-amber-800', high: 'bg-red-100 text-red-700' }
const STATUS_CLS = { not_started: 'bg-slate-100 text-slate-600', in_progress: 'bg-sky-100 text-sky-800', approved: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-100 text-red-700', review_due: 'bg-amber-100 text-amber-800' }
export const kycStatusBadge = (s) => html`<span class="badge ${STATUS_CLS[s] || STATUS_CLS.not_started} whitespace-nowrap">${t(`kyc.status_${s || 'not_started'}`)}</span>`
export const riskBadge = (r) => (r ? html`<span class="badge ${RISK_CLS[r]} whitespace-nowrap">${t(`kyc.risk_${r}`)}</span>` : '')
const yes = (v) => (v ? t('kyc.yes') : t('kyc.no'))

export function kycCard(d, { ro } = {}) {
  const k = d.kyc
  const row = (label, value) => (value || value === false ? html`<div><dt class="text-xs text-slate-500">${label}</dt><dd class="text-sm" dir="auto">${value === false ? t('kyc.no') : value === true ? t('kyc.yes') : value}</dd></div>` : '')
  return html`<section class="card" id="kyc">
    <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
      <div><h2 class="font-semibold"><i class="fas fa-user-shield text-brand-500"></i> ${t('kyc.title')}</h2>
        <p class="text-xs text-slate-500 mt-0.5">${t('kyc.subtitle')}</p></div>
      <div class="flex flex-wrap items-center gap-2">${kycStatusBadge(d.status)}${k ? riskBadge(d.risk.effective) : ''}</div>
    </div>
    ${k ? html`<div class="p-5 space-y-4">
      ${d.status === 'review_due' ? html`<p class="text-sm rounded-lg bg-amber-50 text-amber-900 p-3"><i class="fas fa-clock-rotate-left"></i> ${t('kyc.review_due_help', { date: fmtDate(k.next_review_on) })}</p>` : ''}
      ${d.blockers.length && d.status !== 'approved' ? html`<ul class="text-sm rounded-lg bg-slate-50 p-3 space-y-1">${d.blockers.map((b) => html`<li><i class="fas fa-circle-exclamation text-amber-600"></i> ${t(`kyc.blocker_${b}`)}</li>`)}</ul>` : ''}
      <dl class="grid sm:grid-cols-3 gap-4">
        ${row(t('kyc.identity'), k.identity_verified ? `${t('kyc.yes')}${k.identity_method ? ` · ${t(`kyc.method_${k.identity_method}`)}` : ''}` : false)}
        ${row(t('kyc.source_of_funds'), k.source_of_funds)}
        ${row(t('kyc.pep'), k.pep)}
        ${row(t('kyc.sanctions'), k.sanctions_checked_on ? `${fmtDate(k.sanctions_checked_on, { hijri: false })}${k.sanctions_lists ? ` · ${k.sanctions_lists}` : ''}${k.sanctions_match ? ` · ${t('kyc.possible_match')}` : ''}` : '')}
        ${d.client.kind === 'company' ? row(t('kyc.owners'), k.beneficial_owners.length ? k.beneficial_owners.map((o) => `${o.name}${o.ownership_pct != null ? ` (${o.ownership_pct}%)` : ''}${o.pep ? ' · PEP' : ''}`).join(', ') : '') : ''}
        ${row(t('kyc.score'), `${d.risk.score} → ${t(`kyc.risk_${d.risk.level}`)}${k.risk_override ? ` · ${t('kyc.overridden', { level: t(`kyc.risk_${k.risk_override}`) })}` : ''}`)}
      </dl>
      ${d.risk.factors.length ? html`<p class="text-xs text-slate-500">${t('kyc.factors')}: ${d.risk.factors.map((f) => `${t(`kyc.factor_${f.factor}`)} (+${f.points})`).join(' · ')}</p>` : ''}
      ${k.decided_at ? html`<p class="text-xs text-slate-500">${t(`kyc.decided_${k.status === 'rejected' ? 'rejected' : 'approved'}`, { who: k.decided_by_name || '', when: fmtDateTime(k.decided_at) })}${k.next_review_on ? ` · ${t('kyc.next_review', { date: fmtDate(k.next_review_on) })}` : ''}${k.decision_note ? html`<br><span dir="auto">${k.decision_note}</span>` : ''}</p>` : ''}
    </div>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('kyc.empty')}</p>`}
    ${ro ? '' : html`<div class="px-5 pb-5 flex flex-wrap gap-2">
      <button class="btn btn-outline btn-sm" data-action="kyc-edit"><i class="fas fa-pen"></i>${k ? t('kyc.update') : t('kyc.start')}</button>
      ${k && can('owner', 'admin') && d.status !== 'approved' ? html`<button class="btn btn-primary btn-sm" data-action="kyc-decide"><i class="fas fa-stamp"></i>${t('kyc.decide')}</button>` : ''}
    </div>`}
  </section>`
}

export function kycActions({ data, onChange }) {
  return {
    'kyc-edit': () => openKycForm(data, onChange),
    'kyc-decide': () => openDecision(data, onChange)
  }
}

function openKycForm(d, onSaved) {
  const k = d.kyc || { beneficial_owners: [] }
  const company = d.client.kind === 'company'
  const check = (name, label, hint) => html`<label class="flex items-start gap-2 text-sm"><input type="checkbox" name="${name}" class="mt-1" ${k[name] ? raw('checked') : ''} /><span>${label}${hint ? html`<span class="block text-xs text-slate-500">${hint}</span>` : ''}</span></label>`
  const text = (name, label, attrs = '') => html`<div><label class="label" for="ky-${name}">${label}</label><input id="ky-${name}" name="${name}" class="input" dir="auto" value="${k[name] ?? ''}" ${raw(attrs)} /></div>`
  const ownerRow = (o = {}) => html`<li class="grid grid-cols-12 gap-2 items-center" data-owner>
    <input class="input col-span-5" data-o="name" placeholder="${t('kyc.owner_name')}" value="${o.name || ''}" dir="auto" maxlength="200" />
    <input class="input col-span-3" data-o="nationality" placeholder="${t('kyc.nationality')}" value="${o.nationality || ''}" dir="auto" maxlength="100" />
    <input class="input col-span-2" data-o="ownership_pct" type="number" min="0" max="100" step="0.01" placeholder="%" value="${o.ownership_pct ?? ''}" />
    <label class="col-span-1 text-xs flex items-center gap-1"><input type="checkbox" data-o="pep" ${o.pep ? raw('checked') : ''} />PEP</label>
    <button type="button" class="col-span-1 btn btn-ghost btn-sm" data-remove-owner aria-label="${t('common.delete')}"><i class="fas fa-xmark"></i></button></li>`
  const m = modal({
    title: t('kyc.form_title', { name: d.client.name }),
    size: 'xl',
    body: html`<form data-form="save" class="space-y-6" novalidate>
      <fieldset class="space-y-3"><legend class="font-semibold text-sm">1. ${t('kyc.sec_identity')}</legend>
        <div class="grid sm:grid-cols-3 gap-4">
          ${check('identity_verified', t('kyc.identity_verified'))}
          <div><label class="label" for="ky-method">${t('kyc.method')}</label><select id="ky-method" name="identity_method" class="input"><option value="">—</option>
            ${['in_person', 'video', 'certified_copy', 'other'].map((v) => html`<option value="${v}" ${k.identity_method === v ? raw('selected') : ''}>${t(`kyc.method_${v}`)}</option>`)}</select></div>
          ${text('nationality', company ? t('kyc.incorporation') : t('kyc.nationality'), 'maxlength="100"')}
          ${text('residence_country', t('kyc.residence'), 'maxlength="100"')}
          ${text('occupation', company ? t('kyc.business') : t('kyc.occupation'), 'maxlength="300"')}
          ${text('purpose', t('kyc.purpose'), 'maxlength="1000"')}
        </div></fieldset>
      ${company ? html`<fieldset class="space-y-2"><legend class="font-semibold text-sm">2. ${t('kyc.owners')}</legend>
        <p class="text-xs text-slate-500">${t('kyc.owners_help')}</p>
        <ul class="space-y-2" data-owners>${(k.beneficial_owners.length ? k.beneficial_owners : [{}]).map(ownerRow)}</ul>
        <button type="button" class="btn btn-ghost btn-sm" data-add-owner><i class="fas fa-plus"></i>${t('kyc.add_owner')}</button></fieldset>` : ''}
      <fieldset class="space-y-3"><legend class="font-semibold text-sm">${company ? 3 : 2}. ${t('kyc.sec_funds')}</legend>
        <div class="grid sm:grid-cols-2 gap-4">
          ${textareaField({ name: 'source_of_funds', label: t('kyc.source_of_funds'), value: k.source_of_funds, rows: 2, hint: t('kyc.source_of_funds_hint') })}
          ${textareaField({ name: 'source_of_wealth', label: t('kyc.source_of_wealth'), value: k.source_of_wealth, rows: 2 })}
        </div></fieldset>
      <fieldset class="space-y-3"><legend class="font-semibold text-sm">${company ? 4 : 3}. ${t('kyc.sec_risk')}</legend>
        <div class="grid sm:grid-cols-2 gap-3">
          ${check('pep', t('kyc.pep'), t('kyc.pep_hint'))}
          ${check('high_risk_country', t('kyc.high_risk_country'), t('kyc.high_risk_country_hint'))}
          ${check('cash_involved', t('kyc.cash'))}
          ${check('complex_structure', t('kyc.complex'))}
          ${check('non_face_to_face', t('kyc.non_face'))}
        </div>
        ${text('pep_details', t('kyc.pep_details'), 'maxlength="1000"')}</fieldset>
      <fieldset class="space-y-3"><legend class="font-semibold text-sm">${company ? 5 : 4}. ${t('kyc.sec_sanctions')}</legend>
        <div class="grid sm:grid-cols-3 gap-4">
          <div><label class="label" for="ky-sc">${t('kyc.screened_on')}</label><input id="ky-sc" type="date" name="sanctions_checked_on" class="input" value="${k.sanctions_checked_on || ''}" /></div>
          ${text('sanctions_lists', t('kyc.lists'), `maxlength="500" placeholder="${t('kyc.lists_placeholder')}"`)}
          ${check('sanctions_match', t('kyc.possible_match'))}
        </div>
        ${text('sanctions_notes', t('kyc.sanctions_notes'), 'maxlength="2000"')}</fieldset>
      <fieldset class="space-y-3"><legend class="font-semibold text-sm">${company ? 6 : 5}. ${t('kyc.sec_override')}</legend>
        <div class="grid sm:grid-cols-3 gap-4">
          <div><label class="label" for="ky-ov">${t('kyc.override')}</label><select id="ky-ov" name="risk_override" class="input"><option value="">${t('kyc.override_none')}</option>
            ${['low', 'medium', 'high'].map((v) => html`<option value="${v}" ${k.risk_override === v ? raw('selected') : ''}>${t(`kyc.risk_${v}`)}</option>`)}</select></div>
          <div class="sm:col-span-2">${text('override_reason', t('kyc.override_reason'), 'maxlength="1000"')}</div>
        </div></fieldset>
      ${d.status === 'approved' ? html`<p class="text-sm rounded-lg bg-amber-50 text-amber-900 p-3"><i class="fas fa-circle-info"></i> ${t('kyc.reopen_warning')}</p>` : ''}
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('common.save')}</button>
      </div>
    </form>`,
    forms: {
      save: (form) => busy(form.querySelector('[type=submit]'), async () => {
        const el = form.elements
        const v = (n) => el[n]?.value?.trim() ?? ''
        const c = (n) => !!el[n]?.checked
        const owners = [...form.querySelectorAll('[data-owner]')].map((li) => {
          const g = (n) => li.querySelector(`[data-o=${n}]`)
          return { name: g('name').value.trim(), nationality: g('nationality').value.trim(), ownership_pct: g('ownership_pct').value === '' ? null : Number(g('ownership_pct').value), pep: g('pep').checked }
        }).filter((o) => o.name)
        try {
          await api.put(`/api/kyc/client/${d.client.id}`, {
            identity_verified: c('identity_verified'), identity_method: v('identity_method'), nationality: v('nationality'), residence_country: v('residence_country'),
            occupation: v('occupation'), purpose: v('purpose'), source_of_funds: v('source_of_funds'), source_of_wealth: v('source_of_wealth'),
            pep: c('pep'), pep_details: v('pep_details'), high_risk_country: c('high_risk_country'), cash_involved: c('cash_involved'),
            complex_structure: c('complex_structure'), non_face_to_face: c('non_face_to_face'), beneficial_owners: owners,
            sanctions_checked_on: v('sanctions_checked_on'), sanctions_lists: v('sanctions_lists'), sanctions_match: c('sanctions_match'), sanctions_notes: v('sanctions_notes'),
            risk_override: v('risk_override'), override_reason: v('override_reason')
          })
          m.close()
          toast(t('common.saved'))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
  m.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-owner]')) m.el.querySelector('[data-owners]').insertAdjacentHTML('beforeend', ownerRow().toString())
    const rm = e.target.closest('[data-remove-owner]')
    if (rm) rm.closest('[data-owner]').remove()
  })
}

function openDecision(d, onSaved) {
  const high = d.risk.effective === 'high'
  const m = modal({
    title: t('kyc.decide'),
    body: html`<form data-form="decide" class="space-y-4" novalidate>
      <p class="text-sm">${t('kyc.decide_intro', { name: d.client.name })} ${riskBadge(d.risk.effective)}</p>
      ${d.blockers.length ? html`<ul class="text-sm rounded-lg bg-amber-50 text-amber-900 p-3 space-y-1">${d.blockers.map((b) => html`<li><i class="fas fa-circle-exclamation"></i> ${t(`kyc.blocker_${b}`)}</li>`)}</ul>` : ''}
      ${textareaField({ name: 'note', label: high ? t('kyc.edd_note') : t('kyc.decision_note'), rows: 3, required: high })}
      <div class="flex flex-wrap justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="button" class="btn btn-danger" data-action="reject"><i class="fas fa-ban"></i>${t('kyc.reject')}</button>
        <button type="button" class="btn btn-primary" data-action="approve" ${d.blockers.length ? raw('disabled') : ''}><i class="fas fa-check"></i>${t('kyc.approve')}</button>
      </div>
    </form>`,
    actions: {
      approve: (btn) => decide(btn, 'approved'),
      reject: (btn) => decide(btn, 'rejected')
    }
  })
  const decide = (btn, decision) => busy(btn, async () => {
    try {
      await api.post(`/api/kyc/client/${d.client.id}/decision`, { decision, note: m.el.querySelector('[name=note]').value.trim() })
      m.close()
      toast(t(`kyc.toast_${decision}`))
      onSaved?.()
    } catch (err) { showError(err) }
  })
}

// Banner on a case page while the client's due diligence is not approved.
export async function caseKycBanner(box, kase) {
  if (!box || !kase.client_id || kase.status === 'closed') return
  let d
  try { d = await api.get(`/api/kyc/client/${kase.client_id}`) } catch { return }
  if (!document.body.contains(box) || d.status === 'approved') return
  const tone = d.status === 'rejected' ? 'border-red-200 bg-red-50 text-red-800' : 'border-sky-200 bg-sky-50 text-sky-900'
  render(box, html`<div class="rounded-xl border ${tone} p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
    <div class="text-sm"><i class="fas fa-user-shield"></i> ${t(`kyc.case_${d.status}`)}</div>
    <a class="btn btn-outline btn-sm" href="#/clients/${kase.client_id}">${t('kyc.open_client')}</a></div>`)
}

export async function kycRegisterView(root, { isCurrent }) {
  render(root, html`${pageHeader(t('kyc.register'), t('kyc.register_subtitle'), html`<button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-reg>${spinner()}</div>`)
  bind(root, { actions: { csv: () => download('/api/kyc/register?format=csv'), 'open-client': (el) => (location.hash = `#/clients/${el.dataset.id}`) } })
  const { items, summary: s } = await api.get('/api/kyc/register')
  if (!isCurrent()) return
  const tile = (label, n, cls = '') => html`<div class="card card-pad"><div class="text-2xl font-bold ${cls}">${n}</div><div class="text-xs text-slate-500">${label}</div></div>`
  render(root.querySelector('[data-reg]'), html`
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      ${tile(t('kyc.status_approved'), s.approved, 'text-emerald-700')}${tile(t('kyc.status_review_due'), s.review_due, s.review_due ? 'text-amber-700' : '')}
      ${tile(t('kyc.status_in_progress'), s.in_progress)}${tile(t('kyc.status_not_started'), s.not_started, s.not_started ? 'text-slate-700' : '')}${tile(t('kyc.risk_high'), s.high, s.high ? 'text-red-700' : '')}
    </div>
    <div class="card">${items.length ? html`<div class="overflow-x-auto"><table class="table">
      <thead><tr><th>${t('clients.name')}</th><th>${t('clients.open_cases')}</th><th>${t('common.status')}</th><th>${t('kyc.risk')}</th><th>PEP</th><th>${t('kyc.sanctions')}</th><th>${t('kyc.next_review_col')}</th></tr></thead>
      <tbody>${items.map((r) => html`<tr class="clickable" data-action="open-client" data-id="${r.id}">
        <td class="font-medium" dir="auto">${r.name}</td><td>${r.open_cases}</td><td>${kycStatusBadge(r.status)}</td><td>${riskBadge(r.risk)}</td>
        <td>${r.pep ? html`<span class="badge bg-red-100 text-red-700">${t('kyc.yes')}</span>` : html`<span class="text-slate-300">—</span>`}</td>
        <td class="text-xs">${r.sanctions_match ? html`<span class="text-red-700 font-semibold">${t('kyc.possible_match')}</span>` : r.sanctions_checked_on ? fmtDate(r.sanctions_checked_on, { hijri: false }) : '—'}</td>
        <td class="text-xs">${r.next_review_on ? fmtDate(r.next_review_on, { hijri: false }) : '—'}</td></tr>`)}</tbody></table></div>`
      : emptyState('fa-user-shield', t('kyc.register_empty'), '')}</div>`)
}
