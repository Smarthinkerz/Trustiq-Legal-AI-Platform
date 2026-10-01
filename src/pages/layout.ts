export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

export function head(opts: { title: string; description?: string; assetVersion: string; lang?: 'en' | 'ar' }) {
  const v = opts.assetVersion
  return `<meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(opts.title)}</title>
  ${opts.description ? `<meta name="description" content="${esc(opts.description)}" />` : ''}
  <meta name="theme-color" content="#1a365d" />
  <link rel="icon" href="/static/favicon.svg?v=${v}" type="image/svg+xml" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="TrustiqLegal" />
  <link rel="stylesheet" href="/static/app.css?v=${v}" />
  <link rel="stylesheet" href="/vendor/fa/css/all.min.css?v=${v}" />`
}
