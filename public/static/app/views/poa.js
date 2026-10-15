import { api, ApiError } from '../api.js'
import { formData, html, render } from '../dom.js'
import { t } from '../i18n.js'
import { store } from '../store.js'
import { busy, inputField, modal, selectField, showError, spinner, submitButton, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Power of attorney draft (مسودة وكالة): a bilingual draft for the notary,
// naming the firm's advocates, the scope and the special powers.
// ---------------------------------------------------------------------------

const SCOPES = ['litigation_general', 'litigation_specific', 'company_representation', 'real_estate', 'debt_collection', 'arbitration']
const SPECIAL = ['admit', 'settle', 'waive', 'release', 'arbitrate', 'receive']
// The details each scope asks for.
const DETAILS = { litigation_specific: ['case_ref', 'court', 'opponent'], real_estate: ['property'], debt_collection: ['debtor'] }

export async function openPoaDraft({ clientId, caseId = null }) {
  const m = modal({ title: t('poa.title'), size: 'lg', body: html`<div data-poa>${spinner()}</div>` })
  let o
  try { o = await api.get(`/api/poa/options?client_id=${clientId}${caseId ? `&case_id=${caseId}` : ''}`) } catch (err) { m.close(); return showError(err) }
  const me = store.me?.user?.id
  const k = o.case
  render(m.el.querySelector('[data-poa]'), html`<form data-form="poa" class="space-y-4" novalidate>
    <p class="text-sm text-slate-600">${t('poa.intro', { name: o.client.name })}</p>
    ${selectField({ name: 'scope', label: t('poa.scope'), options: SCOPES.map((s) => ({ value: s, label: t(`poa.s_${s}`) })), value: k ? 'litigation_specific' : 'litigation_general' })}
    <div class="grid sm:grid-cols-3 gap-3" data-details>
      <div data-for="case_ref">${inputField({ name: 'case_ref', label: t('poa.case_ref'), attrs: 'maxlength="200" dir="ltr"', hint: t('poa.case_ref_hint') })}</div>
      <div data-for="court">${inputField({ name: 'court', label: t('cases.court'), value: k?.court ?? '', attrs: 'maxlength="200" dir="auto"' })}</div>
      <div data-for="opponent">${inputField({ name: 'opponent', label: t('poa.opponent'), value: k?.opposing_party ?? '', attrs: 'maxlength="300" dir="auto"' })}</div>
      <div data-for="property" class="sm:col-span-3">${inputField({ name: 'property', label: t('poa.property'), attrs: 'maxlength="500" dir="auto"', placeholder: t('poa.property_placeholder') })}</div>
      <div data-for="debtor" class="sm:col-span-3">${inputField({ name: 'debtor', label: t('poa.debtor'), value: k?.opposing_party ?? '', attrs: 'maxlength="300" dir="auto"' })}</div>
    </div>
    ${o.client.kind === 'company' ? (o.representatives.length
      ? selectField({ name: 'representative_id', label: t('poa.representative'), options: o.representatives.map((r) => ({ value: r.id, label: `${r.name} (${t(`corp.r_${r.role}`)})` })) })
      : html`<p class="text-xs text-amber-800 rounded-lg bg-amber-50 p-2">${t('poa.no_representative')}</p>`) : ''}
    <fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('poa.agents')}</legend>
      <div class="space-y-2">${o.lawyers.map((l) => html`<div class="grid sm:grid-cols-[auto_1fr_1fr_1fr] gap-2 items-center" data-lawyer="${l.id}">
        <input type="checkbox" name="agent" value="${l.id}" ${l.id === me ? 'checked' : ''} aria-label="${l.name}" />
        <span class="text-sm">${l.name}</span>
        <input class="input py-1 text-sm" name="name_ar_${l.id}" value="${l.name_ar ?? ''}" dir="rtl" maxlength="200" placeholder="${t('poa.name_ar')}" aria-label="${t('poa.name_ar')}" data-orig="${l.name_ar ?? ''}" />
        <input class="input py-1 text-sm" name="bar_${l.id}" value="${l.bar_number ?? ''}" dir="ltr" maxlength="60" placeholder="${t('poa.bar_number')}" aria-label="${t('poa.bar_number')}" data-orig="${l.bar_number ?? ''}" />
      </div>`)}</div>
      <p class="text-xs text-slate-500 mt-2">${t('poa.agents_hint')}</p></fieldset>
    <fieldset class="rounded-xl border border-slate-200 p-4"><legend class="px-1 text-sm font-semibold">${t('poa.special')}</legend>
      <p class="text-xs text-slate-500 mb-2">${t('poa.special_hint')}</p>
      <div class="grid sm:grid-cols-2 gap-1">${SPECIAL.map((s) => html`<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="special" value="${s}" /> ${t(`poa.p_${s}`)}</label>`)}</div>
      <label class="flex items-center gap-2 text-sm mt-2"><input type="checkbox" name="substitute" /> ${t('poa.substitute')}</label></fieldset>
    <div class="grid sm:grid-cols-2 gap-4 items-end">
      ${inputField({ name: 'valid_until', label: t('poa.valid_until'), type: 'date', hint: t('poa.valid_hint') })}
      <label class="flex items-center gap-2 text-sm mb-6"><input type="checkbox" name="letterhead" /> ${t('poa.letterhead')}</label>
    </div>
    <p class="text-xs text-slate-500">${t('poa.review')}</p>
    <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-action="close-modal">${t('common.cancel')}</button>
      <button class="btn btn-primary"><i class="fas fa-file-word"></i>${t('poa.download')}</button></div>
  </form>`)
  const form = m.el.querySelector('form')
  const toggle = () => {
    const want = DETAILS[form.elements.scope.value] ?? []
    for (const el of form.querySelectorAll('[data-for]')) el.hidden = !want.includes(el.dataset.for)
  }
  form.elements.scope.addEventListener('change', toggle)
  toggle()
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    busy(submitButton(form), async () => {
      const agents = [...form.querySelectorAll('[name=agent]:checked')].map((x) => x.value)
      if (!agents.length) return toast(t('poa.need_agent'), 'error')
      try {
        // Remember Arabic names and registration numbers that were added or changed.
        for (const id of agents) {
          const ar = form.elements[`name_ar_${id}`], bar = form.elements[`bar_${id}`]
          if (ar.value.trim() !== ar.dataset.orig || bar.value.trim() !== bar.dataset.orig) {
            await api.put(`/api/poa/lawyers/${id}`, { name_ar: ar.value.trim(), bar_number: bar.value.trim() })
            ar.dataset.orig = ar.value.trim(); bar.dataset.orig = bar.value.trim()
          }
        }
        const d = formData(form)
        const q = new URLSearchParams({ client_id: clientId, scope: d.scope, agents: agents.join(','), substitute: String(!!d.substitute), letterhead: String(!!d.letterhead) })
        if (caseId) q.set('case_id', caseId)
        const special = [...form.querySelectorAll('[name=special]:checked')].map((x) => x.value)
        if (special.length) q.set('special', special.join(','))
        if (d.representative_id) q.set('representative_id', d.representative_id)
        if (d.valid_until) q.set('valid_until', d.valid_until)
        for (const k of DETAILS[d.scope] ?? []) if (d[k]) q.set(k, d[k])
        // One request: show the reason if the draft cannot be built, otherwise save the file.
        const res = await fetch(`/api/poa/draft?${q}`, { credentials: 'same-origin' })
        if (!res.ok) {
          const err = (await res.json().catch(() => null))?.error ?? {}
          throw new ApiError(res.status, err.code ?? 'error', err.message ?? res.statusText)
        }
        const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get('content-disposition') ?? '')?.[1]
        const url = URL.createObjectURL(await res.blob())
        const a = Object.assign(document.createElement('a'), { href: url, download: name ? decodeURIComponent(name) : 'poa-draft.docx' })
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        m.close()
        toast(t('poa.ready'))
      } catch (err) { showError(err) }
    })
  })
}
