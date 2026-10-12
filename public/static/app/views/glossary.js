import { api } from '../api.js'
import { bind, formData, html, render } from '../dom.js'
import { t } from '../i18n.js'
import { can, readOnly } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, debounce, emptyState, inputField, modal, pageHeader, showError, spinner, submitButton, textareaField, toast
} from '../ui.js'

// The firm's English <-> Arabic legal glossary; every AI translation follows it.
export async function glossaryView(root, { isCurrent }) {
  const editable = !readOnly() && can('owner', 'admin', 'lawyer')
  const state = { q: '' }
  render(root, html`
    <nav class="text-sm text-slate-500 mb-3"><a href="#/documents" class="hover:underline">${t('nav.documents')}</a></nav>
    ${pageHeader(t('glossary.title'), t('glossary.subtitle'), editable ? html`
      <button class="btn btn-outline" data-action="import"><i class="fas fa-paste"></i>${t('glossary.import')}</button>
      <button class="btn btn-primary" data-action="add"><i class="fas fa-plus"></i>${t('glossary.add')}</button>` : '')}
    <div class="card">
      <div class="p-4 border-b border-slate-100">
        <div class="relative">
          <i class="fas fa-magnifying-glass absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm"></i>
          <input type="search" class="input ps-9" data-search placeholder="${t('glossary.search')}" aria-label="${t('common.search')}" />
        </div>
      </div>
      <div id="terms">${spinner()}</div>
    </div>`)
  const box = root.querySelector('#terms')
  let items = []
  const load = async () => {
    const res = await api.get(`/api/glossary${state.q ? `?q=${encodeURIComponent(state.q)}` : ''}`)
    if (!isCurrent()) return
    items = res.items
    render(box, items.length ? html`<div class="overflow-x-auto"><table class="table">
      <thead><tr><th>${t('common.english')}</th><th>${t('common.arabic')}</th><th>${t('glossary.note')}</th>${editable ? html`<th></th>` : ''}</tr></thead>
      <tbody>${items.map((x) => html`<tr>
        <td class="font-medium" dir="ltr">${x.term_en}</td>
        <td class="font-medium" dir="rtl" lang="ar">${x.term_ar}</td>
        <td class="text-xs text-slate-500" dir="auto">${x.note || ''}</td>
        ${editable ? html`<td class="text-end whitespace-nowrap">
          <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${x.id}" aria-label="${t('common.edit')}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger-ghost btn-sm" data-action="delete" data-id="${x.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button></td>` : ''}
      </tr>`)}</tbody></table></div>
      <p class="px-5 py-3 text-xs text-slate-500 border-t border-slate-100">${t('glossary.count', { n: items.length })}</p>`
      : state.q ? emptyState('fa-magnifying-glass', t('common.no_results'), '')
        : emptyState('fa-language', t('glossary.empty_title'), t('glossary.empty_text'),
          editable ? html`<button class="btn btn-primary" data-action="import"><i class="fas fa-paste"></i>${t('glossary.import')}</button>` : ''))
  }
  const reload = () => load().catch(showError)

  const openForm = (term) => {
    const m = modal({
      title: term ? t('glossary.edit') : t('glossary.add'),
      body: html`<form data-form="save" class="space-y-4" novalidate>
        <div class="grid sm:grid-cols-2 gap-4">
          ${inputField({ name: 'term_en', label: t('common.english'), value: term?.term_en, required: true, dir: 'ltr', attrs: 'maxlength="200"' })}
          ${inputField({ name: 'term_ar', label: t('common.arabic'), value: term?.term_ar, required: true, dir: 'rtl', attrs: 'lang="ar" maxlength="200"' })}
        </div>
        ${inputField({ name: 'note', label: t('glossary.note'), value: term?.note, hint: t('glossary.note_hint'), attrs: 'maxlength="300"' })}
        <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('common.save')}</button>
        </div>
      </form>`,
      forms: {
        save: (form) => busy(submitButton(form), async () => {
          clearFieldErrors(form)
          try {
            const body = formData(form)
            if (term) await api.patch(`/api/glossary/${term.id}`, { ...body, note: body.note || '' })
            else await api.post('/api/glossary', body)
            m.close()
            toast(t('common.saved'))
            reload()
          } catch (err) { showError(err, form) }
        })
      }
    })
  }

  const openImport = () => {
    const m = modal({
      title: t('glossary.import'),
      size: 'lg',
      body: html`<form data-form="import" class="space-y-4" novalidate>
        <p class="text-sm text-slate-600">${t('glossary.import_intro')}</p>
        ${textareaField({ name: 'text', label: t('glossary.import_label'), rows: 10, required: true, placeholder: 'Lessee = المستأجر\nStatement of claim = صحيفة الدعوى\nForce majeure, القوة القاهرة' })}
        <p class="hint">${t('glossary.import_hint')}</p>
        <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
          <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-file-import"></i>${t('glossary.import_go')}</button>
        </div>
      </form>`,
      forms: {
        import: (form) => busy(submitButton(form), async () => {
          try {
            const r = await api.post('/api/glossary/import', formData(form))
            m.close()
            toast(t('glossary.imported', r))
            reload()
          } catch (err) { showError(err, form) }
        })
      }
    })
  }

  bind(root, {
    actions: {
      add: () => openForm(),
      import: openImport,
      edit: (el) => openForm(items.find((x) => x.id === el.dataset.id)),
      delete: async (el) => {
        const x = items.find((i) => i.id === el.dataset.id)
        if (!(await confirmDialog(t('glossary.confirm_delete', { term: x.term_en })))) return
        try {
          await api.del(`/api/glossary/${x.id}`)
          toast(t('common.deleted'))
          reload()
        } catch (err) { showError(err) }
      }
    }
  })
  root.querySelector('[data-search]').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); reload() }))
  await load()
}
