import { ApiError } from '../api.js'
import { html } from '../dom.js'
import { t } from '../i18n.js'
import { modal, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Conflict-of-interest gate for creating clients and cases. The server refuses
// with 409 conflict_of_interest; a partner can proceed by giving a reason.
// ---------------------------------------------------------------------------

export const conflictItem = (m) => html`<li>
  <i class="fas ${m.type === 'opposing_is_client' ? 'fa-address-book' : 'fa-folder-open'} text-slate-400 me-1"></i>
  ${m.type === 'opposing_is_client'
    ? html`${t('conflicts.is_client')}: <a class="underline" target="_blank" rel="noopener" href="#/clients/${m.id}">${m.label}</a>`
    : html`${t('conflicts.is_opposing')}: <a class="underline" target="_blank" rel="noopener" href="#/cases/${m.id}">${m.label}</a> <span class="text-slate-600">(${m.detail})</span>`}
</li>`

// Runs submit(); on a conflict, shows the matches and, for partners, asks for a reason and retries with it.
export async function withConflictGate(submit) {
  try {
    return await submit(null)
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'conflict_of_interest') throw err
    const { conflicts = [], can_override: canOverride } = err.details || {}
    return new Promise((resolve, reject) => {
      let settled = false
      const m = modal({
        title: t('conflicts.title'),
        body: html`<form data-form="override" class="space-y-4" novalidate>
          <div class="rounded-lg bg-red-50 border border-red-200 text-red-800 p-3 text-sm">
            <p class="font-semibold mb-2"><i class="fas fa-triangle-exclamation"></i> ${t('conflicts.found')}</p>
            <ul class="space-y-1">${conflicts.map(conflictItem)}</ul>
          </div>
          ${canOverride ? html`<div>
            <label class="label" for="co-reason">${t('conflicts.reason')} <span class="text-red-500">*</span></label>
            <textarea id="co-reason" name="reason" rows="3" class="input" dir="auto" minlength="5" maxlength="1000" required></textarea>
            <p class="hint">${t('conflicts.reason_hint')}</p>
          </div>` : html`<p class="text-sm text-slate-700">${t('conflicts.need_partner')}</p>`}
          <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <button type="button" class="btn btn-outline" data-action="close-modal">${canOverride ? t('common.cancel') : t('common.close')}</button>
            ${canOverride ? html`<button type="submit" class="btn btn-danger">${t('conflicts.proceed')}</button>` : ''}
          </div>
        </form>`,
        forms: {
          override: async (form) => {
            const reason = form.elements.reason.value.trim()
            if (reason.length < 5) { toast(t('conflicts.reason_short'), 'error'); return }
            try { const res = await submit({ reason }); settled = true; m.close(); resolve(res) } catch (e) { settled = true; m.close(); reject(e) }
          }
        }
      })
      // Closing the dialog without proceeding cancels quietly.
      const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!settled) reject(Object.assign(new Error('cancelled'), { cancelled: true })) } })
      obs.observe(document.getElementById('modal-root'), { childList: true })
    })
  }
}
