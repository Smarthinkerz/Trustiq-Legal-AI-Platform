import { api } from '../api.js'
import { bind, formData, html, qs, raw, render } from '../dom.js'
import { fmtDate, fmtNumber, fmtRelative, getLang, t } from '../i18n.js'
import { navigate, setLeaveGuard } from '../main.js'
import { aiEnabled, can, canManageTeam, readOnly, refLabel, refOptions, store } from '../store.js'
import {
  busy, confirmDialog, emptyState, inputField, modal, selectField, showError, spinner, submitButton, textareaField, toast
} from '../ui.js'

const TABS = [
  ['leads', 'fa-inbox', () => true],
  ['blog', 'fa-newspaper', () => true],
  ['site', 'fa-globe', () => canManageTeam()]
]
const LEAD_FILTERS = ['open', 'new', 'contacted', 'converted', 'declined', 'all']
const LEAD_COLORS = { new: 'bg-sky-100 text-sky-800', contacted: 'bg-amber-100 text-amber-800', converted: 'bg-emerald-100 text-emerald-800', declined: 'bg-slate-100 text-slate-500' }
const SOURCE_ICONS = { form: 'fa-envelope-open-text', chat: 'fa-comments', manual: 'fa-user-pen' }

const canWrite = () => can('owner', 'admin', 'lawyer') && !readOnly()
const leadBadge = (s) => html`<span class="badge ${LEAD_COLORS[s] || ''}">${t(`web.lead_${s}`)}</span>`

export async function websiteView(root, ctx) {
  const tabs = TABS.filter(([, , ok]) => ok())
  const active = tabs.find(([k]) => k === ctx.query.get('tab'))?.[0] || 'leads'
  const { site, url } = await api.get('/api/website/site')
  if (!ctx.isCurrent()) return
  render(root, html`
    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-bold">${t('nav.website')}</h1>
        <p class="text-sm text-slate-500 mt-1">${t('web.subtitle')}</p>
      </div>
      ${url && site.published ? html`<a class="btn btn-outline" href="${url}${getLang() === 'ar' ? '?lang=ar' : ''}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square"></i>${t('web.view_site')}</a>`
        : html`<span class="badge bg-slate-100 text-slate-600 self-center">${t('web.not_published')}</span>`}
    </div>
    <div class="flex gap-1 overflow-x-auto border-b border-slate-200 mb-6" role="tablist">
      ${tabs.map(([k, icon]) => html`<a href="#/website?tab=${k}" role="tab" aria-selected="${k === active}" class="tab ${k === active ? 'active' : ''}"><i class="fas ${icon} me-1.5"></i>${t(`web.tab_${k}`)}</a>`)}
    </div>
    <div id="tab-body">${spinner()}</div>`)
  const body = root.querySelector('#tab-body')
  await ({ leads: leadsTab, blog: blogTab, site: siteTab })[active](body, ctx, { site, url })
}

// ---------------- Leads inbox ----------------

async function leadsTab(root, ctx) {
  const filter = LEAD_FILTERS.includes(ctx.query.get('status')) ? ctx.query.get('status') : 'open'
  const { items, counts } = await api.get(`/api/website/leads${qs({ status: filter })}`)
  if (!ctx.isCurrent()) return
  const countFor = (f) => f === 'open' ? counts.new + counts.contacted : f === 'all' ? counts.new + counts.contacted + counts.converted + counts.declined : counts[f]

  const card = (l) => html`
    <li class="card card-pad space-y-3" data-lead="${l.id}">
      <div class="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div class="flex-1 min-w-[12rem]">
          <div class="font-semibold" dir="auto">${l.name}</div>
          <div class="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
            <span><i class="fas ${SOURCE_ICONS[l.source] || 'fa-inbox'} me-1"></i>${t(`web.source_${l.source}`)}</span>
            <span title="${fmtDate(l.created_at)}">${fmtRelative(l.created_at)}</span>
            ${l.practice_area ? html`<span>${refLabel('practice_areas', l.practice_area)}</span>` : ''}
            ${l.language === 'ar' ? html`<span>العربية</span>` : ''}
          </div>
        </div>
        ${leadBadge(l.status)}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        ${l.email ? html`<a class="text-brand-700 hover:underline" dir="ltr" href="mailto:${l.email}"><i class="fas fa-envelope me-1"></i>${l.email}</a>` : ''}
        ${l.phone ? html`<a class="text-brand-700 hover:underline" dir="ltr" href="tel:${l.phone.replace(/[^0-9+]/g, '')}"><i class="fas fa-phone me-1"></i>${l.phone}</a>` : ''}
        ${l.phone ? html`<a class="text-emerald-700 hover:underline" rel="noopener" target="_blank" href="https://wa.me/${l.phone.replace(/\D/g, '')}"><i class="fab fa-whatsapp me-1"></i>WhatsApp</a>` : ''}
      </div>
      ${l.message ? html`<p class="text-sm text-slate-700 whitespace-pre-line max-h-48 overflow-y-auto bg-slate-50 rounded-lg p-3" dir="auto">${l.message}</p>` : ''}
      ${l.notes ? html`<p class="text-sm text-slate-600 border-s-2 border-amber-300 ps-3 whitespace-pre-line" dir="auto">${l.notes}</p>` : ''}
      ${l.status === 'converted' ? html`<p class="text-sm text-emerald-700 flex flex-wrap gap-x-4">
          ${l.client_id ? html`<a class="hover:underline" href="#/clients/${l.client_id}"><i class="fas fa-address-book me-1"></i>${l.client_name || t('nav.clients')}</a>` : ''}
          ${l.case_id ? html`<a class="hover:underline" href="#/cases/${l.case_id}"><i class="fas fa-folder-open me-1"></i>${l.case_reference}</a>` : ''}</p>` : ''}
      ${!readOnly() ? html`<div class="flex flex-wrap gap-2 pt-1">
        ${l.status !== 'converted' && canWrite() ? html`<button class="btn btn-primary btn-sm" data-action="convert" data-id="${l.id}"><i class="fas fa-user-plus"></i>${t('web.convert')}</button>` : ''}
        ${l.status === 'new' ? html`<button class="btn btn-outline btn-sm" data-action="status" data-status="contacted" data-id="${l.id}"><i class="fas fa-phone-volume"></i>${t('web.mark_contacted')}</button>` : ''}
        ${['new', 'contacted'].includes(l.status) ? html`<button class="btn btn-ghost btn-sm" data-action="status" data-status="declined" data-id="${l.id}"><i class="fas fa-ban"></i>${t('web.decline')}</button>` : ''}
        ${l.status === 'declined' ? html`<button class="btn btn-ghost btn-sm" data-action="status" data-status="new" data-id="${l.id}"><i class="fas fa-rotate-left"></i>${t('web.reopen')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-action="notes" data-id="${l.id}"><i class="fas fa-note-sticky"></i>${t('web.notes')}</button>
        ${canManageTeam() ? html`<button class="btn btn-ghost btn-sm text-red-600" data-action="delete" data-id="${l.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
      </div>` : ''}
    </li>`

  render(root, html`
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="flex flex-wrap gap-2">
        ${LEAD_FILTERS.map((f) => html`<a href="#/website?tab=leads&status=${f}" class="badge ${f === filter ? 'bg-brand-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} px-3 py-1.5">${t(`web.filter_${f}`)} · ${fmtNumber(countFor(f) || 0)}</a>`)}
      </div>
      ${!readOnly() ? html`<button class="btn btn-outline btn-sm" data-action="add"><i class="fas fa-plus"></i>${t('web.add_lead')}</button>` : ''}
    </div>
    ${items.length ? html`<ul class="grid lg:grid-cols-2 gap-4">${items.map(card)}</ul>`
      : html`<div class="card">${emptyState('fa-inbox', t('web.no_leads'), t('web.no_leads_hint'))}</div>`}`)

  const byId = (id) => items.find((l) => l.id === id)
  bind(root, {
    actions: {
      status: async (btn) => {
        try { await api.patch(`/api/website/leads/${btn.dataset.id}`, { status: btn.dataset.status }); ctx.rerender() } catch (err) { showError(err) }
      },
      notes: (btn) => {
        const lead = byId(btn.dataset.id)
        const m = modal({
          title: t('web.notes'),
          body: html`<form data-form="notes" class="space-y-4">${textareaField({ name: 'notes', label: t('web.notes'), value: lead.notes || '', rows: 6 })}
            <div class="flex justify-end gap-2"><button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button><button type="submit" class="btn btn-primary">${t('common.save')}</button></div></form>`,
          forms: {
            notes: (form) => busy(submitButton(form), async () => {
              try { await api.patch(`/api/website/leads/${lead.id}`, { notes: formData(form).notes ?? '' }); m.close(); ctx.rerender() } catch (err) { showError(err, form) }
            })
          }
        })
      },
      delete: async (btn) => {
        if (!(await confirmDialog(t('web.confirm_delete_lead')))) return
        try { await api.del(`/api/website/leads/${btn.dataset.id}`); toast(t('common.deleted')); ctx.rerender() } catch (err) { showError(err) }
      },
      add: () => {
        const m = modal({
          title: t('web.add_lead'),
          body: html`<form data-form="add" class="grid sm:grid-cols-2 gap-4" novalidate>
            ${inputField({ name: 'name', label: t('web.lead_name'), required: true, cls: 'sm:col-span-2' })}
            ${inputField({ name: 'email', label: t('auth.email'), type: 'email', dir: 'ltr' })}
            ${inputField({ name: 'phone', label: t('web.phone'), dir: 'ltr' })}
            ${selectField({ name: 'practice_area', label: t('web.practice_area'), options: refOptions('practice_areas'), empty: '—', cls: 'sm:col-span-2' })}
            ${textareaField({ name: 'message', label: t('web.enquiry'), rows: 4, cls: 'sm:col-span-2' })}
            <div class="sm:col-span-2 flex justify-end gap-2"><button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button><button type="submit" class="btn btn-primary">${t('common.create')}</button></div>
          </form>`,
          forms: {
            add: (form) => busy(submitButton(form), async () => {
              try { await api.post('/api/website/leads', formData(form)); m.close(); toast(t('common.created')); ctx.rerender() } catch (err) { showError(err, form) }
            })
          }
        })
      },
      convert: (btn) => openConvertDialog(byId(btn.dataset.id), () => ctx.rerender())
    }
  })
}

// Conflict check, then create or link the client and optionally open a case.
async function openConvertDialog(lead, onDone) {
  const m = modal({ title: t('web.convert_title'), size: 'lg', body: spinner() })
  const body = m.el.querySelector('.p-5')
  let conflicts = { clients: [], cases: [], conflict: false }
  let matches = []
  try {
    const [cf, byEmail] = await Promise.all([
      api.get(`/api/workspace/conflicts${qs({ name: lead.name })}`),
      lead.email ? api.get(`/api/clients${qs({ q: lead.email, pageSize: 5 })}`) : Promise.resolve({ items: [] })
    ])
    conflicts = cf
    const seen = new Set()
    matches = [...byEmail.items, ...cf.clients].filter((c) => !c.archived_at && !seen.has(c.id) && seen.add(c.id))
  } catch (err) { showError(err) }
  const jurisdictions = refOptions('jurisdictions')
  render(body, html`
    <form data-form="convert" class="space-y-5" novalidate>
      <section class="rounded-lg border ${conflicts.conflict ? 'border-red-300 bg-red-50' : conflicts.clients.length || conflicts.cases.length ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'} p-4 text-sm">
        <h3 class="font-semibold mb-1"><i class="fas fa-shield-halved me-1"></i>${t('web.conflict_check')}</h3>
        ${conflicts.conflict ? html`<p class="text-red-700 font-medium">${t('web.conflict_found')}</p>` : ''}
        ${conflicts.clients.length || conflicts.cases.length ? html`<ul class="mt-2 space-y-1">
            ${conflicts.clients.map((c) => html`<li><i class="fas fa-address-book text-slate-400 me-1"></i><a class="hover:underline" target="_blank" href="#/clients/${c.id}">${c.name}</a></li>`)}
            ${conflicts.cases.map((k) => html`<li><i class="fas fa-folder-open text-slate-400 me-1"></i><a class="hover:underline" target="_blank" href="#/cases/${k.id}">${k.reference} · ${k.title}</a>${k.opposing_party ? html` <span class="text-slate-600">(${t('web.opposing')}: ${k.opposing_party})</span>` : ''}</li>`)}
          </ul>` : html`<p class="text-emerald-800">${t('web.no_conflicts')}</p>`}
      </section>
      <section class="space-y-3">
        <h3 class="font-semibold text-sm">${t('web.client')}</h3>
        <label class="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="new" checked data-change="mode" />${t('web.new_client')}</label>
        <div class="grid sm:grid-cols-2 gap-3 ps-6" data-new>
          ${inputField({ name: 'name', label: t('web.lead_name'), value: lead.name, required: true })}
          ${selectField({ name: 'kind', label: t('clients.type'), options: [{ value: 'individual', label: t('clients.individual') }, { value: 'company', label: t('clients.company') }], value: 'individual' })}
          ${inputField({ name: 'email', label: t('auth.email'), type: 'email', value: lead.email || '', dir: 'ltr' })}
          ${inputField({ name: 'phone', label: t('web.phone'), value: lead.phone || '', dir: 'ltr' })}
        </div>
        ${matches.length ? html`<label class="flex items-center gap-2 text-sm"><input type="radio" name="mode" value="existing" data-change="mode" />${t('web.existing_client')}</label>
          <div class="ps-6" data-existing hidden>${selectField({ name: 'client_id', label: '', options: matches.map((c) => ({ value: c.id, label: [c.name, c.email].filter(Boolean).join(' · ') })) })}</div>` : ''}
      </section>
      <section class="space-y-3">
        <label class="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="open_case" checked data-change="case" />${t('web.open_case')}</label>
        <div class="grid sm:grid-cols-2 gap-3 ps-6" data-case>
          ${inputField({ name: 'case_title', label: t('web.case_title'), value: lead.practice_area ? `${refLabel('practice_areas', lead.practice_area)} – ${lead.name}` : lead.name, required: true, cls: 'sm:col-span-2' })}
          ${selectField({ name: 'case_practice_area', label: t('web.practice_area'), options: refOptions('practice_areas'), value: lead.practice_area || '', empty: '—' })}
          ${selectField({ name: 'case_jurisdiction', label: t('common.jurisdiction'), options: jurisdictions, value: store.me.org.default_jurisdiction })}
        </div>
        <p class="hint ps-6">${t('web.case_hint')}</p>
      </section>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-user-plus"></i>${t('web.convert')}</button>
      </div>
    </form>`)
  const form = body.querySelector('form')
  const sync = () => {
    const existing = form.querySelector('[name=mode]:checked')?.value === 'existing'
    form.querySelector('[data-new]').hidden = existing
    form.querySelector('[data-new]').querySelectorAll('input,select').forEach((el) => { el.disabled = existing })
    const ex = form.querySelector('[data-existing]')
    if (ex) { ex.hidden = !existing; ex.querySelector('select').disabled = !existing }
    const withCase = form.querySelector('[name=open_case]').checked
    form.querySelector('[data-case]').hidden = !withCase
  }
  form.addEventListener('change', sync)
  sync()
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    busy(submitButton(form), async () => {
      const f = formData(form)
      const payload = f.mode === 'existing'
        ? { client_id: f.client_id }
        : { client: { name: f.name, kind: f.kind, email: f.email, phone: f.phone } }
      if (f.open_case) payload.case = { title: f.case_title, practice_area: f.case_practice_area, jurisdiction: f.case_jurisdiction }
      try {
        const r = await api.post(`/api/website/leads/${lead.id}/convert`, payload)
        m.close()
        toast(t('web.converted'))
        if (r.case) navigate(`/cases/${r.case.id}`)
        else if (r.client_id) navigate(`/clients/${r.client_id}`)
        else onDone()
      } catch (err) { showError(err, form) }
    })
  })
}

// ---------------- Blog ----------------

async function blogTab(root, ctx, { site, url }) {
  const { items } = await api.get('/api/website/posts')
  if (!ctx.isCurrent()) return
  const title = (p) => (getLang() === 'ar' ? p.title_ar || p.title : p.title || p.title_ar)
  render(root, html`
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <p class="text-sm text-slate-500">${t('web.blog_hint')}</p>
      ${canWrite() ? html`<a class="btn btn-primary" href="#/website/posts/new"><i class="fas fa-plus"></i>${t('web.new_post')}</a>` : ''}
    </div>
    ${items.length ? html`<div class="card overflow-x-auto"><table class="table">
        <thead><tr><th>${t('web.post_title')}</th><th>${t('common.status')}</th><th>${t('web.languages')}</th><th>${t('common.updated')}</th><th></th></tr></thead>
        <tbody>${items.map((p) => html`<tr>
          <td><a class="font-medium hover:underline" dir="auto" href="#/website/posts/${p.id}">${title(p)}</a>${p.author_name ? html`<div class="text-xs text-slate-500">${p.author_name}</div>` : ''}</td>
          <td><span class="badge ${p.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">${t(`web.post_${p.status}`)}</span></td>
          <td class="text-xs">${[p.title ? 'EN' : '', p.title_ar ? 'AR' : ''].filter(Boolean).join(' · ')}</td>
          <td class="text-sm text-slate-500">${fmtDate(p.published_at || p.updated_at)}</td>
          <td class="text-end">${p.status === 'published' && url && site.published ? html`<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${url}/blog/${p.slug}" aria-label="${t('web.view_site')}"><i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}</td>
        </tr>`)}</tbody></table></div>`
      : html`<div class="card">${emptyState('fa-newspaper', t('web.no_posts'), t('web.no_posts_hint'), canWrite() ? html`<a class="btn btn-primary" href="#/website/posts/new"><i class="fas fa-plus"></i>${t('web.new_post')}</a>` : '')}</div>`}`)
}

export async function postEditView(root, ctx) {
  const isNew = ctx.params.id === 'new'
  const [{ site, url }, data] = await Promise.all([
    api.get('/api/website/site'),
    isNew ? Promise.resolve({ post: { status: 'draft' } }) : api.get(`/api/website/posts/${ctx.params.id}`)
  ])
  if (!ctx.isCurrent()) return
  let post = data.post
  let dirty = false
  setLeaveGuard(() => !dirty || confirm(t('web.unsaved')))
  const editable = canWrite()
  const ai = aiEnabled() && editable

  const langFields = (lang) => {
    const sfx = lang === 'ar' ? '_ar' : ''
    return html`<section class="card card-pad space-y-4" data-lang-col="${lang}">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">${lang === 'ar' ? t('common.arabic') : t('common.english')}</h2>
        ${ai ? html`<div class="flex flex-wrap gap-1">
          <button type="button" class="btn btn-ghost btn-sm" data-action="ai" data-act="improve" data-lang="${lang}"><i class="fas fa-wand-magic-sparkles"></i>${t('web.ai_improve')}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="ai" data-act="translate" data-lang="${lang}"><i class="fas fa-language"></i>${t(lang === 'ar' ? 'web.ai_translate_from_en' : 'web.ai_translate_from_ar')}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="ai" data-act="titles" data-lang="${lang}"><i class="fas fa-heading"></i>${t('web.ai_titles')}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="ai" data-act="excerpt" data-lang="${lang}"><i class="fas fa-align-left"></i>${t('web.ai_excerpt')}</button>
        </div>` : ''}
      </div>
      <div dir="${lang === 'ar' ? 'rtl' : 'ltr'}" class="space-y-4">
        ${inputField({ name: `title${sfx}`, label: t('web.post_title'), value: post[`title${sfx}`] || '', attrs: 'maxlength="200"' })}
        ${textareaField({ name: `excerpt${sfx}`, label: t('web.excerpt'), value: post[`excerpt${sfx}`] || '', rows: 2, hint: t('web.excerpt_hint') })}
        ${textareaField({ name: `body${sfx}`, label: t('web.body'), value: post[`body${sfx}`] || '', rows: 18, hint: t('web.body_hint'), cls: 'font-normal' })}
      </div>
    </section>`
  }

  render(root, html`
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <a class="text-sm text-brand-700 hover:underline" href="#/website?tab=blog"><i class="fas fa-arrow-left rtl:rotate-180 me-1"></i>${t('web.tab_blog')}</a>
        <h1 class="text-2xl font-bold mt-1">${isNew ? t('web.new_post') : t('web.edit_post')}</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        ${!isNew ? html`<span class="badge ${post.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">${t(`web.post_${post.status}`)}</span>` : ''}
        ${post.status === 'published' && url && site.published ? html`<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${url}/blog/${post.slug}"><i class="fas fa-arrow-up-right-from-square"></i>${t('web.view_post')}</a>` : ''}
      </div>
    </div>
    ${ai ? html`<section class="card card-pad mb-6 bg-gradient-to-br from-brand-50 to-white">
      <h2 class="font-semibold mb-1"><i class="fas fa-pen-nib text-brand-600 me-2"></i>${t('web.ai_writer')}</h2>
      <p class="text-sm text-slate-500 mb-4">${t('web.ai_writer_hint')}</p>
      <form data-form="draft" class="grid sm:grid-cols-6 gap-3 items-end" novalidate>
        ${textareaField({ name: 'topic', label: t('web.topic'), rows: 2, placeholder: t('web.topic_placeholder'), cls: 'sm:col-span-6' })}
        ${selectField({ name: 'language', label: t('web.write_in'), options: [{ value: 'en', label: t('common.english') }, { value: 'ar', label: t('common.arabic') }], value: getLang(), cls: 'sm:col-span-2' })}
        ${selectField({ name: 'practice_area', label: t('web.practice_area'), options: refOptions('practice_areas'), empty: '—', cls: 'sm:col-span-2' })}
        ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: refOptions('jurisdictions'), value: store.me.org.default_jurisdiction, cls: 'sm:col-span-2' })}
        <div class="sm:col-span-6 flex flex-wrap gap-2">
          <button type="submit" class="btn btn-primary"><i class="fas fa-wand-magic-sparkles"></i>${t('web.ai_draft')}</button>
          <button type="button" class="btn btn-outline" data-action="topic-titles"><i class="fas fa-lightbulb"></i>${t('web.ai_titles')}</button>
        </div>
      </form>
      <p class="text-xs text-slate-500 mt-3"><i class="fas fa-circle-info me-1"></i>${t('web.ai_review_note')}</p>
    </section>` : ''}
    <form data-form="post" novalidate>
      <fieldset ${editable ? '' : raw('disabled')} class="space-y-6">
        <div class="grid xl:grid-cols-2 gap-6">${langFields('en')}${langFields('ar')}</div>
        <section class="card card-pad grid sm:grid-cols-2 gap-4 items-end">
          ${inputField({ name: 'slug', label: t('web.post_slug'), value: post.slug || '', dir: 'ltr', hint: t('web.post_slug_hint'), attrs: 'pattern="[a-z0-9-]+" maxlength="60"' })}
          <div class="flex flex-wrap justify-end gap-2">
            ${!isNew && can('owner', 'admin', 'lawyer') ? html`<button type="button" class="btn btn-ghost text-red-600" data-action="delete"><i class="fas fa-trash"></i>${t('common.delete')}</button>` : ''}
            ${post.status === 'published'
              ? html`<button type="button" class="btn btn-outline" data-action="save" data-status="draft">${t('web.unpublish')}</button>
                     <button type="button" class="btn btn-primary" data-action="save" data-status="published"><i class="fas fa-check"></i>${t('web.update_published')}</button>`
              : html`<button type="button" class="btn btn-outline" data-action="save" data-status="draft"><i class="fas fa-floppy-disk"></i>${t('web.save_draft')}</button>
                     <button type="button" class="btn btn-primary" data-action="save" data-status="published"><i class="fas fa-paper-plane"></i>${t('web.publish')}</button>`}
          </div>
        </section>
      </fieldset>
    </form>`)

  const postForm = root.querySelector('form[data-form=post]')
  postForm.addEventListener('input', () => { dirty = true })
  const field = (name) => postForm.querySelector(`[name=${name}]`)
  const setFields = (lang, r) => {
    const sfx = lang === 'ar' ? '_ar' : ''
    for (const k of ['title', 'excerpt', 'body']) if (r[k]) field(`${k}${sfx}`).value = r[k]
    dirty = true
  }
  const writer = async (btn, payload) => {
    try {
      const { result } = await api.post('/api/website/writer', payload)
      return result
    } catch (err) { showError(err); return null }
  }
  const pickTitle = (titles, lang) => new Promise((resolve) => {
    const m = modal({
      title: t('web.ai_titles'),
      body: html`<ul class="space-y-2" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">${titles.map((x, i) => html`<li><button type="button" class="w-full text-start rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50" data-action="pick" data-i="${i}">${x}</button></li>`)}</ul>`,
      actions: { pick: (el) => { m.close(); resolve(titles[Number(el.dataset.i)]) } }
    })
  })

  const save = (btn, status) => busy(btn, async () => {
    const f = formData(postForm)
    const payload = { ...f, status }
    if (!payload.slug) delete payload.slug
    try {
      const r = isNew ? await api.post('/api/website/posts', payload) : await api.patch(`/api/website/posts/${post.id}`, payload)
      dirty = false
      toast(status === 'published' ? t('web.published') : t('common.saved'))
      if (isNew) navigate(`/website/posts/${r.post.id}`, { replace: true })
      else ctx.rerender()
    } catch (err) { showError(err, postForm) }
  })

  bind(root, {
    forms: {
      draft: (form) => busy(submitButton(form), async () => {
        const f = formData(form)
        if (!f.topic) return toast(t('web.topic_required'), 'error')
        if ((field(f.language === 'ar' ? 'body_ar' : 'body').value.trim()) && !(await confirmDialog(t('web.replace_confirm'), { danger: false }))) return
        const r = await writer(null, { action: 'draft', ...f })
        if (r) { setFields(f.language, r); toast(t('web.ai_done')) }
      })
    },
    actions: {
      'topic-titles': (btn) => busy(btn, async () => {
        const f = formData(root.querySelector('form[data-form=draft]'))
        if (!f.topic) return toast(t('web.topic_required'), 'error')
        const r = await writer(btn, { action: 'titles', ...f })
        if (r?.titles?.length) {
          const chosen = await pickTitle(r.titles, f.language)
          if (chosen) { field(f.language === 'ar' ? 'title_ar' : 'title').value = chosen; dirty = true }
        }
      }),
      ai: (btn) => busy(btn, async () => {
        const lang = btn.dataset.lang
        const act = btn.dataset.act
        const other = lang === 'ar' ? '' : '_ar'
        const sfx = lang === 'ar' ? '_ar' : ''
        const src = act === 'translate' ? other : sfx
        const content = { title: field(`title${src}`).value, excerpt: field(`excerpt${src}`).value, body: field(`body${src}`).value }
        if (!content.body.trim() && act !== 'titles') return toast(t(act === 'translate' ? 'web.nothing_to_translate' : 'web.write_first'), 'error')
        if (act === 'translate' && field(`body${sfx}`).value.trim() && !(await confirmDialog(t('web.replace_confirm'), { danger: false }))) return
        const r = await writer(btn, { action: act, language: lang, ...content, topic: content.title })
        if (!r) return
        if (act === 'titles') {
          if (r.titles?.length) { const chosen = await pickTitle(r.titles, lang); if (chosen) { field(`title${sfx}`).value = chosen; dirty = true } }
        } else if (act === 'excerpt') {
          if (r.excerpt) { field(`excerpt${sfx}`).value = r.excerpt; dirty = true }
        } else {
          setFields(lang, r)
          toast(t('web.ai_done'))
        }
      }),
      save: (btn) => save(btn, btn.dataset.status),
      delete: async () => {
        if (!(await confirmDialog(t('web.confirm_delete_post')))) return
        try { await api.del(`/api/website/posts/${post.id}`); dirty = false; toast(t('common.deleted')); navigate('/website?tab=blog') } catch (err) { showError(err) }
      }
    }
  })
}

// ---------------- Site settings ----------------

async function siteTab(root, ctx, { site, url }) {
  const origin = location.origin
  const areas = refOptions('practice_areas')
  render(root, html`
    <form data-form="site" class="space-y-6 max-w-5xl" novalidate>
      <section class="card card-pad space-y-4">
        <h2 class="font-semibold">${t('web.address_title')}</h2>
        <div>
          <label class="label" for="f-slug">${t('web.web_address')}</label>
          <div class="flex items-stretch" dir="ltr">
            <span class="inline-flex items-center px-3 rounded-s-lg border border-e-0 border-slate-300 bg-slate-50 text-sm text-slate-500 whitespace-nowrap">${origin}/f/</span>
            <input id="f-slug" name="slug" class="input rounded-s-none" value="${site.slug}" required pattern="[a-z0-9-]+" maxlength="60" />
          </div>
          <p class="hint">${t('web.slug_hint')}</p>
        </div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="published" ${site.published ? raw('checked') : ''} />${t('web.publish_site')}</label>
        ${url && site.published ? html`<p class="text-sm"><a class="text-brand-700 hover:underline" target="_blank" rel="noopener" href="${url}" dir="ltr">${url}</a></p>` : ''}
        <p class="hint">${raw(t('web.branding_hint', { link: '<a class="underline" href="#/settings?tab=branding">' + t('settings.branding') + '</a>' }))}</p>
      </section>
      <section class="card card-pad grid lg:grid-cols-2 gap-4">
        <h2 class="font-semibold lg:col-span-2">${t('web.content')}</h2>
        ${inputField({ name: 'tagline', label: `${t('web.tagline')} (${t('common.english')})`, value: site.tagline || '', dir: 'ltr', attrs: 'maxlength="200"' })}
        ${inputField({ name: 'tagline_ar', label: `${t('web.tagline')} (${t('common.arabic')})`, value: site.tagline_ar || '', dir: 'rtl', attrs: 'maxlength="200"' })}
        ${textareaField({ name: 'about', label: `${t('web.about')} (${t('common.english')})`, value: site.about || '', rows: 8, dir: 'ltr', hint: t('web.body_hint') })}
        ${textareaField({ name: 'about_ar', label: `${t('web.about')} (${t('common.arabic')})`, value: site.about_ar || '', rows: 8, dir: 'rtl', hint: t('web.body_hint') })}
        <fieldset class="lg:col-span-2">
          <legend class="label">${t('web.practice_areas')}</legend>
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-1">
            ${areas.map((a) => html`<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="pa" value="${a.value}" ${site.practice_areas.includes(a.value) ? raw('checked') : ''} />${a.label}</label>`)}
          </div>
        </fieldset>
      </section>
      <section class="card card-pad grid lg:grid-cols-2 gap-4">
        <h2 class="font-semibold lg:col-span-2">${t('web.contact_details')}</h2>
        ${inputField({ name: 'contact_email', label: t('auth.email'), type: 'email', value: site.contact_email || '', dir: 'ltr' })}
        ${inputField({ name: 'phone', label: t('web.phone'), value: site.phone || '', dir: 'ltr' })}
        ${inputField({ name: 'whatsapp', label: t('web.whatsapp'), value: site.whatsapp || '', dir: 'ltr', hint: t('web.whatsapp_hint') })}
        <div></div>
        ${textareaField({ name: 'address', label: `${t('web.address')} (${t('common.english')})`, value: site.address || '', rows: 2, dir: 'ltr' })}
        ${textareaField({ name: 'address_ar', label: `${t('web.address')} (${t('common.arabic')})`, value: site.address_ar || '', rows: 2, dir: 'rtl' })}
        ${inputField({ name: 'office_hours', label: `${t('web.office_hours')} (${t('common.english')})`, value: site.office_hours || '', dir: 'ltr', placeholder: 'Sun–Thu, 8:00–16:00' })}
        ${inputField({ name: 'office_hours_ar', label: `${t('web.office_hours')} (${t('common.arabic')})`, value: site.office_hours_ar || '', dir: 'rtl', placeholder: 'الأحد–الخميس، ٨:٠٠–١٦:٠٠' })}
      </section>
      <section class="card card-pad grid lg:grid-cols-2 gap-4">
        <div class="lg:col-span-2">
          <h2 class="font-semibold">${t('web.chatbot')}</h2>
          <p class="text-sm text-slate-500 mt-1">${t('web.chatbot_hint')}</p>
        </div>
        <label class="flex items-center gap-2 text-sm lg:col-span-2"><input type="checkbox" name="chatbot_enabled" ${site.chatbot_enabled ? raw('checked') : ''} />${t('web.chatbot_enable')}</label>
        ${inputField({ name: 'chatbot_greeting', label: `${t('web.greeting')} (${t('common.english')})`, value: site.chatbot_greeting || '', dir: 'ltr', placeholder: 'Hello! How can we help you today?' })}
        ${inputField({ name: 'chatbot_greeting_ar', label: `${t('web.greeting')} (${t('common.arabic')})`, value: site.chatbot_greeting_ar || '', dir: 'rtl', placeholder: 'مرحبًا! كيف يمكننا مساعدتك اليوم؟' })}
        ${textareaField({ name: 'chat_knowledge', label: t('web.knowledge'), value: site.chat_knowledge || '', rows: 10, hint: t('web.knowledge_hint'), cls: 'lg:col-span-2' })}
        <p class="text-xs text-slate-500 lg:col-span-2"><i class="fas fa-circle-info me-1"></i>${t('web.chatbot_usage')}</p>
      </section>
      <div class="flex justify-end"><button type="submit" class="btn btn-primary" ${readOnly() ? raw('disabled') : ''}><i class="fas fa-floppy-disk"></i>${t('common.save')}</button></div>
    </form>`)

  bind(root, {
    forms: {
      site: (form) => busy(submitButton(form), async () => {
        const f = formData(form)
        delete f.pa
        f.practice_areas = [...form.querySelectorAll('[name=pa]:checked')].map((el) => el.value)
        try {
          await api.put('/api/website/site', f)
          toast(t('common.saved'))
          ctx.rerender()
        } catch (err) { showError(err, form) }
      })
    }
  })
}
