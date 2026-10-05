import { api } from '../api.js'
import { bind, formData, html, qs, raw, render } from '../dom.js'
import { fmtDate, fmtDateTime, fmtMonth, fmtTime, t, weekdayNames } from '../i18n.js'
import { readOnly } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, EVENT_COLORS, eventBadge, inputField, modal, pageHeader, selectField, showError,
  submitButton, textareaField, toast
} from '../ui.js'
import { searchPicker, wirePickers } from './pickers.js'

const KINDS = ['hearing', 'deadline', 'filing', 'meeting', 'reminder']
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const isOverdue = (e) => !e.completed_at && ['deadline', 'filing'].includes(e.kind) && new Date(e.starts_at) < new Date()

export function openEventForm({ event, date, caseId, caseLabel, defaults, onSaved } = {}) {
  const e = event || { ...defaults }
  const start = e.starts_at ? new Date(e.starts_at) : date ? new Date(`${date}T09:00`) : new Date(Math.ceil(Date.now() / 3600000) * 3600000)
  const end = e.ends_at ? new Date(e.ends_at) : null
  const m = modal({
    title: event ? t('events.edit') : t('events.new'),
    size: 'lg',
    body: html`
      <form data-form="save" class="grid sm:grid-cols-2 gap-4" novalidate>
        ${inputField({ name: 'title', label: t('events.title'), value: e.title, required: true, cls: 'sm:col-span-2' })}
        ${selectField({ name: 'kind', label: t('events.kind'), options: KINDS.map((k) => ({ value: k, label: t(`event.${k}`) })), value: e.kind || 'meeting' })}
        <label class="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" name="all_day" ${e.all_day ? raw('checked') : ''} data-change="allday" />${t('events.all_day')}</label>
        ${inputField({ name: 'date', label: t('events.date'), type: 'date', value: localDate(start), required: true })}
        <div class="grid grid-cols-2 gap-2" data-times ${e.all_day ? raw('hidden') : ''}>
          ${inputField({ name: 'start_time', label: t('events.start'), type: 'time', value: localTime(start) })}
          ${inputField({ name: 'end_time', label: t('events.end'), type: 'time', value: end ? localTime(end) : '' })}
        </div>
        ${inputField({ name: 'location', label: t('events.location'), value: e.location, cls: 'sm:col-span-2' })}
        <div class="sm:col-span-2">${searchPicker({ name: 'case_id', label: t('docs.case'), value: e.case_id || caseId, valueLabel: e.case_reference ? `${e.case_reference} · ${e.case_title || ''}` : caseLabel })}</div>
        ${textareaField({ name: 'notes', label: t('events.notes'), value: e.notes, rows: 3, cls: 'sm:col-span-2' })}
        <div class="sm:col-span-2 flex flex-wrap justify-between gap-2 pt-4 border-t border-slate-100">
          <div class="flex gap-2">
            ${event ? html`<button type="button" class="btn btn-danger-ghost" data-action="delete"><i class="fas fa-trash"></i>${t('common.delete')}</button>
              <button type="button" class="btn btn-outline" data-action="toggle-done">${e.completed_at ? t('events.mark_open') : html`<i class="fas fa-check"></i>${t('events.mark_done')}`}</button>` : ''}
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
            <button type="submit" class="btn btn-primary">${t('common.save')}</button>
          </div>
        </div>
      </form>`,
    onMount: (el) => wirePickers(el),
    changes: { allday: (el) => { el.form.querySelector('[data-times]').hidden = el.checked } },
    actions: {
      delete: async () => {
        if (!(await confirmDialog(t('events.confirm_delete')))) return
        try { await api.del(`/api/events/${event.id}`); m.close(); toast(t('common.deleted')); onSaved?.() } catch (err) { showError(err) }
      },
      'toggle-done': async (btn) => busy(btn, async () => {
        try { await api.patch(`/api/events/${event.id}`, { completed: !e.completed_at }); m.close(); onSaved?.() } catch (err) { showError(err) }
      })
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const f = formData(form)
        if (!f.date) return toast(t('events.date_required'), 'error')
        const allDay = !!f.all_day
        const startsAt = new Date(`${f.date}T${allDay ? '00:00' : f.start_time || '09:00'}`)
        const endsAt = !allDay && f.end_time ? new Date(`${f.date}T${f.end_time}`) : null
        if (endsAt && endsAt < startsAt) return toast(t('events.end_before_start'), 'error')
        const body = {
          title: f.title, kind: f.kind, all_day: allDay, starts_at: startsAt.toISOString(), ends_at: endsAt ? endsAt.toISOString() : null,
          location: f.location, notes: f.notes, case_id: f.case_id
        }
        try {
          event ? await api.patch(`/api/events/${event.id}`, body) : await api.post('/api/events', body)
          m.close()
          toast(t('common.saved'))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function calendarView(root, { query, isCurrent, rerender }) {
  const now = new Date()
  const month = query.get('month') && /^\d{4}-\d{2}$/.test(query.get('month')) ? query.get('month') : `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const [y, mo] = month.split('-').map(Number)
  const first = new Date(y, mo - 1, 1)
  const gridStart = new Date(first)
  gridStart.setDate(1 - first.getDay())
  const gridEnd = new Date(gridStart)
  gridEnd.setDate(gridStart.getDate() + 42)

  const [{ items }, { items: overdue }] = await Promise.all([
    api.get('/api/events' + qs({ from: gridStart.toISOString(), to: gridEnd.toISOString() })),
    api.get('/api/events' + qs({ to: new Date().toISOString(), from: new Date(Date.now() - 365 * 86400000).toISOString() }))
  ])
  if (!isCurrent()) return
  const overdueItems = overdue.filter(isOverdue)
  const byDay = {}
  for (const e of items) (byDay[localDate(new Date(e.starts_at))] ||= []).push(e)
  const today = localDate(now)
  const prev = new Date(y, mo - 2, 1)
  const next = new Date(y, mo, 1)
  const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  const ro = readOnly()
  const upcoming = items.filter((e) => new Date(e.starts_at) >= new Date(today) && !e.completed_at).slice(0, 12)

  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d })

  render(root, html`
    ${pageHeader(t('nav.calendar'), t('events.subtitle'), ro ? '' : html`<button class="btn btn-primary" data-action="new"><i class="fas fa-plus"></i>${t('events.new')}</button>`)}
    ${overdueItems.length ? html`<div class="rounded-lg bg-red-50 border border-red-200 p-4 mb-6">
      <h2 class="font-semibold text-red-800 mb-2"><i class="fas fa-triangle-exclamation"></i> ${t('events.overdue_title', { n: overdueItems.length })}</h2>
      <ul class="space-y-1 text-sm">${overdueItems.map((e) => html`<li><button class="text-red-800 hover:underline text-start" data-action="edit" data-id="${e.id}" data-src="overdue">${fmtDate(e.starts_at)} – ${e.title}${e.case_reference ? ` (${e.case_reference})` : ''}</button></li>`)}</ul>
    </div>` : ''}
    <div class="grid xl:grid-cols-4 gap-6">
      <section class="card xl:col-span-3 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div class="flex gap-1">
            <a class="btn btn-ghost btn-sm" href="#/calendar?month=${ym(prev)}" aria-label="${t('events.prev')}"><i class="fas fa-chevron-left rtl:rotate-180"></i></a>
            <a class="btn btn-ghost btn-sm" href="#/calendar?month=${ym(next)}" aria-label="${t('events.next')}"><i class="fas fa-chevron-right rtl:rotate-180"></i></a>
            <a class="btn btn-outline btn-sm" href="#/calendar">${t('events.today')}</a>
          </div>
          <h2 class="font-semibold">${fmtMonth(first)}</h2>
          <span class="w-24"></span>
        </div>
        <div class="grid grid-cols-7 text-center text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-100">
          ${weekdayNames().map((w) => html`<div class="py-2">${w}</div>`)}
        </div>
        <div class="grid grid-cols-7">
          ${days.map((d) => {
            const key = localDate(d)
            const evs = byDay[key] || []
            const inMonth = d.getMonth() === mo - 1
            return html`<div class="cal-cell ${inMonth ? '' : 'bg-slate-50/60 text-slate-400'} ${ro ? '' : 'cursor-pointer hover:bg-brand-50/40'}" ${ro ? '' : raw(`data-action="new-on" data-date="${key}"`)}>
              <div class="mb-1 text-end"><span class="inline-flex w-6 h-6 items-center justify-center rounded-full ${key === today ? 'bg-brand-500 text-white font-bold' : ''}">${d.getDate()}</span></div>
              ${evs.slice(0, 3).map((e) => html`<button class="cal-event ${EVENT_COLORS[e.kind]} ${e.completed_at ? 'line-through opacity-60' : ''}" data-action="edit" data-id="${e.id}" title="${e.title}">${e.all_day ? '' : fmtTime(e.starts_at) + ' '}${e.title}</button>`)}
              ${evs.length > 3 ? html`<div class="text-[11px] text-slate-500">+${evs.length - 3}</div>` : ''}
            </div>`
          })}
        </div>
      </section>
      <section class="card">
        <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('dash.upcoming')}</h2></div>
        ${upcoming.length ? html`<ul class="divide-y divide-slate-100">${upcoming.map((e) => html`<li><button class="w-full text-start px-5 py-3 hover:bg-slate-50" data-action="edit" data-id="${e.id}">
          <div class="flex items-center gap-2 mb-1">${eventBadge(e.kind)}</div>
          <div class="text-sm font-medium">${e.title}</div>
          <div class="text-xs text-slate-500">${e.all_day ? fmtDate(e.starts_at) : fmtDateTime(e.starts_at)}${e.case_reference ? ' · ' + e.case_reference : ''}</div>
        </button></li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('dash.no_upcoming')}</p>`}
      </section>
    </div>`)

  const all = [...items, ...overdueItems]
  bind(root, {
    actions: {
      new: () => openEventForm({ onSaved: rerender }),
      'new-on': (el, ev) => { if (!ev.target.closest('.cal-event')) openEventForm({ date: el.dataset.date, onSaved: rerender }) },
      edit: (el, ev) => {
        ev.stopPropagation()
        const e = all.find((x) => x.id === el.dataset.id)
        if (e && !ro) openEventForm({ event: e, onSaved: rerender })
      }
    }
  })
}
