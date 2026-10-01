import { api, download } from '../api.js'
import { bind, formData, html, qs, raw, render } from '../dom.js'
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, getLang, t } from '../i18n.js'
import { applyLanguage, refreshMe, remount } from '../main.js'
import { can, canManageTeam, refOptions, store } from '../store.js'
import {
  busy, clearFieldErrors, confirmDialog, formActions, inputField, modal, pagination, selectField, showError, spinner,
  submitButton, textareaField, toast
} from '../ui.js'
import { invalidateMembers } from './pickers.js'

const TABS = [
  ['profile', 'fa-user', () => true],
  ['firm', 'fa-building', () => canManageTeam()],
  ['team', 'fa-users', () => true],
  ['branding', 'fa-palette', () => canManageTeam()],
  ['plan', 'fa-credit-card', () => true],
  ['audit', 'fa-clipboard-list', () => canManageTeam()]
]

export async function settingsView(root, ctx) {
  const tabs = TABS.filter(([, , ok]) => ok())
  const active = tabs.find(([k]) => k === ctx.query.get('tab'))?.[0] || 'profile'
  render(root, html`
    <h1 class="text-2xl font-bold mb-4">${t('nav.settings')}</h1>
    <div class="flex gap-1 overflow-x-auto border-b border-slate-200 mb-6" role="tablist">
      ${tabs.map(([k, icon]) => html`<a href="#/settings?tab=${k}" role="tab" aria-selected="${k === active}" class="tab ${k === active ? 'active' : ''}"><i class="fas ${icon} me-1.5"></i>${t(`settings.${k}`)}</a>`)}
    </div>
    <div id="tab-body">${spinner()}</div>`)
  const body = root.querySelector('#tab-body')
  await ({ profile, firm, team, branding, plan, audit })[active](body, ctx)
}

// ---------------- Profile ----------------
export { profile as profileTab }

async function profile(root, { isCurrent, rerender } = {}) {
  const { user } = store.me
  const prefs = await api.get('/api/auth/preferences')
  if (isCurrent && !isCurrent()) return
  const client = user.role === 'client'
  render(root, html`
    <div class="grid lg:grid-cols-2 gap-6 max-w-5xl">
      <section class="card card-pad">
        <h2 class="font-semibold mb-4">${t('settings.profile')}</h2>
        <form data-form="profile" class="space-y-4" novalidate>
          ${inputField({ name: 'name', label: t('auth.full_name'), value: user.name, required: true })}
          ${inputField({ name: 'email', label: t('auth.email'), value: user.email, attrs: 'disabled dir="ltr"', hint: t('settings.email_hint') })}
          ${selectField({ name: 'locale', label: t('settings.language'), options: [{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }], value: user.locale })}
          <div class="flex justify-end"><button type="submit" class="btn btn-primary">${t('common.save')}</button></div>
        </form>
      </section>
      <section class="card card-pad">
        <h2 class="font-semibold mb-4">${t('settings.change_password')}</h2>
        <form data-form="password" class="space-y-4" novalidate>
          ${inputField({ name: 'current_password', label: t('settings.current_password'), type: 'password', required: true, attrs: 'autocomplete="current-password" dir="ltr"' })}
          ${inputField({ name: 'new_password', label: t('auth.new_password'), type: 'password', required: true, hint: t('auth.password_hint'), attrs: 'autocomplete="new-password" dir="ltr"' })}
          <p class="hint">${t('settings.password_signout_note')}</p>
          <div class="flex justify-end"><button type="submit" class="btn btn-primary">${t('settings.update_password')}</button></div>
        </form>
      </section>
      <section class="card card-pad">
        <h2 class="font-semibold mb-1"><i class="fas fa-shield-halved text-slate-400 me-1"></i>${t('security.two_factor')}</h2>
        <p class="text-sm text-slate-500 mb-4">${t('security.two_factor_help')}</p>
        ${prefs.two_factor ? html`
          <p class="text-sm text-emerald-700 mb-2"><i class="fas fa-circle-check"></i> ${t('security.enabled')}</p>
          <p class="text-xs text-slate-500 mb-4">${t('security.recovery_left', { n: prefs.recovery_codes_left })}</p>
          <button class="btn btn-danger-ghost" data-action="disable-2fa">${t('security.disable')}</button>`
        : html`<button class="btn btn-primary" data-action="enable-2fa"><i class="fas fa-lock"></i>${t('security.enable')}</button>`}
      </section>
      <section class="card card-pad space-y-5">
        <div>
          <h2 class="font-semibold mb-1"><i class="fas fa-bell text-slate-400 me-1"></i>${t('prefs.notifications')}</h2>
          <label class="flex items-start gap-2 text-sm mt-3"><input type="checkbox" class="mt-1" data-change="notify" ${prefs.notify_email ? raw('checked') : ''} />
            <span>${client ? t('prefs.notify_client') : t('prefs.notify_staff')}</span></label>
        </div>
        ${client ? '' : html`<div class="pt-5 border-t border-slate-100">
          <h2 class="font-semibold mb-1"><i class="fas fa-calendar-plus text-slate-400 me-1"></i>${t('prefs.calendar_feed')}</h2>
          <p class="text-sm text-slate-500 mb-3">${t('prefs.calendar_help')}</p>
          ${prefs.calendar_url ? html`<div class="flex gap-2 mb-2"><input class="input font-mono text-xs" dir="ltr" readonly value="${prefs.calendar_url}" data-link /><button class="btn btn-outline" data-action="copy-feed" aria-label="${t('common.copy')}"><i class="fas fa-copy"></i></button></div>
            <button class="btn btn-ghost btn-sm" data-action="calendar-token">${t('prefs.calendar_reset')}</button>`
          : html`<button class="btn btn-outline" data-action="calendar-token"><i class="fas fa-link"></i>${t('prefs.calendar_create')}</button>`}
        </div>`}
      </section>
    </div>`)
  const again = () => (rerender ? rerender() : profile(root, { isCurrent, rerender }))
  bind(root, {
    actions: {
      'enable-2fa': () => openTwoFactorSetup(again),
      'disable-2fa': () => {
        const m = modal({
          title: t('security.disable'),
          size: 'sm',
          body: html`<form data-form="off" class="space-y-4" novalidate>
            <p class="text-sm text-slate-600">${t('security.disable_help')}</p>
            ${inputField({ name: 'password', label: t('settings.current_password'), type: 'password', required: true, attrs: 'autocomplete="current-password" dir="ltr"' })}
            ${inputField({ name: 'code', label: t('security.code'), required: true, attrs: 'autocomplete="one-time-code" inputmode="numeric" dir="ltr"' })}
            ${formActions(t('security.disable'))}
          </form>`,
          forms: {
            off: (form) => busy(submitButton(form), async () => {
              try { await api.post('/api/auth/2fa/disable', formData(form)); m.close(); await refreshMe(); toast(t('security.disabled')); again() } catch (err) { showError(err, form) }
            })
          }
        })
      },
      'calendar-token': async (el) => {
        if (prefs.calendar_url && !(await confirmDialog(t('prefs.calendar_reset_confirm'), { danger: false }))) return
        busy(el, async () => {
          try { await api.post('/api/auth/calendar-token'); again() } catch (err) { showError(err) }
        })
      },
      'copy-feed': async () => {
        const input = root.querySelector('[data-link]')
        try { await navigator.clipboard.writeText(input.value); toast(t('common.copied')) } catch { input.select() }
      }
    },
    changes: {
      notify: async (el) => {
        try { store.me = await api.patch('/api/auth/me', { notify_email: el.checked }); toast(t('common.saved')) } catch (err) { el.checked = !el.checked; showError(err) }
      }
    },
    forms: {
      profile: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const data = formData(form)
        try {
          store.me = await api.patch('/api/auth/me', { name: data.name, locale: data.locale })
          toast(t('common.saved'))
          if (data.locale !== getLang()) applyLanguage(data.locale)
          else remount()
        } catch (err) { showError(err, form) }
      }),
      password: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        try {
          await api.post('/api/auth/change-password', formData(form))
          form.reset()
          toast(t('settings.password_changed'))
        } catch (err) { showError(err, form) }
      })
    }
  })
}

function openTwoFactorSetup(onDone) {
  const m = modal({
    title: t('security.enable'),
    body: html`<div data-step>${spinner()}</div>`,
    onMount: async (el) => {
      const step = el.querySelector('[data-step]')
      try {
        const s = await api.post('/api/auth/2fa/setup')
        render(step, html`<form data-form="verify" class="space-y-4" novalidate>
          <ol class="text-sm text-slate-600 list-decimal ps-5 space-y-1"><li>${t('security.step_app')}</li><li>${t('security.step_scan')}</li><li>${t('security.step_code')}</li></ol>
          <div class="flex flex-col items-center gap-2">
            <img src="${s.qr_data_url}" alt="${t('security.qr_alt')}" width="200" height="200" class="border border-slate-200 rounded" />
            <code class="text-xs bg-slate-100 rounded px-2 py-1 break-all" dir="ltr">${s.secret}</code>
          </div>
          ${inputField({ name: 'code', label: t('security.code'), required: true, attrs: 'autocomplete="one-time-code" inputmode="numeric" maxlength="6" dir="ltr"' })}
          ${formActions(t('security.verify'))}
        </form>`)
        step.querySelector('input[name=code]').focus()
      } catch (err) { m.close(); showError(err) }
    },
    forms: {
      verify: (form) => busy(submitButton(form), async () => {
        try {
          const res = await api.post('/api/auth/2fa/enable', formData(form))
          await refreshMe()
          const step = form.parentElement
          render(step, html`<div class="space-y-4">
            <p class="text-sm text-emerald-700"><i class="fas fa-circle-check"></i> ${t('security.now_enabled')}</p>
            <p class="text-sm text-slate-700">${t('security.save_codes')}</p>
            <pre class="bg-slate-50 border border-slate-200 rounded p-3 text-sm font-mono leading-7" dir="ltr" data-codes>${res.recovery_codes.join('\n')}</pre>
            <div class="flex justify-end gap-2">
              <button type="button" class="btn btn-outline" data-action="copy-codes"><i class="fas fa-copy"></i>${t('common.copy')}</button>
              <button type="button" class="btn btn-primary" data-action="done">${t('security.saved_codes')}</button>
            </div></div>`)
        } catch (err) { showError(err, form) }
      })
    },
    actions: {
      'copy-codes': async (el) => {
        try { await navigator.clipboard.writeText(el.closest('div.space-y-4').querySelector('[data-codes]').textContent); toast(t('common.copied')) } catch { /* ignore */ }
      },
      done: () => { m.close(); onDone?.() }
    }
  })
}

// ---------------- Firm ----------------
async function firm(root) {
  const { org } = store.me
  render(root, html`
    <section class="card card-pad max-w-2xl space-y-6">
      <form data-form="firm" class="space-y-4" novalidate>
        <h2 class="font-semibold">${t('settings.firm')}</h2>
        ${inputField({ name: 'name', label: t('auth.firm_name'), value: org.name, required: true })}
        <div class="grid sm:grid-cols-2 gap-4">
          ${selectField({ name: 'default_jurisdiction', label: t('settings.default_jurisdiction'), options: refOptions('jurisdictions'), value: org.default_jurisdiction })}
          ${selectField({ name: 'default_currency', label: t('settings.default_currency'), options: store.ref.currencies.map((c) => ({ value: c, label: c })), value: org.default_currency })}
        </div>
        <div class="flex justify-end"><button type="submit" class="btn btn-primary">${t('common.save')}</button></div>
      </form>
      ${can('owner') ? html`<div class="pt-6 border-t border-slate-100">
        <h2 class="font-semibold mb-1">${t('settings.export_title')}</h2>
        <p class="text-sm text-slate-500 mb-3">${t('settings.export_text')}</p>
        <button class="btn btn-outline" data-action="export"><i class="fas fa-file-export"></i>${t('settings.export_button')}</button>
      </div>` : ''}
    </section>`)
  bind(root, {
    actions: { export: () => download('/api/org/export') },
    forms: {
      firm: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        try {
          await api.patch('/api/org', formData(form))
          await refreshMe()
          toast(t('common.saved'))
          remount()
        } catch (err) { showError(err, form) }
      })
    }
  })
}

// ---------------- Team ----------------
async function team(root, { isCurrent, rerender }) {
  const manage = canManageTeam()
  const [{ items: members }, invites] = await Promise.all([
    api.get('/api/org/members'),
    manage ? api.get('/api/org/invites') : Promise.resolve({ items: [] })
  ])
  if (!isCurrent()) return
  const me = store.me.user
  const roles = ['owner', 'admin', 'lawyer', 'staff']
  render(root, html`
    <div class="space-y-6 max-w-5xl">
      <section class="card">
        <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div><h2 class="font-semibold">${t('settings.team')}</h2><p class="text-xs text-slate-500">${t('settings.roles_help')}</p></div>
          ${manage ? html`<button class="btn btn-primary" data-action="invite"><i class="fas fa-user-plus"></i>${t('settings.invite')}</button>` : ''}
        </div>
        <div class="overflow-x-auto"><table class="table">
          <thead><tr><th>${t('clients.name')}</th><th>${t('auth.email')}</th><th>${t('settings.role')}</th><th>${t('settings.last_login')}</th><th></th></tr></thead>
          <tbody>${members.map((m) => html`<tr class="${m.deactivated_at ? 'opacity-50' : ''}">
            <td class="font-medium">${m.name}${m.id === me.id ? html` <span class="text-xs text-slate-400">(${t('settings.you')})</span>` : ''}</td>
            <td class="text-slate-600" dir="ltr">${m.email}</td>
            <td>${m.deactivated_at ? html`<span class="badge bg-slate-100 text-slate-500">${t('settings.deactivated')}</span>`
              : manage && m.id !== me.id && (me.role === 'owner' || m.role !== 'owner')
                ? html`<select class="input py-1 w-32" data-change="role" data-id="${m.id}" aria-label="${t('settings.role')}">${roles.filter((r) => me.role === 'owner' || r !== 'owner').map((r) => html`<option value="${r}" ${r === m.role ? raw('selected') : ''}>${t(`role.${r}`)}</option>`)}</select>`
                : t(`role.${m.role}`)}</td>
            <td class="text-xs text-slate-500">${m.last_login_at ? fmtRelative(m.last_login_at) : '—'}</td>
            <td class="text-end">${manage && !m.deactivated_at && m.id !== me.id && (me.role === 'owner' || m.role !== 'owner') ? html`<button class="btn btn-danger-ghost btn-sm" data-action="remove" data-id="${m.id}" data-name="${m.name}">${t('settings.remove')}</button>` : ''}</td>
          </tr>`)}</tbody>
        </table></div>
      </section>
      ${manage && invites.items.length ? html`<section class="card">
        <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('settings.pending_invites')}</h2></div>
        <ul class="divide-y divide-slate-100">${invites.items.map((i) => html`<li class="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div><span dir="ltr">${i.email}</span> · ${t(`role.${i.role}`)} <span class="text-xs text-slate-400">· ${t('settings.expires')} ${fmtDate(i.expires_at)}</span></div>
          <button class="btn btn-danger-ghost btn-sm" data-action="revoke" data-id="${i.id}">${t('settings.revoke')}</button></li>`)}</ul>
      </section>` : ''}
    </div>`)

  bind(root, {
    actions: {
      invite: () => {
        const m = modal({
          title: t('settings.invite'),
          body: html`<form data-form="invite" class="space-y-4" novalidate>
            ${inputField({ name: 'email', label: t('auth.email'), type: 'email', required: true, attrs: 'dir="ltr"' })}
            ${selectField({ name: 'role', label: t('settings.role'), options: ['lawyer', 'staff', 'admin'].map((r) => ({ value: r, label: t(`role.${r}`) })), value: 'lawyer' })}
            <p class="hint">${t('settings.roles_help')}</p>
            ${formActions(t('settings.send_invite'))}
          </form>`,
          forms: {
            invite: (form) => busy(submitButton(form), async () => {
              clearFieldErrors(form)
              try {
                const res = await api.post('/api/org/invites', formData(form))
                invalidateMembers()
                render(form, html`<div class="space-y-3">
                  <p class="text-sm ${res.emailed ? 'text-emerald-700' : 'text-slate-700'}">${res.emailed ? t('settings.invite_emailed') : t('settings.invite_share')}</p>
                  <div class="flex gap-2"><input class="input font-mono text-xs" dir="ltr" readonly value="${res.invite_url}" data-link /><button type="button" class="btn btn-outline" data-action="copy-link"><i class="fas fa-copy"></i></button></div>
                  <div class="flex justify-end"><button type="button" class="btn btn-primary" data-action="done">${t('common.done')}</button></div>
                </div>`)
              } catch (err) { showError(err, form) }
            })
          },
          actions: {
            'copy-link': async (el) => {
              const input = el.closest('div').querySelector('[data-link]')
              try { await navigator.clipboard.writeText(input.value); toast(t('common.copied')) } catch { input.select() }
            },
            done: () => { m.close(); rerender() }
          }
        })
      },
      remove: async (el) => {
        if (!(await confirmDialog(t('settings.confirm_remove', { name: el.dataset.name })))) return
        try { await api.del(`/api/org/members/${el.dataset.id}`); invalidateMembers(); toast(t('common.saved')); rerender() } catch (err) { showError(err) }
      },
      revoke: async (el) => {
        try { await api.del(`/api/org/invites/${el.dataset.id}`); rerender() } catch (err) { showError(err) }
      }
    },
    changes: {
      role: async (el) => {
        try { await api.patch(`/api/org/members/${el.dataset.id}`, { role: el.value }); toast(t('common.saved')); rerender() } catch (err) { showError(err); rerender() }
      }
    }
  })
}

// ---------------- Branding ----------------
async function branding(root, { isCurrent, rerender }) {
  const { branding: b } = await api.get('/api/org/branding')
  if (!isCurrent()) return
  const logoUrl = `/api/org/branding/logo?t=${Date.now()}`
  render(root, html`
    <div class="grid lg:grid-cols-3 gap-6 max-w-6xl">
      <section class="card card-pad lg:col-span-2">
        <h2 class="font-semibold mb-1">${t('settings.branding')}</h2>
        <p class="text-sm text-slate-500 mb-4">${t('settings.branding_help')}</p>
        <form data-form="branding" class="grid sm:grid-cols-2 gap-4" novalidate>
          ${inputField({ name: 'firm_name', label: t('settings.firm_name_en'), value: b.firm_name })}
          ${inputField({ name: 'firm_name_ar', label: t('settings.firm_name_ar'), value: b.firm_name_ar, dir: 'rtl' })}
          ${inputField({ name: 'phone', label: t('clients.phone'), value: b.phone, attrs: 'dir="ltr"' })}
          ${inputField({ name: 'email', label: t('auth.email'), type: 'email', value: b.email, attrs: 'dir="ltr"' })}
          ${inputField({ name: 'website', label: t('settings.website'), value: b.website, attrs: 'dir="ltr"' })}
          <div class="grid grid-cols-2 gap-2">
            ${inputField({ name: 'primary_color', label: t('settings.primary_color'), type: 'color', value: b.primary_color || '#1a365d',})}
            ${inputField({ name: 'accent_color', label: t('settings.accent_color'), type: 'color', value: b.accent_color || '#d69e2e',})}
          </div>
          ${textareaField({ name: 'address', label: t('clients.address'), value: b.address, rows: 2, cls: 'sm:col-span-2' })}
          ${inputField({ name: 'footer_text', label: t('settings.footer_text'), value: b.footer_text, cls: 'sm:col-span-2', hint: t('settings.footer_hint') })}
          <div class="sm:col-span-2 flex justify-end"><button type="submit" class="btn btn-primary">${t('common.save')}</button></div>
        </form>
      </section>
      <section class="card card-pad">
        <h2 class="font-semibold mb-3">${t('settings.logo')}</h2>
        <div class="h-28 rounded-lg border border-dashed border-slate-300 flex items-center justify-center bg-slate-50 mb-3">
          ${b.has_logo ? html`<img src="${logoUrl}" alt="${t('settings.logo')}" class="max-h-24 max-w-full object-contain" />` : html`<span class="text-sm text-slate-400">${t('settings.no_logo')}</span>`}
        </div>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-logo-input class="hidden" />
        <div class="flex gap-2">
          <button class="btn btn-outline flex-1" data-action="pick-logo"><i class="fas fa-upload"></i>${t('settings.upload_logo')}</button>
          ${b.has_logo ? html`<button class="btn btn-danger-ghost" data-action="remove-logo" aria-label="${t('common.delete')}"><i class="fas fa-trash"></i></button>` : ''}
        </div>
        <p class="hint mt-2">${t('settings.logo_hint')}</p>
      </section>
    </div>`)
  const input = root.querySelector('[data-logo-input]')
  input.addEventListener('change', async () => {
    const file = input.files[0]
    if (!file) return
    const fd = new FormData()
    fd.set('logo', file)
    try { await api.upload('/api/org/branding/logo', fd); toast(t('common.saved')); rerender() } catch (err) { showError(err) }
  })
  bind(root, {
    actions: {
      'pick-logo': () => input.click(),
      'remove-logo': async () => {
        try { await api.del('/api/org/branding/logo'); rerender() } catch (err) { showError(err) }
      }
    },
    forms: {
      branding: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        try { await api.put('/api/org/branding', formData(form)); toast(t('common.saved')) } catch (err) { showError(err, form) }
      })
    }
  })
}

// ---------------- Plan ----------------
async function plan(root, { isCurrent, query }) {
  const [me, sub] = await Promise.all([refreshMe(), api.get('/api/subscription')])
  if (!isCurrent()) return
  const { plan: p, usage, org } = me
  const plans = store.ref.plans
  const online = sub.online_payments && canManageTeam()
  const mail = (planName) => `mailto:${me.sales_email}?subject=${encodeURIComponent(`TrustiqLegal ${planName} – ${org.name}`)}`
  const limit = (n) => (n == null ? t('common.unlimited') : fmtNumber(n))
  const row = (label, used, max) => html`<tr><td>${label}</td><td class="font-semibold">${fmtNumber(used)}</td><td>${limit(max)}</td></tr>`
  const result = query.get('payment')
  const RESULT = {
    success: ['bg-emerald-50 text-emerald-800', 'fa-circle-check', 'subscription.paid'],
    pending: ['bg-amber-50 text-amber-800', 'fa-hourglass-half', 'subscription.pending'],
    failed: ['bg-red-50 text-red-700', 'fa-circle-xmark', 'subscription.failed']
  }[result]
  const priceLabel = (id) => (me.prices?.[id] ? `${me.prices[id].currency} ${fmtNumber(me.prices[id].amount)} ${t('subscription.per_month')}` : t(`plan.price_${id}`))
  const action = (id) => {
    if (id === 'enterprise') return html`<a class="btn btn-outline btn-sm" href="${mail(plans[id].name)}">${t('settings.contact_upgrade')}</a>`
    if (online) return html`<button class="btn ${org.plan === id ? 'btn-outline' : 'btn-primary'} btn-sm" data-action="checkout" data-plan="${id}"><i class="fas fa-credit-card"></i>${org.plan === id ? t('subscription.renew_month') : t('subscription.pay_now')}</button>`
    return org.plan === id ? '' : html`<a class="btn btn-outline btn-sm" href="${mail(plans[id].name)}">${t('settings.request_plan')}</a>`
  }
  render(root, html`
    <div class="space-y-6 max-w-5xl">
      ${RESULT ? html`<div class="rounded-lg px-4 py-3 text-sm ${RESULT[0]}"><i class="fas ${RESULT[1]}"></i> ${t(RESULT[2])}</div>` : ''}
      <section class="card card-pad">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-wide text-slate-500">${t('settings.current_plan')}</p>
            <h2 class="text-2xl font-bold">${t(`plan.${p.id}`)}</h2>
            ${org.plan === 'trial' && org.trial_ends_at ? html`<p class="text-sm ${org.trial_expired ? 'text-red-600' : 'text-slate-500'}">${org.trial_expired ? t('trial.expired') : t('settings.trial_ends', { date: fmtDate(org.trial_ends_at) })}</p>` : ''}
            ${org.plan !== 'trial' && org.plan_expires_at ? html`<p class="text-sm ${org.subscription_expired ? 'text-red-600' : 'text-slate-500'}">${org.subscription_expired ? t('subscription.expired_on', { date: fmtDate(org.plan_expires_at) }) : t('subscription.active_until', { date: fmtDate(org.plan_expires_at) })}</p>` : ''}
          </div>
          ${online ? '' : html`<a class="btn btn-primary" href="${mail(org.plan === 'trial' ? 'Professional' : 'upgrade')}"><i class="fas fa-envelope"></i>${t('settings.contact_upgrade')}</a>`}
        </div>
        <table class="table mt-6"><thead><tr><th>${t('settings.usage_item')}</th><th>${t('settings.used')}</th><th>${t('settings.limit')}</th></tr></thead><tbody>
          ${row(t('usage.open_cases'), usage.active_cases, p.maxActiveCases)}
          ${row(t('usage.documents_month'), usage.documents_this_month, p.documentsPerMonth)}
          ${row(t('usage.ai_month'), usage.ai_requests_this_month, p.aiRequestsPerMonth)}
          <tr><td>${t('analysis.advanced')}</td><td colspan="2">${p.advancedAnalysis ? html`<i class="fas fa-check text-emerald-600"></i>` : html`<i class="fas fa-xmark text-slate-400"></i>`}</td></tr>
        </tbody></table>
      </section>
      <section class="grid md:grid-cols-3 gap-4">
        ${['starter', 'professional', 'enterprise'].map((id) => html`<div class="card card-pad flex flex-col ${org.plan === id ? 'ring-2 ring-brand-500' : ''}">
          <h3 class="font-bold text-lg">${t(`plan.${id}`)}</h3>
          <p class="text-2xl font-extrabold my-2">${priceLabel(id)}</p>
          <ul class="text-sm text-slate-600 space-y-1 mb-4 flex-1">
            <li>${t('usage.open_cases')}: ${limit(plans[id].maxActiveCases)}</li>
            <li>${t('usage.documents_month')}: ${limit(plans[id].documentsPerMonth)}</li>
            <li>${t('usage.ai_month')}: ${limit(plans[id].aiRequestsPerMonth)}</li>
            <li>${t('analysis.advanced')}: ${plans[id].advancedAnalysis ? '✓' : '—'}</li>
          </ul>
          <div class="flex flex-wrap items-center gap-2">${org.plan === id ? html`<span class="badge bg-brand-50 text-brand-700">${t('settings.current_plan')}</span>` : ''}${action(id)}</div>
        </div>`)}
      </section>
      <p class="text-xs text-slate-500">${online ? t('subscription.note', { vat: sub.vat_percent }) : t('settings.billing_note')}</p>
      ${sub.payments.length ? html`<section class="card">
        <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('subscription.history')}</h2></div>
        <div class="overflow-x-auto"><table class="table text-sm">
          <thead><tr><th>${t('settings.when')}</th><th>${t('subscription.plan')}</th><th class="text-end">${t('billing.amount')}</th><th>${t('common.status')}</th><th>${t('subscription.period_end')}</th></tr></thead>
          <tbody>${sub.payments.map((x) => html`<tr>
            <td class="whitespace-nowrap">${fmtDateTime(x.created_at)}</td><td>${t(`plan.${x.plan}`)}</td>
            <td class="text-end whitespace-nowrap">${x.currency} ${Number(x.amount).toFixed(3)}</td>
            <td><span class="badge ${{ paid: 'bg-emerald-100 text-emerald-800', initiated: 'bg-amber-100 text-amber-800' }[x.status] || 'bg-slate-100 text-slate-600'}">${t(`payment_status.${x.status}`)}</span></td>
            <td>${x.period_end ? fmtDate(x.period_end) : '—'}</td></tr>`)}</tbody>
        </table></div>
      </section>` : ''}
    </div>`)
  bind(root, {
    actions: {
      checkout: (el) => {
        const id = el.dataset.plan
        const price = me.prices[id]
        const total = Math.round(price.amount * (1 + (sub.vat_percent || 0) / 100) * 1000) / 1000
        const m = modal({
          title: t('subscription.checkout_title', { plan: t(`plan.${id}`) }),
          size: 'sm',
          body: html`<form data-form="pay" class="space-y-4" novalidate>
            <dl class="text-sm space-y-1">
              <div class="flex justify-between"><dt>${t(`plan.${id}`)} · ${t('subscription.one_month')}</dt><dd>${price.currency} ${price.amount.toFixed(3)}</dd></div>
              ${sub.vat_percent ? html`<div class="flex justify-between"><dt>${t('billing.vat')} (${sub.vat_percent}%)</dt><dd>${price.currency} ${(total - price.amount).toFixed(3)}</dd></div>` : ''}
              <div class="flex justify-between font-bold border-t border-slate-100 pt-1"><dt>${t('billing.total')}</dt><dd>${price.currency} ${total.toFixed(3)}</dd></div>
            </dl>
            <div class="grid grid-cols-3 gap-2">
              ${inputField({ name: 'phone_country_code', label: t('subscription.country_code'), value: '968', attrs: 'dir="ltr" inputmode="numeric" maxlength="4"' })}
              ${inputField({ name: 'phone', label: t('subscription.phone'), cls: 'col-span-2', attrs: 'dir="ltr" inputmode="numeric" autocomplete="tel-national"' })}
            </div>
            <p class="hint">${t('subscription.redirect_note')}</p>
            ${formActions(t('subscription.continue_to_payment'))}
          </form>`,
          forms: {
            pay: (form) => busy(submitButton(form), async () => {
              const d = formData(form)
              try {
                const res = await api.post('/api/subscription/checkout', { plan: id, phone: d.phone ? d.phone.replace(/\D/g, '') : null, phone_country_code: d.phone ? d.phone_country_code : null })
                location.href = res.checkout_url
              } catch (err) { showError(err, form) }
            })
          }
        })
      }
    }
  })
}

// ---------------- Audit ----------------
async function audit(root, { query, isCurrent }) {
  const page = Number(query.get('page')) || 1
  const res = await api.get('/api/org/audit' + qs({ page }))
  if (!isCurrent()) return
  render(root, html`
    <section class="card">
      <div class="px-5 py-4 border-b border-slate-100"><h2 class="font-semibold">${t('settings.audit')}</h2><p class="text-xs text-slate-500">${t('settings.audit_help')}</p></div>
      <div class="overflow-x-auto"><table class="table">
        <thead><tr><th>${t('settings.when')}</th><th>${t('settings.who')}</th><th>${t('settings.action')}</th><th>${t('settings.ip')}</th></tr></thead>
        <tbody>${res.items.map((a) => html`<tr>
          <td class="text-xs whitespace-nowrap">${fmtDateTime(a.created_at)}</td>
          <td class="text-sm">${a.user_name || '—'}<div class="text-xs text-slate-400" dir="ltr">${a.user_email || ''}</div></td>
          <td class="text-sm"><span class="font-mono text-xs bg-slate-100 rounded px-1.5 py-0.5">${a.action}</span>${a.entity_type ? html` <span class="text-xs text-slate-500">${a.entity_type}</span>` : ''}</td>
          <td class="text-xs text-slate-500 font-mono">${a.ip || ''}</td>
        </tr>`)}</tbody>
      </table></div>
      ${pagination(res)}
    </section>`)
  bind(root, { actions: { page: (el) => (location.hash = `#/settings?tab=audit&page=${el.dataset.page}`) } })
}
