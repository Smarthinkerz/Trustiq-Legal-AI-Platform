import { api } from '../api.js'
import { html, raw, render } from '../dom.js'
import { getLang, t } from '../i18n.js'
import { busy, modal, showError, spinner, toast } from '../ui.js'

// ---------------------------------------------------------------------------
// Voice note on a matter: record (or upload a WhatsApp voice note, or type rough
// notes), then review the AI's file note, tasks, dates and client update before
// anything is saved.
// ---------------------------------------------------------------------------

const MAX_SECONDS = 20 * 60
const KINDS = ['hearing', 'deadline', 'filing', 'meeting']
const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported?.(m)) || ''
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export function openDictation(kase, { onSaved } = {}) {
  const m = modal({ title: t('dictate.title'), size: 'lg', body: html`<div data-dictation></div>` })
  const box = m.el.querySelector('[data-dictation]')
  const state = { spoken: 'auto', output: getLang(), audio: null, audioName: '', text: '', recorder: null, stream: null, seconds: 0, timer: null, review: null }

  const stopStream = () => {
    clearInterval(state.timer)
    state.stream?.getTracks().forEach((tr) => tr.stop())
    state.stream = null
  }

  const capture = () => {
    const rec = !!state.recorder
    render(box, html`<div class="space-y-5">
      <p class="text-sm text-slate-600">${t('dictate.intro')}</p>
      <div class="rounded-xl border border-slate-200 p-5 flex flex-col items-center gap-3 text-center">
        ${rec ? html`
          <button type="button" class="w-20 h-20 rounded-full bg-red-600 text-white text-2xl shadow-lg animate-pulse" data-act="stop" aria-label="${t('dictate.stop')}"><i class="fas fa-stop"></i></button>
          <div class="font-mono text-lg" data-clock>${clock(state.seconds)}</div>
          <p class="text-xs text-slate-500">${t('dictate.recording')}</p>`
        : state.audio ? html`
          <audio controls class="w-full" src="${URL.createObjectURL(state.audio)}"></audio>
          <p class="text-sm text-slate-700"><i class="fas fa-check-circle text-emerald-600"></i> ${state.audioName || t('dictate.recorded')}</p>
          <div class="flex gap-2">
            ${canRecord() ? html`<button type="button" class="btn btn-outline btn-sm" data-act="record"><i class="fas fa-microphone"></i>${t('dictate.record_again')}</button>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-act="clear"><i class="fas fa-trash"></i>${t('dictate.remove')}</button>
          </div>`
        : html`
          ${canRecord() ? html`<button type="button" class="w-20 h-20 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-2xl shadow-lg" data-act="record" aria-label="${t('dictate.record')}"><i class="fas fa-microphone"></i></button>
            <p class="text-sm font-medium">${t('dictate.record')}</p>` : html`<p class="text-sm text-slate-500">${t('dictate.no_mic')}</p>`}
          <label class="btn btn-outline btn-sm cursor-pointer"><i class="fas fa-upload"></i>${t('dictate.upload')}
            <input type="file" class="sr-only" data-file accept="audio/*,.opus,.ogg,.oga,.m4a,.mp3,.wav,.webm,.aac,.mp4" /></label>
          <p class="text-xs text-slate-500">${t('dictate.upload_hint')}</p>`}
      </div>
      <div>
        <label class="label" for="dict-text">${t('dictate.or_type')}</label>
        <textarea id="dict-text" class="input" rows="3" dir="auto" data-text maxlength="20000" placeholder="${t('dictate.type_placeholder')}">${state.text}</textarea>
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        <div><label class="label" for="dict-spoken">${t('dictate.spoken')}</label>
          <select id="dict-spoken" class="input" data-spoken>${['auto', 'ar', 'en'].map((v) => html`<option value="${v}" ${v === state.spoken ? raw('selected') : ''}>${t(`dictate.lang_${v}`)}</option>`)}</select></div>
        <div><label class="label" for="dict-output">${t('dictate.output')}</label>
          <select id="dict-output" class="input" data-output>${['en', 'ar'].map((v) => html`<option value="${v}" ${v === state.output ? raw('selected') : ''}>${t(v === 'ar' ? 'common.arabic' : 'common.english')}</option>`)}</select></div>
      </div>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-action="close-modal">${t('common.cancel')}</button>
        <button type="button" class="btn btn-primary" data-act="process" ${rec ? raw('disabled') : ''}><i class="fas fa-wand-magic-sparkles"></i>${t('dictate.process')}</button>
      </div>
    </div>`)
  }

  const startRecording = async () => {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return toast(t('dictate.mic_denied'), 'error')
    }
    const mime = pickMime()
    const chunks = []
    const recorder = new MediaRecorder(state.stream, mime ? { mimeType: mime } : undefined)
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = () => {
      stopStream()
      state.recorder = null
      state.audio = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' })
      state.audioName = ''
      if (document.body.contains(m.el)) capture()
    }
    state.recorder = recorder
    state.seconds = 0
    recorder.start(1000)
    capture()
    state.timer = setInterval(() => {
      if (!document.body.contains(m.el)) { recorder.state !== 'inactive' && recorder.stop(); return stopStream() }
      state.seconds++
      const el = box.querySelector('[data-clock]')
      if (el) el.textContent = clock(state.seconds)
      if (state.seconds >= MAX_SECONDS) recorder.stop()
    }, 1000)
  }

  const process = (btn) => busy(btn, async () => {
    state.text = box.querySelector('[data-text]')?.value.trim() || ''
    if (!state.audio && !state.text) return toast(t('dictate.nothing'), 'error')
    const fd = new FormData()
    if (state.audio) {
      const ext = state.audio.type.includes('mp4') ? 'm4a' : state.audio.type.includes('ogg') ? 'ogg' : state.audio.type.includes('mpeg') ? 'mp3' : 'webm'
      fd.set('file', state.audio, state.audioName || `voice-note.${ext}`)
    }
    if (state.text) fd.set('text', state.text)
    fd.set('language', state.spoken)
    fd.set('output_language', state.output)
    render(box, html`<div class="py-14 text-center text-sm text-slate-500">${spinner()}<p class="mt-3">${state.audio ? t('dictate.working_audio') : t('dictate.working_text')}</p></div>`)
    try {
      state.review = await api.upload(`/api/ai/cases/${kase.id}/dictation`, fd)
      review()
    } catch (err) {
      showError(err)
      capture()
    }
  })

  const review = () => {
    const { transcript, result: r, has_client } = state.review
    render(box, html`<div class="space-y-5">
      <details class="rounded-lg bg-slate-50 px-4 py-3 text-sm"><summary class="cursor-pointer font-medium text-slate-600">${t('dictate.transcript')}</summary>
        <p class="mt-2 whitespace-pre-wrap text-slate-700" dir="auto">${transcript}</p></details>
      <div><label class="label" for="dict-title">${t('dictate.note_title')}</label><input id="dict-title" class="input" data-r-title maxlength="200" value="${r.title}" dir="auto" /></div>
      <div><label class="label" for="dict-note">${t('dictate.note')}</label><textarea id="dict-note" class="input" rows="7" data-r-note dir="auto" maxlength="20000">${r.note}</textarea></div>
      <section>
        <h3 class="text-sm font-semibold mb-2"><i class="fas fa-list-check text-brand-500"></i> ${t('dictate.tasks')}</h3>
        ${r.tasks.length ? html`<ul class="space-y-2">${r.tasks.map((x, i) => html`<li class="flex flex-wrap items-center gap-2" data-task="${i}">
          <input type="checkbox" checked data-keep aria-label="${t('dictate.keep')}" />
          <input class="input flex-1 min-w-48" data-f="title" value="${x.title}" maxlength="300" dir="auto" aria-label="${t('tasks.title')}" />
          <input class="input w-40" type="date" data-f="due_date" value="${x.due_date}" aria-label="${t('tasks.due')}" /></li>`)}</ul>`
        : html`<p class="text-sm text-slate-500">${t('dictate.none')}</p>`}
      </section>
      <section>
        <h3 class="text-sm font-semibold mb-2"><i class="fas fa-calendar-plus text-brand-500"></i> ${t('dictate.events')}</h3>
        ${r.events.length ? html`<ul class="space-y-2">${r.events.map((x, i) => html`<li class="flex flex-wrap items-center gap-2" data-event="${i}">
          <input type="checkbox" checked data-keep aria-label="${t('dictate.keep')}" />
          <select class="input w-32" data-f="kind" aria-label="${t('events.kind')}">${KINDS.map((k) => html`<option value="${k}" ${k === x.kind ? raw('selected') : ''}>${t(`event.${k}`)}</option>`)}</select>
          <input class="input flex-1 min-w-40" data-f="title" value="${x.title}" maxlength="300" dir="auto" aria-label="${t('events.title')}" />
          <input class="input w-40" type="date" data-f="date" value="${x.date}" required aria-label="${t('dictate.date')}" />
          <input class="input w-28" type="time" data-f="time" value="${x.time}" aria-label="${t('dictate.time')}" />
          <input class="input w-full" data-f="location" value="${x.location}" maxlength="300" dir="auto" placeholder="${t('events.location')}" aria-label="${t('events.location')}" /></li>`)}</ul>`
        : html`<p class="text-sm text-slate-500">${t('dictate.none')}</p>`}
      </section>
      ${has_client ? html`<section>
        <label class="inline-flex items-center gap-2 text-sm font-semibold"><input type="checkbox" data-send /> <i class="fas fa-door-open text-slate-400"></i> ${t('dictate.send_client')}</label>
        <textarea class="input mt-2" rows="3" data-r-client dir="auto" maxlength="5000" placeholder="${t('dictate.client_placeholder')}">${r.client_update}</textarea>
        <p class="hint">${t('dictate.client_hint')}</p>
      </section>` : ''}
      <p class="text-xs text-slate-500"><i class="fas fa-circle-info"></i> ${t('dictate.review_hint')}</p>
      <div class="flex justify-end gap-2 pt-4 border-t border-slate-100">
        <button type="button" class="btn btn-outline" data-act="back">${t('dictate.back')}</button>
        <button type="button" class="btn btn-primary" data-act="save"><i class="fas fa-floppy-disk"></i>${t('dictate.save')}</button>
      </div>
    </div>`)
  }

  const rows = (sel) => [...box.querySelectorAll(sel)].filter((li) => li.querySelector('[data-keep]').checked)
    .map((li) => Object.fromEntries([...li.querySelectorAll('[data-f]')].map((el) => [el.dataset.f, el.value.trim()])))

  const save = (btn) => busy(btn, async () => {
    const note = box.querySelector('[data-r-note]').value.trim()
    if (!note) return toast(t('dictate.note_required'), 'error')
    const events = rows('[data-event]')
    if (events.some((e) => !e.date || !e.title)) return toast(t('dictate.event_date_required'), 'error')
    const send = box.querySelector('[data-send]')?.checked
    const clientMessage = box.querySelector('[data-r-client]')?.value.trim()
    if (send && !clientMessage) return toast(t('dictate.client_required'), 'error')
    try {
      const r = await api.post(`/api/cases/${kase.id}/dictation`, {
        title: box.querySelector('[data-r-title]').value.trim(), note,
        tasks: rows('[data-task]').filter((x) => x.title), events, client_message: send ? clientMessage : ''
      })
      m.close()
      toast(t('dictate.saved', { tasks: r.tasks, events: r.events }) + (r.messaged ? ` · ${t('dictate.sent')}` : ''))
      onSaved?.()
    } catch (err) { showError(err) }
  })

  box.addEventListener('change', (e) => {
    if (e.target.matches('[data-spoken]')) state.spoken = e.target.value
    if (e.target.matches('[data-output]')) state.output = e.target.value
    if (e.target.matches('[data-file]')) {
      const f = e.target.files[0]
      if (!f) return
      if (f.size > 25 * 1048576) return toast(t('dictate.too_big'), 'error')
      state.audio = f
      state.audioName = f.name
      state.text = box.querySelector('[data-text]')?.value || ''
      capture()
    }
  })
  box.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]')
    if (!el) return
    const act = el.dataset.act
    if (act !== 'save' && act !== 'back') state.text = box.querySelector('[data-text]')?.value ?? state.text
    if (act === 'record') startRecording()
    if (act === 'stop') state.recorder?.stop()
    if (act === 'clear') { state.audio = null; state.audioName = ''; capture() }
    if (act === 'process') process(el)
    if (act === 'back') capture()
    if (act === 'save') save(el)
  })
  capture()
}
