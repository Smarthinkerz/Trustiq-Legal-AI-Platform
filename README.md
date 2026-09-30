# TrustiqLegal

Bilingual (English/Arabic), AI-assisted practice-management platform for law firms in Oman and the GCC.

- **Matters & clients**: automatic case references, status and priority, responsible lawyer, notes timeline, conflict-of-interest check when adding clients, global search
- **Documents**: PDF/DOCX/TXT upload with text extraction and **Arabic OCR** for scanned PDFs, editor with version history and restore, branded Word export (RTL-aware), firm **templates** with merge fields
- **GCC law library**: upload laws, royal decrees and judgments (file or pasted text); split into articles and indexed for Arabic and English full-text search; firm-private or platform-shared
- **AI** (OpenAI-compatible): research chat grounded in the law library with **article-level citations** ([S1]…), optional "library only" mode; drafting of 12 GCC document types; structured contract review with risk scoring
- **Tasks & checklists**: personal and matter tasks, bilingual checklists (litigation, arbitration, employment, corporate, real estate, commercial, family)
- **Time & billing**: time entries and expenses, per-lawyer rates, invoices with jurisdiction VAT (OM/UAE 5%, KSA 15%, BH 10%) and 3-decimal currencies, numbering, payments, bilingual tax-invoice Word export
- **Client portal**: clients see their matters, hearings, shared documents and issued invoices, upload files and message their lawyer
- **Calendar**: hearings, filings, deadlines and meetings; daily email digest; private ICS feed for Outlook/Google/Apple
- **Reports**: hours by lawyer and matter, billable value, invoicing, receivables aging, case intake, AI usage
- **Security**: TOTP two-step verification with recovery codes, roles (owner/admin/lawyer/staff/client), audit log
- **Subscriptions**: free trial, Starter, Professional and Enterprise limits; self-serve monthly payment via **Tap Payments**, renewal reminders, platform admin console
- **Installable** as an app (PWA) on phones and desktops

## Architecture

| Layer | Technology |
| --- | --- |
| Server | Node.js 22, [Hono](https://hono.dev), TypeScript (run with `tsx`) |
| Database | PostgreSQL 14+ (production); embedded [PGlite](https://pglite.dev) for local development and tests |
| Frontend | Dependency-free ES-module single-page app in `public/static/app`, Tailwind CSS compiled at build time |
| AI | Any OpenAI-compatible Chat Completions API (`OPENAI_BASE_URL`, `OPENAI_MODEL`) |
| Email | SMTP via Nodemailer |

```
src/
  index.tsx          process entry: config, DB, server, graceful shutdown
  app.ts             middleware (security headers, CSP, origin check, rate limits, sessions) and routes
  config.ts          environment validation
  db/                Postgres/PGlite adapter and versioned migrations
  routes/            auth, org (team, branding, audit, export), clients, cases, documents, events, ai, dashboard, admin
  services/          AI client, legal prompts, text extraction, DOCX export, plan usage
  pages/, landing.ts server-rendered landing (EN at /, AR at /ar), legal pages, app shell
public/static/app/   SPA: router, API client, i18n (locales/en.js, locales/ar.js), views
test/                Vitest suite (runs against PGlite, or real Postgres with TEST_DATABASE_URL)
```

## Local development

```bash
npm install
cp .env.example .env     # optional; everything has local defaults
npm run dev              # builds CSS, starts http://localhost:8080 with an in-memory database
```

- Set `PGLITE_DATA_DIR=.data/pglite` to keep local data between restarts.
- Set `OPENAI_API_KEY` to enable AI features. Without it, the app works and AI screens say AI is not enabled; it never returns fake answers.
- Without SMTP, invitation and password-reset emails are printed to the server log. Invitation links are also shown to admins in the UI.
- Run `npm run dev:css` in a second terminal to rebuild CSS while editing views.

### Checks

```bash
npm run typecheck
npm test                                    # embedded PGlite
TEST_DATABASE_URL=postgres://… npm test     # real PostgreSQL (schema is reset)
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the CSS build and the test suite on both databases.

## Configuration

See `.env.example` for the full list. In production (`NODE_ENV=production`) the server refuses to start without:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Migrations run automatically on boot (safe with multiple replicas). |
| `APP_URL` | Public URL, e.g. `https://app.trustiqlegal.com`. Used for email links and to reject cross-site requests. |

Strongly recommended: `OPENAI_API_KEY`, `SMTP_*` + `MAIL_FROM`, `PLATFORM_ADMIN_EMAILS`, `SALES_EMAIL`, `SUPPORT_EMAIL`, and `DATABASE_SSL=true` for managed Postgres.

Online payments: set `TAP_SECRET_KEY` and `TAP_WEBHOOK_SECRET`, and in the Tap dashboard set the webhook URL to `${APP_URL}/webhooks/tap`. Checkout creates a hosted Tap charge, and the customer returns to `/billing/tap/return`, where the charge is re-fetched from Tap and reconciled. Webhooks are signature-checked (`hashstring` header), rate-limited, idempotent and audited in `webhook_events`. Each successful payment extends the plan by one month. Without `TAP_SECRET_KEY` the plan page falls back to "contact sales".

`JWT_SECRET` is no longer used. Sessions are random tokens stored hashed in the database, so they can be revoked.

## Deployment (Railway)

1. Add a **PostgreSQL** service to the project and reference its `DATABASE_URL` from the app service.
2. Set `NODE_ENV=production`, `APP_URL`, `OPENAI_API_KEY`, SMTP variables and `PLATFORM_ADMIN_EMAILS`.
3. Deploy. `railway.json` runs `npm ci && npm run build`, starts with `npm start`, and health-checks `/ready`.
4. Register the first firm at `/app#/register` using an email listed in `PLATFORM_ADMIN_EMAILS` to get the admin console.

A `Dockerfile` is included for other hosts. Health endpoints: `/health` (liveness) and `/ready` (database check).

Rate limiting is in-memory and per instance. Run one instance, or move the limiter to Redis before scaling out horizontally.

## Operations

- **Plans and billing**: with Tap configured, owners and admins pay monthly from Settings → Plan, which sets `plan_expires_at`. Enterprise and manually invoiced plans are set by a platform admin in `/app#/admin`; leave "paid until" blank for plans that never expire. Limits and self-serve prices live in `src/lib/plans.ts` and must match the landing page.
- **Expired trials and subscriptions** are read-only; users can still view and export data, and can renew. Owners and admins get a renewal email 5 days before expiry.
- **Background jobs** (in-process, safe with several instances): daily digest emails after 08:00 Gulf time, renewal reminders, and pruning of expired sessions, tokens and webhook audit rows.
- **Law library**: platform admins (`PLATFORM_ADMIN_EMAILS`) can publish laws to the shared library that every firm sees; firms can add their own private sources.
- **Backups**: enable automated backups and point-in-time recovery on the Postgres provider. Uploaded files are stored in the database, so database backups cover them.
- **Logs** are structured JSON, one line per request, with request IDs that are also shown to users on server errors.
- **Audit log**: sign-ins, record changes, downloads, exports and AI usage are recorded per organization.

## Security summary

- Passwords hashed with bcrypt (cost 12); account lockout after repeated failures; per-IP rate limits on auth endpoints
- HttpOnly, SameSite=Lax, Secure (in production) session cookies backed by revocable DB sessions; password changes and resets revoke other sessions
- Strict Content-Security-Policy (no inline scripts, no third-party script origins); Font Awesome and CSS are self-hosted
- Cross-origin state-changing requests rejected; request body size limits; uploads validated by content signature, not file extension
- Every query is scoped to the caller's organization, and tenant isolation is covered by tests
- AI prompts fence user documents and library passages as data and instruct the model not to invent citations; only sources the answer actually cites are shown; output is marked as requiring lawyer review
- Optional TOTP two-step verification (recovery codes stored hashed); enabling it signs out other sessions
- Client-portal users can only reach `/api/portal`, `/api/auth` and `/api/reference`, enforced centrally and covered by tests
- Payments: amounts are never taken from the browser; the charge is verified with Tap (amount, currency, organization) before a plan is extended

## Launch checklist (outside the code)

- [ ] Have counsel review `/terms` and `/privacy` (`src/pages/legal.ts`) and confirm the company details and governing law
- [ ] Sign a data-processing agreement with the AI provider; consider an in-region or Azure OpenAI endpoint via `OPENAI_BASE_URL` if clients require data residency
- [ ] Configure SMTP with SPF/DKIM on the sending domain
- [ ] Confirm prices, VAT treatment and plan limits (`src/lib/plans.ts`, `src/landing.ts`, locale files)
- [ ] Enable database backups and uptime monitoring on `/ready`
- [ ] Load the GCC laws you want in the shared library (as a platform admin: Law library → Add, visibility "Shared library")
- [ ] Tap: complete merchant onboarding, set `TAP_SECRET_KEY`/`TAP_WEBHOOK_SECRET`, register the webhook URL, and run one live payment end to end
- [ ] Decide on VAT for subscriptions (`PLATFORM_VAT_PERCENT`) once VAT-registered
- [ ] Remove legacy files no longer used by the app: `src/renderer.tsx`, `src/services/ai-simple.ts`, `src/services/database.ts`, `public/static/app.js`, `public/static/style.css`, `public/static/test-navigation.js`, `standalone.html`, `vite.config.ts`, `wrangler.jsonc`, `ecosystem.config.cjs`, `.dev.vars`, and the sample `*.txt` files in the repository root
