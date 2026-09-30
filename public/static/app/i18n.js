import en from './locales/en.js'
import ar from './locales/ar.js'

const dicts = { en, ar }
let lang = 'en'

export const getLang = () => lang

export function setLang(next) {
  lang = next === 'ar' ? 'ar' : 'en'
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  try { localStorage.setItem('tq_lang', lang) } catch {}
}

export function initialLang() {
  const fromUrl = new URLSearchParams(location.hash.split('?')[1] || '').get('lang')
  if (fromUrl) return fromUrl
  try { const saved = localStorage.getItem('tq_lang'); if (saved) return saved } catch {}
  return (navigator.language || '').startsWith('ar') ? 'ar' : 'en'
}

export function t(key, vars) {
  let s = dicts[lang][key] ?? dicts.en[key]
  if (s === undefined) {
    console.warn('[i18n] missing key', key)
    s = key
  }
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s
}

// Arabic UI uses Latin digits, which is the norm in GCC legal software and court filings.
const locale = () => (lang === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB')

export function fmtDate(v) {
  if (!v) return ''
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v)
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

export function fmtDateTime(v) {
  if (!v) return ''
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v))
}

export function fmtTime(v) {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(v))
}

export function fmtMonth(d) {
  return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(d)
}

export function weekdayNames() {
  const base = new Date(2024, 0, 7) // a Sunday
  return Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(base.getTime() + i * 86400000)))
}

export function fmtNumber(n) {
  return new Intl.NumberFormat(locale()).format(n)
}

export function fmtMoney(n, currency) {
  if (n == null) return ''
  try {
    const whole = Number.isInteger(Number(n))
    return new Intl.NumberFormat(locale(), { style: 'currency', currency, minimumFractionDigits: whole ? 0 : undefined, maximumFractionDigits: whole ? 0 : 3 }).format(n)
  } catch {
    return `${fmtNumber(n)} ${currency}`
  }
}

export function fmtRelative(v) {
  const diff = (new Date(v).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return fmtDate(v)
}

export function fmtBytes(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
