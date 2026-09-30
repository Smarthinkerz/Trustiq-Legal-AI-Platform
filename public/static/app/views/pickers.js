import { api } from '../api.js'
import { $$, html, qs, raw, render } from '../dom.js'
import { t } from '../i18n.js'
import { debounce } from '../ui.js'

const SOURCES = {
  client_id: { url: '/api/clients', label: (c) => c.name + (c.name_ar ? ` – ${c.name_ar}` : ''), empty: () => t('pickers.no_client') },
  case_id: { url: '/api/cases', label: (k) => `${k.reference} · ${k.title}`, empty: () => t('pickers.no_case') }
}

// A select with a search box that queries the API, so large client/case lists stay usable.
export function searchPicker({ name, label, value, valueLabel }) {
  const src = SOURCES[name]
  return html`<div>
    <label class="label" for="f-${name}">${label}</label>
    <div class="flex flex-col sm:flex-row gap-2">
      <input type="search" class="input sm:w-40" data-picker-search="${name}" placeholder="${t('common.search')}" aria-label="${t('common.search')} ${label}" />
      <select id="f-${name}" name="${name}" class="input flex-1" data-picker="${name}">
        <option value="">${src.empty()}</option>
        ${value ? html`<option value="${value}" selected>${valueLabel || value}</option>` : ''}
      </select>
    </div>
  </div>`
}

export function wirePickers(root) {
  for (const input of $$('[data-picker-search]', root)) {
    const name = input.dataset.pickerSearch
    const select = root.querySelector(`[data-picker="${name}"]`)
    const src = SOURCES[name]
    const load = async (q) => {
      const current = select.value
      const currentLabel = select.selectedOptions[0]?.textContent
      try {
        const res = await api.get(src.url + qs({ q, pageSize: 50, ...(name === 'case_id' ? { status: 'open' } : {}) }))
        const items = res.items.filter((i) => i.id !== current)
        render(select, html`<option value="">${src.empty()}</option>
          ${current ? html`<option value="${current}" selected>${currentLabel}</option>` : ''}
          ${items.map((i) => html`<option value="${i.id}">${src.label(i)}</option>`)}`)
      } catch { /* keep existing options */ }
    }
    input.addEventListener('input', debounce(() => load(input.value.trim())))
    load('')
  }
}

let membersCache = null
export async function loadMembers(force = false) {
  if (!membersCache || force) membersCache = (await api.get('/api/org/members')).items.filter((m) => !m.deactivated_at)
  return membersCache
}
export const invalidateMembers = () => { membersCache = null }

export function memberSelect({ name = 'assigned_to', label, value, members }) {
  return html`<div>
    <label class="label" for="f-${name}">${label}</label>
    <select id="f-${name}" name="${name}" class="input">
      <option value="">${t('pickers.unassigned')}</option>
      ${members.map((m) => html`<option value="${m.id}" ${m.id === value ? raw('selected') : ''}>${m.name}</option>`)}
    </select>
  </div>`
}
