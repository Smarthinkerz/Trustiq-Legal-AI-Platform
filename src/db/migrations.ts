import type { Db } from './index'

// Append-only list. Never edit a migration that has shipped; add a new one instead.
export const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ,
  case_seq INTEGER NOT NULL DEFAULT 0,
  default_jurisdiction TEXT NOT NULL DEFAULT 'oman',
  default_currency TEXT NOT NULL DEFAULT 'OMR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','lawyer','staff')),
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_org_idx ON users (org_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE auth_tokens (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('password_reset','invite')),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_org_idx ON auth_tokens (org_id, kind);

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual','company')),
  name TEXT NOT NULL,
  name_ar TEXT,
  email TEXT,
  phone TEXT,
  id_number TEXT,
  address TEXT,
  notes TEXT,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX clients_org_idx ON clients (org_id, created_at DESC);

CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  title_ar TEXT,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  practice_area TEXT,
  jurisdiction TEXT NOT NULL,
  court TEXT,
  opposing_party TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','under_review','on_hold','closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  description TEXT,
  estimated_value NUMERIC(18,3),
  currency TEXT NOT NULL DEFAULT 'OMR',
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_on DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_on DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, reference)
);
CREATE INDEX cases_org_status_idx ON cases (org_id, status);
CREATE INDEX cases_client_idx ON cases (client_id);

CREATE TABLE case_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX case_activity_case_idx ON case_activity (case_id, created_at DESC);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'other',
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
  jurisdiction TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','final')),
  source TEXT NOT NULL CHECK (source IN ('upload','ai','manual')),
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  file_data BYTEA,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documents_org_idx ON documents (org_id, created_at DESC);
CREATE INDEX documents_case_idx ON documents (case_id);

CREATE TABLE document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE TABLE document_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL,
  language TEXT NOT NULL,
  jurisdiction TEXT,
  result JSONB NOT NULL,
  model TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_analyses_doc_idx ON document_analyses (document_id, created_at DESC);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'meeting' CHECK (kind IN ('hearing','deadline','meeting','filing','reminder')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT false,
  location TEXT,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_org_start_idx ON events (org_id, starts_at);

CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  jurisdiction TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv_idx ON ai_messages (conversation_id, created_at);

CREATE TABLE ai_usage (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_org_idx ON ai_usage (org_id, created_at);

CREATE TABLE branding (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  firm_name TEXT,
  firm_name_ar TEXT,
  primary_color TEXT NOT NULL DEFAULT '#1a365d',
  accent_color TEXT NOT NULL DEFAULT '#d69e2e',
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  footer_text TEXT,
  logo BYTEA,
  logo_mime TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  meta JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (org_id, created_at DESC);
`
  },
  {
    version: 2,
    name: 'practice_platform',
    sql: `
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','admin','lawyer','staff','client'));
ALTER TABLE users ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN hourly_rate NUMERIC(12,3);
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN totp_recovery_codes TEXT[];
ALTER TABLE users ADD COLUMN calendar_token TEXT;
ALTER TABLE users ADD COLUMN notify_email BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN last_digest_on DATE;
CREATE UNIQUE INDEX users_calendar_token_key ON users (calendar_token) WHERE calendar_token IS NOT NULL;
CREATE INDEX users_client_idx ON users (client_id) WHERE client_id IS NOT NULL;

ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_kind_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_kind_check CHECK (kind IN ('password_reset','invite','mfa'));
ALTER TABLE auth_tokens ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE organizations ADD COLUMN invoice_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN vat_number TEXT;
ALTER TABLE organizations ADD COLUMN vat_rate NUMERIC(5,2);
ALTER TABLE organizations ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE organizations ADD COLUMN bank_details TEXT;
ALTER TABLE organizations ADD COLUMN invoice_footer TEXT;
ALTER TABLE organizations ADD COLUMN default_hourly_rate NUMERIC(12,3);

ALTER TABLE documents ADD COLUMN shared_with_client BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN uploaded_by_client BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN ocr BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ai_messages ADD COLUMN sources JSONB;

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_org_idx ON tasks (org_id, status, due_date);
CREATE INDEX tasks_case_idx ON tasks (case_id);
CREATE INDEX tasks_assignee_idx ON tasks (assigned_to, status);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','void')),
  issue_date DATE,
  due_date DATE,
  currency TEXT NOT NULL,
  subtotal NUMERIC(14,3) NOT NULL DEFAULT 0,
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(14,3) NOT NULL DEFAULT 0,
  total NUMERIC(14,3) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14,3) NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoices_number_key ON invoices (org_id, number) WHERE number IS NOT NULL;
CREATE INDEX invoices_org_idx ON invoices (org_id, status, issue_date);
CREATE INDEX invoices_client_idx ON invoices (client_id);

CREATE TABLE invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('time','expense','fixed')),
  description TEXT NOT NULL,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,3) NOT NULL DEFAULT 0,
  amount NUMERIC(14,3) NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id, position);

CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description TEXT NOT NULL,
  rate NUMERIC(12,3) NOT NULL DEFAULT 0,
  billable BOOLEAN NOT NULL DEFAULT true,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX time_entries_org_idx ON time_entries (org_id, work_date DESC);
CREATE INDEX time_entries_case_idx ON time_entries (case_id, invoice_id);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  incurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  amount NUMERIC(14,3) NOT NULL CHECK (amount >= 0),
  billable BOOLEAN NOT NULL DEFAULT true,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_case_idx ON expenses (case_id, invoice_id);

CREATE TABLE library_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  jurisdiction TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('law','royal_decree','regulation','ministerial_decision','judgment','circular','treaty','other')),
  title TEXT NOT NULL,
  number TEXT,
  year INTEGER,
  status TEXT NOT NULL DEFAULT 'in_force' CHECK (status IN ('in_force','amended','repealed')),
  language TEXT NOT NULL DEFAULT 'ar' CHECK (language IN ('en','ar')),
  source_url TEXT,
  notes TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_data BYTEA,
  articles INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX library_sources_org_idx ON library_sources (org_id, jurisdiction);

CREATE TABLE library_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES library_sources(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  label TEXT,
  text TEXT NOT NULL,
  search TSVECTOR NOT NULL
);
CREATE INDEX library_chunks_source_idx ON library_chunks (source_id, ordinal);
CREATE INDEX library_chunks_search_idx ON library_chunks USING GIN (search);

CREATE TABLE client_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_client BOOLEAN NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_messages_client_idx ON client_messages (client_id, created_at);

CREATE TABLE document_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'other',
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
  content TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_templates_org_idx ON document_templates (org_id, name);

`
  },
  {
    version: 3,
    name: 'subscriptions_tap',
    sql: `
ALTER TABLE organizations ADD COLUMN plan_expires_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN renewal_reminded_for DATE;

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'tap',
  charge_id TEXT,
  reference_order TEXT NOT NULL,
  plan TEXT NOT NULL,
  cycle TEXT NOT NULL DEFAULT 'monthly',
  amount NUMERIC(14,3) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','paid','failed','cancelled','refunded','partially_refunded','refunding')),
  provider_status TEXT,
  failure_message TEXT,
  paid_at TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  receipt_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_charge_key ON payments (provider, charge_id) WHERE charge_id IS NOT NULL;
CREATE INDEX payments_org_idx ON payments (org_id, created_at DESC);

CREATE TABLE processed_webhook_events (
  event_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  charge_id TEXT,
  result TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_created_idx ON webhook_events (created_at);
`
  },
  {
    version: 4,
    name: 'api_keys',
    sql: `
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  access TEXT NOT NULL DEFAULT 'read' CHECK (access IN ('read','read_write')),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_used_ip TEXT,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_org_idx ON api_keys (org_id, created_at DESC);
`
  },
  {
    version: 5,
    name: 'library_imports',
    sql: `
CREATE TABLE library_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'org' CHECK (scope IN ('org','platform')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  title TEXT,
  jurisdiction TEXT NOT NULL,
  kind TEXT,
  language TEXT,
  status_hint TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','skipped','failed')),
  detail TEXT,
  source_id UUID REFERENCES library_sources(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX library_imports_queue_idx ON library_imports (status, created_at);
CREATE INDEX library_imports_org_idx ON library_imports (org_id, created_at DESC);
CREATE INDEX library_sources_url_idx ON library_sources (source_url);
`
  },
  {
    version: 6,
    name: 'org_holidays',
    sql: `
CREATE TABLE org_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  jurisdiction TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX org_holidays_unique_idx ON org_holidays (org_id, date, coalesce(jurisdiction, ''));
CREATE INDEX org_holidays_org_idx ON org_holidays (org_id, date);
`
  },
  {
    version: 7,
    name: 'firm_website',
    sql: `
CREATE TABLE firm_sites (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  published BOOLEAN NOT NULL DEFAULT false,
  tagline TEXT,
  tagline_ar TEXT,
  about TEXT,
  about_ar TEXT,
  practice_areas TEXT[] NOT NULL DEFAULT '{}',
  contact_email TEXT,
  phone TEXT,
  whatsapp TEXT,
  address TEXT,
  address_ar TEXT,
  office_hours TEXT,
  office_hours_ar TEXT,
  chatbot_enabled BOOLEAN NOT NULL DEFAULT false,
  chatbot_greeting TEXT,
  chatbot_greeting_ar TEXT,
  chat_knowledge TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT,
  title_ar TEXT,
  excerpt TEXT,
  excerpt_ar TEXT,
  body TEXT,
  body_ar TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);
CREATE INDEX blog_posts_org_idx ON blog_posts (org_id, status, published_at DESC);
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  message TEXT,
  practice_area TEXT,
  source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form', 'chat', 'manual')),
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'declined')),
  notes TEXT,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX leads_org_idx ON leads (org_id, status, created_at DESC);
`
    },
  {
    version: 8,
    name: 'calendar_sync',
    sql: `
CREATE TABLE calendar_connections (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  account_email TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_expires_at TIMESTAMPTZ,
  calendar_id TEXT,
  needs_sync BOOLEAN NOT NULL DEFAULT true,
  sync_started_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX calendar_connections_org_idx ON calendar_connections (org_id);
CREATE TABLE calendar_sync_items (
  user_id UUID NOT NULL REFERENCES calendar_connections(user_id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (user_id, item_key)
);
`
  }
]

export async function migrate(db: Db): Promise<void> {
  await db.tx(async (q) => {
    // Serialise concurrent boots (e.g. two replicas starting at once) before touching any DDL.
    await q.query('SELECT pg_advisory_xact_lock(727274)')
    await q.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    const applied = new Set((await q.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => Number(r.version)))
    for (const m of migrations) {
      if (applied.has(m.version)) continue
      for (const stmt of splitStatements(m.sql)) await q.query(stmt)
      await q.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name])
    }
  })
}

function splitStatements(sql: string): string[] {
  return sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)
}
