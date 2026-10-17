// TrustiqLegal task pane for Microsoft Word. Signs in with an API key and calls /api/v1 on this server.
;(function () {
  'use strict'

  const KEY_STORE = 'tq_addin_key'
  const T = {
    en: {
      connectTitle: 'Connect to your firm',
      connectHelp: 'In TrustiqLegal, open Settings, API keys, and create a key for Word. Paste it here. It stays on this computer.',
      apiKey: 'API key', connect: 'Connect', disconnect: 'Disconnect', connecting: 'Connecting…',
      clauses: 'Clauses', saveToCase: 'Save to case', search: 'Search clauses', language: 'Language',
      english: 'English', arabic: 'Arabic', insert: 'Insert', inserted: 'Inserted into the document.',
      noClauses: 'No clauses match.', noWording: 'This clause has no wording in that language.',
      newClause: 'Save selection as a clause', clauseTitle: 'Clause title', saveClause: 'Save clause',
      clauseSaved: 'Saved to the clause bank.', selectFirst: 'Select the wording in the document first.',
      caseSearch: 'Find a case', chooseCase: 'Choose a case', docTitle: 'Document title (optional)',
      saveFile: 'Save this Word file to the case', saving: 'Saving…', saved: 'Saved to the case.', openInApp: 'Open in TrustiqLegal',
      noCases: 'No cases match.', outsideWord: 'Open this pane from Word to insert and save documents.',
      readOnly: 'This key is read-only. Ask the firm owner for a read and write key to save.'
    },
    ar: {
      connectTitle: 'الربط بمكتبك',
      connectHelp: 'في ترستيك ليغال افتح الإعدادات ثم مفاتيح الواجهة البرمجية وأنشئ مفتاحا لبرنامج Word، ثم الصقه هنا. يبقى المفتاح على هذا الجهاز.',
      apiKey: 'مفتاح الواجهة البرمجية', connect: 'ربط', disconnect: 'قطع الربط', connecting: 'جار الربط…',
      clauses: 'البنود', saveToCase: 'الحفظ في قضية', search: 'ابحث في البنود', language: 'اللغة',
      english: 'الإنجليزية', arabic: 'العربية', insert: 'إدراج', inserted: 'أدرج في المستند.',
      noClauses: 'لا توجد بنود مطابقة.', noWording: 'لا توجد صياغة لهذا البند بتلك اللغة.',
      newClause: 'حفظ النص المحدد كبند', clauseTitle: 'عنوان البند', saveClause: 'حفظ البند',
      clauseSaved: 'حفظ في بنك البنود.', selectFirst: 'حدد النص في المستند أولا.',
      caseSearch: 'ابحث عن قضية', chooseCase: 'اختر قضية', docTitle: 'عنوان المستند (اختياري)',
      saveFile: 'احفظ ملف Word هذا في القضية', saving: 'جار الحفظ…', saved: 'حفظ في القضية.', openInApp: 'افتح في ترستيك ليغال',
      noCases: 'لا توجد قضايا مطابقة.', outsideWord: 'افتح هذه اللوحة من برنامج Word لإدراج المستندات وحفظها.',
      readOnly: 'هذا المفتاح للقراءة فقط. اطلب من مالك المكتب مفتاحا للقراءة والكتابة للحفظ.'
    }
  }

  let lang = 'en'
  let inWord = false
  let tab = 'clauses'
  let me = null
  const t = (k) => T[lang][k] || T.en[k]
  const root = () => document.getElementById('root')

  const store = {
    get() { try { return localStorage.getItem(KEY_STORE) } catch { return null } },
    set(v) { try { localStorage.setItem(KEY_STORE, v) } catch { /* private mode: key lasts for this pane only */ } },
    clear() { try { localStorage.removeItem(KEY_STORE) } catch { /* ignore */ } }
  }
  let apiKey = null

  // Builds an element; text is always set as text, never as HTML.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
      else if (k === 'text') el.textContent = v
      else el.setAttribute(k, v === true ? '' : String(v))
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)))
    return el
  }

  async function api(method, path, body) {
    const headers = { authorization: `Bearer ${apiKey}` }
    const init = { method, headers }
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) { init.body = JSON.stringify(body); headers['content-type'] = 'application/json' }
    const res = await fetch(`/api/v1${path}`, init)
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : {}
    if (!res.ok) {
      const err = new Error((data.error && data.error.message) || `Request failed (${res.status})`)
      err.status = res.status
      throw err
    }
    return data
  }

  const note = (el, msg, kind) => { el.textContent = msg || ''; el.className = `note ${kind || ''}` }
  const errorText = (e) => (e.status === 403 && /read-only/i.test(e.message) ? t('readOnly') : e.message)

  function render() {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    const who = document.getElementById('who')
    who.textContent = me ? me.organization.name : ''
    const r = root()
    r.replaceChildren()
    if (!me) return r.append(connectView())
    if (!inWord) r.append(h('p', { class: 'note warn', text: t('outsideWord') }))
    r.append(
      h('nav', { class: 'tabs' },
        h('button', { class: tab === 'clauses' ? 'active' : '', onclick: () => { tab = 'clauses'; render() }, text: t('clauses') }),
        h('button', { class: tab === 'case' ? 'active' : '', onclick: () => { tab = 'case'; render() }, text: t('saveToCase') }),
        h('button', { class: 'link', onclick: () => { store.clear(); apiKey = null; me = null; render() }, text: t('disconnect') })),
      tab === 'clauses' ? clausesView() : caseView())
  }

  function connectView() {
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'tq_live_…', 'aria-label': t('apiKey') })
    const msg = h('p', { class: 'note' })
    const btn = h('button', { class: 'primary', text: t('connect') })
    const go = async () => {
      const key = input.value.trim()
      if (!key) return
      btn.disabled = true; note(msg, t('connecting'))
      apiKey = key
      try {
        me = await api('GET', '/me')
        store.set(key)
        render()
      } catch (e) {
        apiKey = null; btn.disabled = false; note(msg, e.message, 'error')
      }
    }
    btn.addEventListener('click', go)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    return h('section', {}, h('h2', { text: t('connectTitle') }), h('p', { class: 'muted', text: t('connectHelp') }), h('label', {}, t('apiKey'), input), btn, msg)
  }

  // ---------- Clause bank ----------

  function clausesView() {
    let wording = lang
    const q = h('input', { type: 'search', placeholder: t('search'), 'aria-label': t('search') })
    const pick = h('select', { 'aria-label': t('language') },
      h('option', { value: 'en', text: t('english'), selected: wording === 'en' }),
      h('option', { value: 'ar', text: t('arabic'), selected: wording === 'ar' }))
    const list = h('div', { class: 'list' })
    const msg = h('p', { class: 'note' })
    let items = []
    let timer = null

    const show = () => {
      list.replaceChildren()
      if (!items.length) return list.append(h('p', { class: 'muted', text: t('noClauses') }))
      for (const c of items) {
        const text = wording === 'ar' ? c.body_ar : c.body_en
        list.append(h('article', { class: 'item' },
          h('div', { class: 'row' }, h('strong', { text: c.title }), h('span', { class: 'tag', text: c.category })),
          h('p', { class: 'preview', dir: wording === 'ar' ? 'rtl' : 'ltr', text: text ? text.slice(0, 240) : t('noWording') }),
          h('button', { disabled: !text || !inWord, onclick: () => insertClause(c, text, wording, msg), text: t('insert') })))
      }
    }
    const load = async () => {
      try {
        const params = new URLSearchParams()
        if (q.value.trim()) params.set('q', q.value.trim())
        items = (await api('GET', `/clauses?${params}`)).items
        show()
      } catch (e) { note(msg, errorText(e), 'error') }
    }
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250) })
    pick.addEventListener('change', () => { wording = pick.value; show() })
    load()
    return h('section', {}, h('div', { class: 'row' }, q, pick), msg, list, newClauseForm())
  }

  async function insertClause(clause, text, wording, msg) {
    try {
      await Word.run(async (ctx) => {
        const range = ctx.document.getSelection().insertText(text, 'Replace')
        // Arabic wording reads right to left; English left to right.
        if (Office.context.requirements.isSetSupported('WordApiDesktop', '1.1')) {
          const paras = range.paragraphs
          paras.load('items')
          await ctx.sync()
          for (const p of paras.items) p.readingOrder = wording === 'ar' ? 'RightToLeft' : 'LeftToRight'
        }
        range.select('End')
        await ctx.sync()
      })
      note(msg, t('inserted'), 'ok')
      api('POST', `/clauses/${clause.id}/used`).catch(() => { /* read-only keys cannot count uses */ })
    } catch (e) { note(msg, e.message, 'error') }
  }

  function newClauseForm() {
    const title = h('input', { type: 'text', maxlength: 200, 'aria-label': t('clauseTitle'), placeholder: t('clauseTitle') })
    const msg = h('p', { class: 'note' })
    const save = async () => {
      try {
        const text = await selectedText()
        if (!text) return note(msg, t('selectFirst'), 'error')
        const arabic = /[؀-ۿ]/.test(text) && (text.match(/[؀-ۿ]/g) || []).length > text.length / 4
        await api('POST', '/clauses', { title: title.value.trim() || text.slice(0, 60), category: 'general', [arabic ? 'body_ar' : 'body_en']: text })
        title.value = ''
        note(msg, t('clauseSaved'), 'ok')
      } catch (e) { note(msg, errorText(e), 'error') }
    }
    return h('details', { class: 'box' }, h('summary', { text: t('newClause') }), title, h('button', { disabled: !inWord, onclick: save, text: t('saveClause') }), msg)
  }

  function selectedText() {
    return Word.run(async (ctx) => {
      const sel = ctx.document.getSelection()
      sel.load('text')
      await ctx.sync()
      return (sel.text || '').trim()
    })
  }

  // ---------- Save the open document to a case ----------

  function caseView() {
    const q = h('input', { type: 'search', placeholder: t('caseSearch'), 'aria-label': t('caseSearch') })
    const cases = h('select', { 'aria-label': t('chooseCase') }, h('option', { value: '', text: t('chooseCase') }))
    const title = h('input', { type: 'text', maxlength: 300, placeholder: t('docTitle'), 'aria-label': t('docTitle') })
    const msg = h('p', { class: 'note' })
    const btn = h('button', { class: 'primary', disabled: true, text: t('saveFile') })
    let timer = null
    const load = async () => {
      try {
        const params = new URLSearchParams({ pageSize: '50' })
        if (q.value.trim()) params.set('q', q.value.trim())
        const { items } = await api('GET', `/cases?${params}`)
        cases.replaceChildren(h('option', { value: '', text: items.length ? t('chooseCase') : t('noCases') }),
          ...items.map((c) => h('option', { value: c.id, text: [c.reference, c.title, c.client_name].filter(Boolean).join(' · ') })))
        btn.disabled = true
      } catch (e) { note(msg, errorText(e), 'error') }
    }
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250) })
    cases.addEventListener('change', () => { btn.disabled = !cases.value || !inWord })
    btn.addEventListener('click', async () => {
      btn.disabled = true; note(msg, t('saving'))
      try {
        const bytes = await documentBytes()
        const name = (title.value.trim() || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 200)
        const form = new FormData()
        form.set('file', new File([bytes], `${name}.docx`, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
        form.set('case_id', cases.value)
        form.set('language', lang)
        if (title.value.trim()) form.set('title', title.value.trim())
        const { document: doc } = await api('POST', '/documents/upload', form)
        msg.replaceChildren(document.createTextNode(`${t('saved')} `), h('a', { href: `/app#/documents/${doc.id}`, target: '_blank', rel: 'noopener', text: t('openInApp') }))
        msg.className = 'note ok'
      } catch (e) { note(msg, errorText(e), 'error') }
      btn.disabled = !cases.value
    })
    load()
    return h('section', {}, q, cases, title, btn, msg)
  }

  // The open document as a .docx file, read from Word in slices.
  function documentBytes() {
    return new Promise((resolve, reject) => {
      Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 4194304 }, (res) => {
        if (res.status !== Office.AsyncResultStatus.Succeeded) return reject(new Error(res.error.message))
        const file = res.value
        const parts = []
        const next = (i) => {
          if (i >= file.sliceCount) { file.closeAsync(); return resolve(new Blob(parts)) }
          file.getSliceAsync(i, (s) => {
            if (s.status !== Office.AsyncResultStatus.Succeeded) { file.closeAsync(); return reject(new Error(s.error.message)) }
            parts.push(new Uint8Array(s.value.data))
            next(i + 1)
          })
        }
        next(0)
      })
    })
  }

  async function start(info) {
    inWord = !!(info && info.host)
    const display = (window.Office && Office.context && Office.context.displayLanguage) || navigator.language || 'en'
    lang = /^ar/i.test(display) ? 'ar' : 'en'
    apiKey = store.get()
    if (apiKey) {
      try { me = await api('GET', '/me') } catch { apiKey = null; me = null }
    }
    render()
  }

  if (window.Office && Office.onReady) Office.onReady(start)
  else start(null)
})()
