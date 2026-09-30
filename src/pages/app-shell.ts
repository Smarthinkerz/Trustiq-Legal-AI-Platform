import { head } from './layout'

// The authenticated application is a client-rendered SPA (public/app/*). This shell only boots it.
export function appShell(opts: { assetVersion: string }) {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  ${head({ title: 'TrustiqLegal', assetVersion: opts.assetVersion })}
  <meta name="robots" content="noindex" />
  <script type="module" src="/static/app/main.js?v=${opts.assetVersion}"></script>
</head>
<body class="bg-slate-50 text-slate-900 antialiased">
  <div id="root">
    <div class="min-h-screen flex items-center justify-center text-slate-400">
      <i class="fas fa-circle-notch fa-spin text-2xl" aria-hidden="true"></i><span class="sr-only">Loading</span>
    </div>
  </div>
  <div id="modal-root"></div>
  <div id="toast-root" class="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:end-4 flex flex-col items-stretch sm:items-end gap-2 z-[100] pointer-events-none" aria-live="polite"></div>
  <noscript><p style="padding:2rem;text-align:center">TrustiqLegal requires JavaScript to be enabled.</p></noscript>
</body>
</html>`
}
