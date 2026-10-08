import { api, download } from '../api.js'
import { bind, html, qs, render } from '../dom.js'
import { fmtDate, fmtDateTime, fmtRelative, t } from '../i18n.js'
import { can, readOnly } from '../store.js'
import { busy, confirmDialog, emptyState, modal, pageHeader, showError, spinner, submitButton, toast } from '../ui.js'

const STATUS_COLORS = { pending: 'bg-amber-100 text-amber-800', completed: 'bg-emerald-100 text-emerald-800', declined: 'bg-red-100 text-red-700', cancelled: 'bg-slate-100 text-slate-500', expired: 'bg-slate-200 text-slate-600' }
const SIGNER_ICONS = { pending: 'fa-clock text-slate-400', viewed: 'fa-eye text-sky-600', signed: 'fa-circle-check text-emerald-600', declined: 'fa-circle-xmark text-red-600' }
const FILTERS = ['all', 'pending', 'completed', 'declined', 'cancelled']

const canSend = () => can('owner', 'admin', 'lawyer') && !readOnly()
const statusOf = (r) => (r.expired ? 'expired' : r.status)
const statusBadge = (r) => html`<span class="badge ${STATUS_COLORS[statusOf(r)]}">${t(`sig.status_${statusOf(r)}`)}</span>`

// Shows the personal signing links so they can be shared by WhatsApp or SMS as well as email.
function showLinks(links, title) {
  const m = modal({
    title,
    size: 'lg',
    body: html`<div class="space-y-4">
      <p class="text-sm text-slate-600">${t('sig.links_hint')}</p>
      <ul class="space-y-3">${links.map((l, i) => html`<li class="rounded-lg border border-slate-200 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span class="font-medium" dir="auto">${l.name}</span>
          <span class="text-xs ${l.emailed ? 'text-emerald-700' : 'text-slate-500'}">${l.emailed ? html`<i class="fas fa-envelope-circle-check"></i> ${t('sig.emailed_to', { email: l.email })}` : t('sig.not_emailed')}</span>
        </div>
        <div class="flex gap-2 mt-2"><input class="input font-mono text-xs" dir="ltr" readonly value="${l.url}" data-link="${i}" />
          <button class="btn btn-outline" data-action="copy" data-i="${i}" aria-label="${t('common.copy')}"><i class="fas fa-copy"></i></button></div>
      </li>`)}</ul>
      <div class="flex justify-end"><button class="btn btn-primary" data-action="close-modal">${t('common.done')}</button></div>
    </div>`,
    actions: {
      copy: async (el) => {
        const input = m.el.querySelector(`[data-link="${el.dataset.i}"]`)
        try { await navigator.clipboard.writeText(input.value); toast(t('common.copied')) } catch { input.select() }
      }
    }
  })
}

// Dialog on a document: choose signers and send it for signature.
export async function openSignatureDialog(doc, { onSent } = {}) {
  let client = null
  if (doc.client_id) {
    try { client = (await api.get(`/api/clients/${doc.client_id}`)).client } catch { /* optional */ }
  }
  const rowHtml = (s = {}) => html`<div class="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end" data-signer>
    <label class="text-sm"><span class="block text-slate-600 mb-1">${t('sig.signer_name')}</span><input class="input" name="name" value="${s.name ?? ''}" required maxlength="200" dir="auto" /></label>
    <label class="text-sm"><span class="block text-slate-600 mb-1">${t('auth.email')}</span><input class="input" name="email" type="email" value="${s.email ?? ''}" maxlength="254" dir="ltr" /></label>
    <input type="hidden" name="client_id" value="${s.client_id ?? ''}" />
    <button type="button" class="btn btn-ghost btn-sm text-red-600" data-action="remove" aria-label="${t('common.delete')}"><i class="fas fa-xmark"></i></button>
  </div>`
  const m = modal({
    title: t('sig.send_title'),
    size: 'lg',
    body: html`<form data-form="send" class="space-y-5" novalidate>
      <p class="text-sm text-slate-600">${t('sig.send_intro', { title: doc.title })}</p>
      <section>
        <h3 class="font-semibold text-sm mb-2">${t('sig.signers')}</h3>
        <div class="space-y-3" data-signers>${rowHtml(client ? { name: client.name, email: client.email, client_id: client.id } : {})}</div>
        <button type="button" class="btn btn-ghost btn-sm mt-2" data-action="add"><i class="fas fa-plus"></i>${t('sig.add_signer')}</button>
      </section>
      <label class="block text-sm"><span class="block text-slate-600 mb-1">${t('sig.message')}</span>
        <textarea class="input" name="message" rows="3" maxlength="2000" dir="auto" placeholder="${t('sig.message_placeholder')}"></textarea></label>
      <div class="grid sm:grid-cols-2 gap-4">
        <label class="text-sm"><span class="block text-slate-600 mb-1">${t('sig.expires_in')}</span>
          <select class="input" name="expires_in_days">${[7, 14, 30, 60].map((n) => html`<option value="${n}" ${n === 14 ? 'selected' : ''}>${t('sig.days', { n })}</option>`)}</select></label>
        <label class="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" name="send_email" checked />${t('sig.send_email')}</label>
      </div>
      <p class="text-xs text-slate-500"><i class="fas fa-circle-info me-1"></i>${t('sig.snapshot_note')}</p>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-paper-plane"></i>${t('sig.send')}</button>
      </div>
    </form>`,
    actions: {
      add: () => {
        const box = m.el.querySelector('[data-signers]')
        if (box.children.length >= 10) return
        box.insertAdjacentHTML('beforeend', String(rowHtml()))
      },
      remove: (el) => {
        const box = m.el.querySelector('[data-signers]')
        if (box.children.length > 1) el.closest('[data-signer]').remove()
      }
    },
    forms: {
      send: (form) => busy(submitButton(form), async () => {
        const signers = [...form.querySelectorAll('[data-signer]')].map((row) => ({
          name: row.querySelector('[name=name]').value.trim(),
          email: row.querySelector('[name=email]').value.trim(),
          client_id: row.querySelector('[name=client_id]').value || null
        })).filter((s) => s.name)
        if (!signers.length) return toast(t('sig.need_signer'), 'error')
        try {
          const r = await api.post('/api/signatures', {
            document_id: doc.id, signers,
            message: form.querySelector('[name=message]').value.trim(),
            expires_in_days: Number(form.querySelector('[name=expires_in_days]').value),
            send_email: form.querySelector('[name=send_email]').checked
          })
          m.close()
          toast(t('sig.sent'))
          showLinks(r.links, t('sig.links_title'))
          onSent?.()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

async function openDetails(id, onChange) {
  const m = modal({ title: t('sig.details'), size: 'lg', body: spinner() })
  const body = m.el.querySelector('.p-5')
  try {
    const { request: r, signers, events } = await api.get(`/api/signatures/${id}`)
    render(body, html`<div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold" dir="auto">${r.title}</h3>${statusBadge(r)}</div>
      <ul class="divide-y divide-slate-100 text-sm">${signers.map((s) => html`<li class="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <i class="fas ${SIGNER_ICONS[s.status]}"></i><span class="font-medium" dir="auto">${s.name}</span>
        ${s.email ? html`<span class="text-slate-500" dir="ltr">${s.email}</span>` : ''}
        <span class="ms-auto text-xs text-slate-500">${t(`sig.signer_${s.status}`)}${s.signed_at ? ` · ${fmtDateTime(s.signed_at)}` : ''}${s.decline_reason ? ` · ${s.decline_reason}` : ''}</span>
      </li>`)}</ul>
      <p class="text-xs text-slate-500 break-all">${t('sig.fingerprint')}: <span class="font-mono" dir="ltr">${r.content_hash}</span></p>
      <details><summary class="cursor-pointer text-sm font-semibold">${t('sig.audit_trail')}</summary>
        <ol class="mt-2 text-xs space-y-1">${events.map((e) => html`<li class="flex flex-wrap gap-x-2"><span class="text-slate-500">${fmtDateTime(e.created_at)}</span>
          <span class="font-medium">${t(`sig.event_${e.event}`)}</span>${e.signer_name ? html`<span dir="auto">${e.signer_name}</span>` : ''}${e.detail ? html`<span class="text-slate-500" dir="auto">${e.detail}</span>` : ''}${e.ip ? html`<span class="text-slate-400 font-mono">${e.ip}</span>` : ''}</li>`)}</ol></details>
      <div class="flex flex-wrap justify-end gap-2 pt-4 border-t border-slate-100">
        ${r.status === 'completed' ? html`<button class="btn btn-primary" data-action="download"><i class="fas fa-file-word"></i>${t('sig.download_signed')}</button>`
          : html`<button class="btn btn-outline" data-action="download"><i class="fas fa-file-word"></i>${t('sig.download_record')}</button>`}
        ${r.status === 'pending' && !r.expired && canSend() ? html`<button class="btn btn-outline" data-action="remind"><i class="fas fa-bell"></i>${t('sig.remind')}</button>
          <button class="btn btn-ghost text-red-600" data-action="cancel">${t('sig.cancel')}</button>` : ''}
      </div>
    </div>`)
    bind(body, {
      actions: {
        download: () => download(`/api/signatures/${id}/signed-copy`),
        remind: (el) => busy(el, async () => {
          try { const res = await api.post(`/api/signatures/${id}/remind`); m.close(); showLinks(res.links, t('sig.reminded')) } catch (err) { showError(err) }
        }),
        cancel: async () => {
          if (!(await confirmDialog(t('sig.confirm_cancel')))) return
          try { await api.post(`/api/signatures/${id}/cancel`); m.close(); toast(t('sig.cancelled')); onChange?.() } catch (err) { showError(err) }
        }
      }
    })
  } catch (err) { m.close(); showError(err) }
}

export async function signaturesView(root, ctx) {
  const filter = FILTERS.includes(ctx.query.get('status')) ? ctx.query.get('status') : 'all'
  const { items } = await api.get(`/api/signatures${qs({ status: filter })}`)
  if (!ctx.isCurrent()) return
  render(root, html`
    ${pageHeader(t('nav.signatures'), t('sig.subtitle'))}
    <div class="flex flex-wrap gap-2 mb-4">${FILTERS.map((f) => html`<a href="#/signatures?status=${f}" class="badge ${f === filter ? 'bg-brand-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} px-3 py-1.5">${t(`sig.filter_${f}`)}</a>`)}</div>
    ${items.length ? html`<div class="card overflow-x-auto"><table class="table">
      <thead><tr><th>${t('sig.document')}</th><th>${t('sig.signers')}</th><th>${t('common.status')}</th><th>${t('sig.sent_on')}</th><th></th></tr></thead>
      <tbody>${items.map((r) => html`<tr>
        <td><button class="font-medium text-start hover:underline" data-action="open" data-id="${r.id}" dir="auto">${r.title}</button>
          ${r.document_id ? html`<div><a class="text-xs text-brand-600 hover:underline" href="#/documents/${r.document_id}">${t('sig.open_document')}</a></div>` : ''}</td>
        <td><ul class="text-xs space-y-0.5">${r.signers.map((s) => html`<li><i class="fas ${SIGNER_ICONS[s.status]} me-1"></i><span dir="auto">${s.name}</span></li>`)}</ul></td>
        <td>${statusBadge(r)}</td>
        <td class="text-sm text-slate-500" title="${fmtDateTime(r.created_at)}">${fmtRelative(r.created_at)}${r.status === 'pending' && !r.expired ? html`<div class="text-xs">${t('sig.until', { date: fmtDate(r.expires_at) })}</div>` : ''}</td>
        <td class="text-end">${r.status === 'completed' ? html`<button class="btn btn-ghost btn-sm" data-action="download" data-id="${r.id}" aria-label="${t('sig.download_signed')}"><i class="fas fa-file-word"></i></button>` : ''}</td>
      </tr>`)}</tbody></table></div>`
      : html`<div class="card">${emptyState('fa-signature', t('sig.none'), t('sig.none_hint'))}</div>`}`)
  bind(root, {
    actions: {
      open: (el) => openDetails(el.dataset.id, () => ctx.rerender()),
      download: (el) => download(`/api/signatures/${el.dataset.id}/signed-copy`)
    }
  })
}
