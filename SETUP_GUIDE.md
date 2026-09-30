# Setup Guide

**Local:** `npm install && npm run dev`, then open http://localhost:8080. No database or API keys are needed to try it.

**Production (Railway):**

1. Add a PostgreSQL service and expose its `DATABASE_URL` to the app.
2. Set `NODE_ENV=production`, `APP_URL`, `OPENAI_API_KEY`, `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` and `PLATFORM_ADMIN_EMAILS`.
3. Deploy. The build compiles CSS; migrations run automatically on start; `/ready` is the health check.

See `README.md` for configuration, operations and the launch checklist.
