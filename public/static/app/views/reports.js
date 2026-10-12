import { api, download } from '../api.js'
import { bind, html, qs, render } from '../dom.js'
import { fmtDateTime, fmtMoney, fmtNumber, getLang, t } from '../i18n.js'
import { aiEnabled, refLabel, store } from '../store.js'
import { busy, emptyState, pageHeader, showError } from '../ui.js'
import { fmtHours } from './billing.js'

const delta = (cur, prev, { invert = false, unit = '%' } = {}) => {
  if (cur == null || prev == null || (prev === 0 && cur === 0)) return ''
  if (prev === 0) return html`<span class="text-xs text-slate-500">${t('insights.new')}</span>`
  const ch = unit === 'pt' ? Math.round(cur - prev) : Math.round(((cur - prev) / Math.abs(prev)) * 100)
  if (ch === 0) return html`<span class="text-xs text-slate-500">±0${unit === 'pt' ? ' pt' : '%'}</span>`
  const good = invert ? ch < 0 : ch > 0
  return html`<span class="text-xs ${good ? 'text-emerald-700' : 'text-red-700'}"><i class="fas ${ch > 0 ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> ${Math.abs(ch)}${unit === 'pt' ? ' pt' : '%'}</span>`
}

// Partner dashboard: key numbers vs the previous period, lockup, billing trend, lawyers, clients and enquiries.
function insightsSection(ins) {
  const { current: k, previous: p } = ins.kpis
  const cur = ins.currency
  const money = (n) => fmtMoney(n, cur)
  const tile = (label, value, d, icon, hint = '') => html`<div class="card card-pad">
    <div class="text-xs text-slate-500 flex items-center gap-2"><i class="fas ${icon}"></i>${label}</div>
    <div class="text-2xl font-bold mt-1">${value}</div>
    <div class="flex items-center gap-2 mt-1">${d}${hint ? html`<span class="text-xs text-slate-400">${hint}</span>` : ''}</div></div>`
  const vsPrev = t('insights.vs_previous')
  const max = Math.max(1, ...ins.trend.flatMap((m) => [m.invoiced, m.collected]))
  const lk = ins.lockup
  const leads = ins.leads
  const funnel = ['new', 'contacted', 'converted', 'declined'].map((s) => [s, leads.by_status[s] || 0])
  const leadTotal = funnel.reduce((a, [, n]) => a + n, 0)
  return html`
  <section class="mb-6 space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-slate-500">${t('insights.period', { from: ins.from, to: ins.to, pfrom: ins.previous.from, pto: ins.previous.to })}</p>
      ${ins.other_currencies.length ? html`<p class="text-xs text-amber-700">${t('insights.other_currencies', { cur, list: ins.other_currencies.join(', ') })}</p>` : ''}
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      ${tile(t('reports.billable_hours'), fmtHours(k.billable_minutes), delta(k.billable_minutes, p.billable_minutes), 'fa-stopwatch', vsPrev)}
      ${tile(t('reports.utilisation'), k.utilisation_pct != null ? `${k.utilisation_pct}%` : '—', delta(k.utilisation_pct, p.utilisation_pct, { unit: 'pt' }), 'fa-gauge')}
      ${tile(t('insights.invoiced'), money(k.invoiced), delta(k.invoiced, p.invoiced), 'fa-file-invoice-dollar')}
      ${tile(t('insights.collected'), money(k.collected), delta(k.collected, p.collected), 'fa-sack-dollar')}
      ${tile(t('insights.recorded'), money(k.recorded_value), delta(k.recorded_value, p.recorded_value), 'fa-coins')}
      ${tile(t('insights.new_matters'), fmtNumber(k.new_matters), delta(k.new_matters, p.new_matters), 'fa-folder-plus', t('insights.closed_n', { n: k.closed_matters }))}
      ${tile(t('insights.new_clients'), fmtNumber(k.new_clients), delta(k.new_clients, p.new_clients), 'fa-user-plus')}
      ${tile(t('insights.conversion'), k.conversion_pct != null ? `${k.conversion_pct}%` : '—', delta(k.conversion_pct, p.conversion_pct, { unit: 'pt' }), 'fa-filter', t('insights.of_leads', { n: k.leads }))}
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <section class="card card-pad">
        <h2 class="font-semibold">${t('insights.lockup')}</h2>
        <p class="text-xs text-slate-500 mb-4">${t('insights.lockup_help')}</p>
        <div class="text-3xl font-bold">${lk.lockup_days != null ? t('insights.days', { n: lk.lockup_days }) : '—'}</div>
        <dl class="grid grid-cols-2 gap-3 text-sm mt-4">
          <div><dt class="text-xs text-slate-500">${t('insights.wip')}</dt><dd class="font-semibold">${money(lk.wip)}</dd><dd class="text-xs text-slate-500">${lk.wip_days != null ? t('insights.days', { n: lk.wip_days }) : '—'}</dd></div>
          <div><dt class="text-xs text-slate-500">${t('insights.debtors')}</dt><dd class="font-semibold">${money(lk.debtors)}</dd><dd class="text-xs text-slate-500">${lk.debtor_days != null ? t('insights.days', { n: lk.debtor_days }) : '—'}</dd></div>
          <div class="col-span-2"><dt class="text-xs text-slate-500">${t('invoice_status.overdue')}</dt><dd class="font-semibold ${lk.overdue > 0 ? 'text-red-700' : ''}">${money(lk.overdue)}</dd></div>
        </dl>
      </section>
      <section class="card card-pad lg:col-span-2">
        <h2 class="font-semibold">${t('insights.trend')}</h2>
        <div class="flex gap-4 text-xs text-slate-600 mt-1 mb-3">
          <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm" style="background:#3182ce"></span>${t('insights.invoiced')}</span>
          <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm" style="background:#d69e2e"></span>${t('insights.collected')}</span>
        </div>
        <div class="flex items-end gap-1 h-44 border-b border-slate-200" role="img" aria-label="${t('insights.trend')}">
          ${ins.trend.map((m) => html`<div class="flex-1 h-full flex items-end justify-center gap-0.5 min-w-0 group relative" title="${m.month} · ${t('insights.invoiced')}: ${money(m.invoiced)} · ${t('insights.collected')}: ${money(m.collected)}">
            <div class="w-1/2 max-w-[24px] rounded-t" style="background:#3182ce;height:${m.invoiced ? Math.max(2, Math.round((m.invoiced / max) * 100)) : 0}%"></div>
            <div class="w-1/2 max-w-[24px] rounded-t" style="background:#d69e2e;height:${m.collected ? Math.max(2, Math.round((m.collected / max) * 100)) : 0}%"></div>
          </div>`)}
        </div>
        <div class="flex gap-1 mt-1">${ins.trend.map((m) => html`<span class="flex-1 text-center text-[10px] text-slate-500">${m.month.slice(5)}</span>`)}</div>
        <details class="mt-3 text-sm"><summary class="cursor-pointer text-brand-700 text-xs">${t('insights.as_table')}</summary>
          <div class="overflow-x-auto mt-2"><table class="table text-xs"><thead><tr><th>${t('insights.month')}</th><th class="text-end">${t('insights.invoiced')}</th><th class="text-end">${t('insights.collected')}</th></tr></thead>
          <tbody>${ins.trend.map((m) => html`<tr><td>${m.month}</td><td class="text-end">${money(m.invoiced)}</td><td class="text-end">${money(m.collected)}</td></tr>`)}</tbody></table></div></details>
      </section>
    </div>

    <section class="card card-pad">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div><h2 class="font-semibold"><i class="fas fa-wand-magic-sparkles text-brand-600 me-1"></i>${t('insights.summary_title')}</h2><p class="text-xs text-slate-500">${t('insights.summary_help')}</p></div>
        ${aiEnabled() ? html`<button class="btn btn-outline btn-sm" data-action="summary"><i class="fas fa-wand-magic-sparkles"></i>${t('insights.summarise')}</button>` : ''}
      </div>
      <div data-summary class="mt-3"></div>
    </section>

    <div class="grid lg:grid-cols-2 gap-6">
      <section class="card">
        <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <h2 class="font-semibold">${t('insights.lawyers')}</h2>
          <button class="btn btn-ghost btn-sm" data-action="export" data-section="lawyers"><i class="fas fa-file-csv"></i>CSV</button>
        </div>
        <div class="overflow-x-auto"><table class="table text-sm">
          <thead><tr><th>${t('insights.lawyer')}</th><th class="text-end">${t('reports.billable_hours')}</th><th class="text-end">${t('reports.utilisation')}</th><th class="text-end">${t('insights.recorded')}</th><th class="text-end">${t('fees.realization')}</th><th class="text-end">${t('insights.open_matters')}</th><th class="text-end">${t('insights.overdue_tasks')}</th></tr></thead>
          <tbody>${ins.lawyers.map((l) => html`<tr>
            <td class="whitespace-nowrap">${l.name}</td>
            <td class="text-end font-mono">${fmtHours(l.billable_minutes)}</td>
            <td class="text-end">${l.utilisation_pct != null ? `${l.utilisation_pct}%` : '—'}</td>
            <td class="text-end whitespace-nowrap">${money(l.recorded_value)}</td>
            <td class="text-end">${l.realization_pct != null ? `${l.realization_pct}%` : '—'}</td>
            <td class="text-end">${fmtNumber(l.open_matters)}</td>
            <td class="text-end ${l.overdue_tasks ? 'text-red-700 font-semibold' : ''}">${fmtNumber(l.overdue_tasks)}</td></tr>`)}</tbody></table></div>
      </section>
      <section class="card">
        <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div><h2 class="font-semibold">${t('insights.clients')}</h2>
            ${ins.concentration.top1_pct != null ? html`<p class="text-xs ${ins.concentration.top1_pct >= 40 ? 'text-amber-700' : 'text-slate-500'}">${t('insights.concentration', { top1: ins.concentration.top1_pct, top5: ins.concentration.top5_pct, n: ins.concentration.billed_clients })}</p>` : ''}</div>
          <button class="btn btn-ghost btn-sm" data-action="export" data-section="clients"><i class="fas fa-file-csv"></i>CSV</button>
        </div>
        ${ins.clients.length ? html`<div class="overflow-x-auto"><table class="table text-sm">
          <thead><tr><th>${t('cases.client')}</th><th class="text-end">${t('insights.invoiced')}</th><th class="text-end">${t('insights.collected')}</th><th class="text-end">${t('billing.balance')}</th><th class="text-end">${t('insights.share')}</th></tr></thead>
          <tbody>${ins.clients.map((c) => html`<tr>
            <td><a class="hover:underline" href="#/clients/${c.id}" dir="auto">${getLang() === 'ar' ? c.name_ar || c.name : c.name}</a></td>
            <td class="text-end whitespace-nowrap">${money(c.invoiced)}</td>
            <td class="text-end whitespace-nowrap">${money(c.collected)}</td>
            <td class="text-end whitespace-nowrap ${c.outstanding > 0 ? 'text-amber-700' : ''}">${money(c.outstanding)}</td>
            <td class="text-end">${c.share_pct != null ? `${c.share_pct}%` : '—'}</td></tr>`)}</tbody></table></div>`
          : html`<p class="px-5 py-6 text-sm text-slate-500">${t('reports.no_invoices')}</p>`}
      </section>
    </div>

    <section class="card card-pad">
      <h2 class="font-semibold mb-1">${t('insights.enquiries')}</h2>
      <p class="text-xs text-slate-500 mb-4">${leads.median_response_hours != null ? t('insights.response', { h: leads.median_response_hours, n: leads.replied }) : t('insights.no_replies')}</p>
      ${leadTotal ? html`<div class="grid sm:grid-cols-2 gap-6">
        <ul class="space-y-2">${funnel.map(([s, n]) => html`<li><div class="flex justify-between text-sm mb-1"><span>${t(`web.lead_${s}`)}</span><span>${fmtNumber(n)}</span></div>${bar(n, leadTotal, s === 'converted' ? 'bg-emerald-500' : s === 'declined' ? 'bg-slate-300' : 'bg-brand-500')}</li>`)}</ul>
        <table class="table text-sm"><thead><tr><th>${t('insights.source')}</th><th class="text-end">${t('insights.enquiries_n')}</th><th class="text-end">${t('web.lead_converted')}</th></tr></thead>
          <tbody>${leads.by_source.map((s) => html`<tr><td>${t(`web.source_${s.key}`)}</td><td class="text-end">${fmtNumber(s.n)}</td><td class="text-end">${fmtNumber(s.converted)}</td></tr>`)}</tbody></table>
      </div>` : html`<p class="text-sm text-slate-500">${t('insights.no_enquiries')}</p>`}
    </section>
  </section>`
}

const bar = (value, max, cls = 'bg-brand-500') => html`<div class="h-2 rounded bg-slate-100 overflow-hidden"><div class="h-full ${cls}" style="width:${max ? Math.max(2, Math.round((value / max) * 100)) : 0}%"></div></div>`

export async function reportsView(root, { query, isCurrent }) {
  const [r, matters, logRes, ins] = await Promise.all([
    api.get('/api/reports' + qs({ from: query.get('from'), to: query.get('to') })),
    api.get('/api/reports/matters' + qs({ include_closed: query.get('closed') === '1' ? 'true' : '' })),
    api.get('/api/workspace/conflicts/log').catch(() => ({ items: [] })),
    api.get('/api/reports/insights' + qs({ from: query.get('from'), to: query.get('to') }))
  ])
  const conflictLog = logRes.items
  if (!isCurrent()) return
  const maxCase = Math.max(0, ...r.by_case.map((k) => k.minutes))
  const maxMonth = Math.max(1, ...r.cases_by_month.flatMap((m) => [m.opened, m.closed]))
  const maxArea = Math.max(0, ...r.by_practice_area.map((a) => a.n))

  render(root, html`
    ${pageHeader(t('nav.reports'), t('reports.subtitle'), html`<form data-form="range" class="flex flex-wrap items-end gap-2">
      <label class="text-xs text-slate-500">${t('reports.from')}<input type="date" name="from" class="input py-1.5" value="${r.from}" /></label>
      <label class="text-xs text-slate-500">${t('reports.to')}<input type="date" name="to" class="input py-1.5" value="${r.to}" /></label>
      <button type="submit" class="btn btn-outline">${t('reports.apply')}</button></form>`)}
    ${insightsSection(ins)}
    <div class="grid lg:grid-cols-2 gap-6">
      <section class="card card-pad">
        <h2 class="font-semibold mb-4">${t('reports.top_matters')}</h2>
        ${r.by_case.length ? html`<ul class="space-y-3">${r.by_case.map((k) => html`<li>
          <div class="flex justify-between gap-3 text-sm mb-1"><a href="#/cases/${k.id}" class="truncate hover:underline"><span class="font-mono text-xs text-slate-500">${k.reference}</span> ${k.title}</a><span class="font-mono whitespace-nowrap">${fmtHours(k.minutes)}</span></div>
          ${bar(k.minutes, maxCase, 'bg-gold-500')}</li>`)}</ul>` : emptyState('fa-folder-open', t('reports.no_time'), '')}
      </section>
      <section class="card card-pad">
        <h2 class="font-semibold mb-4">${t('reports.invoicing')}</h2>
        ${r.invoices.length ? html`<div class="overflow-x-auto"><table class="table text-sm">
          <thead><tr><th>${t('cases.currency')}</th><th class="text-end">${t('reports.invoiced')}</th><th class="text-end">${t('reports.collected')}</th><th class="text-end">${t('billing.balance')}</th><th class="text-end">${t('invoice_status.overdue')}</th></tr></thead>
          <tbody>${r.invoices.map((i) => html`<tr><td>${i.currency}</td><td class="text-end">${fmtMoney(i.invoiced, i.currency)}</td><td class="text-end">${fmtMoney(i.collected, i.currency)}</td><td class="text-end">${fmtMoney(i.outstanding, i.currency)}</td><td class="text-end text-red-600">${fmtMoney(i.overdue, i.currency)}</td></tr>`)}</tbody>
        </table></div>` : html`<p class="text-sm text-slate-500">${t('reports.no_invoices')}</p>`}
        ${r.aging.length ? html`<h3 class="font-semibold text-sm mt-6 mb-2">${t('reports.aging')}</h3>
          <div class="overflow-x-auto"><table class="table text-sm">
            <thead><tr><th></th><th class="text-end">${t('reports.not_due')}</th><th class="text-end">1–30</th><th class="text-end">31–60</th><th class="text-end">61–90</th><th class="text-end">90+</th></tr></thead>
            <tbody>${r.aging.map((a) => html`<tr><td>${a.currency}</td>${['current', 'd30', 'd60', 'd90', 'd90plus'].map((k) => html`<td class="text-end">${fmtMoney(a[k], a.currency)}</td>`)}</tr>`)}</tbody>
          </table></div>` : ''}
      </section>
      <section class="card card-pad">
        <h2 class="font-semibold mb-4">${t('reports.intake')}</h2>
        <div class="flex items-end gap-2 h-40" role="img" aria-label="${t('reports.intake')}">
          ${r.cases_by_month.map((m) => html`<div class="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div class="w-full flex items-end justify-center gap-0.5 h-32">
              <div class="w-1/2 bg-brand-500 rounded-t" style="height:${Math.round((m.opened / maxMonth) * 100)}%" title="${t('reports.opened')}: ${m.opened}"></div>
              <div class="w-1/2 bg-slate-300 rounded-t" style="height:${Math.round((m.closed / maxMonth) * 100)}%" title="${t('reports.closed')}: ${m.closed}"></div>
            </div>
            <span class="text-[10px] text-slate-500">${m.month.slice(5)}</span></div>`)}
        </div>
        <div class="flex gap-4 text-xs text-slate-500 mt-2"><span><span class="inline-block w-2 h-2 bg-brand-500 rounded"></span> ${t('reports.opened')}</span><span><span class="inline-block w-2 h-2 bg-slate-300 rounded"></span> ${t('reports.closed')}</span></div>
        <h3 class="font-semibold text-sm mt-6 mb-3">${t('reports.by_area')}</h3>
        ${r.by_practice_area.length ? html`<ul class="space-y-2">${r.by_practice_area.map((a) => html`<li>
          <div class="flex justify-between text-sm mb-1"><span>${a.key === 'other' ? t('doctype.other') : refLabel('practice_areas', a.key)}</span><span>${fmtNumber(a.n)}</span></div>${bar(a.n, maxArea, 'bg-emerald-500')}</li>`)}</ul>` : html`<p class="text-sm text-slate-500">—</p>`}
      </section>
      <section class="card lg:col-span-2">
        <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div><h2 class="font-semibold">${t('fees.report_title')}</h2><p class="text-xs text-slate-500">${t('fees.report_help')}</p></div>
          <label class="text-sm flex items-center gap-2"><input type="checkbox" data-change="closed" ${query.get('closed') === '1' ? 'checked' : ''} />${t('fees.include_closed')}</label>
        </div>
        ${matters.items.length ? html`<div class="overflow-x-auto"><table class="table text-sm">
          <thead><tr><th>${t('cases.reference')}</th><th>${t('fees.arrangement')}</th><th class="text-end">${t('fees.hours')}</th><th class="text-end">${t('fees.recorded')}</th>
            <th class="w-36">${t('fees.budget_used')}</th><th class="text-end">${t('fees.unbilled')}</th><th class="text-end">${t('fees.invoiced')}</th><th class="text-end">${t('fees.collected')}</th>
            <th class="text-end">${t('fees.realization')}</th><th class="text-end">${t('fees.effective_rate')}</th></tr></thead>
          <tbody>${matters.items.map((m) => html`<tr>
            <td><a class="hover:underline" href="#/cases/${m.id}"><span class="font-mono text-xs text-slate-500">${m.reference}</span> <span class="block truncate max-w-[14rem]" dir="auto">${m.title}</span></a></td>
            <td class="text-xs">${t(`fees.arr_${m.fee_arrangement}`)}</td>
            <td class="text-end font-mono">${fmtHours(m.billable_minutes)}</td>
            <td class="text-end whitespace-nowrap">${fmtMoney(m.recorded_value, m.currency)}</td>
            <td>${m.used_pct != null ? html`<div class="text-xs mb-1 ${m.budget_state === 'over' ? 'text-red-600 font-semibold' : m.budget_state === 'warning' ? 'text-amber-700' : 'text-slate-600'}">${m.used_pct}%</div>${bar(Math.min(m.used_pct, 100), 100, m.budget_state === 'over' ? 'bg-red-500' : m.budget_state === 'warning' ? 'bg-amber-500' : 'bg-emerald-500')}` : html`<span class="text-xs text-slate-400">—</span>`}</td>
            <td class="text-end whitespace-nowrap ${m.unbilled_time + m.unbilled_expenses > 0 ? 'text-amber-700' : ''}">${fmtMoney(m.unbilled_time + m.unbilled_expenses, m.currency)}</td>
            <td class="text-end whitespace-nowrap">${fmtMoney(m.invoiced_net, m.currency)}</td>
            <td class="text-end whitespace-nowrap">${fmtMoney(m.collected, m.currency)}</td>
            <td class="text-end">${m.realization_pct != null ? `${m.realization_pct}%` : '—'}</td>
            <td class="text-end whitespace-nowrap">${m.effective_rate != null ? fmtMoney(m.effective_rate, m.currency) : '—'}</td>
          </tr>`)}</tbody></table></div>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('fees.report_empty')}</p>`}
      </section>
      <section class="card lg:col-span-2">
        <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold"><i class="fas fa-shield-halved text-slate-400 me-1"></i>${t('conflicts.log_title')}</h2><p class="text-xs text-slate-500">${t('conflicts.log_help')}</p></div>
        ${conflictLog.length ? html`<div class="overflow-x-auto"><table class="table text-sm">
          <thead><tr><th>${t('conflicts.log_date')}</th><th>${t('conflicts.log_subject')}</th><th>${t('conflicts.log_matches')}</th><th>${t('conflicts.log_decision')}</th><th>${t('conflicts.reason')}</th><th>${t('conflicts.log_by')}</th></tr></thead>
          <tbody>${conflictLog.map((l) => html`<tr>
            <td class="whitespace-nowrap text-xs">${fmtDateTime(l.created_at)}</td>
            <td><a class="hover:underline" href="#/${l.subject_type === 'case' ? 'cases' : 'clients'}/${l.subject_id}"><i class="fas ${l.subject_type === 'case' ? 'fa-folder-open' : 'fa-address-book'} text-slate-400 me-1"></i><span dir="auto">${l.subject_name}</span></a></td>
            <td class="text-xs">${(l.matches || []).map((m) => m.reference || m.label).join(', ') || '—'}</td>
            <td>${l.decision === 'override' ? html`<span class="badge bg-red-100 text-red-700">${t('conflicts.decision_override')}</span>` : html`<span class="badge bg-emerald-100 text-emerald-800">${t('conflicts.decision_clear')}</span>`}</td>
            <td class="text-xs" dir="auto">${l.reason || '—'}</td>
            <td class="text-xs">${l.user_name || ''}</td></tr>`)}</tbody></table></div>`
          : html`<p class="px-5 py-6 text-sm text-slate-500">${t('conflicts.log_empty')}</p>`}
      </section>
      ${r.ai_usage.length ? html`<section class="card card-pad lg:col-span-2">
        <h2 class="font-semibold mb-3">${t('reports.ai_usage')}</h2>
        <div class="flex flex-wrap gap-3">${r.ai_usage.map((a) => html`<div class="rounded-lg bg-slate-50 px-4 py-2 text-sm"><span class="text-slate-500">${t(`ai_feature.${a.feature.split(':')[0]}`)}${a.feature.includes(':') ? ` · ${a.feature.split(':')[1]}` : ''}</span> <strong>${fmtNumber(a.n)}</strong></div>`)}</div>
      </section>` : ''}
    </div>`)
  bind(root, {
    actions: {
      export: (el) => download('/api/reports/insights/export' + qs({ from: ins.from, to: ins.to, section: el.dataset.section })),
      summary: (el) => busy(el, async () => {
        const box = root.querySelector('[data-summary]')
        try {
          const { summary } = await api.post('/api/reports/insights/summary', { from: ins.from, to: ins.to, language: getLang() === 'ar' ? 'ar' : 'en' })
          render(box, html`<div class="rounded-lg bg-brand-50 border border-brand-100 p-4 space-y-3 text-sm" dir="auto">
            <p class="font-semibold">${summary.headline}</p>
            ${summary.points.length ? html`<ul class="list-disc ms-5 space-y-1">${summary.points.map((x) => html`<li>${x}</li>`)}</ul>` : ''}
            ${summary.actions.length ? html`<div><p class="font-semibold mb-1">${t('insights.actions')}</p><ol class="list-decimal ms-5 space-y-1">${summary.actions.map((x) => html`<li>${x}</li>`)}</ol></div>` : ''}
            <p class="text-xs text-slate-500">${t('insights.ai_note')}</p></div>`)
        } catch (err) { showError(err) }
      })
    },
    changes: {
      closed: (el) => { location.hash = '#/reports' + qs({ from: query.get('from'), to: query.get('to'), closed: el.checked ? '1' : '' }) }
    },
    forms: {
      range: (form) => { location.hash = '#/reports' + qs({ from: form.elements.from.value, to: form.elements.to.value }) }
    }
  })
}
