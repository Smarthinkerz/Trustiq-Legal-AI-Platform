import { api, download } from '../api.js'
import { bind, html, raw, render } from '../dom.js'
import { fmtDate, t } from '../i18n.js'
import { can, readOnly } from '../store.js'
import { emptyState, pageHeader, showError, spinner, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Matter onboarding register: conflict check, KYC, power of attorney and
// engagement letter for every open matter, in one place.
// ---------------------------------------------------------------------------

const CHECKS = ['conflict', 'kyc', 'poa', 'engagement']
const OK = { conflict: ['clear', 'override'], kyc: ['approved'], poa: ['valid', 'expiring'], engagement: ['signed'] }
const WARN = { poa: ['expiring'], conflict: ['override'], engagement: ['sent'], kyc: ['in_progress', 'review_due'] }

function cell(check, value, required, extra) {
  const ok = OK[check].includes(value)
  const warn = WARN[check]?.includes(value)
  const tone = !required ? 'text-slate-400' : ok && !warn ? 'text-emerald-700' : ok || warn ? 'text-amber-700' : 'text-red-700'
  const icon = ok ? (warn ? 'fa-circle-exclamation' : 'fa-circle-check') : value === 'no_client' ? 'fa-minus' : warn ? 'fa-hourglass-half' : 'fa-circle-xmark'
  return html`<td class="text-xs whitespace-nowrap ${tone}"><i class="fas ${icon}"></i> ${t(`onb.v_${value}`)}${extra ? html`<div class="text-slate-500">${extra}</div>` : ''}</td>`
}

export async function onboardingView(root, { query, isCurrent }) {
  const state = { show: query.get('show') === 'not_ready' ? 'not_ready' : 'all', data: null, settingsOpen: false }
  const manage = !readOnly() && can('owner', 'admin')
  render(root, html`${pageHeader(t('onb.title'), t('onb.subtitle'), html`
      <a class="btn btn-outline" href="#/compliance"><i class="fas fa-user-shield"></i>${t('kyc.register')}</a>
      <button class="btn btn-outline" data-action="csv"><i class="fas fa-file-csv"></i>${t('kyc.export_csv')}</button>`)}
    <div data-onb>${spinner()}</div>`)

  const draw = () => {
    const { items, required, summary: s } = state.data
    const shown = state.show === 'not_ready' ? items.filter((r) => r.gaps.length) : items
    const tile = (label, n, cls, show) => html`<button class="card card-pad text-start hover:shadow-md ${show && state.show === show ? 'ring-2 ring-brand-500' : ''}" ${show ? raw(`data-action="show" data-show="${show}"`) : ''}>
      <div class="text-2xl font-bold ${cls}">${n}</div><div class="text-xs text-slate-500">${label}</div></button>`
    render(root.querySelector('[data-onb]'), html`
      <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        ${tile(t('onb.ready'), s.ready, 'text-emerald-700', 'all')}${tile(t('onb.not_ready'), s.not_ready, s.not_ready ? 'text-red-700' : '', 'not_ready')}
        ${CHECKS.map((c) => tile(t('onb.missing', { check: t(`onb.c_${c}`) }), required.includes(c) ? s[c] : '—', required.includes(c) && s[c] ? 'text-amber-700' : 'text-slate-400'))}
      </div>
      ${manage ? html`<details class="card card-pad mb-6" data-settings ${state.settingsOpen ? raw('open') : ''}><summary class="cursor-pointer text-sm font-semibold"><i class="fas fa-sliders text-slate-400"></i> ${t('onb.settings')}</summary>
        <p class="text-sm text-slate-600 mt-3">${t('onb.settings_help')}</p>
        <div class="flex flex-wrap gap-4 mt-3">${CHECKS.map((c) => html`<label class="flex items-center gap-2 text-sm"><input type="checkbox" data-req="${c}" ${required.includes(c) ? raw('checked') : ''} /> ${t(`onb.c_${c}`)}</label>`)}</div>
      </details>` : ''}
      <div class="card">${shown.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.reference')}</th><th>${t('onb.matter')}</th>${CHECKS.map((c) => html`<th class="${required.includes(c) ? '' : 'text-slate-400'}">${t(`onb.c_${c}`)}</th>`)}<th></th></tr></thead>
        <tbody>${shown.map((r) => html`<tr class="clickable" data-action="open" data-id="${r.id}">
          <td class="font-mono text-xs whitespace-nowrap">${r.reference}</td>
          <td><div class="font-medium" dir="auto">${r.title}</div><div class="text-xs text-slate-500" dir="auto">${r.client_name || t('onb.no_client')}${r.lawyer_name ? ` · ${r.lawyer_name}` : ''}</div></td>
          ${cell('conflict', r.checks.conflict, required.includes('conflict'))}
          ${cell('kyc', r.checks.kyc, required.includes('kyc'))}
          ${cell('poa', r.checks.poa, required.includes('poa'), r.poa_expires_on ? fmtDate(r.poa_expires_on, { hijri: false }) : '')}
          ${cell('engagement', r.checks.engagement, required.includes('engagement'))}
          <td>${r.gaps.length ? html`<span class="badge bg-red-100 text-red-700">${t('onb.gaps', { n: r.gaps.length })}</span>` : html`<span class="badge bg-emerald-100 text-emerald-800"><i class="fas fa-check"></i> ${t('onb.ready_one')}</span>`}</td>
        </tr>`)}</tbody></table></div>`
        : emptyState(state.show === 'not_ready' ? 'fa-circle-check' : 'fa-folder-open', state.show === 'not_ready' ? t('onb.all_ready') : t('onb.empty'), '')}</div>
      <p class="text-xs text-slate-500 mt-3">${t('onb.footnote')}</p>`)
    root.querySelector('[data-settings]')?.addEventListener('toggle', (e) => { state.settingsOpen = e.target.open })
    for (const el of root.querySelectorAll('[data-req]')) {
      el.addEventListener('change', async () => {
        const next = [...root.querySelectorAll('[data-req]')].filter((x) => x.checked).map((x) => x.dataset.req)
        try { await api.put('/api/onboarding/settings', { required: next }); toast(t('common.saved')); await load() } catch (err) { showError(err) }
      })
    }
  }
  const load = async () => {
    const data = await api.get('/api/onboarding')
    if (!isCurrent()) return
    state.data = data
    draw()
  }
  bind(root, {
    actions: {
      csv: () => download(`/api/onboarding?format=csv${state.show === 'not_ready' ? '&show=not_ready' : ''}`),
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      show: (el) => { state.show = el.dataset.show; history.replaceState(null, '', `#/onboarding${state.show === 'not_ready' ? '?show=not_ready' : ''}`); draw() }
    }
  })
  await load()
}
