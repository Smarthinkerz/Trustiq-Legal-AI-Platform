import { api } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { fmtRelative, t } from '../i18n.js'
import { can, readOnly, store } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, emptyState, formActions, inputField, modal, pageHeader, selectField, showError,
  submitButton, toast
} from '../ui.js'
import { searchPicker, wirePickers } from './pickers.js'
import { docTypeLabel, docTypeOptions } from './documents.js'
const editable = () => can('owner', 'admin', 'lawyer') && !readOnly()

// Creates a document from a template for a case/client and opens it.
export function openGenerateForm({ template, templates, caseId, caseLabel }) {
  const m = modal({
    title: t('templates.use'),
    body: html`<form data-form="generate" class="space-y-4" novalidate>
      ${template ? html`<p class="text-sm"><span class="text-slate-500">${t('templates.template')}:</span> <strong>${template.name}</strong></p>`
        : selectField({ name: 'template_id', label: t('templates.template'), options: templates.map((x) => ({ value: x.id, label: x.name })), required: true })}
      ${searchPicker({ name: 'case_id', label: t('cases.matter'), value: caseId, valueLabel: caseLabel })}
      ${searchPicker({ name: 'client_id', label: t('cases.client') })}
      <p class="hint">${t('templates.generate_hint')}</p>
      ${inputField({ name: 'title', label: t('templates.doc_title'), placeholder: template?.name || '' })}
      ${formActions(t('templates.create_document'))}
    </form>`,
    onMount: (el) => wirePickers(el),
    forms: {
      generate: (form) => busy(submitButton(form), async () => {
        const d = formData(form)
        const id = template?.id || d.template_id
        try {
          const res = await api.post(`/api/workspace/templates/${id}/generate`, { title: d.title, case_id: d.case_id, client_id: d.client_id })
          m.close()
          toast(t('templates.generated'))
          location.hash = `#/documents/${res.document.id}`
        } catch (err) { showError(err, form) }
      })
    }
  })
}

export async function templatesView(root, { isCurrent, rerender }) {
  const { items } = await api.get('/api/workspace/templates')
  if (!isCurrent()) return
  render(root, html`
    ${pageHeader(t('nav.templates'), t('templates.subtitle'), editable() ? html`<button class="btn btn-primary" data-action="new"><i class="fas fa-plus"></i>${t('templates.new')}</button>` : '')}
    <div class="card">
      ${items.length ? html`<ul class="divide-y divide-slate-100">${items.map((x) => html`<li class="px-5 py-3 flex flex-wrap items-center gap-3">
        <i class="fas fa-file-signature text-slate-400"></i>
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate" dir="auto">${x.name}</div>
          <div class="text-xs text-slate-500">${docTypeLabel(x.doc_type)} · ${x.language === 'ar' ? 'العربية' : 'English'} · ${fmtRelative(x.updated_at)}</div>
        </div>
        ${readOnly() ? '' : html`<button class="btn btn-primary btn-sm" data-action="use" data-id="${x.id}"><i class="fas fa-file-circle-plus"></i>${t('templates.use')}</button>`}
        ${editable() ? html`<a class="btn btn-outline btn-sm" href="#/templates/${x.id}"><i class="fas fa-pen"></i>${t('common.edit')}</a>
          <button class="btn btn-danger-ghost btn-sm" data-action="delete" data-id="${x.id}" data-name="${x.name}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
      </li>`)}</ul>`
        : emptyState('fa-file-signature', t('templates.empty_title'), t('templates.empty_text'), editable() ? html`<button class="btn btn-primary" data-action="new">${t('templates.new')}</button>` : '')}
    </div>`)
  bind(root, {
    actions: {
      new: () => (location.hash = '#/templates/new'),
      use: (el) => openGenerateForm({ template: items.find((x) => x.id === el.dataset.id) }),
      delete: async (el) => {
        if (!(await confirmDialog(t('templates.confirm_delete', { name: el.dataset.name })))) return
        try { await api.del(`/api/workspace/templates/${el.dataset.id}`); rerender() } catch (err) { showError(err) }
      }
    }
  })
}

export async function templateEditView(root, { params, isCurrent }) {
  const isNew = params.id === 'new'
  const data = isNew ? await api.get('/api/workspace/templates').then((r) => ({ template: null, merge_fields: r.merge_fields })) : await api.get(`/api/workspace/templates/${params.id}`)
  if (!isCurrent()) return
  const tp = data.template || { language: store.me.user.locale || 'en', doc_type: 'contract' }
  render(root, html`
    <nav class="text-sm text-slate-500 mb-3"><a href="#/templates" class="hover:underline">${t('nav.templates')}</a></nav>
    <form data-form="save" class="grid lg:grid-cols-4 gap-6" novalidate>
      <div class="lg:col-span-3 card card-pad space-y-4">
        <div class="grid sm:grid-cols-3 gap-4">
          ${inputField({ name: 'name', label: t('templates.name'), value: tp.name, required: true, attrs: 'dir="auto"' })}
          ${selectField({ name: 'doc_type', label: t('docs.type'), options: docTypeOptions(), value: tp.doc_type })}
          ${selectField({ name: 'language', label: t('settings.language'), options: [{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }], value: tp.language })}
        </div>
        <div>
          <label class="label" for="f-content">${t('templates.content')}</label>
          <textarea id="f-content" name="content" rows="24" class="input font-mono text-sm" dir="${tp.language === 'ar' ? 'rtl' : 'ltr'}" required>${tp.content || ''}</textarea>
        </div>
        <div class="flex justify-end gap-2">
          <a href="#/templates" class="btn btn-outline">${t('common.cancel')}</a>
          <button type="submit" class="btn btn-primary">${t('common.save')}</button>
        </div>
      </div>
      <aside class="card card-pad h-fit">
        <h2 class="font-semibold mb-1">${t('templates.merge_fields')}</h2>
        <p class="text-xs text-slate-500 mb-3">${t('templates.merge_help')}</p>
        <div class="flex flex-wrap gap-1.5">${data.merge_fields.map((f) => html`<button type="button" class="badge bg-slate-100 text-slate-700 hover:bg-brand-50 font-mono" data-action="insert" data-field="${f}">{{${f}}}</button>`)}</div>
      </aside>
    </form>`)
  const textarea = root.querySelector('#f-content')
  bind(root, {
    actions: {
      insert: (el) => {
        const token = `{{${el.dataset.field}}}`
        const { selectionStart: a, selectionEnd: b, value } = textarea
        textarea.value = value.slice(0, a) + token + value.slice(b)
        textarea.focus()
        textarea.selectionStart = textarea.selectionEnd = a + token.length
      }
    },
    forms: {
      save: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const d = formData(form)
        d.content = textarea.value
        try {
          if (isNew) await api.post('/api/workspace/templates', d)
          else await api.patch(`/api/workspace/templates/${params.id}`, d)
          toast(t('common.saved'))
          location.hash = '#/templates'
        } catch (err) { showError(err, form) }
      })
    }
  })
  root.querySelector('[name=language]').addEventListener('change', (e) => { textarea.dir = e.target.value === 'ar' ? 'rtl' : 'ltr' })
}
