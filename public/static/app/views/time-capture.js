import { api } from '../api.js'
import { html, render } from '../dom.js'
import { fmtDate, t } from '../i18n.js'
import { readOnly } from '../store.js'
import { busy, showError, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Suggested time entries from the lawyer's own activity this week: review,
// adjust, and log them in one go.
// ---------------------------------------------------------------------------

const ICONS = {
  hearing: 'fa-gavel', meeting: 'fa-people-group', draft: 'fa-pen-nib', revise: 'fa-pen-to-square', analysis: 'fa-magnifying-glass-chart',
  playbook: 'fa-chess-knight', outcome: 'fa-clipboard-check', signature: 'fa-signature', engagement: 'fa-handshake', judgment: 'fa-scale-balanced', messages: 'fa-comments'
}
const hours = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
const parseDuration = (v) => {
  const s = String(v).trim()
  const m = s.match(/^(\d+):(\d{1,2})$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : NaN
}

export async function timeSuggestionsPanel(box, { onAccepted } = {}) {
  if (!box || readOnly()) return
  let data
  try { data = await api.get('/api/time-suggestions') } catch { return }
  if (!document.body.contains(box) || !data.items.length) { render(box, ''); return }
  render(box, html`<section class="card mb-6 border-violet-200">
    <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
      <div><h2 class="font-semibold"><i class="fas fa-wand-magic-sparkles text-violet-500 me-1"></i> ${t('tc.title')}</h2>
        <p class="text-xs text-slate-500 mt-0.5">${t('tc.intro', { n: data.items.length, hours: hours(data.minutes) })}</p></div>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-sm" data-tc="dismiss"><i class="fas fa-eye-slash"></i>${t('tc.dismiss')}</button>
        <button class="btn btn-primary btn-sm" data-tc="accept"><i class="fas fa-check"></i>${t('tc.accept')}</button>
      </div>
    </div>
    <div class="overflow-x-auto"><table class="table">
      <thead><tr><th class="w-8"><input type="checkbox" data-tc-all checked aria-label="${t('tc.select_all')}" /></th><th>${t('billing.date')}</th><th>${t('cases.matter')}</th><th>${t('common.description')}</th><th class="text-end">${t('billing.hours')}</th></tr></thead>
      <tbody>${data.items.map((s, n) => html`<tr data-row="${n}">
        <td><input type="checkbox" data-tc-pick checked aria-label="${t('tc.select')}" /></td>
        <td class="text-sm whitespace-nowrap">${fmtDate(s.work_date, { hijri: false })}</td>
        <td class="text-xs whitespace-nowrap"><a class="text-brand-600 hover:underline" href="#/cases/${s.case_id}">${s.case_reference}</a></td>
        <td class="min-w-[18rem]"><div class="flex items-center gap-2"><i class="fas ${ICONS[s.kind] || 'fa-clock'} text-slate-400 w-4"></i>
          <input class="input py-1 text-sm" data-tc-desc value="${s.description}" maxlength="2000" dir="auto" aria-label="${t('common.description')}" />
          ${s.detail ? html`<span class="text-xs text-slate-400 whitespace-nowrap">${s.detail}</span>` : ''}</div></td>
        <td class="text-end"><input class="input py-1 text-sm w-20 text-end font-mono" data-tc-min value="${hours(s.minutes)}" dir="ltr" inputmode="decimal" aria-label="${t('billing.hours')}" /></td>
      </tr>`)}</tbody></table></div>
    <p class="px-5 py-3 text-xs text-slate-500 border-t border-slate-100">${t('tc.footnote')}</p>
  </section>`)
  const rows = () => [...box.querySelectorAll('[data-row]')]
  box.querySelector('[data-tc-all]').addEventListener('change', (e) => { for (const c of box.querySelectorAll('[data-tc-pick]')) c.checked = e.target.checked })
  box.onclick = (e) => {
    const btn = e.target.closest('[data-tc]')
    if (!btn) return
    const picked = rows().filter((r) => r.querySelector('[data-tc-pick]').checked)
    if (!picked.length) return toast(t('tc.pick_some'), 'error')
    busy(btn, async () => {
      try {
        if (btn.dataset.tc === 'dismiss') {
          await api.post('/api/time-suggestions/dismiss', { keys: picked.map((r) => data.items[Number(r.dataset.row)].key) })
          toast(t('tc.dismissed'))
        } else {
          const items = []
          for (const r of picked) {
            const s = data.items[Number(r.dataset.row)]
            const minutes = parseDuration(r.querySelector('[data-tc-min]').value)
            if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) { r.querySelector('[data-tc-min]').focus(); return toast(t('tc.bad_duration'), 'error') }
            items.push({ key: s.key, case_id: s.case_id, work_date: s.work_date, minutes, description: r.querySelector('[data-tc-desc]').value.trim() || s.description })
          }
          const res = await api.post('/api/time-suggestions/accept', { items })
          toast(t('tc.logged', { n: res.created }))
          onAccepted?.()
        }
        timeSuggestionsPanel(box, { onAccepted })
      } catch (err) { showError(err) }
    })
  }
}

// A one-line nudge on the dashboard when this week's activity is not yet logged.
export async function timeSuggestionsNudge(box) {
  if (!box || readOnly()) return
  let data
  try { data = await api.get('/api/time-suggestions') } catch { return }
  if (!document.body.contains(box) || !data.items.length) return
  render(box, html`<a href="#/billing?tab=time" class="card card-pad mb-6 flex items-center gap-3 border-violet-200 hover:shadow-md">
    <i class="fas fa-stopwatch text-violet-600 text-xl"></i>
    <div class="flex-1"><div class="font-semibold text-sm">${t('tc.dash_title', { hours: hours(data.minutes) })}</div><div class="text-xs text-slate-500">${t('tc.dash_help', { n: data.items.length })}</div></div>
    <i class="fas fa-chevron-right text-slate-400 rtl:rotate-180"></i></a>`)
}

