import { api, download } from '../api.js'
import { bind, html, raw, render } from '../dom.js'
import { fmtDateLong, t } from '../i18n.js'
import { can, readOnly, store } from '../store.js'
import { emptyState, pageHeader, showError, spinner, toast } from '../ui.js'
import { openOutcomeForm } from './hearings.js'
import { loadMembers } from './pickers.js'

// ---------------------------------------------------------------------------
// Court roll (جدول الجلسات): hearings for a period by day and court, who
// attends each one, and a printable Word copy in Arabic or English.
// ---------------------------------------------------------------------------

const muscatDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })
const PRESETS = { today: [0, 0], tomorrow: [1, 1], week: [0, 6], next_week: [7, 13] }

export async function rollView(root, { query, isCurrent }) {
  const preset = PRESETS[query.get('range')] ? query.get('range') : 'tomorrow'
  const state = {
    preset,
    from: query.get('from') || muscatDay(PRESETS[preset][0]),
    to: query.get('to') || muscatDay(PRESETS[preset][1]),
    who: query.get('who') || '',
    data: null
  }
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  const members = await loadMembers().catch(() => [])
  if (!isCurrent()) return

  const qs = (extra = {}) => new URLSearchParams({ from: state.from, to: state.to, ...(state.who ? { who: state.who } : {}), ...extra }).toString()
  const draw = () => {
    render(root, html`
      ${pageHeader(t('roll.title'), t('roll.subtitle'), html`
        <a class="btn btn-outline" href="#/workload"><i class="fas fa-people-arrows"></i>${t('wl.title')}</a>
        <button class="btn btn-outline" data-action="word" data-lang="ar"><i class="fas fa-file-word"></i>${t('roll.word_ar')}</button>
        <button class="btn btn-outline" data-action="word" data-lang="en"><i class="fas fa-file-word"></i>${t('roll.word_en')}</button>`)}
      <div class="card card-pad mb-6 flex flex-wrap items-end gap-3">
        <div class="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
          ${Object.keys(PRESETS).map((p) => html`<button class="px-3 py-1.5 rounded-md ${state.preset === p ? 'bg-brand-600 text-white' : 'text-slate-600'}" data-action="preset" data-preset="${p}">${t(`roll.p_${p}`)}</button>`)}
        </div>
        <label class="text-sm"><span class="block text-slate-500 text-xs mb-1">${t('roll.from')}</span><input type="date" class="input" data-date="from" value="${state.from}" /></label>
        <label class="text-sm"><span class="block text-slate-500 text-xs mb-1">${t('roll.to')}</span><input type="date" class="input" data-date="to" value="${state.to}" /></label>
        <label class="text-sm"><span class="block text-slate-500 text-xs mb-1">${t('roll.lawyer')}</span>
          <select class="input" data-who>
            <option value="">${t('roll.everyone')}</option>
            <option value="me" ${state.who === 'me' ? raw('selected') : ''}>${t('roll.me')}</option>
            ${members.filter((m) => m.id !== store.me.user.id).map((m) => html`<option value="${m.id}" ${state.who === m.id ? raw('selected') : ''}>${m.name}</option>`)}
          </select></label>
      </div>
      <div data-list>${spinner()}</div>`)
    for (const el of root.querySelectorAll('[data-date]')) el.addEventListener('change', () => { state[el.dataset.date] = el.value; state.preset = null; load() })
    root.querySelector('[data-who]').addEventListener('change', (e) => { state.who = e.target.value; load() })
  }

  const now = Date.now()
  const drawList = () => {
    const { days, total, unassigned } = state.data
    render(root.querySelector('[data-list]'), total ? html`
      ${unassigned ? html`<p class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4"><i class="fas fa-user-clock"></i> ${t('roll.unassigned', { n: unassigned })}</p>` : ''}
      <div class="space-y-6">${days.map((d) => html`<section>
        <h2 class="font-semibold text-lg mb-3">${fmtDateLong(d.day)}</h2>
        <div class="space-y-4">${d.courts.map((c) => html`<div class="card overflow-hidden">
          <div class="px-5 py-3 bg-slate-50 border-b border-slate-100 font-medium text-sm"><i class="fas fa-landmark text-slate-400 me-1"></i> <span dir="auto">${c.court || t('roll.no_court')}</span> <span class="text-slate-400">· ${c.hearings.length}</span></div>
          <div class="overflow-x-auto"><table class="table">
            <thead><tr><th>${t('roll.time')}</th><th>${t('roll.matter')}</th><th>${t('roll.parties')}</th><th>${t('roll.attends')}</th><th>${t('roll.last')}</th><th></th></tr></thead>
            <tbody>${c.hearings.map((h) => html`<tr>
              <td class="font-mono text-sm whitespace-nowrap">${h.time ?? t('roll.all_day')}</td>
              <td>${h.case_id ? html`<a class="font-medium text-brand-700 hover:underline" href="#/cases/${h.case_id}"><span class="font-mono text-xs">${h.reference}</span><br /><span dir="auto">${h.case_title}</span></a>` : html`<span dir="auto">${h.title}</span>`}</td>
              <td class="text-sm"><div dir="auto">${h.client_name || '—'}</div>${h.opposing_party ? html`<div class="text-xs text-slate-500" dir="auto">${t('roll.versus')} ${h.opposing_party}</div>` : ''}</td>
              <td class="text-sm">${editable ? html`<select class="input py-1 text-sm min-w-[9rem]" data-attendee="${h.id}" aria-label="${t('roll.attends')}">
                  <option value="">${h.lawyer_name ? t('roll.responsible', { name: h.lawyer_name }) : t('pickers.unassigned')}</option>
                  ${members.map((m) => html`<option value="${m.id}" ${h.attendee_id === m.id ? raw('selected') : ''}>${m.name}</option>`)}</select>`
                : html`${h.attendee_name || h.lawyer_name || '—'}`}</td>
              <td class="text-xs max-w-xs">${h.last_outcome ? html`<div class="font-medium">${t(`hearing.outcome_${h.last_outcome}`)} <span class="text-slate-400">· ${h.last_date}</span></div>
                <div class="text-slate-600 line-clamp-2" dir="auto">${h.last_summary}</div>
                ${h.last_next_steps ? html`<div class="text-emerald-800 mt-1 line-clamp-2" dir="auto"><i class="fas fa-list-check"></i> ${h.last_next_steps}</div>` : ''}` : html`<span class="text-slate-400">—</span>`}</td>
              <td class="text-end whitespace-nowrap">${h.recorded ? html`<span class="badge bg-emerald-100 text-emerald-800"><i class="fas fa-check"></i> ${t('roll.recorded')}</span>`
                : editable && h.case_id && new Date(h.starts_at).getTime() <= now ? html`<button class="btn btn-primary btn-sm" data-action="outcome" data-id="${h.id}"><i class="fas fa-gavel"></i>${t('hearing.record')}</button>`
                : h.case_id ? html`<a class="btn btn-outline btn-sm" href="#/hearing-prep/${h.id}"><i class="fas fa-clipboard-list"></i>${t('prep.button')}</a>` : ''}</td>
            </tr>`)}</tbody></table></div></div>`)}</div>
      </section>`)}</div>`
      : emptyState('fa-landmark', t('roll.empty'), ''))
    for (const el of root.querySelectorAll('[data-attendee]')) {
      el.addEventListener('change', async () => {
        try { await api.patch(`/api/roll/${el.dataset.attendee}`, { attendee_id: el.value || null }); toast(t('common.saved')); if (state.who) load() } catch (err) { showError(err) }
      })
    }
  }

  const load = async () => {
    const box = root.querySelector('[data-list]')
    render(box, spinner())
    history.replaceState(null, '', `#/roll?${state.preset ? new URLSearchParams({ range: state.preset, ...(state.who ? { who: state.who } : {}) }) : qs()}`)
    try {
      state.data = await api.get(`/api/roll?${qs()}`)
      if (isCurrent()) drawList()
    } catch (err) { if (isCurrent()) render(box, ''); showError(err) }
  }

  bind(root, {
    actions: {
      preset: (el) => {
        const [a, b] = PRESETS[el.dataset.preset]
        Object.assign(state, { preset: el.dataset.preset, from: muscatDay(a), to: muscatDay(b) })
        draw(); load()
      },
      word: (el) => download(`/api/roll?${qs({ format: 'docx', lang: el.dataset.lang })}`),
      outcome: (el) => {
        const h = state.data.days.flatMap((d) => d.courts.flatMap((c) => c.hearings)).find((x) => x.id === el.dataset.id)
        openOutcomeForm({ id: h.id, title: h.title, starts_at: h.starts_at, all_day: h.all_day, case_reference: h.reference, kind: 'hearing' }, { hasClient: !!h.client_name, onSaved: load })
      }
    }
  })
  draw()
  await load()
}

