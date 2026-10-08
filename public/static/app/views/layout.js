import { api } from '../api.js'
import { $, $$, bind, html, render } from '../dom.js'
import { getLang, t } from '../i18n.js'
import { applyLanguage, signOut } from '../main.js'
import { can, store } from '../store.js'
import { debounce } from '../ui.js'

const NAV = [
  ['dashboard', 'fa-gauge-high', '/dashboard'],
  ['cases', 'fa-folder-open', '/cases'],
  ['clients', 'fa-address-book', '/clients'],
  ['tasks', 'fa-list-check', '/tasks'],
  ['calendar', 'fa-calendar-days', '/calendar'],
  ['deadlines', 'fa-hourglass-half', '/deadlines'],
  ['documents', 'fa-file-lines', '/documents'],
  ['templates', 'fa-file-signature', '/templates'],
  ['signatures', 'fa-signature', '/signatures'],
  ['assistant', 'fa-wand-magic-sparkles', '/assistant'],
  ['library', 'fa-book-open', '/library'],
  ['website', 'fa-globe', '/website'],
  ['billing', 'fa-file-invoice-dollar', '/billing'],
  ['reports', 'fa-chart-line', '/reports', () => can('owner', 'admin')],
  ['settings', 'fa-gear', '/settings']
]

function subscriptionBanner() {
  const { org } = store.me
  if (org.plan === 'trial' || !org.plan_expires_at) return ''
  const days = Math.ceil((new Date(org.plan_expires_at).getTime() - Date.now()) / 86400000)
  if (org.subscription_expired) {
    return html`<div class="bg-red-600 text-white text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-3">
      <span><i class="fas fa-lock"></i> ${t('subscription.expired_banner')}</span>
      <a class="underline font-semibold" href="#/settings?tab=plan">${t('subscription.renew')}</a></div>`
  }
  if (days > 5) return ''
  return html`<div class="bg-amber-100 text-amber-900 text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-3">
    <span><i class="fas fa-hourglass-half"></i> ${t('subscription.ends_in', { days })}</span>
    <a class="underline font-semibold" href="#/settings?tab=plan">${t('subscription.renew')}</a></div>`
}

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
  const nav = [...NAV.filter(([, , , ok]) => !ok || ok()), ...(store.me.is_platform_admin ? [['admin', 'fa-screwdriver-wrench', '/admin']] : [])]
  if (user.role === 'client') return portalLayout()
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
      ${trialBanner()}${subscriptionBanner()}
      <header class="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center justify-between gap-3 px-4 lg:px-8">
        <div class="flex items-center gap-3 min-w-0">
          <button class="btn btn-ghost lg:hidden" data-action="layout-menu" aria-label="${t('nav.menu')}"><i class="fas fa-bars"></i></button>
          <div class="relative w-full max-w-md" data-global-search>
            <i class="fas fa-magnifying-glass absolute top-1/2 -translate-y-1/2 start-3 text-slate-400 text-sm"></i>
            <input type="search" class="input ps-9 py-1.5" id="global-search" placeholder="${t('search.placeholder')}" aria-label="${t('search.placeholder')}" autocomplete="off" />
            <div id="global-results" class="hidden absolute start-0 mt-2 w-[min(32rem,calc(100vw-2rem))] card py-2 z-50 max-h-[70vh] overflow-y-auto"></div>
          </div>
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
    wireGlobalSearch()
  })
  return view
}

// ---------- Global search ----------
function wireGlobalSearch() {
  const input = document.getElementById('global-search')
  const box = document.getElementById('global-results')
  if (!input) return
  let seq = 0
  const run = debounce(async () => {
    const q = input.value.trim()
    const mine = ++seq
    if (q.length < 2) { box.classList.add('hidden'); return }
    try {
      const r = await api.get(`/api/workspace/search?q=${encodeURIComponent(q)}`)
      if (mine !== seq) return
      const group = (key, icon, items, href, label) => items.length ? html`
        <div class="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">${t(key)}</div>
        ${items.map((i) => html`<a href="#${href(i)}" class="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50" data-search-hit><i class="fas ${icon} w-4 text-slate-400"></i><span class="truncate" dir="auto">${label(i)}</span></a>`)}` : ''
      const total = r.clients.length + r.cases.length + r.documents.length + r.tasks.length + r.library.length
      render(box, total ? html`
        ${group('nav.cases', 'fa-folder-open', r.cases, (i) => `/cases/${i.id}`, (i) => `${i.reference} · ${i.title}`)}
        ${group('nav.clients', 'fa-address-book', r.clients, (i) => `/clients/${i.id}`, (i) => i.name + (i.name_ar ? ` – ${i.name_ar}` : ''))}
        ${group('nav.documents', 'fa-file-lines', r.documents, (i) => `/documents/${i.id}`, (i) => i.title)}
        ${group('nav.tasks', 'fa-list-check', r.tasks, (i) => (i.case_id ? `/cases/${i.case_id}` : '/tasks'), (i) => i.title)}
        ${group('nav.library', 'fa-book-open', r.library, (i) => `/library/${i.id}`, (i) => i.title + (i.number ? ` (${i.number})` : ''))}`
        : html`<p class="px-4 py-3 text-sm text-slate-500">${t('common.no_results')}</p>`)
      box.classList.remove('hidden')
    } catch { /* ignore */ }
  }, 250)
  input.addEventListener('input', run)
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run() })
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { box.classList.add('hidden'); input.blur() } })
  box.addEventListener('click', (e) => { if (e.target.closest('[data-search-hit]')) { box.classList.add('hidden'); input.value = '' } })
}

// ---------- Client portal shell ----------
function portalLayout() {
  const { user } = store.me
  const firm = store.me.branding?.firm_name || store.me.org.name
  const view = html`
  <div class="min-h-screen flex flex-col">
    <header class="sticky top-0 z-20 bg-brand-900 text-white">
      <div class="max-w-5xl mx-auto h-16 px-4 flex items-center justify-between gap-3">
        <a href="#/portal" class="flex items-center gap-2 font-bold truncate"><i class="fas fa-scale-balanced text-gold-300"></i><span class="truncate">${firm}</span></a>
        <nav class="flex items-center gap-0.5 sm:gap-1 text-sm shrink-0">
          <a href="#/portal" class="px-3 py-2 rounded hover:bg-white/10" data-nav="portal" aria-label="${t('portal.home')}"><i class="fas fa-house sm:hidden"></i><span class="hidden sm:inline">${t('portal.home')}</span></a>
          <a href="#/portal/messages" class="px-3 py-2 rounded hover:bg-white/10" data-nav="portal-messages" aria-label="${t('portal.messages')}"><i class="fas fa-comments sm:hidden"></i><span class="hidden sm:inline">${t('portal.messages')}</span></a>
          <a href="#/portal/settings" class="px-3 py-2 rounded hover:bg-white/10" data-nav="portal-settings" aria-label="${t('nav.settings')}"><i class="fas fa-gear"></i></a>
          <button class="px-3 py-2 rounded hover:bg-white/10" data-action="layout-lang" title="${t('nav.switch_language')}" lang="${getLang() === 'ar' ? 'en' : 'ar'}">${getLang() === 'ar' ? 'EN' : 'ع'}</button>
          <button class="px-3 py-2 rounded hover:bg-white/10" data-action="layout-logout" aria-label="${t('auth.sign_out')}" title="${t('auth.sign_out')} (${user.email})"><i class="fas fa-right-from-bracket"></i></button>
        </nav>
      </div>
    </header>
    <main id="view" class="flex-1 w-full max-w-5xl mx-auto px-4 py-6 lg:py-8" tabindex="-1"></main>
    <footer class="text-center text-xs text-slate-400 py-6">${t('portal.powered_by')}</footer>
  </div>`
  queueMicrotask(() => {
    bind(document.getElementById('root'), {
      actions: {
        'layout-logout': () => signOut(),
        'layout-lang': async () => {
          const next = getLang() === 'ar' ? 'en' : 'ar'
          api.patch('/api/auth/me', { locale: next }).then((me) => { store.me = me }).catch(() => {})
          applyLanguage(next)
        }
      }
    })
  })
  return view
}

function closeMenusOnOutsideClick(e) {
  const menu = document.getElementById('user-menu')
  if (menu && !menu.classList.contains('hidden') && !e.target.closest('[data-action="layout-user"]') && !e.target.closest('#user-menu')) {
    menu.classList.add('hidden')
  }
  const results = document.getElementById('global-results')
  if (results && !e.target.closest('[data-global-search]')) results.classList.add('hidden')
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
