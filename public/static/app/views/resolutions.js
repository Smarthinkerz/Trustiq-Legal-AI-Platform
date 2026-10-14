import { api, download } from '../api.js'
import { formData, html, render } from '../dom.js'
import { fmtDate, getLang, t } from '../i18n.js'
import { aiEnabled, can, readOnly } from '../store.js'
import { busy, clearFieldErrors, confirmDialog, inputField, modal, selectField, showError, submitButton, textareaField, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Corporate resolutions (قرارات الشركاء ومجلس الإدارة) on a company client's
// page: draft from a purpose, edit the wording, print, sign and apply.
// ---------------------------------------------------------------------------

const BODIES = ['shareholders', 'board', 'sole_owner']
const PURPOSES = ['appoint_manager', 'remove_manager', 'authorise_signatory', 'open_bank_account', 'grant_poa', 'change_address', 'approve_accounts', 'other']
const APPLICABLE = ['appoint_manager', 'remove_manager', 'authorise_signatory', 'change_address']
// Which inputs each purpose asks for.
const FIELDS = {
  appoint_manager: ['person', 'authority', 'effective_on'], authorise_signatory: ['person', 'authority', 'effective_on'], remove_manager: ['remove', 'effective_on'],
  open_bank_account: ['bank', 'person', 'authority'], grant_poa: ['person', 'scope'], change_address: ['address'], approve_accounts: ['period_end'], other: ['items']
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' })

export async function resolutionsCard(box, { clientId }) {
  if (!box || !clientId) return
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  let d = null
  const draw = () => {
    if (!d) return
    render(box, html`<section class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold"><i class="fas fa-stamp text-slate-400 me-1"></i> ${t('res.title')} <span class="text-slate-400 font-normal">(${d.items.length})</span></h2>
        ${editable ? html`<button class="btn btn-outline btn-sm" data-r="new"><i class="fas fa-plus"></i>${t('res.new')}</button>` : ''}
      </div>
      ${d.items.length ? html`<ul class="divide-y divide-slate-100">${d.items.map((r) => html`<li class="px-5 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-xs text-slate-500">${t('res.no', { n: r.number })}</span>
          <span class="text-sm font-medium flex-1 min-w-0">${t(r.purpose === 'other' ? 'res.custom' : `res.p_${r.purpose}`)} <span class="text-xs text-slate-500 font-normal">· ${t(`res.b_${r.body}`)}</span></span>
          <span class="badge ${r.status === 'signed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${t(`res.s_${r.status}`)}</span>
        </div>
        <div class="text-xs text-slate-500 mt-1">${fmtDate(r.resolved_on, { hijri: false })}${r.place ? html` · <span dir="auto">${r.place}</span>` : ''}
          · ${t('res.signers_n', { n: r.signers.length })}${r.percent_present != null ? html` · <b class="${r.percent_present < 100 ? 'text-amber-700' : ''}">${t('res.present', { n: r.percent_present })}</b>` : ''}
          ${r.signed_on ? ` · ${t('res.signed_on', { date: fmtDate(r.signed_on, { hijri: false }) })}` : ''}${r.applied_at ? html` · <i class="fas fa-check text-emerald-600"></i> ${t('res.applied')}` : ''}</div>
        <p class="text-sm text-slate-700 mt-1 line-clamp-2" dir="auto">${(getLang() === 'ar' ? r.items[0]?.ar || r.items[0]?.en : r.items[0]?.en || r.items[0]?.ar) || ''}</p>
        <div class="flex flex-wrap gap-1 mt-2">
          <button class="btn btn-ghost btn-sm" data-r="word" data-id="${r.id}"><i class="fas fa-file-word"></i>${t('res.word')}</button>
          ${editable && r.status === 'draft' ? html`<button class="btn btn-ghost btn-sm" data-r="edit" data-id="${r.id}"><i class="fas fa-pen"></i>${t('common.edit')}</button>
            <button class="btn btn-outline btn-sm" data-r="sign" data-id="${r.id}"><i class="fas fa-signature"></i>${t('res.mark_signed')}</button>` : ''}
          ${editable && (r.status === 'draft' || can('owner', 'admin')) ? html`<button class="btn btn-danger-ghost btn-sm" data-r="delete" data-id="${r.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </li>`)}</ul>` : html`<p class="px-5 py-6 text-sm text-slate-500">${t('res.none')}</p>`}
    </section>`)
  }
  const load = async () => {
    try { d = await api.get(`/api/resolutions/client/${clientId}`); if (document.body.contains(box)) draw() } catch { /* card stays empty */ }
  }
  box.onclick = async (e) => {
    const el = e.target.closest('[data-r]')
    if (!el) return
    const act = el.dataset.r
    // Fresh signer and manager lists, in case the company record just changed.
    if (act === 'new' || act === 'edit') await load()
    if (act === 'new') newForm(clientId, d, load)
    const r = d.items.find((x) => x.id === el.dataset.id)
    if (act === 'word') download(`/api/resolutions/${r.id}/docx`)
    if (act === 'edit') editForm(r, d, load)
    if (act === 'sign') signForm(r, load)
    if (act === 'delete') {
      if (!(await confirmDialog(t('res.delete_confirm', { n: r.number })))) return
      try { await api.del(`/api/resolutions/${r.id}`); load() } catch (err) { showError(err) }
    }
  }
  await load()
}

// Ticks for who signs, with the share of the capital they hold.
const signerBoxes = (list, chosen) => list.length ? html`<div class="space-y-1">${list.map((s) => html`<label class="flex items-center gap-2 text-sm">
  <input type="checkbox" name="signer" value="${s.id}" data-pct="${s.percent ?? ''}" ${!chosen || chosen.includes(s.id) ? 'checked' : ''} />
  <span dir="auto">${s.name}</span>${s.percent != null ? html`<span class="text-xs text-slate-500">${s.percent}%</span>` : ''}</label>`)}</div>`
  : html`<p class="text-sm text-amber-800">${t('res.no_signers')}</p>`

const itemFields = (items) => html`${items.map((it, i) => html`<div class="grid sm:grid-cols-2 gap-2" data-item>
  <textarea class="input text-sm" rows="5" name="en_${i}" dir="ltr" aria-label="${t('res.english')} ${i + 1}" placeholder="${t('res.english')}">${it.en}</textarea>
  <textarea class="input text-sm" rows="5" name="ar_${i}" dir="rtl" aria-label="${t('res.arabic')} ${i + 1}" placeholder="${t('res.arabic')}">${it.ar}</textarea></div>`)}`
const readItems = (form) => [...form.querySelectorAll('[data-item]')].map((_, i) => ({ en: form.elements[`en_${i}`].value.trim(), ar: form.elements[`ar_${i}`].value.trim() })).filter((x) => x.en || x.ar)

function newForm(clientId, d, done) {
  let items = [{ en: '', ar: '' }]
  const m = modal({
    title: t('res.new'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-2 gap-4">
        ${selectField({ name: 'body', label: t('res.body'), options: BODIES.map((b) => ({ value: b, label: t(`res.b_${b}`) })), value: 'shareholders', attrs: 'data-change="body"' })}
        ${selectField({ name: 'purpose', label: t('res.purpose'), options: PURPOSES.map((p) => ({ value: p, label: t(`res.p_${p}`) })), value: 'appoint_manager', attrs: 'data-change="purpose"' })}
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'resolved_on', label: t('res.date'), type: 'date', value: today(), required: true })}
        ${inputField({ name: 'place', label: t('res.place'), attrs: 'maxlength="200" dir="auto"', placeholder: t('res.place_placeholder') })}
      </div>
      <fieldset class="rounded-xl border border-slate-200 p-4 space-y-3"><legend class="px-1 text-sm font-semibold">${t('res.details')}</legend>
        <div data-for="person" class="grid sm:grid-cols-2 gap-3">
          ${inputField({ name: 'person_name', label: t('res.person_name'), attrs: 'maxlength="300" dir="auto"' })}
          ${inputField({ name: 'person_name_ar', label: t('res.person_name_ar'), attrs: 'maxlength="300" dir="rtl"' })}
          ${inputField({ name: 'nationality', label: t('corp.nationality'), attrs: 'maxlength="100" dir="auto"' })}
          ${inputField({ name: 'id_number', label: t('corp.id_number'), attrs: 'maxlength="100" dir="ltr"' })}
        </div>
        <div data-for="bank">${inputField({ name: 'bank', label: t('res.bank'), attrs: 'maxlength="300" dir="auto"', placeholder: t('res.bank_placeholder') })}</div>
        <div data-for="authority">${textareaField({ name: 'authority', label: t('corp.signing_authority'), rows: 2, placeholder: t('corp.signing_placeholder') })}</div>
        <div data-for="scope">${textareaField({ name: 'scope', label: t('res.scope'), rows: 2, placeholder: t('res.scope_placeholder') })}</div>
        <div data-for="address">${textareaField({ name: 'address', label: t('corp.registered_address'), rows: 2 })}</div>
        <div data-for="remove">${selectField({ name: 'remove_person_id', label: t('res.remove_who'), options: d.managers.map((p) => ({ value: p.id, label: `${p.name} (${t(`corp.r_${p.role}`)})` })), empty: '' })}</div>
        <div data-for="period_end">${inputField({ name: 'period_end', label: t('res.period_end'), type: 'date' })}</div>
        <div data-for="effective_on">${inputField({ name: 'effective_on', label: t('res.effective_on'), type: 'date', hint: t('res.effective_hint') })}</div>
        <div data-for="items" class="space-y-2">
          <p class="text-xs text-slate-500">${t('res.items_help')}</p>
          ${aiEnabled() ? html`<div class="flex gap-2 items-end"><div class="flex-1">${textareaField({ name: 'description', label: t('res.describe'), rows: 2, placeholder: t('res.describe_placeholder') })}</div>
            <button type="button" class="btn btn-outline btn-sm mb-1" data-action="ai"><i class="fas fa-wand-magic-sparkles"></i>${t('res.ai')}</button></div>` : ''}
          <div data-items class="space-y-2">${itemFields(items)}</div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="add-item"><i class="fas fa-plus"></i>${t('res.add_item')}</button>
        </div>
      </fieldset>
      <div class="grid sm:grid-cols-2 gap-4">
        <div><div class="label">${t('res.signers')} <span class="text-xs text-slate-500" data-pct-out></span></div><div data-signers>${signerBoxes(d.eligible.shareholders, null)}</div></div>
        ${selectField({ name: 'implementer_id', label: t('res.implementer'), options: d.signatories.map((p) => ({ value: p.id, label: `${p.name} (${t(`corp.r_${p.role}`)})` })), empty: t('res.no_implementer'), hint: t('res.implementer_hint') })}
      </div>
      <p class="text-xs text-slate-500">${t('res.review_note')}</p>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-file-signature"></i>${t('res.draft')}</button></div>
    </form>`,
    actions: {
      'add-item': () => { items = readAll(); items.push({ en: '', ar: '' }); redrawItems() },
      ai: async (el) => {
        const description = m.el.querySelector('[name=description]').value.trim()
        if (description.length < 10) return toast(t('res.describe_more'), 'error')
        await busy(el, async () => {
          try {
            const r = await api.post(`/api/resolutions/client/${clientId}/ai`, { description, body: m.el.querySelector('[name=body]').value })
            items = r.items; redrawItems(); toast(t('res.ai_done'))
          } catch (err) { showError(err) }
        })
      }
    },
    changes: { purpose: () => toggle(), body: () => { drawSigners(); } },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const b = formData(form)
        const purpose = b.purpose
        const params = {}
        for (const k of ['person_name', 'person_name_ar', 'nationality', 'id_number', 'authority', 'bank', 'scope', 'address', 'period_end', 'effective_on', 'remove_person_id', 'implementer_id']) {
          const el = form.elements[k]
          if (el && !el.closest('[data-for]')?.hidden) params[k] = b[k]
        }
        params.implementer_id = b.implementer_id
        const signer_ids = [...form.querySelectorAll('[name=signer]:checked')].map((x) => x.value)
        try {
          const r = await api.post(`/api/resolutions/client/${clientId}`, {
            body: b.body, purpose, resolved_on: b.resolved_on, place: b.place, params, signer_ids, items: purpose === 'other' ? readItems(form) : undefined
          })
          m.close(); toast(t('res.drafted', { n: r.resolution.number })); done()
          // Straight to review: details typed in one language appear as typed in the other.
          editForm(r.resolution, d, done, { review: true })
        } catch (err) { showError(err, form) }
      })
    }
  })
  const form = m.el.querySelector('form')
  const readAll = () => readItems(form).length ? readItems(form) : [{ en: '', ar: '' }]
  const redrawItems = () => render(m.el.querySelector('[data-items]'), itemFields(items))
  const toggle = () => {
    const want = FIELDS[form.elements.purpose.value]
    for (const el of form.querySelectorAll('[data-for]')) el.hidden = !want.includes(el.dataset.for)
  }
  const pctOut = () => {
    const ticked = [...form.querySelectorAll('[name=signer]:checked')]
    const pct = ticked.reduce((n, x) => n + Number(x.dataset.pct || 0), 0)
    m.el.querySelector('[data-pct-out]').textContent = form.elements.body.value === 'board' ? '' : `(${Math.round(pct * 100) / 100}%)`
  }
  const drawSigners = () => {
    const body = form.elements.body.value
    render(m.el.querySelector('[data-signers]'), signerBoxes(body === 'board' ? d.eligible.board : d.eligible.shareholders, null))
    pctOut()
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'signer') pctOut() })
  toggle(); pctOut()
}

function editForm(r, d, done, { review = false } = {}) {
  const m = modal({
    title: t('res.edit', { n: r.number }),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'resolved_on', label: t('res.date'), type: 'date', value: r.resolved_on, required: true })}
        ${inputField({ name: 'place', label: t('res.place'), value: r.place ?? '', attrs: 'maxlength="200" dir="auto"' })}
      </div>
      ${review ? html`<p class="text-sm rounded-lg bg-amber-50 text-amber-900 p-2"><i class="fas fa-language"></i> ${t('res.check_languages')}</p>` : ''}
      <div class="rounded-lg bg-slate-50 p-3 text-sm grid sm:grid-cols-2 gap-2"><p dir="ltr">${r.preamble.en}</p><p dir="rtl">${r.preamble.ar}</p></div>
      <div class="space-y-2" data-items>${itemFields(r.items)}</div>
      ${r.body !== 'sole_owner' ? html`<div><div class="label">${t('res.signers')}</div>${signerBoxes(r.body === 'board' ? d.eligible.board : d.eligible.shareholders, r.signers.map((s) => s.id))}</div>` : ''}
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary">${t('common.save')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        const b = formData(form)
        const body = { resolved_on: b.resolved_on, place: b.place, items: readItems(form) }
        if (r.body !== 'sole_owner') body.signer_ids = [...form.querySelectorAll('[name=signer]:checked')].map((x) => x.value)
        try { await api.patch(`/api/resolutions/${r.id}`, body); m.close(); toast(t('common.saved')); done() } catch (err) { showError(err, form) }
      })
    }
  })
}

function signForm(r, done) {
  const canApply = APPLICABLE.includes(r.purpose)
  const m = modal({
    title: t('res.mark_signed'),
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <p class="text-sm">${t('res.no', { n: r.number })} · ${t(r.purpose === 'other' ? 'res.custom' : `res.p_${r.purpose}`)}</p>
      ${inputField({ name: 'signed_on', label: t('res.signed_date'), type: 'date', value: today(), required: true, attrs: `min="${r.resolved_on}" max="${today()}"` })}
      ${canApply ? html`<label class="flex items-start gap-2 text-sm"><input type="checkbox" name="apply" checked class="mt-1" /> <span>${t('res.apply')}<span class="block text-xs text-slate-500">${t(`res.apply_${r.purpose}`)}</span></span></label>` : ''}
      <p class="text-xs text-slate-500">${t('res.sign_note')}</p>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button><button class="btn btn-primary"><i class="fas fa-signature"></i>${t('res.mark_signed')}</button></div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        const b = formData(form)
        try {
          await api.post(`/api/resolutions/${r.id}/sign`, { signed_on: b.signed_on, apply: !!b.apply })
          m.close(); toast(b.apply ? t('res.signed_applied') : t('res.signed')); done()
          // The company record above may have changed.
          if (b.apply) window.dispatchEvent(new CustomEvent('corporate:changed'))
        } catch (err) { showError(err, form) }
      })
    }
  })
}
