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
    </div>`)
  const results = root.querySelector('#results')
  const load = async () => {
    const res = await api.get('/api/admin/organizations' + qs({ page: state.page, q: state.q }))
    if (!isCurrent()) return
    render(results, html`<div class="overflow-x-auto"><table class="table">
      <thead><tr><th>${t('admin.organization')}</th><th>${t('admin.owner')}</th><th>${t('admin.users')}</th><th>${t('nav.cases')}</th><th>${t('admin.ai_month')}</th><th>${t('admin.last_active')}</th><th>${t('admin.plan')}</th><th>${t('admin.trial_ends')}</th></tr></thead>
      <tbody>${res.items.map((o) => html`<tr>
        <td><div class="font-medium">${o.name}</div><div class="text-xs text-slate-400">${fmtDate(o.created_at)}</div></td>
        <td class="text-xs" dir="ltr">${o.owner_email || ''}</td>
        <td>${o.users}</td><td>${o.cases}</td><td>${o.ai_this_month}</td>
        <td class="text-xs">${o.last_active_at ? fmtRelative(o.last_active_at) : '—'}</td>
        <td><select class="input py-1 w-36" data-change="plan" data-id="${o.id}" aria-label="${t('admin.plan')}">${plans.map((p) => html`<option value="${p}" ${p === o.plan ? raw('selected') : ''}>${t(`plan.${p}`)}</option>`)}</select></td>
        <td><input type="date" class="input py-1 w-40" data-change="trial" data-id="${o.id}" value="${o.trial_ends_at ? String(o.trial_ends_at).slice(0, 10) : ''}" aria-label="${t('admin.trial_ends')}" /></td>
      </tr>`)}</tbody></table></div>${pagination(res)}`)
  }
  const reload = () => load().catch(showError)
  bind(root, {
    actions: { page: (el) => { state.page = Number(el.dataset.page); reload() } },
    changes: {
      plan: async (el) => { try { await api.patch(`/api/admin/organizations/${el.dataset.id}`, { plan: el.value }); toast(t('common.saved')) } catch (err) { showError(err); reload() } },
      trial: async (el) => {
        try {
          await api.patch(`/api/admin/organizations/${el.dataset.id}`, { trial_ends_at: el.value ? new Date(`${el.value}T23:59:59`).toISOString() : null })
          toast(t('common.saved'))
        } catch (err) { showError(err); reload() }
      }
    }
  })
  root.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; reload() }))
  await load()
}
