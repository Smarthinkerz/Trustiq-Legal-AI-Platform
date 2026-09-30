import { api, download } from '../api.js'
import { bind, html, render } from '../dom.js'
import { fmtDate, fmtDateTime, fmtMoney, fmtRelative, getLang, t } from '../i18n.js'
import { refLabel, store } from '../store.js'
import { busy, emptyState, eventBadge, modal, showError, statusBadge, submitButton, toast } from '../ui.js'
import { invoiceBadge } from './billing.js'
import { profileTab } from './settings.js'

const isoDay = (v) => (v ? String(v).slice(0, 10) : '')
const caseTitle = (k) => (getLang() === 'ar' && k.title_ar ? k.title_ar : k.title)

function openClientUpload({ cases, caseId, onSaved }) {
  const m = modal({
    title: t('portal.upload'),
    body: html`<form data-form="upload" class="space-y-4" novalidate>
      <div>
        <label class="label" for="f-file">${t('docs.file')} <span class="text-red-500">*</span></label>
        <input id="f-file" name="file" type="file" required class="input" accept=".pdf,.docx,.txt,application/pdf" />
        <p class="hint">${t('portal.upload_hint')}</p>
      </div>
      <div>
        <label class="label" for="f-title">${t('library.title')}</label>
        <input id="f-title" name="title" class="input" dir="auto" maxlength="300" />
      </div>
      ${cases.length ? html`<div>
        <label class="label" for="f-case">${t('cases.matter')}</label>
        <select id="f-case" name="case_id" class="input"><option value="">—</option>${cases.map((k) => html`<option value="${k.id}" ${k.id === caseId ? 'selected' : ''}>${k.reference} · ${caseTitle(k)}</option>`)}</select>
      </div>` : ''}
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-upload"></i>${t('portal.send_file')}</button>
      </div>
    </form>`,
    forms: {
      upload: (form) => busy(submitButton(form), async () => {
        if (!form.elements.file.files[0]) return toast(t('portal.choose_file'), 'error')
        try {
          await api.upload('/api/portal/documents', new FormData(form))
          m.close()
          toast(t('portal.file_sent'))
          onSaved?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

const docList = (docs) => docs.length ? html`<ul class="divide-y divide-slate-100">${docs.map((d) => html`<li class="px-5 py-3 flex items-center gap-3">
  <i class="fas ${d.uploaded_by_client ? 'fa-file-arrow-up' : 'fa-file-lines'} text-slate-400"></i>
  <div class="flex-1 min-w-0"><div class="text-sm font-medium truncate" dir="auto">${d.title}</div>
    <div class="text-xs text-slate-500">${d.uploaded_by_client ? t('portal.sent_by_you') : t('portal.shared_by_firm')} · ${fmtRelative(d.updated_at)}</div></div>
  <button class="btn btn-outline btn-sm" data-action="download-doc" data-id="${d.id}"><i class="fas fa-download"></i><span class="hidden sm:inline">${t('portal.download')}</span></button>
</li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('portal.no_documents')}</p>`

export async function portalHomeView(root, { isCurrent, rerender }) {
  const o = await api.get('/api/portal/overview')
  if (!isCurrent()) return
  const outstanding = o.invoices.filter((i) => i.status === 'issued')
  render(root, html`
    <div class="mb-6">
      <h1 class="text-2xl font-bold">${t('portal.welcome', { name: store.me.user.name })}</h1>
      <p class="text-slate-500 text-sm mt-1">${t('portal.subtitle', { firm: (getLang() === 'ar' && o.firm?.firm_name_ar) || o.firm?.firm_name || store.me.org.name })}</p>
    </div>
    ${o.unread_messages ? html`<a href="#/portal/messages" class="block card card-pad mb-6 border-brand-300 bg-brand-50 text-brand-800 text-sm"><i class="fas fa-envelope"></i> ${t('portal.unread', { n: o.unread_messages })}</a>` : ''}
    <div class="grid lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <section class="card">
          <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('portal.your_matters')}</h2></div>
          ${o.cases.length ? html`<ul class="divide-y divide-slate-100">${o.cases.map((k) => html`<li><a href="#/portal/cases/${k.id}" class="px-5 py-4 flex flex-wrap items-center gap-3 hover:bg-slate-50">
            <div class="flex-1 min-w-0"><div class="font-medium" dir="auto">${caseTitle(k)}</div>
              <div class="text-xs text-slate-500">${k.reference} · ${refLabel('jurisdictions', k.jurisdiction)}${k.lawyer_name ? ` · ${k.lawyer_name}` : ''}</div>
              ${k.next_hearing ? html`<div class="text-xs text-red-700 mt-1"><i class="fas fa-gavel"></i> ${t('portal.next_hearing')}: ${fmtDateTime(k.next_hearing)}</div>` : ''}</div>
            ${statusBadge(k.status)}</a></li>`)}</ul>` : emptyState('fa-folder-open', t('portal.no_matters'), '')}
        </section>
        <section class="card">
          <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3"><h2 class="font-semibold">${t('nav.documents')}</h2>
            <button class="btn btn-primary btn-sm" data-action="upload"><i class="fas fa-upload"></i>${t('portal.upload')}</button></div>
          ${docList(o.documents)}
        </section>
      </div>
      <div class="space-y-6">
        <section class="card">
          <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('portal.invoices')}</h2>
            ${outstanding.length ? html`<p class="text-xs text-slate-500">${t('portal.outstanding', { n: outstanding.length })}</p>` : ''}</div>
          ${o.invoices.length ? html`<ul class="divide-y divide-slate-100">${o.invoices.map((i) => html`<li class="px-5 py-3">
            <div class="flex items-center justify-between gap-2"><span class="font-mono text-xs">${i.number}</span>${invoiceBadge(i)}</div>
            <div class="flex items-center justify-between gap-2 mt-1">
              <div class="text-sm font-semibold">${fmtMoney(Number(i.total), i.currency)}<div class="text-xs font-normal text-slate-500">${t('billing.due')}: ${fmtDate(isoDay(i.due_date))}</div></div>
              <button class="btn btn-ghost btn-sm" data-action="download-invoice" data-id="${i.id}" aria-label="${t('portal.download')}"><i class="fas fa-download"></i></button>
            </div></li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('portal.no_invoices')}</p>`}
        </section>
        <section class="card card-pad text-sm space-y-2">
          <h2 class="font-semibold">${t('portal.contact_firm')}</h2>
          ${o.firm?.phone ? html`<div dir="ltr" class="text-start"><i class="fas fa-phone text-slate-400 w-5"></i>${o.firm.phone}</div>` : ''}
          ${o.firm?.email ? html`<div dir="ltr" class="text-start"><i class="fas fa-envelope text-slate-400 w-5"></i><a class="text-brand-600 hover:underline" href="mailto:${o.firm.email}">${o.firm.email}</a></div>` : ''}
          <a href="#/portal/messages" class="btn btn-outline w-full mt-2"><i class="fas fa-comments"></i>${t('portal.message_lawyer')}</a>
        </section>
      </div>
    </div>`)
  bind(root, {
    actions: {
      upload: () => openClientUpload({ cases: o.cases, onSaved: rerender }),
      'download-doc': (el) => download(`/api/portal/documents/${el.dataset.id}/download`),
      'download-invoice': (el) => download(`/api/portal/invoices/${el.dataset.id}/download`)
    }
  })
}

export async function portalCaseView(root, { params, isCurrent, rerender }) {
  const [{ case: k, events, documents }, overview] = await Promise.all([api.get(`/api/portal/cases/${params.id}`), api.get('/api/portal/overview')])
  if (!isCurrent()) return
  const info = (label, value) => value ? html`<div><dt class="text-xs text-slate-500">${label}</dt><dd class="text-sm font-medium mt-0.5" dir="auto">${value}</dd></div>` : ''
  render(root, html`
    <nav class="text-sm text-slate-500 mb-3"><a href="#/portal" class="hover:underline">${t('portal.home')}</a></nav>
    <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div><h1 class="text-2xl font-bold" dir="auto">${caseTitle(k)}</h1><div class="mt-2">${statusBadge(k.status)}</div></div>
      <div class="flex gap-2">
        <button class="btn btn-outline" data-action="upload"><i class="fas fa-upload"></i>${t('portal.upload')}</button>
        <a class="btn btn-primary" href="#/portal/messages?case=${k.id}"><i class="fas fa-comments"></i>${t('portal.message_lawyer')}</a>
      </div>
    </div>
    <div class="grid lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <section class="card card-pad"><dl class="grid grid-cols-2 md:grid-cols-3 gap-4">
          ${info(t('cases.reference'), k.reference)}
          ${info(t('common.jurisdiction'), refLabel('jurisdictions', k.jurisdiction))}
          ${info(t('cases.court'), k.court)}
          ${info(t('cases.opposing_party'), k.opposing_party)}
          ${info(t('portal.your_lawyer'), k.lawyer_name)}
          ${info(t('cases.opened_on'), k.opened_on ? fmtDate(isoDay(k.opened_on)) : '')}
        </dl></section>
        <section class="card"><div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('nav.documents')}</h2></div>${docList(documents)}</section>
      </div>
      <section class="card h-fit">
        <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('portal.hearings')}</h2></div>
        ${events.length ? html`<ul class="divide-y divide-slate-100">${events.map((e) => html`<li class="px-5 py-3">
          <div class="mb-1">${eventBadge(e.kind)}</div><div class="text-sm font-medium" dir="auto">${e.title}</div>
          <div class="text-xs text-slate-500">${e.all_day ? fmtDate(e.starts_at) : fmtDateTime(e.starts_at)}${e.location ? ` · ${e.location}` : ''}</div></li>`)}</ul>`
          : html`<p class="px-5 py-6 text-sm text-slate-500">${t('portal.no_hearings')}</p>`}
      </section>
    </div>`)
  bind(root, {
    actions: {
      upload: () => openClientUpload({ cases: overview.cases, caseId: k.id, onSaved: rerender }),
      'download-doc': (el) => download(`/api/portal/documents/${el.dataset.id}/download`)
    }
  })
}

// Message thread shared by the portal and the firm's client page.
export function messageThread(items, { mineIsClient }) {
  if (!items.length) return html`<p class="text-sm text-slate-500 text-center py-8">${t('portal.no_messages')}</p>`
  return html`${items.map((m) => {
    const mine = m.from_client === mineIsClient
    return html`<div class="flex flex-col ${mine ? 'items-end' : 'items-start'}">
      <div class="chat-msg ${mine ? 'user' : 'assistant'} whitespace-pre-wrap" dir="auto">${m.body}</div>
      <div class="text-xs text-slate-400 mt-1">${m.sender_name || ''}${m.case_reference ? ` · ${m.case_reference}` : ''} · ${fmtDateTime(m.created_at)}</div>
    </div>`
  })}`
}

export async function portalMessagesView(root, { query, isCurrent }) {
  const [{ items }, o] = await Promise.all([api.get('/api/portal/messages'), api.get('/api/portal/overview')])
  if (!isCurrent()) return
  const preset = query.get('case') || ''
  render(root, html`
    <h1 class="text-2xl font-bold mb-4">${t('portal.messages')}</h1>
    <section class="card flex flex-col">
      <div class="p-5 space-y-4 bg-slate-50 max-h-[60vh] overflow-y-auto" data-thread>${messageThread(items, { mineIsClient: true })}</div>
      <form data-form="send" class="p-4 border-t border-slate-100 space-y-3">
        ${o.cases.length ? html`<select name="case_id" class="input" aria-label="${t('cases.matter')}"><option value="">${t('portal.general_question')}</option>${o.cases.map((k) => html`<option value="${k.id}" ${k.id === preset ? 'selected' : ''}>${k.reference} · ${caseTitle(k)}</option>`)}</select>` : ''}
        <div class="flex gap-2 items-end">
          <textarea name="body" rows="3" class="input flex-1" dir="auto" required maxlength="10000" placeholder="${t('portal.write_message')}" aria-label="${t('portal.write_message')}"></textarea>
          <button type="submit" class="btn btn-primary h-11"><i class="fas fa-paper-plane rtl:-scale-x-100"></i><span class="hidden sm:inline">${t('ai.send')}</span></button>
        </div>
        <p class="text-xs text-slate-500">${t('portal.message_note')}</p>
      </form>
    </section>`)
  const thread = root.querySelector('[data-thread]')
  thread.scrollTop = thread.scrollHeight
  bind(root, {
    forms: {
      send: (form) => busy(submitButton(form), async () => {
        const body = form.elements.body.value.trim()
        if (!body) return
        try {
          await api.post('/api/portal/messages', { body, case_id: form.elements.case_id?.value || null })
          form.elements.body.value = ''
          const { items: fresh } = await api.get('/api/portal/messages')
          render(thread, messageThread(fresh, { mineIsClient: true }))
          thread.scrollTop = thread.scrollHeight
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function portalSettingsView(root, ctx) {
  render(root, html`<h1 class="text-2xl font-bold mb-4">${t('nav.settings')}</h1><div id="tab-body"></div>`)
  await profileTab(root.querySelector('#tab-body'), ctx)
}
