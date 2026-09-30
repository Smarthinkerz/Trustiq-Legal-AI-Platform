import { api } from '../api.js'
import { bind, html, render } from '../dom.js'
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, t } from '../i18n.js'
import { aiEnabled, readOnly, store } from '../store.js'
import { eventBadge, statusBadge, priorityBadge } from '../ui.js'
import { openCaseForm } from './cases.js'
import { openUploadForm, openDraftForm } from './documents.js'

const kpi = (icon, color, label, value, href, alert) => html`
  <a href="${href}" class="card card-pad flex items-center gap-4 hover:shadow-md transition ${alert ? 'ring-1 ring-red-200' : ''}">
    <div class="w-11 h-11 rounded-lg ${color} flex items-center justify-center shrink-0"><i class="fas ${icon}"></i></div>
    <div class="min-w-0">
      <div class="text-2xl font-bold ${alert ? 'text-red-600' : 'text-slate-900'}">${fmtNumber(value)}</div>
      <div class="text-xs text-slate-500 leading-tight">${label}</div>
    </div>
  </a>`

function usageBar(label, used, limit) {
  const pct = limit == null ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100))
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-brand-500'
  return html`<div>
    <div class="flex justify-between text-xs mb-1"><span class="text-slate-600">${label}</span>
      <span class="font-semibold" dir="ltr">${fmtNumber(used)} / ${limit == null ? '∞' : fmtNumber(limit)}</span></div>
    <div class="h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-full ${color}" style="width:${pct}%"></div></div>
  </div>`
}

export async function dashboardView(root, { isCurrent }) {
  const d = await api.get('/api/dashboard')
  if (!isCurrent()) return
  const { counts, usage } = d
  const plan = store.me.plan
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('dash.good_morning') : hour < 18 ? t('dash.good_afternoon') : t('dash.good_evening')
  const ro = readOnly()

  render(root, html`
    <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold">${greeting}, ${store.me.user.name.split(' ')[0]}</h1>
        <p class="text-sm text-slate-500 mt-1">${store.me.org.name}</p>
      </div>
      ${ro ? '' : html`<div class="flex flex-wrap gap-2">
        <button class="btn btn-primary" data-action="new-case"><i class="fas fa-folder-plus"></i>${t('cases.new')}</button>
        <button class="btn btn-outline" data-action="upload"><i class="fas fa-upload"></i>${t('docs.upload')}</button>
        ${aiEnabled() ? html`<button class="btn btn-outline" data-action="draft"><i class="fas fa-pen-nib"></i>${t('docs.ai_draft')}</button>` : ''}
      </div>`}
    </div>

    ${!aiEnabled() ? html`<div class="rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3 mb-6"><i class="fas fa-triangle-exclamation"></i> ${t('ai.not_configured_banner')}</div>` : ''}

    <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      ${kpi('fa-folder-open', 'bg-brand-50 text-brand-700', t('dash.open_cases'), counts.open_cases, '#/cases?status=open')}
      ${kpi('fa-fire', 'bg-orange-50 text-orange-600', t('dash.priority_cases'), counts.priority_cases, '#/cases?status=open')}
      ${kpi('fa-user-tie', 'bg-violet-50 text-violet-600', t('dash.my_cases'), counts.my_cases, `#/cases?status=open&assigned_to=${store.me.user.id}`)}
      ${kpi('fa-address-book', 'bg-emerald-50 text-emerald-600', t('dash.clients'), counts.clients, '#/clients')}
      ${kpi('fa-file-lines', 'bg-sky-50 text-sky-600', t('dash.documents'), counts.documents, '#/documents')}
      ${kpi('fa-triangle-exclamation', 'bg-red-50 text-red-600', t('dash.overdue'), counts.overdue_deadlines, '#/calendar', counts.overdue_deadlines > 0)}
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <section class="card">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 class="font-semibold">${t('dash.upcoming')}</h2>
            <a href="#/calendar" class="text-sm text-brand-600 hover:underline">${t('dash.open_calendar')}</a>
          </div>
          ${d.upcoming.length ? html`<ul class="divide-y divide-slate-100">
            ${d.upcoming.map((e) => html`<li class="px-5 py-3 flex items-center gap-3">
              <div class="w-24 shrink-0 text-xs text-slate-500">${e.all_day ? fmtDate(e.starts_at) : fmtDateTime(e.starts_at)}</div>
              ${eventBadge(e.kind)}
              <div class="min-w-0 flex-1 truncate text-sm font-medium">${e.title}</div>
              ${e.case_id ? html`<a class="text-xs text-brand-600 hover:underline shrink-0" href="#/cases/${e.case_id}">${e.case_reference}</a>` : ''}
            </li>`)}
          </ul>` : html`<p class="px-5 py-8 text-sm text-slate-500 text-center">${t('dash.no_upcoming')}</p>`}
        </section>

        <section class="card">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 class="font-semibold">${t('dash.recent_cases')}</h2>
            <a href="#/cases" class="text-sm text-brand-600 hover:underline">${t('common.view_all')}</a>
          </div>
          ${d.recent_cases.length ? html`<ul class="divide-y divide-slate-100">
            ${d.recent_cases.map((k) => html`<li><a href="#/cases/${k.id}" class="px-5 py-3 flex flex-wrap items-center gap-3 hover:bg-slate-50">
              <span class="text-xs font-mono text-slate-500 w-20">${k.reference}</span>
              <span class="flex-1 min-w-0 truncate text-sm font-medium">${k.title}</span>
              ${priorityBadge(k.priority)} ${statusBadge(k.status)}
              <span class="text-xs text-slate-400 w-24 text-end">${fmtRelative(k.updated_at)}</span>
            </a></li>`)}
          </ul>` : html`<div class="px-5 py-8 text-center text-sm text-slate-500">${t('dash.no_cases')}
            ${ro ? '' : html`<div class="mt-3"><button class="btn btn-primary btn-sm" data-action="new-case">${t('cases.new')}</button></div>`}</div>`}
        </section>
      </div>

      <div class="space-y-6">
        <section class="card card-pad">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-semibold">${t('dash.usage')}</h2>
            <span class="badge bg-brand-50 text-brand-700">${t(`plan.${plan.id}`)}</span>
          </div>
          <div class="space-y-4">
            ${usageBar(t('usage.open_cases'), usage.active_cases, plan.maxActiveCases)}
            ${usageBar(t('usage.documents_month'), usage.documents_this_month, plan.documentsPerMonth)}
            ${usageBar(t('usage.ai_month'), usage.ai_requests_this_month, plan.aiRequestsPerMonth)}
          </div>
          <a href="#/settings?tab=plan" class="block text-sm text-brand-600 hover:underline mt-4">${t('dash.manage_plan')}</a>
        </section>

        <section class="card">
          <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 class="font-semibold">${t('dash.recent_documents')}</h2>
            <a href="#/documents" class="text-sm text-brand-600 hover:underline">${t('common.view_all')}</a>
          </div>
          ${d.recent_documents.length ? html`<ul class="divide-y divide-slate-100">
            ${d.recent_documents.map((doc) => html`<li><a href="#/documents/${doc.id}" class="px-5 py-3 flex items-center gap-3 hover:bg-slate-50">
              <i class="fas ${doc.source === 'ai' ? 'fa-wand-magic-sparkles text-violet-500' : doc.source === 'upload' ? 'fa-file-arrow-up text-sky-500' : 'fa-file-lines text-slate-400'}"></i>
              <span class="flex-1 min-w-0 truncate text-sm">${doc.title}</span>
              <span class="text-xs text-slate-400">${fmtRelative(doc.updated_at)}</span>
            </a></li>`)}
          </ul>` : html`<p class="px-5 py-8 text-sm text-slate-500 text-center">${t('dash.no_documents')}</p>`}
        </section>
      </div>
    </div>`)

  bind(root, {
    actions: {
      'new-case': () => openCaseForm({ onSaved: (k) => (location.hash = `#/cases/${k.id}`) }),
      upload: () => openUploadForm({ onSaved: (doc) => (location.hash = `#/documents/${doc.id}`) }),
      draft: () => openDraftForm({ onSaved: (doc) => (location.hash = `#/documents/${doc.id}`) })
    }
  })
}
