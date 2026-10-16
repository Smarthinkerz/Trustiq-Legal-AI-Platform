import { api } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtDate, fmtDateTime, t } from '../i18n.js'
import { aiEnabled, can, readOnly } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, emptyState, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, inputField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Client updates (تقارير الموكل): plain-language progress reports on a matter,
// drafted by AI or by hand, sent to the client portal and by email.
// ---------------------------------------------------------------------------

const LANGS = () => [{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]

function lastLine(d) {
  if (!d.has_client) return html`<p class="text-xs text-slate-500 mt-0.5">${t('cu.no_client')}</p>`
  const late = d.days_since == null || d.days_since >= d.every_days
  const text = d.days_since == null ? t('cu.never') : d.days_since === 0 ? t('cu.today') : t('cu.days_ago', { n: d.days_since })
  return html`<p class="text-xs mt-0.5 ${late ? 'text-amber-700 font-medium' : 'text-slate-500'}">${late ? html`<i class="fas fa-bell"></i> ` : ''}${text}</p>`
}

export async function caseClientUpdatesCard(box, kase) {
  if (!box) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  let d = null
  const draw = () => render(box, html`<section class="card">
    <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
      <div><h2 class="font-semibold"><i class="fas fa-paper-plane text-slate-400 me-1"></i> ${t('cu.title')}</h2>${d ? lastLine(d) : ''}</div>
      ${editable && d?.has_client ? html`<div class="flex gap-2">
        <button class="btn btn-outline btn-sm" data-u="write"><i class="fas fa-pen"></i>${t('cu.write')}</button>
        ${aiEnabled() ? html`<button class="btn btn-primary btn-sm" data-u="ai"><i class="fas fa-wand-magic-sparkles"></i>${t('cu.ai_draft')}</button>` : ''}
      </div>` : ''}
    </div>
    ${d && d.has_client && !d.has_portal ? html`<p class="px-5 py-2 text-xs bg-amber-50 text-amber-800 border-b border-amber-100"><i class="fas fa-circle-info"></i> ${t('cu.no_portal')}</p>` : ''}
    ${!d ? html`<div class="p-5">${spinner()}</div>` : d.items.length ? html`<ul class="divide-y divide-slate-100">${d.items.map((u) => html`<li class="px-5 py-3">
      <div class="flex flex-wrap items-center gap-2">
        ${u.status === 'draft' ? html`<span class="badge bg-amber-100 text-amber-800">${t('cu.draft')}</span>` : html`<span class="badge bg-emerald-100 text-emerald-800">${t('cu.sent')}</span>`}
        ${u.ai_drafted ? html`<span class="badge bg-violet-100 text-violet-800" title="${t('cu.ai_drafted')}"><i class="fas fa-wand-magic-sparkles"></i></span>` : ''}
        <span class="text-sm font-medium flex-1 min-w-0 truncate" dir="auto">${u.title}</span>
        <span class="text-xs text-slate-500">${u.status === 'draft' ? fmtDateTime(u.created_at) : fmtDateTime(u.published_at)}</span>
      </div>
      ${u.status === 'published' ? html`<div class="text-xs text-slate-500 mt-1">${u.published_by_name || ''}${u.emailed ? ` · ${t('cu.emailed', { n: u.emailed })}` : ''}
        ${u.whatsapp_status === 'sent' ? html` · <span class="text-emerald-700"><i class="fab fa-whatsapp"></i> ${t('cu.wa_status_sent')}</span>` : u.whatsapp_status === 'failed' ? html` · <span class="text-red-700"><i class="fab fa-whatsapp"></i> ${t('cu.wa_status_failed')}</span>` : ''} ·
        ${u.read_at ? html`<span class="text-emerald-700"><i class="fas fa-check-double"></i> ${t('cu.read', { date: fmtDate(u.read_at) })}</span>` : html`<span>${t('cu.unread')}</span>`}</div>` : ''}
      <details class="mt-1 text-sm"><summary class="cursor-pointer text-slate-500 text-xs">${t('cu.show')}</summary><p class="whitespace-pre-wrap mt-2 text-slate-700" dir="auto">${u.body}</p></details>
      ${editable && u.status === 'draft' ? html`<div class="flex gap-2 mt-2">
        <button class="btn btn-primary btn-sm" data-u="edit" data-id="${u.id}"><i class="fas fa-pen-to-square"></i>${t('cu.review_send')}</button>
        <button class="btn btn-danger-ghost btn-sm" data-u="delete" data-id="${u.id}"><i class="fas fa-trash"></i>${t('common.delete')}</button></div>` : ''}
    </li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${d.has_client ? t('cu.none') : ''}</p>`}
  </section>`)
  const load = async () => {
    try { d = await api.get(`/api/client-updates/case/${kase.id}`); if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-u]')
    if (!el) return
    const act = el.dataset.u
    const u = d.items.find((x) => x.id === el.dataset.id)
    if (act === 'ai') openAiDraft(kase, d, (draft) => { load(); openEditor(kase, draft, d, load) })
    if (act === 'write') openEditor(kase, null, d, load)
    if (act === 'edit') openEditor(kase, u, d, load)
    if (act === 'delete' && (await confirmDialog(t('cu.confirm_delete')))) {
      try { await api.del(`/api/client-updates/${u.id}`); toast(t('common.deleted')); load() } catch (err) { showError(err) }
    }
  }
  draw()
  await load()
}

function openAiDraft(kase, d, done) {
  const m = modal({
    title: t('cu.ai_draft'),
    body: html`<form data-form="go" class="space-y-4" novalidate>
      <p class="text-sm text-slate-600">${t('cu.ai_intro')}</p>
      ${selectField({ name: 'language', label: t('cu.language'), options: LANGS(), value: d.client_language || 'ar' })}
      ${textareaField({ name: 'points', label: t('cu.points'), rows: 3, hint: t('cu.points_hint') })}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button class="btn btn-primary"><i class="fas fa-wand-magic-sparkles"></i>${t('cu.generate')}</button></div>
    </form>`,
    forms: {
      go: (form) => busy(submitButton(form), async () => {
        const b = formData(form)
        try {
          const r = await api.post(`/api/client-updates/case/${kase.id}/draft`, { language: b.language, ...(b.points ? { points: b.points } : {}) })
          m.close()
          done(r.update)
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function openEditor(kase, u, d, done) {
  const m = modal({
    title: u ? t('cu.review_send') : t('cu.write'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      ${u?.ai_drafted ? html`<p class="text-xs rounded-lg bg-violet-50 text-violet-800 p-3"><i class="fas fa-wand-magic-sparkles"></i> ${t('cu.check_ai')}</p>` : ''}
      <div class="grid sm:grid-cols-4 gap-4">
        ${inputField({ name: 'title', label: t('cu.subject'), value: u?.title ?? '', required: true, cls: 'sm:col-span-3', attrs: 'maxlength="200" dir="auto"' })}
        ${selectField({ name: 'language', label: t('cu.language'), options: LANGS(), value: u?.language ?? d.client_language ?? 'ar' })}
      </div>
      ${textareaField({ name: 'body', label: t('cu.body'), value: u?.body ?? '', rows: 12, required: true })}
      ${u?.ai_drafted ? html`<label class="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 rounded-md p-2"><input type="checkbox" name="reviewed" class="mt-1" /> <span>${t('cu.confirm_reviewed')}</span></label>` : ''}
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="email" checked /> ${t('cu.also_email')}</label>
      ${d.whatsapp === 'ready' ? html`<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="whatsapp" checked /> <i class="fab fa-whatsapp text-emerald-600"></i> ${t('cu.also_whatsapp')}</label>`
        : d.whatsapp === 'no_opt_in' || d.whatsapp === 'no_phone' ? html`<p class="hint"><i class="fab fa-whatsapp"></i> ${t(`cu.wa_${d.whatsapp}`)}</p>` : ''}
      ${d.has_portal ? '' : html`<p class="hint text-amber-700">${t('cu.no_portal')}</p>`}
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
        <button type="button" class="btn btn-outline" data-action="save-draft"><i class="fas fa-floppy-disk"></i>${t('cu.save_draft')}</button>
        <button class="btn btn-primary"><i class="fas fa-paper-plane"></i>${t('cu.send')}</button>
      </div>
    </form>`,
    actions: {
      'save-draft': (el) => busy(el, async () => { if (await save(el.closest('form'))) { m.close(); toast(t('common.saved')); done() } })
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        if (form.elements.reviewed && !form.elements.reviewed.checked) return toast(t('cu.confirm_reviewed_needed'), 'error')
        const saved = await save(form)
        if (!saved) return
        try {
          const r = await api.post(`/api/client-updates/${saved.id}/publish`, { email: !!form.elements.email.checked, whatsapp: !!form.elements.whatsapp?.checked, reviewed: !!form.elements.reviewed?.checked })
          m.close()
          toast(r.emailed ? t('cu.sent_emailed', { n: r.emailed }) : t('cu.sent_portal'))
          if (r.whatsapp === 'sent') toast(t('cu.wa_sent'))
          if (r.whatsapp === 'failed') toast(t('cu.wa_failed'), 'error')
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
  let current = u
  async function save(form) {
    clearFieldErrors(form)
    const b = formData(form)
    const body = { language: b.language, title: b.title ?? '', body: b.body ?? '' }
    try {
      current = current ? (await api.patch(`/api/client-updates/${current.id}`, body)).update : (await api.post(`/api/client-updates/case/${kase.id}`, body)).update
      return current
    } catch (err) { showError(err, form); return null }
  }
}

// Matters whose client has not heard from the firm for a month.
export async function clientUpdatesDueView(root, { query, isCurrent }) {
  const state = { mine: query.get('mine') !== '0' }
  render(root, html`${pageHeader(t('cu.due_title'), t('cu.due_subtitle'))}<div data-due>${spinner()}</div>`)
  const load = async () => {
    const d = await api.get(`/api/client-updates/due?mine=${state.mine ? 1 : 0}`)
    if (!isCurrent()) return
    render(root.querySelector('[data-due]'), html`
      <div class="flex gap-1 mb-3">${[['1', t('cu.mine')], ['0', t('cu.everyone')]].map(([v, label]) => html`<button class="px-3 py-1.5 rounded-md text-sm ${(state.mine ? '1' : '0') === v ? 'bg-brand-600 text-white' : 'text-slate-600 bg-white border border-slate-200'}" data-action="mine" data-v="${v}">${label}</button>`)}</div>
      <div class="card">${d.items.length ? html`<div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('cases.reference')}</th><th>${t('onb.matter')}</th><th>${t('cases.assigned_to')}</th><th>${t('cu.last')}</th><th></th></tr></thead>
        <tbody>${d.items.map((k) => html`<tr class="clickable" data-action="open" data-id="${k.id}">
          <td class="font-mono text-xs">${k.reference}</td>
          <td><div class="font-medium" dir="auto">${k.title}</div><div class="text-xs text-slate-500" dir="auto">${k.client_name}</div></td>
          <td class="text-sm">${k.lawyer_name || '—'}</td>
          <td class="text-sm whitespace-nowrap">${k.last_update ? html`${fmtDate(k.last_update, { hijri: false })} <span class="text-xs text-amber-700">(${t('cu.days_ago', { n: k.days })})</span>` : html`<span class="text-amber-700">${t('cu.never_days', { n: k.days })}</span>`}</td>
          <td class="text-xs whitespace-nowrap">${k.drafts ? html`<span class="badge bg-amber-100 text-amber-800">${t('cu.drafts', { n: k.drafts })}</span>` : ''}
            ${k.has_portal ? '' : html`<span class="badge bg-slate-100 text-slate-600" title="${t('cu.no_portal')}"><i class="fas fa-user-slash"></i> ${t('cu.no_portal_short')}</span>`}</td>
        </tr>`)}</tbody></table></div>` : emptyState('fa-paper-plane', t('cu.all_current'), t('cu.all_current_help', { n: d.every_days }))}</div>`)
  }
  bind(root, {
    actions: {
      open: (el) => (location.hash = `#/cases/${el.dataset.id}`),
      mine: (el) => { state.mine = el.dataset.v === '1'; history.replaceState(null, '', `#/client-updates${state.mine ? '' : '?mine=0'}`); load().catch(showError) }
    }
  })
  await load()
}
