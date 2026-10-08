import { esc } from './layout'

// ---------------------------------------------------------------------------
// Public page where a signer reviews and signs a document (/sign/:token).
// Everything shown comes through esc(); the document text is displayed as-is
// with preserved line breaks.
// ---------------------------------------------------------------------------

type Lang = 'en' | 'ar'
export type SignState = 'sign' | 'signed' | 'completed' | 'declined' | 'cancelled' | 'expired' | 'invalid'

const copy = {
  en: {
    title: 'Sign document', from: 'Sent by', review: 'Please read the document below carefully before signing.',
    message: 'Message', file: 'Original file', openFile: 'Open the original file', fingerprint: 'Document fingerprint (SHA-256)',
    yourName: 'Type your full name to sign', draw: 'Draw your signature (optional)', clear: 'Clear',
    consent: 'I have read this document and agree to sign it electronically. I understand my electronic signature has the same effect as my handwritten signature.',
    sign: 'Sign document', decline: 'Decline to sign', declineReason: 'Reason (optional)', declineConfirm: 'Decline',
    signedTitle: 'Thank you, your signature has been recorded.', signedText: 'The firm has been notified. You will be able to download the signed copy once everyone has signed.',
    completedTitle: 'This document has been signed by everyone.', download: 'Download the signed copy (Word)',
    declinedTitle: 'You declined to sign this document.', declinedText: 'The firm has been notified.',
    cancelledTitle: 'This signature request was cancelled by the firm.', expiredTitle: 'This signing link has expired.', expiredText: 'Please contact the firm for a new link.',
    invalidTitle: 'This signing link is not valid.', invalidText: 'Check that you opened the full link from your email, or contact the firm.',
    nameRequired: 'Please type your full name and tick the agreement box.', other: 'العربية', legal: 'Simple electronic signature with an audit trail (time, IP address and document fingerprint).'
  },
  ar: {
    title: 'توقيع مستند', from: 'مرسل من', review: 'يُرجى قراءة المستند أدناه بعناية قبل التوقيع.',
    message: 'رسالة', file: 'الملف الأصلي', openFile: 'فتح الملف الأصلي', fingerprint: 'البصمة الرقمية للمستند (SHA-256)',
    yourName: 'اكتب اسمك الكامل للتوقيع', draw: 'ارسم توقيعك (اختياري)', clear: 'مسح',
    consent: 'قرأت هذا المستند وأوافق على توقيعه إلكترونيًا، وأدرك أن توقيعي الإلكتروني له أثر توقيعي الخطي نفسه.',
    sign: 'توقيع المستند', decline: 'رفض التوقيع', declineReason: 'السبب (اختياري)', declineConfirm: 'رفض',
    signedTitle: 'شكرًا لك، تم تسجيل توقيعك.', signedText: 'تم إشعار المكتب. يمكنك تنزيل النسخة الموقّعة بعد أن يوقّع جميع الأطراف.',
    completedTitle: 'وقّع جميع الأطراف على هذا المستند.', download: 'تنزيل النسخة الموقّعة (Word)',
    declinedTitle: 'لقد رفضت توقيع هذا المستند.', declinedText: 'تم إشعار المكتب.',
    cancelledTitle: 'ألغى المكتب طلب التوقيع هذا.', expiredTitle: 'انتهت صلاحية رابط التوقيع.', expiredText: 'يُرجى التواصل مع المكتب للحصول على رابط جديد.',
    invalidTitle: 'رابط التوقيع غير صالح.', invalidText: 'تأكد من فتح الرابط كاملًا من بريدك الإلكتروني، أو تواصل مع المكتب.',
    nameRequired: 'يُرجى كتابة اسمك الكامل ووضع علامة على مربع الموافقة.', other: 'English', legal: 'توقيع إلكتروني بسيط مع سجل تدقيق (الوقت وعنوان IP والبصمة الرقمية للمستند).'
  }
} as const

export function signPage(o: {
  state: SignState
  lang: Lang
  assetVersion: string
  token?: string
  firmName?: string
  color?: string | null
  title?: string
  signerName?: string
  message?: string | null
  content?: string
  contentLanguage?: Lang
  contentHash?: string
  fileName?: string | null
  error?: boolean
}) {
  const t = copy[o.lang]
  const color = /^#[0-9a-f]{6}$/i.test(o.color ?? '') ? o.color! : '#1a365d'
  const base = o.token ? `/sign/${o.token}` : ''
  const other = o.lang === 'ar' ? 'en' : 'ar'
  const status = (icon: string, title: string, text = '', extra = '') => `
    <section class="bg-white rounded-2xl border border-slate-200 p-8 text-center">
      <i class="fas ${icon} text-4xl" style="color:${color}"></i>
      <h1 class="text-xl font-bold mt-4">${title}</h1>${text ? `<p class="text-slate-600 mt-2">${text}</p>` : ''}${extra}
    </section>`
  const download = o.token ? `<a class="inline-block mt-6 rounded-lg px-5 py-3 font-semibold text-white" style="background:${color}" href="${base}/signed-copy">${t.download}</a>` : ''

  let main: string
  switch (o.state) {
    case 'invalid': main = status('fa-link-slash', t.invalidTitle, t.invalidText); break
    case 'expired': main = status('fa-hourglass-end', t.expiredTitle, t.expiredText); break
    case 'cancelled': main = status('fa-ban', t.cancelledTitle); break
    case 'declined': main = status('fa-circle-xmark', t.declinedTitle, t.declinedText); break
    case 'signed': main = status('fa-circle-check', t.signedTitle, t.signedText); break
    case 'completed': main = status('fa-circle-check', t.completedTitle, '', download); break
    default: main = `
      <section class="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div>
          <p class="text-sm text-slate-500">${t.from} <strong>${esc(o.firmName)}</strong></p>
          <h1 class="text-2xl font-bold mt-1" dir="auto">${esc(o.title)}</h1>
          <p class="text-sm text-slate-600 mt-2">${t.review}</p>
        </div>
        ${o.message ? `<div class="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm"><div class="font-semibold mb-1">${t.message}</div><p class="whitespace-pre-line" dir="auto">${esc(o.message)}</p></div>` : ''}
        ${o.fileName ? `<p class="text-sm"><i class="fas fa-paperclip text-slate-400 me-1"></i>${t.file}: <a class="font-semibold underline" style="color:${color}" target="_blank" rel="noopener" href="${base}/file">${esc(o.fileName)}</a></p>` : ''}
        ${o.content?.trim() ? `<article class="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 p-5 leading-8 whitespace-pre-wrap text-[0.95rem]" dir="${o.contentLanguage === 'ar' ? 'rtl' : 'auto'}" lang="${o.contentLanguage ?? 'en'}" tabindex="0">${esc(o.content)}</article>` : ''}
        <p class="text-xs text-slate-500 break-all">${t.fingerprint}: <span class="font-mono" dir="ltr">${esc(o.contentHash)}</span></p>
      </section>
      <section class="bg-white rounded-2xl border border-slate-200 p-6">
        ${o.error ? `<p class="rounded-lg bg-red-50 border border-red-200 text-red-700 p-3 text-sm mb-4" role="alert">${t.nameRequired}</p>` : ''}
        <form method="post" action="${base}" class="space-y-4" id="sign-form">
          <input type="hidden" name="action" value="sign" />
          <input type="hidden" name="lang" value="${o.lang}" />
          <input type="hidden" name="signature" id="signature-data" />
          <label class="block"><span class="text-sm font-medium">${t.yourName}</span>
            <input name="signed_name" required minlength="2" maxlength="200" autocomplete="name" value="${esc(o.signerName)}" dir="auto"
              class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-lg" /></label>
          <div>
            <div class="flex items-center justify-between"><span class="text-sm font-medium">${t.draw}</span>
              <button type="button" id="signature-clear" class="text-sm underline text-slate-600">${t.clear}</button></div>
            <canvas id="signature-pad" class="mt-1 w-full h-40 rounded-lg border border-dashed border-slate-400 bg-slate-50 touch-none" aria-label="${t.draw}"></canvas>
          </div>
          <label class="flex items-start gap-3 text-sm"><input type="checkbox" name="consent" required class="mt-1" /><span>${t.consent}</span></label>
          <button type="submit" class="w-full rounded-lg px-5 py-3 font-semibold text-white text-lg" style="background:${color}"><i class="fas fa-signature me-2"></i>${t.sign}</button>
        </form>
        <details class="mt-6 text-sm">
          <summary class="cursor-pointer text-slate-600">${t.decline}</summary>
          <form method="post" action="${base}" class="mt-3 space-y-3">
            <input type="hidden" name="action" value="decline" /><input type="hidden" name="lang" value="${o.lang}" />
            <label class="block"><span class="text-sm">${t.declineReason}</span>
              <textarea name="reason" rows="2" maxlength="1000" dir="auto" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"></textarea></label>
            <button type="submit" class="rounded-lg px-4 py-2 border border-red-300 text-red-700 font-semibold">${t.declineConfirm}</button>
          </form>
        </details>
        <p class="text-xs text-slate-500 mt-6">${t.legal}</p>
      </section>`
  }

  return `<!DOCTYPE html>
<html lang="${o.lang}" dir="${o.lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="same-origin" />
  <title>${esc(o.title ? `${t.title}: ${o.title}` : t.title)}</title>
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/static/app.css?v=${o.assetVersion}" />
  <link rel="stylesheet" href="/vendor/fa/css/all.min.css?v=${o.assetVersion}" />
</head>
<body class="bg-slate-100 text-slate-800 antialiased min-h-screen">
  <header class="text-white" style="background:${color}">
    <div class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
      <span class="font-semibold truncate"><i class="fas fa-file-signature me-2"></i>${esc(o.firmName ?? 'TrustiqLegal')}</span>
      ${o.token ? `<a class="text-sm underline" href="${base}?lang=${other}" lang="${other}">${t.other}</a>` : ''}
    </div>
  </header>
  <main class="max-w-3xl mx-auto px-4 py-8 space-y-6">${main}</main>
  <footer class="max-w-3xl mx-auto px-4 pb-10 text-center text-xs text-slate-500">TrustiqLegal</footer>
  ${o.state === 'sign' ? `<script src="/static/site/sign.js?v=${o.assetVersion}" defer></script>` : ''}
</body>
</html>`
}
