import { api } from '../api.js'
import { formData, html } from '../dom.js'
import { fmtDate, fmtDateTime, t } from '../i18n.js'
import { can, readOnly } from '../store.js'
import { busy, inputField, modal, selectField, showError, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Hearing outcomes: record what happened at a hearing, book the next one,
// add follow-up tasks and optionally update the client in the portal.
// ---------------------------------------------------------------------------

export const OUTCOMES = ['adjourned', 'reserved', 'judgment', 'settled', 'dismissed', 'other']
const OUTCOME_BADGE = {
  adjourned: 'bg-amber-100 text-amber-800', reserved: 'bg-sky-100 text-sky-800', judgment: 'bg-violet-100 text-violet-800',
  settled: 'bg-emerald-100 text-emerald-800', dismissed: 'bg-slate-200 text-slate-700', other: 'bg-slate-100 text-slate-700'
}
export const outcomeBadge = (o) => html`<span class="badge ${OUTCOME_BADGE[o]}">${t(`hearing.outcome_${o}`)}</span>`
const when = (at, allDay) => (allDay ? fmtDate(at) : fmtDateTime(at))
const pad = (n) => String(n).padStart(2, '0')
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export const canRecord = (e) => e.kind === 'hearing' && e.case_id && !e.completed_at && new Date(e.starts_at) < new Date() && !readOnly() && can('owner', 'admin', 'lawyer')

export function openOutcomeForm(event, { hasClient = true, onSaved } = {}) {
  const at = new Date(event.starts_at)
  const m = modal({
    title: t('hearing.record'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm text-slate-600"><i class="fas fa-gavel text-slate-400 me-1"></i><span dir="auto">${event.title}</span> · ${when(event.starts_at, event.all_day)}${event.case_reference ? ` · ${event.case_reference}` : ''}</p>
      ${selectField({ name: 'outcome', label: t('hearing.outcome'), options: OUTCOMES.map((o) => ({ value: o, label: t(`hearing.outcome_${o}`) })), value: 'adjourned', attrs: 'data-change="outcome"' })}
      ${textareaField({ name: 'summary', label: t('hearing.summary'), rows: 3, required: true, hint: t('hearing.summary_hint') })}
      <fieldset class="rounded-lg border border-slate-200 p-4 space-y-3" data-next>
        <legend class="px-1 text-sm font-semibold">${t('hearing.next_hearing')}</legend>
        <div class="grid sm:grid-cols-3 gap-3">
          ${inputField({ name: 'next_date', label: t('events.date'), type: 'date' })}
          ${inputField({ name: 'next_time', label: t('events.start'), type: 'time', value: localTime(at) })}
          ${inputField({ name: 'next_location', label: t('events.location'), value: event.location })}
        </div>
        <p class="hint">${t('hearing.next_hint')}</p>
      </fieldset>
      ${textareaField({ name: 'next_steps', label: t('hearing.next_steps'), rows: 2 })}
      ${textareaField({ name: 'tasks', label: t('hearing.tasks'), rows: 2, hint: t('hearing.tasks_hint') })}
      ${hasClient ? html`<div class="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3">
        <label class="flex items-start gap-2 text-sm"><input type="checkbox" name="notify_client" class="mt-1" checked data-change="notify" /><span>${t('hearing.notify_client')}</span></label>
        <div data-message>${textareaField({ name: 'client_message', label: t('hearing.client_message'), rows: 3, hint: t('hearing.client_message_hint') })}</div>
      </div>` : ''}
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-check"></i>${t('hearing.save')}</button>
      </div>
    </form>`,
    changes: {
      notify: (el) => { el.form.querySelector('[data-message]').hidden = !el.checked },
      // Only an adjournment normally has a next hearing; keep the fields but signal it.
      outcome: (el) => { el.form.querySelector('[data-next]').classList.toggle('opacity-60', !['adjourned', 'reserved', 'other'].includes(el.value)) }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        const f = formData(form)
        let next = null
        if (f.next_date) {
          const allDay = !f.next_time
          next = { starts_at: new Date(`${f.next_date}T${f.next_time || '00:00'}`).toISOString(), all_day: allDay, location: f.next_location }
        }
        const tasks = (f.tasks || '').split('\n').map((s) => s.trim()).filter(Boolean).map((title) => ({ title }))
        try {
          await api.post('/api/hearings', {
            event_id: event.id, outcome: f.outcome, summary: f.summary, next_steps: f.next_steps, next_hearing: next, tasks,
            notify_client: hasClient && !!f.notify_client, client_message: f.notify_client ? f.client_message : null
          })
          m.close()
          toast(t('hearing.saved'))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export function hearingHistoryCard(records, awaiting = []) {
  return html`<section class="card">
    <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold"><i class="fas fa-gavel text-slate-400 me-1"></i>${t('hearing.history')} <span class="text-slate-400 font-normal">(${records.length})</span></h2></div>
    ${awaiting.map((e) => html`<div class="px-5 py-3 bg-amber-50 border-b border-amber-100 flex flex-wrap items-center gap-3">
      <div class="flex-1 min-w-0 text-sm"><span class="font-medium" dir="auto">${e.title}</span> · ${when(e.starts_at, e.all_day)}<div class="text-xs text-amber-800">${t('hearing.awaiting_one')}</div></div>
      <button class="btn btn-primary btn-sm" data-action="record-outcome" data-id="${e.id}"><i class="fas fa-pen"></i>${t('hearing.record')}</button></div>`)}
    ${records.length ? html`<ol class="divide-y divide-slate-100">${records.map((r) => html`<li class="px-5 py-4 space-y-1">
      <div class="flex flex-wrap items-center gap-2"><span class="text-sm font-semibold">${when(r.hearing_at, r.hearing_all_day)}</span>${outcomeBadge(r.outcome)}
        ${r.shared_with_client ? html`<span class="text-xs text-slate-500"><i class="fas fa-share"></i> ${t('hearing.client_updated')}</span>` : ''}</div>
      <p class="text-sm whitespace-pre-wrap" dir="auto">${r.summary}</p>
      ${r.next_steps ? html`<p class="text-xs text-slate-600 whitespace-pre-wrap" dir="auto"><span class="font-semibold">${t('hearing.next_steps')}:</span> ${r.next_steps}</p>` : ''}
      ${r.next_hearing_at ? html`<p class="text-xs text-brand-700"><i class="fas fa-arrow-right rtl:rotate-180"></i> ${t('hearing.next_hearing')}: ${when(r.next_hearing_at, r.next_hearing_all_day)}${r.next_hearing_location ? ` · ${r.next_hearing_location}` : ''}</p>` : ''}
      <p class="text-xs text-slate-400">${r.recorded_by || ''}</p>
    </li>`)}</ol>` : awaiting.length ? '' : html`<p class="px-5 py-6 text-sm text-slate-500">${t('hearing.none')}</p>`}
  </section>`
}
