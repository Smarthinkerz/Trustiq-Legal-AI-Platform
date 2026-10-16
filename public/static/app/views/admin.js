import { api } from '../api.js'
import { bind, html, qs, raw, render } from '../dom.js'
import { fmtDate, fmtRelative, t } from '../i18n.js'
import { store } from '../store.js'
import { debounce, pageHeader, pagination, showError, spinner, toast } from '../ui.js'

// Platform operator console (only visible to PLATFORM_ADMIN_EMAILS).
export async function adminView(root, { query, isCurrent }) {
  if (!store.me.is_platform_admin) { location.hash = '#/dashboard'; return }
  const state = { page: Number(query.get('page')) || 1, q: query.get('q') || '' }
  const plans = Object.keys(store.ref.plans)
  render(root, html`
    ${pageHeader(t('nav.admin'), t('admin.subtitle'))}
    <div class="card">
      <div class="p-4 border-b border-slate-100"><input type="search" class="input" data-search placeholder="${t('admin.search')}" value="${state.q}" aria-label="${t('common.search')}" /></div>
      <div id="results">${spinner()}</div>
    </div>
    <section class="card mt-6"><h2 class="px-4 pt-4 font-semibold">${t('admin.ai_feedback')}</h2><div id="ai-feedback" class="p-4">${spinner()}</div></section>`)
  const results = root.querySelector('#results')
  const load = async () => {
    const res = await api.get('/api/admin/organizations' + qs({ page: state.page, q: state.q }))
    if (!isCurrent()) return
    render(results, html`<div class="overflow-x-auto"><table class="table">
      <thead><tr><th>${t('admin.organization')}</th><th>${t('admin.owner')}</th><th>${t('admin.users')}</th><th>${t('nav.cases')}</th><th>${t('admin.ai_month')}</th><th>${t('admin.last_active')}</th><th>${t('admin.plan')}</th><th>${t('admin.trial_ends')}</th><th>${t('admin.paid_until')}</th></tr></thead>
      <tbody>${res.items.map((o) => html`<tr>
        <td><div class="font-medium">${o.name}</div><div class="text-xs text-slate-400">${fmtDate(o.created_at)}</div></td>
        <td class="text-xs" dir="ltr">${o.owner_email || ''}</td>
        <td>${o.users}</td><td>${o.cases}</td><td>${o.ai_this_month}</td>
        <td class="text-xs">${o.last_active_at ? fmtRelative(o.last_active_at) : '—'}</td>
        <td><select class="input py-1 w-36" data-change="plan" data-id="${o.id}" aria-label="${t('admin.plan')}">${plans.map((p) => html`<option value="${p}" ${p === o.plan ? raw('selected') : ''}>${t(`plan.${p}`)}</option>`)}</select></td>
        <td><input type="date" class="input py-1 w-40" data-change="trial" data-id="${o.id}" value="${o.trial_ends_at ? String(o.trial_ends_at).slice(0, 10) : ''}" aria-label="${t('admin.trial_ends')}" /></td>
        <td><input type="date" class="input py-1 w-40" data-change="expires" data-id="${o.id}" value="${o.plan_expires_at ? String(o.plan_expires_at).slice(0, 10) : ''}" aria-label="${t('admin.paid_until')}" title="${t('admin.paid_until_help')}" /></td>
      </tr>`)}</tbody></table></div>${pagination(res)}`)
  }
  const reload = () => load().catch(showError)
  bind(root, {
    actions: { page: (el) => { state.page = Number(el.dataset.page); reload() } },
    changes: {
      plan: async (el) => { try { await api.patch(`/api/admin/organizations/${el.dataset.id}`, { plan: el.value }); toast(t('common.saved')) } catch (err) { showError(err); reload() } },
      expires: async (el) => {
        try {
          await api.patch(`/api/admin/organizations/${el.dataset.id}`, { plan_expires_at: el.value ? new Date(`${el.value}T23:59:59`).toISOString() : null })
          toast(t('common.saved'))
        } catch (err) { showError(err); reload() }
      },
      trial: async (el) => {
        try {
          await api.patch(`/api/admin/organizations/${el.dataset.id}`, { trial_ends_at: el.value ? new Date(`${el.value}T23:59:59`).toISOString() : null })
          toast(t('common.saved'))
        } catch (err) { showError(err); reload() }
      }
    }
  })
  const feedbackEl = root.querySelector('#ai-feedback')
  const loadFeedback = async () => {
    const { items } = await api.get('/api/admin/ai-feedback')
    if (!isCurrent()) return
    render(feedbackEl, items.length ? html`<ul class="space-y-4">${items.map((f) => html`<li class="border border-slate-200 rounded-lg p-3 text-sm space-y-2">
      <div class="flex flex-wrap gap-2 items-center"><span class="badge bg-red-100 text-red-800">${t(`ai.reason.${f.reason}`)}</span><span class="font-medium">${f.feature}</span>
        <span class="text-xs text-slate-500">${f.org_name || ''} · ${f.user_name || ''} · ${fmtRelative(f.created_at)}</span></div>
      ${f.excerpt ? html`<blockquote class="border-s-4 border-red-200 ps-3 text-slate-700" dir="auto">${f.excerpt}</blockquote>` : ''}
      ${f.note ? html`<p dir="auto">${f.note}</p>` : ''}
      ${f.log_output ? html`<details><summary class="cursor-pointer text-xs text-slate-500">${t('admin.ai_feedback_output')}</summary><pre class="whitespace-pre-wrap text-xs bg-slate-50 p-2 rounded mt-1" dir="auto">${String(f.log_output).slice(0, 5000)}</pre></details>` : ''}
      <div class="flex flex-wrap gap-2 items-center"><input class="input py-1 flex-1 min-w-48" data-res="${f.id}" placeholder="${t('admin.ai_feedback_resolution')}" aria-label="${t('admin.ai_feedback_resolution')}" />
        ${['reviewed', 'fixed', 'dismissed'].map((st) => html`<button class="btn btn-outline btn-sm" data-action="fb" data-id="${f.id}" data-status="${st}">${t(`admin.ai_feedback_status.${st}`)}</button>`)}</div>
    </li>`)}</ul>` : html`<p class="text-sm text-slate-500">${t('admin.ai_feedback_none')}</p>`)
    bind(feedbackEl, { actions: { fb: async (el) => {
      try {
        await api.patch(`/api/admin/ai-feedback/${el.dataset.id}`, { status: el.dataset.status, resolution: feedbackEl.querySelector(`[data-res="${el.dataset.id}"]`)?.value.trim() || null })
        toast(t('common.saved')); loadFeedback().catch(showError)
      } catch (err) { showError(err) }
    } } })
  }
  loadFeedback().catch(showError)
  root.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; reload() }))
  await load()
}
