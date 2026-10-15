import { api } from '../api.js'
import { html } from '../dom.js'
import { t } from '../i18n.js'
import { aiEnabled } from '../store.js'
import { busy, showError, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// "Read with AI" at the top of a form: pick a document on the matter and the
// form's fields are filled from it, for the lawyer to check before saving.
// ---------------------------------------------------------------------------

export const readBar = (docs) => aiEnabled() && docs.length ? html`<div class="rounded-xl bg-violet-50 p-3 flex flex-wrap items-end gap-2">
  <div class="flex-1 min-w-48"><label class="label" for="f-read-doc"><i class="fas fa-wand-magic-sparkles text-violet-600"></i> ${t('read.from_document')}</label>
    <select id="f-read-doc" class="input" data-read-doc><option value="">${t('read.choose')}</option>${docs.map((d) => html`<option value="${d.id}">${d.title}</option>`)}</select></div>
  <button type="button" class="btn btn-outline btn-sm mb-1" data-read-go><i class="fas fa-wand-magic-sparkles"></i>${t('read.read')}</button>
  <p class="w-full text-xs text-violet-800" data-read-note hidden>${t('read.check')}</p></div>` : ''

// Wires the bar: fills each named field the AI returned a value for, and highlights it.
export function wireReadBar(form, url, { onFields } = {}) {
  const go = form.querySelector('[data-read-go]')
  if (!go) return
  go.addEventListener('click', () => busy(go, async () => {
    const id = form.querySelector('[data-read-doc]').value
    if (!id) return toast(t('read.need_document'), 'error')
    try {
      const { fields } = await api.post(url, { document_id: id })
      let filled = 0
      for (const [k, v] of Object.entries(fields)) {
        const el = form.elements[k]
        if (!el || v === null || v === '' || v === undefined) continue
        el.value = v
        el.classList.add('ring-2', 'ring-violet-300')
        filled++
      }
      onFields?.(fields)
      form.querySelector('[data-read-note]').hidden = false
      toast(filled ? t('read.filled', { n: filled }) : t('read.nothing'), filled ? 'success' : 'error')
    } catch (err) { showError(err) }
  }))
}
