// Firm quote form on the pricing page: one screen, the price recalculates on every change.
// The server recalculates the same quote from the inputs before anything is charged.
const root = document.getElementById('firm-quote')
const { COUNTRIES, quoteFirm } = await import(`./firm-pricing.js${new URL(import.meta.url).search}`)

const T = JSON.parse(root.dataset.t)
const lang = root.dataset.lang === 'ar' ? 'ar' : 'en'
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
const escHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
const money = (n, cur) => `<bdi dir="ltr">${cur} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 })}</bdi>`
const num = (n) => `<bdi>${Number(n).toLocaleString(lang === 'ar' ? 'ar-OM' : 'en-US')}</bdi>`

const field = (name, label, input) => `<label class="block"><span class="block text-sm font-medium text-slate-700 mb-1">${label}</span>${input}</label>`
const text = (name, type, extra = '') => `<input class="input w-full" name="${name}" type="${type}" required ${extra} />`

root.innerHTML = `
<div class="fixed inset-0 z-[60] bg-slate-900/60 flex items-start md:items-center justify-center p-0 md:p-6 overflow-y-auto" data-overlay>
  <div class="bg-white w-full md:max-w-4xl md:rounded-2xl shadow-2xl min-h-full md:min-h-0" role="dialog" aria-modal="true" aria-labelledby="fq-title">
    <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200">
      <h2 id="fq-title" class="text-xl font-bold">${T.title}</h2>
      <button type="button" class="text-slate-500 hover:text-slate-900 p-2" data-close aria-label="${T.close}"><i class="fas fa-xmark text-xl"></i></button>
    </div>
    <form class="grid md:grid-cols-2 gap-6 p-5" novalidate>
      <div class="space-y-3">
        <p class="text-sm text-slate-600">${T.intro}</p>
        ${field('firm_name', T.firm_name, text('firm_name', 'text', 'maxlength="200" autocomplete="organization"'))}
        ${field('country', T.country, `<select class="input w-full" name="country">${COUNTRIES.map((c) => `<option value="${c}">${T.countries[c]}</option>`).join('')}</select>`)}
        <div class="grid grid-cols-2 gap-3">
          ${field('lawyers', T.lawyers, text('lawyers', 'number', 'min="1" step="1" inputmode="numeric" value="5"'))}
          ${field('support', T.support, text('support', 'number', 'min="0" max="200" step="1" inputmode="numeric" value="0"'))}
        </div>
        <fieldset><legend class="block text-sm font-medium text-slate-700 mb-1">${T.cycle}</legend>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <label class="flex items-center gap-2"><input type="radio" name="cycle" value="monthly" checked /> ${T.monthly}</label>
            <label class="flex items-center gap-2"><input type="radio" name="cycle" value="annual" /> ${T.annual}</label>
          </div></fieldset>
        ${field('contact_name', T.contact_name, text('contact_name', 'text', 'maxlength="200" autocomplete="name"'))}
        ${field('email', T.email, text('email', 'email', 'maxlength="254" autocomplete="email" dir="ltr"'))}
        ${field('phone', T.phone, text('phone', 'tel', 'maxlength="20" autocomplete="tel" dir="ltr"'))}
      </div>
      <div class="flex flex-col gap-3" aria-live="polite">
        <div data-quote class="space-y-3"></div>
        <p class="text-xs text-slate-500">${T.supportNote}</p>
        <p class="text-sm text-red-700" data-error hidden></p>
        <button class="btn btn-primary w-full mt-auto" data-submit>${T.submit}</button>
      </div>
    </form>
    <div class="p-8 text-center hidden" data-done></div>
  </div>
</div>`

const form = root.querySelector('form')
const quoteBox = root.querySelector('[data-quote]')
const submit = root.querySelector('[data-submit]')
const errorBox = root.querySelector('[data-error]')
let chosen = null // a plan the visitor picked; otherwise the recommendation
let current = null

const read = () => ({
  country: form.elements.country.value,
  lawyers: Number(form.elements.lawyers.value),
  support: form.elements.support.value === '' ? 0 : Number(form.elements.support.value),
  cycle: form.elements.cycle.value
})

function optionCard(o, q) {
  const selected = o.plan === (chosen ?? q.recommended)
  const rec = o.plan === q.recommended
  return `<label class="block rounded-xl border-2 p-4 cursor-pointer ${selected ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}">
    <div class="flex items-center justify-between gap-2 mb-2">
      <span class="flex items-center gap-2 font-semibold"><input type="radio" name="plan" value="${o.plan}" ${selected ? 'checked' : ''} /> ${T.plan[o.plan]}</span>
      ${rec ? `<span class="text-xs font-bold uppercase tracking-wide bg-brand-700 text-white rounded-full px-2 py-0.5">${T.recommended}</span>` : ''}
    </div>
    <ul class="text-sm text-slate-600 space-y-1">
      <li class="flex justify-between gap-2"><span>${fill(T.base, { n: num(o.included_seats) })}</span><span>${money(o.base_price, q.currency)}</span></li>
      ${o.extra_seats ? `<li class="flex justify-between gap-2"><span>${fill(T.extra, { n: num(o.extra_seats), price: money(o.seat_price, q.currency) })}</span><span>${money(o.extra_seats * o.seat_price, q.currency)}</span></li>` : ''}
      <li>${fill(T.ai, { n: num(o.ai_requests) })}</li>
      ${q.support_seats ? `<li>${fill(T.supportSeats, { n: num(q.support_seats) })}</li>` : ''}
      <li class="text-xs">${o.plan === 'professional' ? T.pro : T.starterNote}</li>
    </ul>
    <div class="mt-3 pt-3 border-t border-slate-200">
      <p class="text-2xl font-extrabold">${fill(T.perMonth, { price: money(o.monthly, q.currency) })}</p>
      <p class="text-sm text-slate-600">${q.cycle === 'annual' ? fill(T.annualTotal, { price: money(o.total, q.currency) }) : fill(T.monthlyTotal, { price: money(o.total, q.currency) })}</p>
      <p class="text-xs text-slate-500">${T.vat}</p>
    </div>
  </label>`
}

function update() {
  const q = quoteFirm(read())
  current = q
  errorBox.hidden = true
  if (!q) {
    quoteBox.innerHTML = `<p class="text-sm text-slate-500">${T.invalid}</p>`
    submit.disabled = true
    return
  }
  submit.disabled = false
  if (q.enterprise) {
    quoteBox.innerHTML = `<div class="rounded-xl border-2 border-slate-200 p-4"><p class="font-semibold mb-1">${T.enterpriseTitle}</p><p class="text-sm text-slate-600">${T.enterpriseText}</p></div>`
    submit.textContent = T.submitEnterprise
    return
  }
  if (chosen && !q.options.some((o) => o.plan === chosen)) chosen = null
  quoteBox.innerHTML = q.options.map((o) => optionCard(o, q)).join('')
  submit.textContent = T.submit
}

form.addEventListener('input', (e) => {
  if (e.target.name === 'plan') chosen = e.target.value
  update()
})
form.addEventListener('change', (e) => {
  if (e.target.name === 'plan') { chosen = e.target.value; update() }
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!current) return
  if (!form.reportValidity()) return
  const body = {
    ...read(), lang,
    firm_name: form.elements.firm_name.value, contact_name: form.elements.contact_name.value,
    email: form.elements.email.value, phone: form.elements.phone.value,
    plan: current.enterprise ? null : chosen ?? current.recommended
  }
  submit.disabled = true
  const label = submit.textContent
  submit.textContent = T.sending
  try {
    const res = await fetch('/firms/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    const done = root.querySelector('[data-done]')
    done.innerHTML = `<i class="fas fa-circle-check text-emerald-600 text-4xl mb-4"></i><p class="text-lg">${fill(data.kind === 'enterprise' ? T.doneEnterprise : T.done, { email: `<bdi dir="ltr">${escHtml(body.email)}</bdi>` })}</p>
      <button type="button" class="btn btn-secondary mt-6" data-close>${T.close}</button>`
    form.classList.add('hidden')
    done.classList.remove('hidden')
  } catch {
    errorBox.textContent = T.error
    errorBox.hidden = false
    submit.disabled = false
    submit.textContent = label
  }
})

const open = () => {
  root.hidden = false
  document.body.style.overflow = 'hidden'
  update()
  form.elements.firm_name.focus()
}
const close = () => {
  root.hidden = true
  document.body.style.overflow = ''
}
root.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target.matches('[data-overlay]')) close()
})
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close() })
for (const b of document.querySelectorAll('[data-firm-quote]')) b.addEventListener('click', open)
if (location.hash === '#firms-quote') open()
