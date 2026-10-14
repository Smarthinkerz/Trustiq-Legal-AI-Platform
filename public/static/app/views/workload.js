import { api } from '../api.js'
import { bind, html, render } from '../dom.js'
import { fmtDate, fmtDateTime, t } from '../i18n.js'
import { can } from '../store.js'
import { pageHeader, showError, spinner, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Team workload (توزيع العمل): the next 14 days per person, court clashes, and
// handing hearings, deadlines, tasks and matters to someone else.
// ---------------------------------------------------------------------------

const LEVEL = { high: 'bg-red-100 text-red-700', normal: 'bg-slate-100 text-slate-700', free: 'bg-emerald-100 text-emerald-800' }
const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(document.documentElement.lang === 'ar' ? 'ar-OM' : 'en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

export async function workloadView(root, { isCurrent }) {
  const manager = can('owner', 'admin', 'lawyer')
  render(root, html`${pageHeader(t('wl.title'), t('wl.subtitle'))}<div data-board>${spinner()}</div>`)
  const state = { open: null, items: null }
  let d
  const draw = () => {
    const clashDays = (m) => new Set(m.clashes.map((c) => c.day))
    render(root.querySelector('[data-board]'), html`
      ${d.clashes || d.unassigned_hearings ? html`<div class="flex flex-wrap gap-3 mb-4">
        ${d.clashes ? html`<div class="card card-pad border-red-200 text-sm text-red-800"><i class="fas fa-code-compare"></i> ${t('wl.clashes', { n: d.clashes })}</div>` : ''}
        ${d.unassigned_hearings ? html`<a href="#/roll" class="card card-pad border-amber-200 text-sm text-amber-800 hover:shadow-md"><i class="fas fa-user-slash"></i> ${t('wl.unassigned', { n: d.unassigned_hearings })}</a>` : ''}
      </div>` : ''}
      <div class="card overflow-x-auto"><table class="table">
        <thead><tr><th>${t('wl.member')}</th><th class="text-center">${t('wl.matters')}</th><th class="text-center">${t('wl.hearings')}</th><th class="text-center">${t('wl.deadlines')}</th>
          <th class="text-center">${t('wl.overdue')}</th><th class="text-center">${t('wl.tasks')}</th><th class="text-center">${t('wl.hours')}</th>
          ${d.days.map((day) => html`<th class="text-center text-[10px] font-normal whitespace-nowrap px-1">${dayLabel(day)}</th>`)}</tr></thead>
        <tbody>${d.members.map((m) => html`<tr class="clickable ${state.open === m.id ? 'bg-slate-50' : ''}" data-action="open" data-id="${m.id}">
          <td class="whitespace-nowrap"><div class="font-medium">${m.name}</div><span class="badge ${LEVEL[m.level]}">${t(`wl.level_${m.level}`)}</span> <span class="text-xs text-slate-500">${t(`role.${m.role}`)}</span></td>
          <td class="text-center">${m.open_matters}</td><td class="text-center font-semibold">${m.hearings}</td><td class="text-center">${m.deadlines}</td>
          <td class="text-center ${m.overdue_deadlines + m.overdue_tasks ? 'text-red-700 font-semibold' : 'text-slate-400'}">${m.overdue_deadlines + m.overdue_tasks}</td>
          <td class="text-center">${m.open_tasks}</td><td class="text-center text-slate-600">${m.hours_30d}</td>
          ${m.per_day.map((n, i) => html`<td class="px-1 text-center"><span class="inline-flex w-6 h-6 items-center justify-center rounded text-[11px]
            ${clashDays(m).has(d.days[i]) ? 'bg-red-600 text-white font-bold' : n >= 2 ? 'bg-amber-200 text-amber-900' : n ? 'bg-brand-100 text-brand-800' : 'text-slate-300'}">${n || '·'}</span></td>`)}
        </tr>
        ${state.open === m.id ? html`<tr><td colspan="${7 + d.days.length}" class="bg-slate-50">${state.items ? detail(m) : spinner()}</td></tr>` : ''}`)}</tbody></table></div>
      <p class="text-xs text-slate-500 mt-3">${t('wl.legend')}</p>`)
  }
  const handTo = (kind, id, exclude) => manager ? html`<select class="input py-0.5 text-xs w-36" data-change="hand" data-kind="${kind}" data-id="${id}" aria-label="${t('wl.hand_to')}">
    <option value="">${t('wl.hand_to')}</option>${d.members.filter((x) => x.id !== exclude).map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select>` : ''
  const detail = (m) => {
    const it = state.items
    const clash = m.clashes.length ? html`<div class="mb-3 rounded-lg bg-red-50 text-red-800 p-3 text-sm"><b><i class="fas fa-code-compare"></i> ${t('wl.clash_title')}</b>
      ${m.clashes.map((c) => html`<div class="mt-1">${fmtDate(c.day)}: ${c.hearings.map((h) => html`<span class="me-3">${h.time || ''} <bdi dir="ltr">${h.reference}</bdi> · <span dir="auto">${h.place}</span></span>`)}</div>`)}</div>` : ''
    const row = (main, sub, kind, id, tone = '') => html`<li class="flex flex-wrap items-center gap-2 py-1.5 text-sm"><div class="flex-1 min-w-0 ${tone}">${main}<div class="text-xs text-slate-500">${sub}</div></div>${handTo(kind, id, m.id)}</li>`
    return html`<div class="p-3">${clash}<div class="grid lg:grid-cols-3 gap-4">
      <div><h3 class="font-semibold text-sm mb-1">${t('wl.hearings')}</h3><ul class="divide-y divide-slate-200">${it.hearings.length ? it.hearings.map((h) => row(
        html`<a class="text-brand-600 hover:underline" href="#/hearing-prep/${h.id}"><bdi dir="ltr">${h.reference || ''}</bdi></a> <span dir="auto">${h.case_title || h.title}</span>`,
        html`${h.all_day ? fmtDate(h.starts_at) : fmtDateTime(h.starts_at)}${h.place ? html` · <span dir="auto">${h.place}</span>` : ''}`, 'hearing', h.id)) : html`<li class="text-xs text-slate-500 py-2">${t('wl.none')}</li>`}</ul></div>
      <div><h3 class="font-semibold text-sm mb-1">${t('wl.deadlines_tasks')}</h3><ul class="divide-y divide-slate-200">
        ${it.deadlines.map((x) => row(html`<span dir="auto">${x.title}</span>`, html`${fmtDate(x.starts_at)}${x.reference ? html` · <bdi dir="ltr">${x.reference}</bdi>` : ''}`, 'deadline', x.id, x.overdue ? 'text-red-700' : ''))}
        ${it.tasks.map((x) => row(html`<i class="fas fa-list-check text-slate-400"></i> <span dir="auto">${x.title}</span>`, html`${x.due_date ? fmtDate(x.due_date) : t('wl.no_due')}${x.reference ? html` · <bdi dir="ltr">${x.reference}</bdi>` : ''}`, 'task', x.id, x.overdue ? 'text-red-700' : ''))}
        ${!it.deadlines.length && !it.tasks.length ? html`<li class="text-xs text-slate-500 py-2">${t('wl.none')}</li>` : ''}</ul></div>
      <div><h3 class="font-semibold text-sm mb-1">${t('wl.matters')}</h3><ul class="divide-y divide-slate-200">${it.matters.length ? it.matters.map((k) => html`<li class="flex flex-wrap items-center gap-2 py-1.5 text-sm">
        <a class="flex-1 min-w-0 text-brand-600 hover:underline" href="#/cases/${k.id}"><bdi dir="ltr">${k.reference}</bdi> <span dir="auto">${k.title}</span></a>
        ${can('owner', 'admin') ? handTo('matter', k.id, m.id) : ''}</li>`) : html`<li class="text-xs text-slate-500 py-2">${t('wl.none')}</li>`}</ul></div>
    </div></div>`
  }
  const load = async () => {
    d = await api.get('/api/workload')
    if (!isCurrent()) return
    if (state.open) state.items = await api.get(`/api/workload/${state.open}`)
    draw()
  }
  bind(root, {
    actions: {
      open: async (el) => {
        state.open = state.open === el.dataset.id ? null : el.dataset.id
        state.items = null
        draw()
        if (state.open) { try { state.items = await api.get(`/api/workload/${state.open}`); draw() } catch (err) { showError(err) } }
      }
    },
    changes: {
      hand: async (el) => {
        const to = el.value
        if (!to) return
        el.disabled = true
        try {
          const r = await api.post('/api/workload/reassign', { kind: el.dataset.kind, id: el.dataset.id, to })
          toast(t('wl.handed', { name: r.to.name }))
          await load()
        } catch (err) { el.disabled = false; el.value = ''; showError(err) }
      }
    }
  })
  await load()
}
