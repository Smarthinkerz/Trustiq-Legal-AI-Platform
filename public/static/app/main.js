import { api, onUnauthorized } from './api.js'
import { $, bind, html, render } from './dom.js'
import { getLang, initialLang, setLang, t } from './i18n.js'
import { store } from './store.js'
import { showError, spinner, toast } from './ui.js'
import * as authViews from './views/auth.js'
import { dashboardView } from './views/dashboard.js'
import { casesListView, caseDetailView } from './views/cases.js'
import { clientsListView, clientDetailView } from './views/clients.js'
import { documentsListView, documentDetailView } from './views/documents.js'
import { assistantView } from './views/assistant.js'
import { calendarView } from './views/calendar.js'
import { settingsView } from './views/settings.js'
import { adminView } from './views/admin.js'
import { layout, updateNav } from './views/layout.js'

const routes = [
  { path: '/login', view: authViews.loginView, public: true },
  { path: '/register', view: authViews.registerView, public: true },
  { path: '/forgot-password', view: authViews.forgotView, public: true },
  { path: '/reset-password', view: authViews.resetView, public: true, allowAuthed: true },
  { path: '/accept-invite', view: authViews.acceptInviteView, public: true, allowAuthed: true },
  { path: '/dashboard', view: dashboardView, nav: 'dashboard' },
  { path: '/cases', view: casesListView, nav: 'cases' },
  { path: '/cases/:id', view: caseDetailView, nav: 'cases' },
  { path: '/clients', view: clientsListView, nav: 'clients' },
  { path: '/clients/:id', view: clientDetailView, nav: 'clients' },
  { path: '/documents', view: documentsListView, nav: 'documents' },
  { path: '/documents/:id', view: documentDetailView, nav: 'documents' },
  { path: '/assistant', view: assistantView, nav: 'assistant' },
  { path: '/assistant/:id', view: assistantView, nav: 'assistant' },
  { path: '/calendar', view: calendarView, nav: 'calendar' },
  { path: '/settings', view: settingsView, nav: 'settings' },
  { path: '/admin', view: adminView, nav: 'admin' }
]

function match(path) {
  for (const r of routes) {
    const keys = []
    const re = new RegExp('^' + r.path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$')
    const m = path.match(re)
    if (m) return { route: r, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }
  }
  return null
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path
  if (location.hash === target) return route()
  if (replace) history.replaceState(null, '', target)
  else location.hash = target
  if (replace) route()
}

let renderSeq = 0
let shellMounted = false
let currentHash = location.hash
let leaveGuard = null

// A view with unsaved work registers a guard; returning false cancels in-app navigation.
export const setLeaveGuard = (fn) => { leaveGuard = fn }

function onHashChange() {
  if (leaveGuard && !leaveGuard()) {
    history.replaceState(null, '', currentHash)
    return
  }
  route()
}

export async function route() {
  const seq = ++renderSeq
  leaveGuard = null
  currentHash = location.hash
  // Dialogs belong to the view that opened them.
  document.getElementById('modal-root').replaceChildren()
  const [rawPath, rawQuery] = (location.hash.slice(1) || '/').split('?')
  const path = rawPath || '/'
  const query = new URLSearchParams(rawQuery || '')
  const matched = match(path)

  if (!matched) return navigate(store.me ? '/dashboard' : '/login', { replace: true })
  const { route: r, params } = matched

  if (!r.public && !store.me) {
    return navigate(`/login?next=${encodeURIComponent(path + (rawQuery ? '?' + rawQuery : ''))}`, { replace: true })
  }
  if (r.public && store.me && !r.allowAuthed) return navigate('/dashboard', { replace: true })

  const root = document.getElementById('root')
  let container
  if (r.public) {
    shellMounted = false
    container = root
  } else {
    if (!shellMounted) {
      render(root, layout())
      shellMounted = true
    }
    updateNav(r.nav)
    container = $('#view')
    render(container, spinner())
    window.scrollTo(0, 0)
  }
  const ctx = {
    params,
    query,
    isCurrent: () => seq === renderSeq,
    rerender: () => route()
  }
  try {
    await r.view(container, ctx)
  } catch (err) {
    if (!ctx.isCurrent()) return
    if (err?.status === 404) {
      render(container, html`<div class="card card-pad text-center py-16"><h2 class="text-lg font-semibold">${t('error.not_found')}</h2><a class="btn btn-outline mt-4" href="#/dashboard">${t('nav.dashboard')}</a></div>`)
    } else {
      render(container, html`<div class="card card-pad text-center py-16"><p class="text-slate-600">${t('error.load_failed')}</p><button class="btn btn-outline mt-4" data-action="retry">${t('common.retry')}</button></div>`)
      bind(container, { actions: { retry: () => route() } })
      if (err?.status !== 401) showError(err)
    }
  }
}

export async function refreshMe() {
  store.me = await api.get('/api/auth/me')
  return store.me
}

// Re-renders everything after a language switch or session change.
export function remount() {
  shellMounted = false
  route()
}

export function applyLanguage(lang) {
  setLang(lang)
  remount()
}

export async function signedIn(me, next) {
  store.me = me
  if (me.user.locale && me.user.locale !== getLang()) setLang(me.user.locale)
  shellMounted = false
  navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard', { replace: true })
}

export async function signOut() {
  try { await api.post('/api/auth/logout') } catch {}
  store.me = null
  shellMounted = false
  navigate('/login', { replace: true })
}

onUnauthorized(() => {
  if (!store.me) return
  store.me = null
  shellMounted = false
  toast(t('auth.session_expired'), 'info')
  navigate('/login', { replace: true })
})

async function boot() {
  setLang(initialLang())
  const [ref, me] = await Promise.all([
    api.get('/api/reference').catch(() => null),
    api.get('/api/auth/me').catch(() => null)
  ])
  store.ref = ref
  if (me) {
    store.me = me
    const urlLang = new URLSearchParams(location.hash.split('?')[1] || '').get('lang')
    if (!urlLang && me.user.locale) setLang(me.user.locale)
  }
  if (!store.ref) {
    const root = document.getElementById('root')
    render(root, html`<div class="min-h-screen flex items-center justify-center p-6 text-center"><div><p class="text-slate-700 mb-4">${t('error.network')}</p><button class="btn btn-primary" data-action="reload">${t('common.retry')}</button></div></div>`)
    bind(root, { actions: { reload: () => location.reload() } })
    return
  }
  window.addEventListener('hashchange', onHashChange)
  route()
}

boot()
