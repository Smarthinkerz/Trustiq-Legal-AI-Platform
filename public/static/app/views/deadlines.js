import { api } from '../api.js'
import { bind, formData, html, raw, render } from '../dom.js'
import { fmtDate, fmtDateLong, fmtHijri, getLang, t, weekdayNames } from '../i18n.js'
import { can, readOnly, refOptions, store } from '../store.js'
import { busy, confirmDialog, inputField, pageHeader, selectField, showError, submitButton, toast } from '../ui.js'
import { openEventForm } from './calendar.js'

const UNITS = ['days', 'working_days', 'weeks', 'months', 'years']
const pad = (n) => String(n).padStart(2, '0')
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

export async function deadlinesView(root, { isCurrent }) {
  const year = new Date().getFullYear()
  let holidays = (await api.get(`/api/deadlines/holidays?year=${year}`)).items
  if (!isCurrent()) return
  const jurisdictions = refOptions('jurisdictions').filter((j) => j.value !== 'international')
  const canEdit = can('owner', 'admin', 'lawyer') && !readOnly()
  let last = null
  let lastInput = null

  const resultCard = () => {
    if (!last) return html`<p class="text-sm text-slate-500">${t('deadlines.hint')}</p>`
    const r = last.result
    const days = weekdayNames('long')
    return html`
      <div class="rounded-xl bg-amber-50 border border-amber-200 p-5">
        <div class="text-xs uppercase tracking-wide text-amber-700">${t('deadlines.due')}</div>
        <div class="text-2xl font-bold text-amber-900 mt-1" data-due="${r.due}">${fmtDateLong(r.due, { hijri: false })}</div>
        <div class="text-amber-800 mt-1" dir="auto">${fmtHijri(r.due)}</div>
      </div>
      <ol class="mt-4 space-y-2 text-sm">
        <li class="flex gap-2"><i class="fas fa-flag text-slate-400 mt-1"></i><span>${t('deadlines.step_start', { date: fmtDate(r.start, { hijri: false }), hijri: fmtHijri(r.start) })}</span></li>
        ${r.steps.map((s) => html`<li class="flex gap-2">${s.code === 'counted'
          ? html`<i class="fas fa-calculator text-slate-400 mt-1"></i><span>${t('deadlines.step_counted', { period: periodLabel(lastInput), date: fmtDate(s.date) })}</span>`
          : s.code === 'holiday'
            ? html`<i class="fas fa-umbrella-beach text-sky-500 mt-1"></i><span>${t('deadlines.step_holiday', { date: fmtDate(s.date), name: s.name })}</span>`
            : html`<i class="fas fa-calendar-xmark text-slate-400 mt-1"></i><span>${t('deadlines.step_weekend', { date: fmtDate(s.date), day: days[new Date(s.date + 'T00:00:00Z').getUTCDay()] })}</span>`}</li>`)}
      </ol>
      <p class="text-xs text-slate-500 mt-4">${t('deadlines.weekend_note', { days: last.weekend.map((d) => days[d]).join(getLang() === 'ar' ? ' و' : ' & ') })}</p>
      <p class="text-xs text-slate-500 mt-1">${t('deadlines.disclaimer')}</p>
      ${!readOnly() ? html`<div class="mt-4"><button class="btn btn-primary" data-action="add-event"><i class="fas fa-calendar-plus"></i>${t('deadlines.add_to_calendar')}</button></div>` : ''}`
  }

  const periodLabel = (i) => i ? `${i.amount} ${t(`deadlines.unit_${i.unit}`)}${i.calendar === 'hijri' && ['months', 'years'].includes(i.unit) ? ` (${t('deadlines.hijri')})` : ''}` : ''

  const holidayList = () => holidays.length
    ? html`<ul class="divide-y divide-slate-100 text-sm">${holidays.map((h) => html`<li class="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="font-mono text-xs w-24 shrink-0">${h.date}</span>
        <span class="flex-1 min-w-[8rem] break-words" dir="auto">${h.name}</span>
        <span class="text-xs text-slate-500">${h.jurisdiction ? jurisdictions.find((j) => j.value === h.jurisdiction)?.label ?? h.jurisdiction : t('deadlines.all_jurisdictions')}</span>
        ${canEdit ? html`<button class="btn btn-ghost btn-sm" data-action="delete-holiday" data-id="${h.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
      </li>`)}</ul>`
    : html`<p class="text-sm text-slate-500">${t('deadlines.no_holidays')}</p>`

  const draw = () => render(root, html`
    ${pageHeader(t('nav.deadlines'), t('deadlines.subtitle'))}
    <div class="grid lg:grid-cols-2 gap-6">
      <section class="card card-pad">
        <h2 class="font-semibold mb-4">${t('deadlines.calculate')}</h2>
        <form data-form="calc" class="grid sm:grid-cols-2 gap-4" novalidate>
          ${inputField({ name: 'start', label: t('deadlines.start'), type: 'date', value: lastInput?.start ?? today(), required: true, hint: t('deadlines.start_hint') })}
          ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: jurisdictions, value: lastInput?.jurisdiction ?? store.me.org.default_jurisdiction })}
          ${inputField({ name: 'amount', label: t('deadlines.amount'), type: 'number', value: lastInput?.amount ?? 30, required: true, attrs: 'min="0" max="3650" data-type="number"' })}
          ${selectField({ name: 'unit', label: t('deadlines.unit'), options: UNITS.map((u) => ({ value: u, label: t(`deadlines.unit_${u}`) })), value: lastInput?.unit ?? 'days' })}
          ${selectField({ name: 'calendar', label: t('deadlines.calendar'), options: [{ value: 'gregorian', label: t('deadlines.gregorian') }, { value: 'hijri', label: t('deadlines.hijri') }], value: lastInput?.calendar ?? 'gregorian', hint: t('deadlines.calendar_hint') })}
          <label class="flex items-center gap-2 text-sm self-center"><input type="checkbox" name="roll_forward" ${lastInput?.roll_forward === false ? '' : raw('checked')} />${t('deadlines.roll_forward')}</label>
          <div class="sm:col-span-2"><button type="submit" class="btn btn-primary"><i class="fas fa-calculator"></i>${t('deadlines.calculate')}</button></div>
        </form>
      </section>
      <section class="card card-pad" aria-live="polite">${resultCard()}</section>
      <section class="card card-pad lg:col-span-2">
        <h2 class="font-semibold mb-1">${t('deadlines.holidays', { year })}</h2>
        <p class="text-sm text-slate-500 mb-4">${t('deadlines.holidays_hint')}</p>
        ${canEdit ? html`<form data-form="holiday" class="grid sm:grid-cols-4 gap-3 items-end mb-4" novalidate>
          ${inputField({ name: 'date', label: t('deadlines.holiday_date'), type: 'date', required: true })}
          ${inputField({ name: 'name', label: t('deadlines.holiday_name'), required: true, placeholder: t('deadlines.holiday_placeholder') })}
          ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: jurisdictions, empty: t('deadlines.all_jurisdictions') })}
          <div><button type="submit" class="btn btn-outline"><i class="fas fa-plus"></i>${t('deadlines.add_holiday')}</button></div>
        </form>` : ''}
        ${holidayList()}
      </section>
    </div>`)

  draw()
  bind(root, {
    forms: {
      calc: (form) => busy(submitButton(form), async () => {
        const f = formData(form)
        if (!f.start) return toast(t('deadlines.start_required'), 'error')
        lastInput = { start: f.start, amount: Number(f.amount ?? 0), unit: f.unit, calendar: f.calendar, jurisdiction: f.jurisdiction, roll_forward: !!f.roll_forward }
        try { last = await api.post('/api/deadlines/calculate', lastInput); draw() } catch (err) { showError(err, form) }
      }),
      holiday: (form) => busy(submitButton(form), async () => {
        const f = formData(form)
        try {
          await api.post('/api/deadlines/holidays', { date: f.date, name: f.name, jurisdiction: f.jurisdiction })
          holidays = (await api.get(`/api/deadlines/holidays?year=${year}`)).items
          toast(t('common.saved'))
          draw()
        } catch (err) { showError(err, form) }
      })
    },
    actions: {
      'add-event': () => openEventForm({
        date: last.result.due,
        defaults: { kind: 'deadline', all_day: true, title: t('deadlines.event_title', { period: periodLabel(lastInput) }), notes: t('deadlines.event_notes', { start: lastInput.start, period: periodLabel(lastInput), hijri: fmtHijri(last.result.due) }) },
        onSaved: () => toast(t('deadlines.added'))
      }),
      'delete-holiday': async (btn) => {
        if (!(await confirmDialog(t('deadlines.confirm_delete_holiday')))) return
        try {
          await api.del(`/api/deadlines/holidays/${btn.dataset.id}`)
          holidays = holidays.filter((h) => h.id !== btn.dataset.id)
          draw()
        } catch (err) { showError(err) }
      }
    }
  })
}
