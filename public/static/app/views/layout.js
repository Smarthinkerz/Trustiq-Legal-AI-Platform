import { api } from '../api.js'
import { $, $$, bind, html } from '../dom.js'
import { getLang, t } from '../i18n.js'
import { applyLanguage, signOut } from '../main.js'
import { store } from '../store.js'

const NAV = [
  ['dashboard', 'fa-gauge-high', '/dashboard'],
  ['cases', 'fa-folder-open', '/cases'],
  ['clients', 'fa-address-book', '/clients'],
  ['documents', 'fa-file-lines', '/documents'],
  ['assistant', 'fa-wand-magic-sparkles', '/assistant'],
  ['calendar', 'fa-calendar-days', '/calendar'],
  ['settings', 'fa-gear', '/settings']
]

function trialBanner() {
  const { org } = store.me
  if (org.plan !== 'trial' || !org.trial_ends_at) return ''
  const days = Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / 86400000)
  const mail = `mailto:${store.me.sales_email}?subject=${encodeURIComponent('TrustiqLegal plan – ' + org.name)}`
  if (org.trial_expired) {
    return html`<div class="bg-red-600 text-white text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-3">
      <span><i class="fas fa-lock"></i> ${t('trial.expired')}</span>
      <a class="underline font-semibold" href="${mail}">${t('trial.contact_sales')}</a></div>`
  }
  if (days > 7) return ''
  return html`<div class="bg-amber-100 text-amber-900 text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-3">
    <span><i class="fas fa-hourglass-half"></i> ${t('trial.days_left', { days })}</span>
    <a class="underline font-semibold" href="#/settings?tab=plan">${t('trial.see_plans')}</a></div>`
}

export function layout() {
  const { user, org } = store.me
  const nav = [...NAV, ...(store.me.is_platform_admin ? [['admin', 'fa-screwdriver-wrench', '/admin']] : [])]
  const view = html`
  <div class="min-h-screen lg:flex">
    <aside id="sidebar" class="hidden lg:flex fixed lg:sticky top-0 start-0 z-40 h-screen w-64 shrink-0 flex-col bg-brand-900 text-white">
      <div class="h-16 flex items-center gap-2 px-5 font-bold text-lg border-b border-white/10">
        <i class="fas fa-scale-balanced text-gold-300"></i> TrustiqLegal
      </div>
      <nav class="flex-1 overflow-y-auto p-3 space-y-1" aria-label="${t('nav.main')}">
        ${nav.map(([key, icon, href]) => html`<a href="#${href}" class="nav-item" data-nav="${key}"><i class="fas ${icon} w-5 text-center"></i>${t(`nav.${key}`)}</a>`)}
      </nav>
      <div class="p-4 border-t border-white/10 text-xs text-slate-300">
        <div class="font-semibold text-white truncate">${org.name}</div>
        <div>${t(`plan.${store.me.plan.id}`)}</div>
      </div>
    </aside>
    <div id="sidebar-backdrop" class="hidden fixed inset-0 z-30 bg-slate-900/50 lg:hidden" data-action="layout-menu"></div>
    <div class="flex-1 min-w-0 flex flex-col">
      ${trialBanner()}
      <header class="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center justify-between gap-3 px-4 lg:px-8">
        <div class="flex items-center gap-3 min-w-0">
          <button class="btn btn-ghost lg:hidden" data-action="layout-menu" aria-label="${t('nav.menu')}"><i class="fas fa-bars"></i></button>
          <span class="font-semibold text-slate-700 truncate lg:hidden">TrustiqLegal</span>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-ghost" data-action="layout-lang" title="${t('nav.switch_language')}">
            <i class="fas fa-language"></i><span class="hidden sm:inline" lang="${getLang() === 'ar' ? 'en' : 'ar'}">${getLang() === 'ar' ? 'English' : 'العربية'}</span>
          </button>
          <div class="relative">
            <button class="btn btn-ghost" data-action="layout-user" aria-haspopup="true" aria-expanded="false">
              <span class="w-8 h-8 rounded-full bg-brand-100 text-brand-800 flex items-center justify-center text-xs font-bold">${initials(user.name)}</span>
              <span class="hidden sm:inline max-w-40 truncate">${user.name}</span>
              <i class="fas fa-chevron-down text-xs"></i>
            </button>
            <div id="user-menu" class="hidden absolute end-0 mt-2 w-60 card py-2 z-50">
              <div class="px-4 py-2 border-b border-slate-100 mb-1">
                <div class="text-sm font-semibold truncate">${user.name}</div>
                <div class="text-xs text-slate-500 truncate">${user.email}</div>
                <div class="text-xs text-slate-500">${t(`role.${user.role}`)}</div>
              </div>
              <a href="#/settings?tab=profile" class="block px-4 py-2 text-sm hover:bg-slate-50"><i class="fas fa-user w-5"></i>${t('settings.profile')}</a>
              <a href="mailto:${store.me.support_email}" class="block px-4 py-2 text-sm hover:bg-slate-50"><i class="fas fa-life-ring w-5"></i>${t('nav.support')}</a>
              <button class="block w-full text-start px-4 py-2 text-sm hover:bg-slate-50 text-red-600" data-action="layout-logout"><i class="fas fa-right-from-bracket w-5"></i>${t('auth.sign_out')}</button>
            </div>
          </div>
        </div>
      </header>
      <main id="view" class="flex-1 w-full max-w-7xl mx-auto px-4 lg:px-8 py-6 lg:py-8" tabindex="-1"></main>
    </div>
  </div>`
  queueMicrotask(() => {
    const root = document.getElementById('root')
    bind(root, {
      actions: {
        'layout-menu': toggleMenu,
        'layout-user': (el) => {
          const menu = $('#user-menu')
          menu.classList.toggle('hidden')
          el.setAttribute('aria-expanded', String(!menu.classList.contains('hidden')))
        },
        'layout-logout': () => signOut(),
        'layout-lang': async () => {
          const next = getLang() === 'ar' ? 'en' : 'ar'
          api.patch('/api/auth/me', { locale: next }).then((me) => { store.me = me }).catch(() => {})
          applyLanguage(next)
        }
      }
    })
    document.addEventListener('click', closeMenusOnOutsideClick)
  })
  return view
}

function closeMenusOnOutsideClick(e) {
  const menu = document.getElementById('user-menu')
  if (menu && !menu.classList.contains('hidden') && !e.target.closest('[data-action="layout-user"]') && !e.target.closest('#user-menu')) {
    menu.classList.add('hidden')
  }
}

function toggleMenu(force) {
  const sidebar = $('#sidebar')
  const backdrop = $('#sidebar-backdrop')
  const open = typeof force === 'boolean' ? force : sidebar.classList.contains('hidden')
  sidebar.classList.toggle('hidden', !open)
  sidebar.classList.toggle('flex', open)
  backdrop.classList.toggle('hidden', !open)
}

export function updateNav(active) {
  $$('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === active
    a.classList.toggle('active', on)
    if (on) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
  if (window.innerWidth < 1024 && $('#sidebar') && !$('#sidebar').classList.contains('hidden')) toggleMenu(false)
  $('#user-menu')?.classList.add('hidden')
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
