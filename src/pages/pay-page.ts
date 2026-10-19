import { esc } from './layout'

// ---------------------------------------------------------------------------
// Public page where a client pays an invoice online (/pay/:token).
// No scripts: a plain form posts to the server, which redirects to Tap or Thawani.
// ---------------------------------------------------------------------------

type Lang = 'en' | 'ar'
export type PayState = 'pay' | 'paid' | 'unavailable' | 'invalid'
export type PayResult = 'success' | 'pending' | 'failed' | null

const copy = {
  en: {
    title: 'Pay invoice', from: 'Invoice from', invoice: 'Invoice', due: 'Due date', outstanding: 'Amount due', total: 'Invoice total', paidSoFar: 'Paid so far',
    email: 'Email for your receipt', emailHint: 'Leave blank to use the email the firm has on file.', pay: 'Pay', secure: 'You will be taken to Tap Payments to pay securely by card, mada, Apple Pay or KNET (where available). Your card details are never shared with the firm or with TrustiqLegal.',
    test: 'Test mode: no real money will be taken.', paidTitle: 'This invoice has been paid in full.', paidText: 'Thank you for your payment.',
    successTitle: 'Thank you, your payment was received.', pendingTitle: 'Your payment is being processed.', pendingText: 'This page will show the result once Tap confirms it. You can safely close it.',
    failedTitle: 'The payment did not go through.', failedText: 'No money was taken. You can try again below.',
    unavailableTitle: 'Online payment is not available for this invoice.', unavailableText: 'Please contact the firm for other ways to pay.',
    invalidTitle: 'This payment link is not valid.', invalidText: 'Check that you opened the full link, or contact the firm.',
    emailRequired: 'Please enter your email address for the receipt.', other: 'العربية',
    payTap: 'Pay by card', payThawani: 'Pay with Thawani',
    secureThawani: 'Thawani takes you to its secure page to pay in Omani rials by Omani debit or credit card. Your card details are never shared with the firm or with TrustiqLegal.',
    secureBoth: 'Both options open a secure payment page. Your card details are never shared with the firm or with TrustiqLegal.'
  },
  ar: {
    title: 'دفع فاتورة', from: 'فاتورة من', invoice: 'رقم الفاتورة', due: 'تاريخ الاستحقاق', outstanding: 'المبلغ المستحق', total: 'إجمالي الفاتورة', paidSoFar: 'المدفوع حتى الآن',
    email: 'البريد الإلكتروني لإرسال الإيصال', emailHint: 'اتركه فارغًا لاستخدام البريد المسجّل لدى المكتب.', pay: 'ادفع', secure: 'سيتم تحويلك إلى Tap Payments للدفع بأمان عبر البطاقة أو مدى أو Apple Pay أو كي-نت (حسب التوفر). لا تتم مشاركة بيانات بطاقتك مع المكتب أو مع TrustiqLegal.',
    test: 'وضع الاختبار: لن يتم خصم أي مبلغ فعلي.', paidTitle: 'تم سداد هذه الفاتورة بالكامل.', paidText: 'شكرًا لك على السداد.',
    successTitle: 'شكرًا لك، تم استلام دفعتك.', pendingTitle: 'جارٍ معالجة دفعتك.', pendingText: 'ستظهر النتيجة في هذه الصفحة بعد تأكيد Tap. يمكنك إغلاقها بأمان.',
    failedTitle: 'لم تتم عملية الدفع.', failedText: 'لم يتم خصم أي مبلغ. يمكنك المحاولة مرة أخرى أدناه.',
    unavailableTitle: 'الدفع الإلكتروني غير متاح لهذه الفاتورة.', unavailableText: 'يُرجى التواصل مع المكتب لمعرفة طرق الدفع الأخرى.',
    invalidTitle: 'رابط الدفع غير صالح.', invalidText: 'تأكد من فتح الرابط كاملًا، أو تواصل مع المكتب.',
    emailRequired: 'يُرجى إدخال بريدك الإلكتروني لإرسال الإيصال.', other: 'English',
    payTap: 'ادفع بالبطاقة', payThawani: 'ادفع عبر ثواني',
    secureThawani: 'تنقلك ثواني إلى صفحتها الآمنة للدفع بالريال العماني باستخدام البطاقات العمانية المدينة أو الائتمانية. لا تتم مشاركة بيانات بطاقتك مع المكتب أو مع TrustiqLegal.',
    secureBoth: 'يفتح كلا الخيارين صفحة دفع آمنة. لا تتم مشاركة بيانات بطاقتك مع المكتب أو مع TrustiqLegal.'
  }
} as const

export function payPage(o: {
  state: PayState
  lang: Lang
  assetVersion: string
  token?: string
  result?: PayResult
  firmName?: string
  color?: string | null
  number?: string
  dueDate?: string | null
  currency?: string
  total?: string
  paid?: string
  outstanding?: string
  testMode?: boolean
  error?: 'email'
  providers?: ('tap' | 'thawani')[]
}) {
  const t = copy[o.lang]
  const color = /^#[0-9a-f]{6}$/i.test(o.color ?? '') ? o.color! : '#1a365d'
  const base = o.token ? `/pay/${o.token}` : ''
  const other = o.lang === 'ar' ? 'en' : 'ar'
  const money = (v?: string) => `<span dir="ltr">${esc(v)} ${esc(o.currency)}</span>`
  const providers: ('tap' | 'thawani')[] = o.providers?.length ? o.providers : ['tap']
  const button = (provider: 'tap' | 'thawani', label: string, primary: boolean) =>
    `<button type="submit" name="provider" value="${provider}" class="w-full rounded-lg px-5 py-3 font-semibold text-lg ${primary ? 'text-white' : 'border-2'}" style="${primary ? `background:${color}` : `border-color:${color};color:${color}`}"><i class="fas fa-lock me-2"></i>${label} ${money(o.outstanding)}</button>`
  const buttons = providers.length > 1
    ? `${button('tap', t.payTap, true)}${button('thawani', t.payThawani, false)}`
    : button(providers[0]!, providers[0] === 'thawani' ? t.payThawani : t.pay, true)
  const secure = providers.length > 1 ? t.secureBoth : providers[0] === 'thawani' ? t.secureThawani : t.secure
  const status = (icon: string, title: string, text = '', tone = color) => `
    <section class="bg-white rounded-2xl border border-slate-200 p-8 text-center">
      <i class="fas ${icon} text-4xl" style="color:${tone}"></i>
      <h1 class="text-xl font-bold mt-4">${title}</h1>${text ? `<p class="text-slate-600 mt-2">${text}</p>` : ''}
    </section>`

  let main = ''
  if (o.result === 'success' || (o.result !== 'failed' && o.state === 'paid')) main += status('fa-circle-check', o.result === 'success' ? t.successTitle : t.paidTitle, o.state === 'paid' ? t.paidText : '', '#15803d')
  else if (o.result === 'pending') main += status('fa-hourglass-half', t.pendingTitle, t.pendingText)
  else if (o.result === 'failed' && o.state === 'pay') main += `<p class="rounded-lg bg-red-50 border border-red-200 text-red-700 p-4 text-sm" role="alert"><strong>${t.failedTitle}</strong> ${t.failedText}</p>`
  if (o.state === 'invalid') main = status('fa-link-slash', t.invalidTitle, t.invalidText)
  else if (o.state === 'unavailable') main += status('fa-circle-info', t.unavailableTitle, t.unavailableText)

  if (o.state !== 'invalid' && o.number) {
    main += `
      <section class="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <p class="text-sm text-slate-500">${t.from} <strong>${esc(o.firmName)}</strong></p>
        <dl class="grid grid-cols-2 gap-4 text-sm">
          <div><dt class="text-slate-500">${t.invoice}</dt><dd class="font-mono font-semibold" dir="ltr">${esc(o.number)}</dd></div>
          ${o.dueDate ? `<div><dt class="text-slate-500">${t.due}</dt><dd dir="ltr">${esc(o.dueDate)}</dd></div>` : '<div></div>'}
          <div><dt class="text-slate-500">${t.total}</dt><dd>${money(o.total)}</dd></div>
          ${o.paid && Number(o.paid) > 0 ? `<div><dt class="text-slate-500">${t.paidSoFar}</dt><dd>${money(o.paid)}</dd></div>` : ''}
        </dl>
        ${o.state === 'pay' ? `
        <div class="rounded-xl bg-slate-50 border border-slate-200 p-4 flex items-center justify-between gap-3">
          <span class="text-slate-600">${t.outstanding}</span><span class="text-2xl font-bold">${money(o.outstanding)}</span>
        </div>
        ${o.testMode ? `<p class="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-3 text-sm">${t.test}</p>` : ''}
        ${o.error === 'email' ? `<p class="rounded-lg bg-red-50 border border-red-200 text-red-700 p-3 text-sm" role="alert">${t.emailRequired}</p>` : ''}
        <form method="post" action="${base}" class="space-y-4">
          <input type="hidden" name="lang" value="${o.lang}" />
          <label class="block"><span class="text-sm font-medium">${t.email}</span>
            <input name="email" type="email" maxlength="254" autocomplete="email" dir="ltr" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3" />
            <span class="block text-xs text-slate-500 mt-1">${t.emailHint}</span></label>
          ${buttons}
        </form>
        <p class="text-xs text-slate-500">${secure}</p>` : ''}
      </section>`
  }

  return `<!DOCTYPE html>
<html lang="${o.lang}" dir="${o.lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
  <title>${esc(o.number ? `${t.title} ${o.number}` : t.title)}</title>
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/static/app.css?v=${o.assetVersion}" />
  <link rel="stylesheet" href="/vendor/fa/css/all.min.css?v=${o.assetVersion}" />
</head>
<body class="bg-slate-100 text-slate-800 antialiased min-h-screen">
  <header class="text-white" style="background:${color}">
    <div class="max-w-xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
      <span class="font-semibold truncate"><i class="fas fa-file-invoice-dollar me-2"></i>${esc(o.firmName ?? 'TrustiqLegal')}</span>
      ${o.token ? `<a class="text-sm underline" href="${base}?lang=${other}" lang="${other}">${t.other}</a>` : ''}
    </div>
  </header>
  <main class="max-w-xl mx-auto px-4 py-8 space-y-6">${main}</main>
  <footer class="max-w-xl mx-auto px-4 pb-10 text-center text-xs text-slate-500">TrustiqLegal</footer>
</body>
</html>`
}
