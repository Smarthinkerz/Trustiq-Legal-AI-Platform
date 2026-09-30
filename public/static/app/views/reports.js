import { api } from '../api.js'
import { bind, html, qs, render } from '../dom.js'
import { fmtMoney, fmtNumber, t } from '../i18n.js'
import { refLabel, store } from '../store.js'
import { emptyState, pageHeader } from '../ui.js'
import { fmtHours } from './billing.js'

const bar = (value, max, cls = 'bg-brand-500') => html`<div class="h-2 rounded bg-slate-100 overflow-hidden"><div class="h-full ${cls}" style="width:${max ? Math.max(2, Math.round((value / max) * 100)) : 0}%"></div></div>`

export async function reportsView(root, { query, isCurrent }) {
  const r = await api.get('/api/reports' + qs({ from: query.get('from'), to: query.get('to') }))
  if (!isCurrent()) return
  const cur = store.me.org.default_currency
  const maxUser = Math.max(0, ...r.by_user.map((u) => u.minutes))
  const maxCase = Math.max(0, ...r.by_case.map((k) => k.minutes))
  const maxMonth = Math.max(1, ...r.cases_by_month.flatMap((m) => [m.opened, m.closed]))
  const maxArea = Math.max(0, ...r.by_practice_area.map((a) => a.n))
  const totalMinutes = r.by_user.reduce((s, u) => s + u.minutes, 0)
  const billable = r.by_user.reduce((s, u) => s + u.billable_minutes, 0)
  const value = r.by_user.reduce((s, u) => s + u.value, 0)
  const card = (label, v, icon) => html`<div class="card card-pad"><div class="text-xs text-slate-500 flex items-center gap-2"><i class="fas ${icon}"></i>${label}</div><div class="text-2xl font-bold mt-1">${v}</div></div>`

  render(root, html`
    ${pageHeader(t('nav.reports'), t('reports.subtitle'), html`<form data-form="range" class="flex flex-wrap items-end gap-2">
      <label class="text-xs text-slate-500">${t('reports.from')}<input type="date" name="from" class="input py-1.5" value="${r.from}" /></label>
      <label class="text-xs text-slate-500">${t('reports.to')}<input type="date" name="to" class="input py-1.5" value="${r.to}" /></label>
      <button type="submit" class="btn btn-outline">${t('reports.apply')}</button></form>`)}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${card(t('reports.hours_logged'), fmtHours(totalMinutes), 'fa-stopwatch')}
      ${card(t('reports.billable_hours'), fmtHours(billable), 'fa-sack-dollar')}
      ${card(t('reports.billable_value'), fmtMoney(Math.round(value * 1000) / 1000, cur), 'fa-coins')}
      ${card(t('reports.utilisation'), totalMinutes ? `${Math.round((billable / totalMinutes) * 100)}%` : '—', 'fa-gauge')}
    </div>
    <div class="grid lg:grid-cols-2 gap-6">
      <section class="card card-pad">
        <h2 class="font-semibold mb-4">${t('reports.by_lawyer')}</h2>
        ${r.by_user.length ? html`<ul class="space-y-3">${r.by_user.map((u) => html`<li>
          <div class="flex justify-between text-sm mb-1"><span class="truncate">${u.name}</span><span class="font-mono">${fmtHours(u.minutes)} <span class="text-slate-400">(${fmtHours(u.billable_minutes)})</span></span></div>
          ${bar(u.minutes, maxUser)}</li>`)}</ul>` : emptyState('fa-stopwatch', t('reports.no_time'), '')}
      </section>
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
      ${r.ai_usage.length ? html`<section class="card card-pad lg:col-span-2">
        <h2 class="font-semibold mb-3">${t('reports.ai_usage')}</h2>
        <div class="flex flex-wrap gap-3">${r.ai_usage.map((a) => html`<div class="rounded-lg bg-slate-50 px-4 py-2 text-sm"><span class="text-slate-500">${t(`ai_feature.${a.feature.split(':')[0]}`)}${a.feature.includes(':') ? ` · ${a.feature.split(':')[1]}` : ''}</span> <strong>${fmtNumber(a.n)}</strong></div>`)}</div>
      </section>` : ''}
    </div>`)
  bind(root, {
    forms: {
      range: (form) => { location.hash = '#/reports' + qs({ from: form.elements.from.value, to: form.elements.to.value }) }
    }
  })
}
