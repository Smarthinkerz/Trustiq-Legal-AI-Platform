import { api } from '../api.js'
import { bind, formData, html, raw, render } from '../dom.js'
import { getLang, setLang, t } from '../i18n.js'
import { navigate, remount, signedIn } from '../main.js'
import { busy, clearFieldErrors, inputField, showError, submitButton, toast } from '../ui.js'

function shell(title, subtitle, body, footer) {
  return html`
  <div class="min-h-screen flex flex-col bg-slate-50">
    <div class="flex items-center justify-between px-6 h-16">
      <a href="${getLang() === 'ar' ? '/ar' : '/'}" class="flex items-center gap-2 font-bold text-brand-900 text-lg"><i class="fas fa-scale-balanced text-gold-500"></i>TrustiqLegal</a>
      <button class="btn btn-ghost" data-action="lang"><i class="fas fa-language"></i><span>${getLang() === 'ar' ? 'English' : 'العربية'}</span></button>
    </div>
    <div class="flex-1 flex items-center justify-center px-4 py-10">
      <div class="w-full max-w-md">
        <div class="card p-8">
          <h1 class="text-2xl font-bold mb-1">${title}</h1>
          ${subtitle ? html`<p class="text-sm text-slate-500 mb-6">${subtitle}</p>` : html`<div class="mb-6"></div>`}
          ${body}
        </div>
        ${footer ? html`<div class="text-center text-sm text-slate-600 mt-6">${footer}</div>` : ''}
      </div>
    </div>
    <footer class="text-center text-xs text-slate-400 py-6">
      <a href="/terms" class="hover:underline">${t('auth.terms')}</a> · <a href="/privacy" class="hover:underline">${t('auth.privacy')}</a>
    </footer>
  </div>`
}

const langAction = { lang: () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); remount() } }

const passwordHint = () => t('auth.password_hint')

export async function loginView(root, { query }) {
  render(root, shell(t('auth.sign_in_title'), t('auth.sign_in_subtitle'), html`
    <form data-form="login" class="space-y-4" novalidate>
      ${inputField({ name: 'email', label: t('auth.email'), type: 'email', required: true, attrs: 'autocomplete="email" dir="ltr"' })}
      ${inputField({ name: 'password', label: t('auth.password'), type: 'password', required: true, attrs: 'autocomplete="current-password" dir="ltr"' })}
      <div class="flex justify-end"><a href="#/forgot-password" class="text-sm text-brand-600 hover:underline">${t('auth.forgot_link')}</a></div>
      <button type="submit" class="btn btn-primary w-full py-2.5">${t('auth.sign_in')}</button>
    </form>`,
    html`${t('auth.no_account')} <a href="#/register" class="font-semibold text-brand-600 hover:underline">${t('auth.start_trial')}</a>`))
  bind(root, {
    actions: langAction,
    forms: {
      login: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        try {
          const me = await api.post('/api/auth/login', formData(form))
          await signedIn(me, query.get('next'))
        } catch (err) {
          showError(err, form)
          form.elements.password.value = ''
        }
      })
    }
  })
}

export async function registerView(root) {
  render(root, shell(t('auth.register_title'), t('auth.register_subtitle'), html`
    <form data-form="register" class="space-y-4" novalidate>
      ${inputField({ name: 'firm_name', label: t('auth.firm_name'), required: true, attrs: 'autocomplete="organization"' })}
      ${inputField({ name: 'name', label: t('auth.full_name'), required: true, attrs: 'autocomplete="name"' })}
      ${inputField({ name: 'email', label: t('auth.work_email'), type: 'email', required: true, attrs: 'autocomplete="email" dir="ltr"' })}
      ${inputField({ name: 'password', label: t('auth.password'), type: 'password', required: true, hint: passwordHint(), attrs: 'autocomplete="new-password" minlength="10" dir="ltr"' })}
      <label class="flex items-start gap-2 text-sm text-slate-600">
        <input type="checkbox" name="accept_terms" class="mt-1" required />
        <span>${raw(t('auth.accept_terms_html'))}</span>
      </label>
      <button type="submit" class="btn btn-primary w-full py-2.5">${t('auth.create_account')}</button>
      <p class="text-xs text-slate-500 text-center">${t('auth.trial_note')}</p>
    </form>`,
    html`${t('auth.have_account')} <a href="#/login" class="font-semibold text-brand-600 hover:underline">${t('auth.sign_in')}</a>`))
  bind(root, {
    actions: langAction,
    forms: {
      register: (form) => busy(submitButton(form), async () => {
        clearFieldErrors(form)
        const data = formData(form)
        if (!data.accept_terms) return toast(t('auth.must_accept_terms'), 'error')
        try {
          const me = await api.post('/api/auth/register', { ...data, locale: getLang() })
          toast(t('auth.welcome', { name: me.user.name }))
          await signedIn(me)
        } catch (err) {
          showError(err, form)
        }
      })
    }
  })
}

export async function forgotView(root) {
  render(root, shell(t('auth.forgot_title'), t('auth.forgot_subtitle'), html`
    <form data-form="forgot" class="space-y-4" novalidate>
      ${inputField({ name: 'email', label: t('auth.email'), type: 'email', required: true, attrs: 'autocomplete="email" dir="ltr"' })}
      <button type="submit" class="btn btn-primary w-full py-2.5">${t('auth.send_reset')}</button>
    </form>`,
    html`<a href="#/login" class="font-semibold text-brand-600 hover:underline">${t('auth.back_to_sign_in')}</a>`))
  bind(root, {
    actions: langAction,
    forms: {
      forgot: (form) => busy(submitButton(form), async () => {
        try {
          await api.post('/api/auth/forgot-password', formData(form))
          render(form, html`<div class="rounded-lg bg-emerald-50 text-emerald-800 text-sm p-4"><i class="fas fa-envelope-circle-check"></i> ${t('auth.reset_sent')}</div>`)
        } catch (err) {
          showError(err, form)
        }
      })
    }
  })
}

export async function resetView(root, { query }) {
  const token = query.get('token') || ''
  render(root, shell(t('auth.reset_title'), t('auth.reset_subtitle'), html`
    <form data-form="reset" class="space-y-4" novalidate>
      ${inputField({ name: 'password', label: t('auth.new_password'), type: 'password', required: true, hint: passwordHint(), attrs: 'autocomplete="new-password" dir="ltr"' })}
      <button type="submit" class="btn btn-primary w-full py-2.5">${t('auth.set_password')}</button>
    </form>`))
  bind(root, {
    actions: langAction,
    forms: {
      reset: (form) => busy(submitButton(form), async () => {
        try {
          await api.post('/api/auth/reset-password', { token, password: formData(form).password })
          toast(t('auth.reset_done'))
          navigate('/login', { replace: true })
        } catch (err) {
          showError(err, form)
        }
      })
    }
  })
}

export async function acceptInviteView(root, { query, isCurrent }) {
  const token = query.get('token') || ''
  let invite
  try {
    invite = await api.get(`/api/auth/invite/${encodeURIComponent(token)}`)
  } catch {
    if (!isCurrent()) return
    render(root, shell(t('auth.invite_invalid_title'), t('auth.invite_invalid'), html`<a href="#/login" class="btn btn-primary w-full">${t('auth.sign_in')}</a>`))
    bind(root, { actions: langAction })
    return
  }
  if (!isCurrent()) return
  render(root, shell(t('auth.invite_title', { org: invite.org_name }), t('auth.invite_subtitle', { email: invite.email, role: t(`role.${invite.role}`) }), html`
    <form data-form="accept" class="space-y-4" novalidate>
      ${inputField({ name: 'name', label: t('auth.full_name'), required: true, attrs: 'autocomplete="name"' })}
      ${inputField({ name: 'password', label: t('auth.password'), type: 'password', required: true, hint: passwordHint(), attrs: 'autocomplete="new-password" dir="ltr"' })}
      <p class="text-xs text-slate-500">${raw(t('auth.accept_invite_terms_html'))}</p>
      <button type="submit" class="btn btn-primary w-full py-2.5">${t('auth.join')}</button>
    </form>`))
  bind(root, {
    actions: langAction,
    forms: {
      accept: (form) => busy(submitButton(form), async () => {
        try {
          const me = await api.post('/api/auth/accept-invite', { token, ...formData(form), locale: getLang() })
          toast(t('auth.welcome', { name: me.user.name }))
          await signedIn(me)
        } catch (err) {
          showError(err, form)
        }
      })
    }
  })
}
