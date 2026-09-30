import { api } from '../api.js'
import { bind, html, render, renderRichText } from '../dom.js'
import { fmtRelative, getLang, t } from '../i18n.js'
import { aiEnabled, readOnly, refOptions, store } from '../store.js'
import { aiDisclaimer, confirmDialog, emptyState, selectField, showError, toast } from '../ui.js'
import { searchPicker, wirePickers } from './pickers.js'

const SUGGESTIONS = ['ai.suggest_1', 'ai.suggest_2', 'ai.suggest_3', 'ai.suggest_4']

export async function assistantView(root, { params, query, isCurrent }) {
  if (!aiEnabled()) {
    render(root, html`<div class="card">${emptyState('fa-wand-magic-sparkles', t('nav.assistant'), t('ai.not_configured_banner'))}</div>`)
    return
  }
  const [convs, current] = await Promise.all([
    api.get('/api/ai/conversations'),
    params.id ? api.get(`/api/ai/conversations/${params.id}`) : Promise.resolve(null)
  ])
  if (!isCurrent()) return
  const presetCase = query.get('case')
  let presetCaseLabel = ''
  if (presetCase && !current) {
    try {
      const { case: k } = await api.get(`/api/cases/${presetCase}`)
      presetCaseLabel = `${k.reference} · ${k.title}`
    } catch { /* ignore */ }
  }
  if (!isCurrent()) return

  const state = {
    conversationId: current?.conversation.id || null,
    messages: current?.messages || [],
    sending: false
  }
  const ro = readOnly()

  render(root, html`
    <div class="grid lg:grid-cols-4 gap-6 lg:h-[calc(100vh-8rem)]">
      <aside class="card flex flex-col min-h-0 lg:col-span-1 max-h-72 lg:max-h-none">
        <div class="p-3 border-b border-slate-100">
          <a href="#/assistant" class="btn btn-primary w-full"><i class="fas fa-plus"></i>${t('ai.new_chat')}</a>
        </div>
        <ul class="flex-1 overflow-y-auto divide-y divide-slate-100">
          ${convs.items.length ? convs.items.map((c) => html`<li class="group flex items-center ${c.id === state.conversationId ? 'bg-brand-50' : 'hover:bg-slate-50'}">
            <a href="#/assistant/${c.id}" class="flex-1 min-w-0 px-4 py-3">
              <div class="text-sm font-medium truncate" dir="auto">${c.title}</div>
              <div class="text-xs text-slate-400">${c.case_reference ? c.case_reference + ' · ' : ''}${fmtRelative(c.updated_at)}</div>
            </a>
            <button class="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 focus:opacity-100 me-1" data-action="delete-conv" data-id="${c.id}" aria-label="${t('common.delete')}"><i class="fas fa-trash text-xs"></i></button>
          </li>`) : html`<li class="px-4 py-6 text-sm text-slate-500">${t('ai.no_conversations')}</li>`}
        </ul>
      </aside>

      <section class="card flex flex-col min-h-[70vh] lg:min-h-0 lg:col-span-3">
        <div class="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h1 class="font-semibold truncate" dir="auto">${current ? current.conversation.title : t('ai.new_chat')}</h1>
          ${current?.conversation.case_id ? html`<a href="#/cases/${current.conversation.case_id}" class="text-xs text-brand-600 hover:underline"><i class="fas fa-folder-open"></i> ${t('ai.linked_case')}</a>` : ''}
        </div>
        <div class="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50" data-messages aria-live="polite"></div>
        ${ro ? '' : html`<form data-form="send" class="p-4 border-t border-slate-100 space-y-3">
          ${!state.conversationId ? html`<div class="grid sm:grid-cols-2 gap-3">
            ${searchPicker({ name: 'case_id', label: t('ai.case_context'), value: presetCase, valueLabel: presetCaseLabel })}
            ${selectField({ name: 'jurisdiction', label: t('common.jurisdiction'), options: refOptions('jurisdictions'), value: store.me.org.default_jurisdiction })}
          </div>` : ''}
          <label class="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="library_only" /> <i class="fas fa-book-open"></i>${t('ai.library_only')}</label>
          <div class="flex gap-2 items-end">
            <textarea name="message" rows="2" class="input flex-1 resize-none" dir="auto" placeholder="${t('ai.placeholder')}" maxlength="8000" required aria-label="${t('ai.placeholder')}"></textarea>
            <button type="submit" class="btn btn-primary h-11" aria-label="${t('ai.send')}"><i class="fas fa-paper-plane rtl:-scale-x-100"></i><span class="hidden sm:inline">${t('ai.send')}</span></button>
          </div>
          ${aiDisclaimer()}
        </form>`}
      </section>
    </div>`)

  const list = root.querySelector('[data-messages]')
  const form = root.querySelector('form[data-form="send"]')
  const textarea = form?.elements.message

  const drawMessages = () => {
    if (!state.messages.length) {
      render(list, html`<div class="max-w-xl mx-auto text-center pt-8">
        <div class="mx-auto w-12 h-12 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center mb-3"><i class="fas fa-wand-magic-sparkles"></i></div>
        <h2 class="font-semibold text-lg">${t('ai.welcome_title')}</h2>
        <p class="text-sm text-slate-500 mt-1 mb-5">${t('ai.welcome_text')}</p>
        ${ro ? '' : html`<div class="grid sm:grid-cols-2 gap-2">${SUGGESTIONS.map((k) => html`<button class="card px-4 py-3 text-sm text-start hover:border-brand-300" data-action="suggest" data-text="${t(k)}">${t(k)}</button>`)}</div>`}
      </div>`)
      return
    }
    render(list, html`${state.messages.map((m) => html`
      <div class="flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}">
        <div class="chat-msg ${m.role}" dir="auto">${m.role === 'assistant' ? renderRichText(m.content) : m.content}</div>
        ${m.role === 'assistant' && m.sources?.length ? html`<div class="mt-2 max-w-3xl w-full">
          <p class="text-xs font-semibold text-slate-500 mb-1"><i class="fas fa-book-open"></i> ${t('ai.sources')}</p>
          <ul class="flex flex-wrap gap-1.5">${m.sources.map((src) => html`<li><a href="#/library/${src.source_id}" class="badge ${src.status === 'repealed' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'} hover:underline" dir="auto" title="${src.status === 'repealed' ? t('law_status.repealed') : ''}">[${src.ref}] ${src.citation}</a></li>`)}</ul>
        </div>` : ''}
        ${m.role === 'assistant' && m.library_matches === 0 && !m.sources?.length ? html`<p class="text-xs text-slate-400 mt-1"><i class="fas fa-circle-info"></i> ${t('ai.no_library_matches')} <a class="underline" href="#/library">${t('nav.library')}</a></p>` : ''}
        ${m.role === 'assistant' && !m.pending ? html`<button class="text-xs text-slate-400 hover:text-slate-700 mt-1" data-action="copy" data-idx="${state.messages.indexOf(m)}"><i class="fas fa-copy"></i> ${t('common.copy')}</button>` : ''}
      </div>`)}
      ${state.sending ? html`<div class="flex items-start"><div class="chat-msg assistant text-slate-500"><i class="fas fa-circle-notch fa-spin"></i> ${t('ai.thinking')}</div></div>` : ''}`)
    list.scrollTop = list.scrollHeight
  }
  drawMessages()
  if (form) wirePickers(form)

  const send = async (text) => {
    if (state.sending || !text.trim()) return
    state.sending = true
    state.messages.push({ role: 'user', content: text })
    drawMessages()
    const btn = form.querySelector('[type=submit]')
    btn.disabled = true
    try {
      const body = { message: text, language: getLang(), library_only: !!form.elements.library_only?.checked }
      if (state.conversationId) body.conversation_id = state.conversationId
      else {
        const caseId = form.elements.case_id?.value
        if (caseId) body.case_id = caseId
        body.jurisdiction = form.elements.jurisdiction?.value
      }
      const res = await api.post('/api/ai/chat', body)
      if (!isCurrent()) return
      state.messages.push({ role: 'assistant', content: res.reply, sources: res.sources, library_matches: res.library_matches })
      textarea.value = ''
      if (!state.conversationId) {
        state.conversationId = res.conversation_id
        // Update the URL without re-rendering so the conversation appears in history on next visit.
        history.replaceState(null, '', `#/assistant/${res.conversation_id}`)
      }
    } catch (err) {
      state.messages.pop()
      textarea.value = text
      showError(err)
    } finally {
      state.sending = false
      btn.disabled = false
      drawMessages()
      textarea.focus()
    }
  }

  textarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      send(textarea.value)
    }
  })

  bind(root, {
    actions: {
      suggest: (el) => { textarea.value = el.dataset.text; textarea.focus() },
      copy: async (el) => {
        try {
          await navigator.clipboard.writeText(state.messages[Number(el.dataset.idx)].content)
          toast(t('common.copied'))
        } catch { toast(t('error.generic'), 'error') }
      },
      'delete-conv': async (el) => {
        if (!(await confirmDialog(t('ai.confirm_delete')))) return
        try {
          await api.del(`/api/ai/conversations/${el.dataset.id}`)
          if (el.dataset.id === state.conversationId) location.hash = '#/assistant'
          else el.closest('li').remove()
        } catch (err) { showError(err) }
      }
    },
    forms: { send: () => send(textarea.value) }
  })
  if (textarea && query.get('q') && !state.messages.length) textarea.value = t('ai.ask_about', { title: query.get('q') })
  textarea?.focus()
}
