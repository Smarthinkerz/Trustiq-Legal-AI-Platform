import { api, download } from '../api.js'
import { bind, html, render } from '../dom.js'
import { fmtDate, fmtDateTime, fmtMoney, getLang, t } from '../i18n.js'
import { aiEnabled, can, readOnly } from '../store.js'
import { busy, emptyState, showError, spinner, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Hearing preparation (تحضير الجلسة): the facts for one hearing, an AI note
// and a checklist, printable for the lawyer attending.
// ---------------------------------------------------------------------------

const list = (title, items, icon) => items?.length ? html`<div><h3 class="text-sm font-semibold mb-1"><i class="fas ${icon} text-slate-400 me-1"></i>${title}</h3>
  <ul class="list-disc ps-5 text-sm space-y-1" dir="auto">${items.map((x) => html`<li>${x}</li>`)}</ul></div>` : ''

export async function hearingPrepView(root, { params, isCurrent }) {
  render(root, spinner())
  let d = await api.get(`/api/hearing-prep/${params.id}`)
  if (!isCurrent()) return
  const editable = !readOnly()
  const canAi = aiEnabled() && can('owner', 'admin', 'lawyer') && editable
  let checklist = d.checklist
  const draw = () => {
    const n = d.prep?.content
    const done = checklist.filter((x) => x.done).length
    render(root, html`
      <nav class="text-sm text-slate-500 mb-3"><a href="#/roll" class="hover:underline">${t('roll.title')}</a> <i class="fas fa-chevron-right text-xs mx-1 rtl:rotate-180"></i>
        <a href="#/cases/${d.case.id}" class="hover:underline font-mono" dir="ltr">${d.case.reference}</a></nav>
      <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div><h1 class="text-2xl font-bold">${t('prep.title')}</h1>
          <p class="text-slate-600 mt-1" dir="auto">${d.case.title}${d.case.opposing_party ? html` <span class="text-slate-400">${t('roll.versus')}</span> ${d.case.opposing_party}` : ''}</p>
          <p class="text-sm text-slate-500 mt-1"><i class="fas fa-gavel"></i> ${d.event.all_day ? fmtDate(d.event.starts_at) : fmtDateTime(d.event.starts_at)}${d.case.court ? ` · ${d.case.court}` : ''}${d.event.attendee_name || d.case.lawyer_name ? ` · ${d.event.attendee_name || d.case.lawyer_name}` : ''}</p></div>
        <div class="flex flex-wrap gap-2">
          <button class="btn btn-outline" data-action="word"><i class="fas fa-file-word"></i>${t('prep.word')}</button>
          ${canAi ? html`<button class="btn btn-primary" data-action="ai" data-lang="${getLang()}"><i class="fas fa-wand-magic-sparkles"></i>${n ? t('prep.redo') : t('prep.ai')}</button>` : ''}
        </div>
      </div>
      <div class="grid lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 space-y-6">
          <section class="card card-pad space-y-4">
            ${n ? html`
              <p class="text-xs rounded-lg bg-violet-50 text-violet-800 p-2"><i class="fas fa-wand-magic-sparkles"></i> ${t('prep.ai_note', { date: fmtDateTime(d.prep.updated_at) })}</p>
              ${n.summary ? html`<p class="text-sm text-slate-800" dir="auto">${n.summary}</p>` : ''}
              ${list(t('prep.objectives'), n.objectives, 'fa-bullseye')}${list(t('prep.arguments'), n.arguments, 'fa-scale-balanced')}
              ${list(t('prep.requests'), n.requests, 'fa-hand')}${list(t('prep.bring'), n.bring, 'fa-briefcase')}
              ${list(t('prep.risks'), n.risks, 'fa-triangle-exclamation')}${list(t('prep.open_questions'), n.open_questions, 'fa-circle-question')}`
              : emptyState('fa-wand-magic-sparkles', t('prep.no_note'), canAi ? t('prep.no_note_help') : '')}
          </section>
          ${d.last ? html`<section class="card card-pad"><h2 class="font-semibold mb-2">${t('prep.last', { date: fmtDate(d.last.date) })}</h2>
            <p class="text-sm"><b>${t(`hearing.outcome_${d.last.outcome}`)}</b></p>
            ${d.last.summary ? html`<p class="text-sm text-slate-700 mt-1 whitespace-pre-wrap" dir="auto">${d.last.summary}</p>` : ''}
            ${d.last.next_steps ? html`<p class="text-sm text-emerald-800 mt-2 whitespace-pre-wrap" dir="auto"><i class="fas fa-list-check"></i> ${d.last.next_steps}</p>` : ''}</section>` : ''}
          ${d.documents.length ? html`<section class="card"><div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('prep.documents')}</h2></div>
            <ul class="divide-y divide-slate-100">${d.documents.map((x) => html`<li class="px-5 py-2 text-sm"><a class="text-brand-600 hover:underline" href="#/documents/${x.id}" dir="auto">${x.title}</a> <span class="text-xs text-slate-500">· ${fmtDate(x.updated_at)}</span></li>`)}</ul></section>` : ''}
        </div>
        <div class="space-y-6">
          <section class="card">
            <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between"><h2 class="font-semibold">${t('prep.checklist')}</h2><span class="text-xs text-slate-500">${done}/${checklist.length}</span></div>
            <ul class="divide-y divide-slate-100">${checklist.map((x, i) => html`<li class="px-5 py-2 flex items-start gap-2 text-sm">
              <input type="checkbox" class="mt-1" data-change="tick" data-i="${i}" ${x.done ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="${x.text}" />
              <span class="flex-1 ${x.done ? 'line-through text-slate-400' : ''}" dir="auto">${x.text}</span>
              ${editable ? html`<button class="text-slate-400 hover:text-red-600" data-action="remove" data-i="${i}" aria-label="${t('common.delete')}"><i class="fas fa-xmark"></i></button>` : ''}</li>`)}</ul>
            ${editable ? html`<form data-form="add" class="px-5 py-3 border-t border-slate-100 flex gap-2" novalidate>
              <input class="input py-1 text-sm" name="text" maxlength="300" dir="auto" placeholder="${t('prep.add_item')}" aria-label="${t('prep.add_item')}" />
              <button class="btn btn-outline btn-sm"><i class="fas fa-plus"></i></button></form>` : ''}
          </section>
          ${d.originals.length ? html`<section class="card card-pad text-sm"><h2 class="font-semibold mb-2"><i class="fas fa-vault text-slate-400 me-1"></i>${t('prep.originals')}</h2>
            <ul class="space-y-1">${d.originals.map((o) => html`<li dir="auto">${o.description}${o.reference_no ? html` <bdi dir="ltr" class="text-xs text-slate-500">${o.reference_no}</bdi>` : ''}
              <div class="text-xs ${o.status === 'lodged' ? 'text-amber-800' : 'text-slate-500'}">${o.status === 'lodged' ? html`${t('orig.lodged_with')} <span dir="auto">${o.lodged_with}</span>` : o.location || t('orig.no_location')}</div></li>`)}</ul></section>` : ''}
          ${d.tasks.length ? html`<section class="card card-pad text-sm"><h2 class="font-semibold mb-2"><i class="fas fa-list-check text-slate-400 me-1"></i>${t('prep.tasks')}</h2>
            <ul class="space-y-1">${d.tasks.map((x) => html`<li dir="auto">${x.title}${x.due_date ? html` <span class="text-xs text-slate-500">· ${fmtDate(x.due_date)}</span>` : ''}</li>`)}</ul></section>` : ''}
          ${d.experts.length || d.notices.length || d.offers.length ? html`<section class="card card-pad text-sm space-y-2"><h2 class="font-semibold">${t('prep.moving')}</h2>
            ${d.experts.map((x) => html`<div><i class="fas fa-user-tie text-slate-400"></i> ${t(`exp.t_${x.expert_type}`)}${x.expert_name ? ` · ${x.expert_name}` : ''}: ${x.report_filed_on ? t('prep.report_filed', { date: fmtDate(x.report_filed_on) }) : x.report_due ? t('prep.report_due', { date: fmtDate(x.report_due) }) : ''}</div>`)}
            ${d.notices.map((x) => html`<div><i class="fas fa-envelope-open-text text-slate-400"></i> <span dir="auto">${x.subject}</span>${x.response_due ? ` · ${fmtDate(x.response_due)}` : ''}</div>`)}
            ${d.offers.map((x) => html`<div title="${t('stl.internal')}"><i class="fas fa-lock text-slate-400"></i> ${t(`stl.d_${x.direction}`)}: ${fmtMoney(x.amount, x.currency)} · ${t(`stl.s_${x.status}`)}</div>`)}</section>` : ''}
        </div>
      </div>`)
  }
  const save = async () => {
    try { checklist = (await api.put(`/api/hearing-prep/${params.id}/checklist`, { checklist })).checklist } catch (err) { showError(err) }
  }
  bind(root, {
    actions: {
      word: () => download(`/api/hearing-prep/${params.id}/docx?lang=${getLang()}`),
      ai: (el) => busy(el, async () => {
        try {
          const r = await api.post(`/api/hearing-prep/${params.id}/ai`, { language: el.dataset.lang })
          d = { ...d, prep: { ...r.prep, updated_at: new Date().toISOString() } }
          checklist = r.prep.checklist
          toast(t('prep.ready'))
          if (isCurrent()) draw()
        } catch (err) { showError(err) }
      }),
      remove: async (el) => { checklist = checklist.filter((_, i) => i !== Number(el.dataset.i)); draw(); await save() }
    },
    changes: {
      tick: async (el) => { checklist = checklist.map((x, i) => (i === Number(el.dataset.i) ? { ...x, done: el.checked } : x)); draw(); await save() }
    },
    forms: {
      add: async (form) => {
        const text = form.elements.text.value.trim()
        if (!text) return
        checklist = [...checklist, { text, done: false }]
        draw()
        await save()
      }
    }
  })
  draw()
}
