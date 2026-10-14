import { api, download } from '../api.js'
import { html, render } from '../dom.js'
import { t } from '../i18n.js'
import { modal, selectField, showError, spinner } from '../ui.js'

// Side-by-side bilingual version (English | العربية) of a document and its translation.
export function openBilingual(docId) {
  const m = modal({ title: t('bil.title'), size: 'xl', body: html`<div data-bil><div class="py-10 flex justify-center">${spinner()}</div></div>` })
  const box = m.el.querySelector('[data-bil]')
  api.get(`/api/documents/${docId}/bilingual?format=json`).then((d) => {
    render(box, html`<div class="space-y-4">
      <p class="text-sm text-slate-600">${t('bil.intro')}</p>
      ${d.flagged ? html`<p class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2"><i class="fas fa-triangle-exclamation"></i> ${t('bil.flagged', { n: d.flagged })}</p>` : ''}
      <div class="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-slate-100"><tr><th class="text-start p-2 w-1/2">English</th><th class="text-end p-2 w-1/2">العربية</th></tr></thead>
          <tbody>
            <tr class="border-t border-slate-200 font-semibold"><td class="p-2 align-top">${d.english.title}</td><td class="p-2 align-top text-right" dir="rtl">${d.arabic.title}</td></tr>
            ${d.pairs.map((p) => html`<tr class="border-t border-slate-200 ${p.flagged ? 'bg-amber-50' : ''}">
              <td class="p-2 align-top whitespace-pre-wrap font-serif" dir="ltr">${p.en || html`<span class="text-amber-700 italic">${t('bil.missing')}</span>`}</td>
              <td class="p-2 align-top whitespace-pre-wrap font-serif text-right" dir="rtl">${p.ar || html`<span class="text-amber-700 italic">${t('bil.missing')}</span>`}</td></tr>`)}
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-end justify-between gap-3 pt-2 border-t border-slate-100">
        ${selectField({ name: 'prevailing', label: t('bil.prevailing'), options: [{ value: 'ar', label: t('bil.prev_ar') }, { value: 'en', label: t('bil.prev_en') }, { value: 'none', label: t('bil.prev_none') }], value: 'ar', cls: 'min-w-[16rem]' })}
        <button class="btn btn-primary" data-bil-download><i class="fas fa-file-word"></i>${t('bil.download')}</button>
      </div>
    </div>`)
    box.querySelector('[data-bil-download]').addEventListener('click', () => {
      download(`/api/documents/${docId}/bilingual?prevailing=${box.querySelector('[name=prevailing]').value}`)
    })
  }).catch((err) => { m.close(); showError(err) })
}
