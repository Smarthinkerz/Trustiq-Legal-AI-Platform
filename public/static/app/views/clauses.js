import { api } from '../api.js'
import { bind, formData, html, raw, render } from '../dom.js'
import { fmtDateTime, getLang, t } from '../i18n.js'
import { aiEnabled, can, readOnly } from '../store.js'
import {
  aiDisclaimer, busy, clearFieldErrors, confirmDialog, debounce, emptyState, inputField, modal, pageHeader, selectField, showError, spinner, submitButton, textareaField, toast
} from '../ui.js'

// ---------------------------------------------------------------------------
// Clause bank (approved bilingual wording) and contract playbook (negotiation
// positions), plus the playbook review panel shown on a document.
// ---------------------------------------------------------------------------

export const CATEGORIES = ['parties_definitions', 'payment', 'liability', 'indemnity', 'warranties', 'termination', 'governing_law', 'dispute_resolution',
  'confidentiality', 'ip', 'force_majeure', 'assignment', 'non_compete', 'data_protection', 'employment', 'real_estate', 'general']
const catLabel = (c) => t(`clause.cat_${c}`)
const catOptions = () => CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))
const SEV = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-800', low: 'bg-slate-100 text-slate-700' }
const STATUS = {
  meets: ['bg-emerald-100 text-emerald-800', 'fa-circle-check'], fallback: ['bg-sky-100 text-sky-800', 'fa-circle-half-stroke'],
  deviates: ['bg-red-100 text-red-700', 'fa-triangle-exclamation'], missing: ['bg-amber-100 text-amber-800', 'fa-circle-question'],
  not_applicable: ['bg-slate-100 text-slate-600', 'fa-minus']
}
const statusBadge = (s) => html`<span class="badge ${STATUS[s][0]}"><i class="fas ${STATUS[s][1]}"></i> ${t(`playbook.status_${s}`)}</span>`
const scoreColor = (n) => (n >= 80 ? 'bg-emerald-100 text-emerald-800' : n >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700')

export async function clausesView(root, { query, isCurrent }) {
  const canClause = !readOnly() && can('owner', 'admin', 'lawyer')
  const canRules = !readOnly() && can('owner', 'admin')
  const state = { tab: query.get('tab') === 'playbook' ? 'playbook' : 'clauses', q: '', category: '' }
  let clauses = []
  let rules = []

  const draw = () => {
    render(root, html`
      <nav class="text-sm text-slate-500 mb-3"><a href="#/documents" class="hover:underline">${t('nav.documents')}</a></nav>
      ${pageHeader(t('clause.title'), t('clause.subtitle'), html`
        ${canRules && !rules.length ? html`<button class="btn btn-outline" data-action="starter"><i class="fas fa-seedling"></i>${t('playbook.load_starter')}</button>` : ''}
        ${state.tab === 'clauses' && canClause ? html`<button class="btn btn-primary" data-action="add-clause"><i class="fas fa-plus"></i>${t('clause.add')}</button>` : ''}
        ${state.tab === 'playbook' && canRules ? html`<button class="btn btn-primary" data-action="add-rule"><i class="fas fa-plus"></i>${t('playbook.add_rule')}</button>` : ''}`)}
      <div class="flex gap-1 border-b border-slate-200 mb-4">
        ${['clauses', 'playbook'].map((x) => html`<button class="px-4 py-2 text-sm font-medium border-b-2 -mb-px ${state.tab === x ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}" data-action="tab" data-tab="${x}">
          ${x === 'clauses' ? html`<i class="fas fa-book-bookmark"></i> ${t('clause.tab')} <span class="text-xs text-slate-400">${clauses.length}</span>` : html`<i class="fas fa-chess-knight"></i> ${t('playbook.tab')} <span class="text-xs text-slate-400">${rules.length}</span>`}</button>`)}
      </div>
      ${state.tab === 'clauses' ? clausesPane() : playbookPane()}`)
    const search = root.querySelector('[data-search]')
    if (search) {
      search.value = state.q
      search.addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); loadClauses().then(drawList).catch(showError) }))
    }
  }

  const drawList = () => { const el = root.querySelector('[data-clause-list]'); if (el) render(el, clauseList()) }

  const clausesPane = () => html`<div class="card">
    <div class="p-4 border-b border-slate-100 flex flex-wrap gap-3">
      <div class="relative flex-1 min-w-[200px]">
        <i class="fas fa-magnifying-glass absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm"></i>
        <input type="search" class="input ps-9" data-search placeholder="${t('clause.search')}" aria-label="${t('common.search')}" />
      </div>
      ${selectField({ name: 'category', options: catOptions(), value: state.category, empty: t('clause.all_categories'), cls: 'w-56', attrs: `data-change="category" aria-label="${t('clause.category')}"` })}
    </div>
    <div data-clause-list>${clauseList()}</div>
  </div>`

  const clauseList = () => clauses.length ? html`<ul class="divide-y divide-slate-100">${clauses.map((x) => html`<li class="p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0"><h3 class="font-semibold" dir="auto">${x.title}</h3>
          <div class="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500"><span class="badge bg-slate-100 text-slate-700">${catLabel(x.category)}</span>
            ${x.body_en ? html`<span class="badge bg-sky-50 text-sky-800">EN</span>` : ''}${x.body_ar ? html`<span class="badge bg-emerald-50 text-emerald-800">ع</span>` : ''}
            ${x.usage_count ? html`<span>${t('clause.used_n', { n: x.usage_count })}</span>` : ''}</div></div>
        ${canClause ? html`<div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" data-action="edit-clause" data-id="${x.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger-ghost btn-sm" data-action="delete-clause" data-id="${x.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button></div>` : ''}
      </div>
      <div class="grid ${x.body_en && x.body_ar ? 'md:grid-cols-2' : ''} gap-4 mt-3">
        ${x.body_en ? html`<p class="text-sm leading-relaxed whitespace-pre-wrap font-serif text-slate-700 line-clamp-6" dir="ltr">${x.body_en}</p>` : ''}
        ${x.body_ar ? html`<p class="text-sm leading-relaxed whitespace-pre-wrap font-serif text-slate-700 line-clamp-6" dir="rtl" lang="ar">${x.body_ar}</p>` : ''}
      </div>
      ${x.note ? html`<p class="text-xs text-slate-500 mt-2" dir="auto"><i class="fas fa-circle-info"></i> ${x.note}</p>` : ''}
    </li>`)}</ul>`
      : state.q || state.category ? emptyState('fa-magnifying-glass', t('common.no_results'), '')
        : emptyState('fa-book-bookmark', t('clause.empty_title'), t('clause.empty_text'),
          canRules ? html`<button class="btn btn-primary" data-action="starter"><i class="fas fa-seedling"></i>${t('playbook.load_starter')}</button>`
            : canClause ? html`<button class="btn btn-primary" data-action="add-clause"><i class="fas fa-plus"></i>${t('clause.add')}</button>` : '')

  const playbookPane = () => html`<div class="space-y-4">
    <div class="rounded-xl bg-violet-50 border border-violet-200 p-4 text-sm text-violet-900"><i class="fas fa-circle-info"></i> ${t('playbook.intro')}</div>
    ${rules.length ? html`<div class="card"><ul class="divide-y divide-slate-100">${rules.map((r) => html`<li class="p-5 ${r.active ? '' : 'opacity-60'}">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0"><h3 class="font-semibold" dir="auto">${r.topic}</h3>
          <div class="flex flex-wrap items-center gap-2 mt-1 text-xs"><span class="badge ${SEV[r.severity]}">${t(`playbook.sev_${r.severity}`)}</span>
            <span class="badge bg-slate-100 text-slate-700">${catLabel(r.category)}</span>
            ${r.active ? '' : html`<span class="badge bg-slate-200 text-slate-600">${t('playbook.inactive')}</span>`}
            ${r.clause_title ? html`<span class="text-slate-500" dir="auto"><i class="fas fa-link"></i> ${r.clause_title}</span>` : ''}</div></div>
        ${canRules ? html`<div class="flex gap-1">
          <button class="btn btn-ghost btn-sm" data-action="toggle-rule" data-id="${r.id}" title="${r.active ? t('playbook.deactivate') : t('playbook.activate')}"><i class="fas ${r.active ? 'fa-toggle-on text-emerald-600' : 'fa-toggle-off'}"></i></button>
          <button class="btn btn-ghost btn-sm" data-action="edit-rule" data-id="${r.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger-ghost btn-sm" data-action="delete-rule" data-id="${r.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button></div>` : ''}
      </div>
      <dl class="grid md:grid-cols-3 gap-3 mt-3 text-sm" dir="auto">
        <div><dt class="text-xs font-semibold uppercase text-emerald-700">${t('playbook.standard')}</dt><dd class="mt-0.5">${r.standard_position}</dd></div>
        <div><dt class="text-xs font-semibold uppercase text-sky-700">${t('playbook.fallback')}</dt><dd class="mt-0.5">${r.fallback_position || '—'}</dd></div>
        <div><dt class="text-xs font-semibold uppercase text-red-700">${t('playbook.red_flags')}</dt><dd class="mt-0.5">${r.red_flags || '—'}</dd></div>
      </dl>
    </li>`)}</ul></div>`
      : html`<div class="card">${emptyState('fa-chess-knight', t('playbook.empty_title'), t('playbook.empty_text'),
        canRules ? html`<button class="btn btn-primary" data-action="starter"><i class="fas fa-seedling"></i>${t('playbook.load_starter')}</button>` : '')}</div>`}
  </div>`

  const loadClauses = async () => {
    const q = new URLSearchParams()
    if (state.q) q.set('q', state.q)
    if (state.category) q.set('category', state.category)
    clauses = (await api.get(`/api/clauses?${q}`)).items
  }
  const loadRules = async () => { rules = (await api.get('/api/playbook/rules')).items }
  const reload = async () => { try { await Promise.all([loadClauses(), loadRules()]); if (isCurrent()) draw() } catch (err) { showError(err) } }

  const openStarter = () => {
    const m = modal({
      title: t('playbook.load_starter'),
      body: html`<form data-form="starter" class="space-y-4" novalidate>
        <p class="text-sm text-slate-600">${t('playbook.starter_intro')}</p>
        ${selectField({ name: 'language', label: t('playbook.starter_language'), options: [{ value: 'en', label: t('common.english') }, { value: 'ar', label: t('common.arabic') }], value: getLang() })}
        <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-seedling"></i>${t('playbook.load_go')}</button>
        </div></form>`,
      forms: {
        starter: (form) => busy(submitButton(form), async () => {
          try {
            const r = await api.post('/api/playbook/starter', formData(form))
            m.close()
            toast(t('playbook.loaded', r))
            reload()
          } catch (err) { showError(err, form) }
        })
      }
    })
  }

  bind(root, {
    actions: {
      tab: (el) => { state.tab = el.dataset.tab; history.replaceState(null, '', `#/clauses${state.tab === 'playbook' ? '?tab=playbook' : ''}`); draw() },
      starter: openStarter,
      'add-clause': () => openClauseForm(null, reload),
      'edit-clause': (el) => openClauseForm(clauses.find((x) => x.id === el.dataset.id), reload),
      'delete-clause': async (el) => {
        const x = clauses.find((i) => i.id === el.dataset.id)
        if (!(await confirmDialog(t('clause.confirm_delete', { title: x.title })))) return
        try { await api.del(`/api/clauses/${x.id}`); toast(t('common.deleted')); reload() } catch (err) { showError(err) }
      },
      'add-rule': () => openRuleForm(null, reload),
      'edit-rule': (el) => openRuleForm(rules.find((x) => x.id === el.dataset.id), reload),
      'toggle-rule': async (el) => {
        const r = rules.find((x) => x.id === el.dataset.id)
        try { await api.patch(`/api/playbook/rules/${r.id}`, { active: !r.active }); reload() } catch (err) { showError(err) }
      },
      'delete-rule': async (el) => {
        const r = rules.find((x) => x.id === el.dataset.id)
        if (!(await confirmDialog(t('playbook.confirm_delete', { topic: r.topic })))) return
        try { await api.del(`/api/playbook/rules/${r.id}`); toast(t('common.deleted')); reload() } catch (err) { showError(err) }
      }
    },
    changes: { category: (el) => { state.category = el.value; loadClauses().then(drawList).catch(showError) } }
  })
  render(root, spinner())
  await Promise.all([loadClauses(), loadRules()])
  if (isCurrent()) draw()
}

function openClauseForm(clause, done) {
  const m = modal({
    title: clause ? t('clause.edit') : t('clause.add'),
    size: 'xl',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-2 gap-4">
        ${inputField({ name: 'title', label: t('clause.name'), value: clause?.title, required: true, attrs: 'maxlength="200" dir="auto"' })}
        ${selectField({ name: 'category', label: t('clause.category'), options: catOptions(), value: clause?.category || 'general' })}
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <div>${textareaField({ name: 'body_en', label: t('common.english'), value: clause?.body_en, rows: 10, dir: 'ltr' })}
          ${clause && aiEnabled() ? html`<button type="button" class="btn btn-ghost btn-sm mt-1" data-action="ai-translate" data-to="en"><i class="fas fa-language"></i>${t('clause.translate_from_ar')}</button>` : ''}</div>
        <div>${textareaField({ name: 'body_ar', label: t('common.arabic'), value: clause?.body_ar, rows: 10, dir: 'rtl' })}
          ${clause && aiEnabled() ? html`<button type="button" class="btn btn-ghost btn-sm mt-1" data-action="ai-translate" data-to="ar"><i class="fas fa-language"></i>${t('clause.translate_from_en')}</button>` : ''}</div>
      </div>
      <p class="hint">${t('clause.bilingual_hint')}</p>
      ${inputField({ name: 'note', label: t('clause.note'), value: clause?.note, hint: t('clause.note_hint'), attrs: 'maxlength="2000" dir="auto"' })}
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('common.save')}</button>
      </div>
    </form>`,
    actions: {
      'ai-translate': (btn) => busy(btn, async () => {
        const form = m.el.querySelector('form')
        const to = btn.dataset.to
        const source = form.elements[to === 'ar' ? 'body_en' : 'body_ar'].value.trim()
        if (!source) return toast(t('clause.nothing_to_translate'), 'error')
        try {
          // Save the source side first so the server translates exactly what is on screen.
          await api.patch(`/api/clauses/${clause.id}`, { [to === 'ar' ? 'body_en' : 'body_ar']: source })
          const r = await api.post(`/api/clauses/${clause.id}/translate`, { to })
          form.elements[to === 'ar' ? 'body_ar' : 'body_en'].value = r.text
          toast(t('clause.translated_review'))
        } catch (err) { showError(err) }
      })
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const body = formData(form)
        if (!body.body_en?.trim() && !body.body_ar?.trim()) return toast(t('clause.need_text'), 'error')
        try {
          if (clause) await api.patch(`/api/clauses/${clause.id}`, { ...body, note: body.note || '' })
          else await api.post('/api/clauses', body)
          m.close()
          toast(t('common.saved'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

async function openRuleForm(rule, done) {
  let clauses = []
  try { clauses = (await api.get('/api/clauses')).items } catch { /* linking is optional */ }
  const m = modal({
    title: rule ? t('playbook.edit_rule') : t('playbook.add_rule'),
    size: 'lg',
    body: html`<form data-form="save" class="space-y-4" novalidate>
      <div class="grid sm:grid-cols-3 gap-4">
        ${inputField({ name: 'topic', label: t('playbook.topic'), value: rule?.topic, required: true, cls: 'sm:col-span-3', attrs: 'maxlength="200" dir="auto"' })}
        ${selectField({ name: 'category', label: t('clause.category'), options: catOptions(), value: rule?.category || 'general' })}
        ${selectField({ name: 'severity', label: t('playbook.severity'), options: ['high', 'medium', 'low'].map((s) => ({ value: s, label: t(`playbook.sev_${s}`) })), value: rule?.severity || 'medium' })}
        ${selectField({ name: 'clause_id', label: t('playbook.linked_clause'), options: clauses.map((c) => ({ value: c.id, label: c.title })), value: rule?.clause_id || '', empty: t('playbook.no_clause') })}
      </div>
      ${textareaField({ name: 'standard_position', label: t('playbook.standard'), value: rule?.standard_position, rows: 3, required: true, hint: t('playbook.standard_hint') })}
      ${textareaField({ name: 'fallback_position', label: t('playbook.fallback'), value: rule?.fallback_position, rows: 2, hint: t('playbook.fallback_hint') })}
      ${textareaField({ name: 'red_flags', label: t('playbook.red_flags'), value: rule?.red_flags, rows: 2, hint: t('playbook.red_flags_hint') })}
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${t('common.save')}</button>
      </div>
    </form>`,
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const body = formData(form)
        body.fallback_position ||= ''
        body.red_flags ||= ''
        body.clause_id ||= ''
        try {
          if (rule) await api.patch(`/api/playbook/rules/${rule.id}`, body)
          else await api.post('/api/playbook/rules', body)
          m.close()
          toast(t('common.saved'))
          done()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Document view: insert a clause at the cursor.
// ---------------------------------------------------------------------------

export async function openClausePicker(docLang, onInsert) {
  const state = { q: '', category: '', lang: docLang === 'ar' ? 'ar' : 'en', items: [] }
  const m = modal({
    title: t('clause.insert'),
    size: 'lg',
    body: html`<div class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <input type="search" class="input flex-1 min-w-[180px]" data-q placeholder="${t('clause.search')}" aria-label="${t('common.search')}" />
        ${selectField({ name: 'category', options: catOptions(), empty: t('clause.all_categories'), cls: 'w-48', attrs: `data-change="category" aria-label="${t('clause.category')}"` })}
        <div class="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="group">
          ${['en', 'ar'].map((l) => html`<button class="px-3 py-1 rounded-md" data-action="lang" data-lang="${l}">${l === 'en' ? 'EN' : 'ع'}</button>`)}
        </div>
      </div>
      <div data-list class="max-h-[60vh] overflow-y-auto">${spinner()}</div>
      <p class="text-xs text-slate-500">${t('clause.manage_hint')} <a class="text-brand-700 hover:underline" href="#/clauses" data-action="close-modal-nav">${t('clause.title')}</a></p>
    </div>`,
    actions: {
      lang: (el) => { state.lang = el.dataset.lang; draw() },
      insert: (el) => {
        const x = state.items.find((i) => i.id === el.dataset.id)
        const text = (state.lang === 'ar' ? x.body_ar : x.body_en) || x.body_en || x.body_ar
        m.close()
        onInsert(text)
        api.post(`/api/clauses/${x.id}/used`).catch(() => {})
      },
      'close-modal-nav': () => { m.close(); location.hash = '#/clauses' }
    },
    changes: { category: (el) => { state.category = el.value; load() } }
  })
  const list = m.el.querySelector('[data-list]')
  const draw = () => {
    m.el.querySelectorAll('[data-lang]').forEach((b) => { b.className = `px-3 py-1 rounded-md ${b.dataset.lang === state.lang ? 'bg-brand-600 text-white' : 'text-slate-600'}` })
    render(list, state.items.length ? html`<ul class="space-y-2">${state.items.map((x) => {
      const text = state.lang === 'ar' ? x.body_ar : x.body_en
      return html`<li class="rounded-lg border border-slate-200 p-3 hover:border-brand-300">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><div class="font-medium text-sm" dir="auto">${x.title}</div><div class="text-xs text-slate-500">${catLabel(x.category)}</div></div>
          <button class="btn btn-primary btn-sm" data-action="insert" data-id="${x.id}"><i class="fas fa-arrow-right-to-bracket"></i>${t('clause.insert_go')}</button>
        </div>
        <p class="text-sm text-slate-600 mt-2 line-clamp-3 font-serif" dir="${text ? (state.lang === 'ar' ? 'rtl' : 'ltr') : 'auto'}">${text || html`<span class="text-amber-700">${t('clause.missing_lang')}</span> ${x.body_en || x.body_ar}`}</p>
      </li>`
    })}</ul>` : emptyState('fa-book-bookmark', state.q || state.category ? t('common.no_results') : t('clause.empty_title'), state.q || state.category ? '' : t('clause.empty_text')))
  }
  const load = async () => {
    const q = new URLSearchParams()
    if (state.q) q.set('q', state.q)
    if (state.category) q.set('category', state.category)
    try { state.items = (await api.get(`/api/clauses?${q}`)).items; draw() } catch (err) { showError(err) }
  }
  m.el.querySelector('[data-q]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); load() }))
  load()
}

// ---------------------------------------------------------------------------
// Document view: playbook review panel.
// ---------------------------------------------------------------------------

export function playbookPanel(box, doc, { onInsert, canEdit }) {
  const state = { reviews: [], rules: null, running: false }
  const draw = () => {
    const latest = state.reviews[0]
    render(box, html`<section class="card">
      <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold"><i class="fas fa-chess-knight text-violet-500"></i> ${t('playbook.review_title')}</h2>
        <a class="text-xs text-brand-700 hover:underline" href="#/clauses?tab=playbook">${t('playbook.manage')}</a>
      </div>
      <div class="p-5 space-y-4">
        ${!aiEnabled() ? html`<p class="text-sm text-slate-500">${t('ai.not_configured_banner')}</p>`
          : state.rules === 0 ? html`<p class="text-sm text-slate-600">${t('playbook.no_rules')} <a class="text-brand-700 hover:underline" href="#/clauses?tab=playbook">${t('playbook.set_up')}</a></p>`
            : canEdit ? html`<form data-form="review" class="space-y-3">
              <p class="text-sm text-slate-600">${t('playbook.review_intro', { n: state.rules ?? '…' })}</p>
              <div class="grid grid-cols-2 gap-3">
                ${inputField({ name: 'acting_for', label: t('playbook.acting_for'), value: '', placeholder: doc.client_name || '', attrs: 'maxlength="200"' })}
                ${selectField({ name: 'language', label: t('analysis.output_language'), options: [{ value: 'en', label: t('common.english') }, { value: 'ar', label: t('common.arabic') }], value: getLang() })}
              </div>
              <button type="submit" class="btn btn-primary w-full" ${state.running ? raw('disabled') : ''}><i class="fas fa-${state.running ? 'circle-notch fa-spin' : 'list-check'}"></i>${state.running ? t('playbook.reviewing') : t('playbook.run')}</button>
            </form>` : ''}
        ${latest ? reviewHtml(latest, doc) : ''}
        ${state.reviews.length > 1 ? html`<details class="text-xs text-slate-500"><summary class="cursor-pointer">${t('playbook.earlier', { n: state.reviews.length - 1 })}</summary>
          <ul class="mt-2 space-y-1">${state.reviews.slice(1).map((r) => html`<li class="flex items-center gap-2"><span class="badge ${scoreColor(r.result.score)}">${r.result.score}</span>${fmtDateTime(r.created_at)} · v${r.document_version} · ${r.created_by_name || ''}</li>`)}</ul></details>` : ''}
        ${aiEnabled() && state.rules !== 0 ? aiDisclaimer() : ''}
      </div>
    </section>`)
  }
  const reviewHtml = (rv, d) => {
    const r = rv.result
    const order = { deviates: 0, missing: 1, fallback: 2, meets: 3, not_applicable: 4 }
    const items = [...r.items].sort((a, b) => order[a.status] - order[b.status])
    return html`<div class="space-y-3">
      <div class="flex items-center gap-3">
        <span class="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold ${scoreColor(r.score)}" title="${t('playbook.score_help')}">${r.score}</span>
        <div class="text-xs text-slate-500 flex-1">
          <div class="flex flex-wrap gap-1 mb-1">${['deviates', 'missing', 'fallback', 'meets'].filter((s) => r.counts[s]).map((s) => html`<span class="badge ${STATUS[s][0]}">${r.counts[s]} ${t(`playbook.status_${s}`)}</span>`)}</div>
          ${fmtDateTime(rv.created_at)} · v${rv.document_version}${rv.document_version !== d.version ? html` <span class="text-amber-700">(${t('playbook.outdated')})</span>` : ''}${rv.acting_for ? ` · ${t('cmp.acting_for', { name: rv.acting_for })}` : ''}
        </div>
      </div>
      ${r.overview ? html`<p class="text-sm leading-relaxed" dir="${rv.language === 'ar' ? 'rtl' : 'ltr'}">${r.overview}</p>` : ''}
      <ul class="space-y-2">${items.map((i) => html`<li>
        <details class="rounded-lg border border-slate-200 ${i.status === 'deviates' ? 'border-s-4 border-s-red-400' : i.status === 'missing' ? 'border-s-4 border-s-amber-400' : ''}" ${i.status === 'deviates' && i.severity === 'high' ? raw('open') : ''}>
          <summary class="px-3 py-2 cursor-pointer flex flex-wrap items-center gap-2 text-sm">${statusBadge(i.status)}<span class="font-medium" dir="auto">${i.topic}</span>
            ${i.clause ? html`<span class="text-xs text-slate-500">${i.clause}</span>` : ''}<span class="badge ${SEV[i.severity]} ms-auto">${t(`playbook.sev_${i.severity}`)}</span></summary>
          <div class="px-3 pb-3 space-y-2 text-sm" dir="${rv.language === 'ar' ? 'rtl' : 'ltr'}">
            ${i.found ? html`<blockquote class="border-s-2 border-slate-300 ps-3 text-slate-600 italic font-serif" dir="auto">${i.found}</blockquote>` : ''}
            ${i.issue ? html`<p>${i.issue}</p>` : ''}
            ${i.suggestion ? html`<div class="rounded-md bg-emerald-50 p-2"><div class="text-xs font-semibold text-emerald-800 mb-1"><i class="fas fa-lightbulb"></i> ${t('playbook.suggested')}</div>
              <p class="whitespace-pre-wrap font-serif" dir="auto">${i.suggestion}</p>
              ${onInsert ? html`<button type="button" class="btn btn-ghost btn-sm mt-1" data-insert="suggestion" data-rule="${i.rule_id}"><i class="fas fa-arrow-right-to-bracket"></i>${t('playbook.insert_suggestion')}</button>` : ''}</div>` : ''}
            ${i.approved_clause ? html`<div class="rounded-md bg-violet-50 p-2"><div class="text-xs font-semibold text-violet-800 mb-1"><i class="fas fa-book-bookmark"></i> ${t('playbook.approved_clause')}${i.approved_clause.title ? `: ${i.approved_clause.title}` : ''}</div>
              <p class="whitespace-pre-wrap font-serif line-clamp-4" dir="auto">${i.approved_clause.text}</p>
              ${onInsert ? html`<button type="button" class="btn btn-ghost btn-sm mt-1" data-insert="approved" data-rule="${i.rule_id}"><i class="fas fa-arrow-right-to-bracket"></i>${t('playbook.insert_approved')}</button>` : ''}</div>` : ''}
          </div>
        </details></li>`)}</ul>
    </div>`
  }
  box.addEventListener('click', (e) => {
    const el = e.target.closest('[data-insert]')
    if (!el || !state.reviews[0]) return
    const item = state.reviews[0].result.items.find((i) => i.rule_id === el.dataset.rule)
    if (!item) return
    onInsert(el.dataset.insert === 'approved' ? item.approved_clause.text : item.suggestion)
  })
  box.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form="review"]')
    if (!form) return
    e.preventDefault()
    if (state.running) return
    const body = formData(form)
    state.running = true
    draw()
    try {
      const r = await api.post('/api/playbook/review', { document_id: doc.id, language: body.language, acting_for: body.acting_for || undefined })
      state.reviews = [r.review, ...state.reviews]
      toast(t('playbook.done', { score: r.review.result.score }))
    } catch (err) { showError(err) }
    state.running = false
    if (box.isConnected) draw()
  })
  draw()
  Promise.all([api.get(`/api/playbook/reviews?document_id=${doc.id}`), api.get('/api/playbook/rules')]).then(([rv, rules]) => {
    state.reviews = rv.items
    state.rules = rules.items.filter((r) => r.active).length
    if (box.isConnected) draw()
  }).catch(() => {})
}
