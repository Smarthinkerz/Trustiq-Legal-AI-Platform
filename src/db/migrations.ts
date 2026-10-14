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
    },
  {
    version: 9,
    name: 'e_signatures',
    sql: `
CREATE TABLE signature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','ar')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_name TEXT,
  file_mime TEXT,
  file_data BYTEA,
  file_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','declined','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX signature_requests_org_idx ON signature_requests (org_id, created_at DESC);
CREATE TABLE signature_signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','viewed','signed','declined')),
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  decline_reason TEXT,
  signed_name TEXT,
  signature_image BYTEA,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX signature_signers_request_idx ON signature_signers (request_id);
CREATE INDEX signature_signers_client_idx ON signature_signers (client_id);
CREATE TABLE signature_tokens (
  token_hash TEXT PRIMARY KEY,
  signer_id UUID NOT NULL REFERENCES signature_signers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE signature_events (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  signer_id UUID REFERENCES signature_signers(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX signature_events_request_idx ON signature_events (request_id, id);
`
    },
  {
    version: 10,
    name: 'signed_documents',
    sql: `
ALTER TABLE signature_requests ADD COLUMN signed_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;
`
  },
  {
    version: 11,
    name: 'zatca_invoicing',
    sql: `
ALTER TABLE invoices ADD COLUMN issued_at TIMESTAMPTZ;
UPDATE invoices SET issued_at = issue_date::timestamptz WHERE issue_date IS NOT NULL;
ALTER TABLE clients ADD COLUMN vat_number TEXT;
`
  },
  {
    version: 12,
    name: 'hijri_dates',
    sql: `
ALTER TABLE users ADD COLUMN hijri_dates TEXT NOT NULL DEFAULT 'auto' CHECK (hijri_dates IN ('auto', 'on', 'off'));
`
  },
  {
    version: 13,
    name: 'document_requests',
    sql: `
CREATE TABLE document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_reminded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_requests_org_idx ON document_requests (org_id, status, created_at DESC);
CREATE INDEX document_requests_client_idx ON document_requests (client_id, status);

CREATE TABLE document_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES document_requests(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'accepted', 'rejected')),
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT
);
CREATE INDEX document_request_items_request_idx ON document_request_items (request_id, position);
`
  },
  {
    version: 14,
    name: 'hearing_records',
    sql: `
CREATE TABLE hearing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  event_id UUID NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('adjourned', 'reserved', 'judgment', 'settled', 'dismissed', 'other')),
  summary TEXT NOT NULL,
  next_steps TEXT,
  next_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  shared_with_client BOOLEAN NOT NULL DEFAULT false,
  client_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hearing_records_case_idx ON hearing_records (case_id, created_at DESC);
`
  },
  {
    version: 15,
    name: 'matter_budgets',
    sql: `
ALTER TABLE cases ADD COLUMN fee_arrangement TEXT NOT NULL DEFAULT 'hourly' CHECK (fee_arrangement IN ('hourly', 'fixed', 'capped', 'contingency'));
ALTER TABLE cases ADD COLUMN fee_amount NUMERIC(18,3);
ALTER TABLE cases ADD COLUMN budget_amount NUMERIC(18,3);
ALTER TABLE cases ADD COLUMN budget_alert_level INTEGER NOT NULL DEFAULT 0;
`
  },
  {
    version: 16,
    name: 'conflict_checks',
    sql: `
CREATE TABLE conflict_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('client', 'case')),
  subject_id UUID NOT NULL,
  subject_name TEXT NOT NULL,
  matches JSONB NOT NULL DEFAULT '[]',
  decision TEXT NOT NULL CHECK (decision IN ('clear', 'override')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conflict_checks_subject_idx ON conflict_checks (org_id, subject_type, subject_id, created_at DESC);
CREATE INDEX conflict_checks_org_idx ON conflict_checks (org_id, created_at DESC);
`
  },
  {
    version: 17,
    name: 'case_briefs',
    sql: `
CREATE TABLE case_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('en', 'ar')),
  content JSONB NOT NULL,
  model TEXT,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX case_briefs_case_idx ON case_briefs (case_id, language, created_at DESC);
`
  },
  {
    version: 18,
    name: 'invoice_online_payments',
    sql: `
ALTER TABLE organizations ADD COLUMN tap_secret_sealed TEXT;
ALTER TABLE organizations ADD COLUMN tap_key_mode TEXT;
ALTER TABLE organizations ADD COLUMN tap_key_hint TEXT;
ALTER TABLE organizations ADD COLUMN tap_connected_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN pay_token TEXT;
CREATE UNIQUE INDEX invoices_pay_token_key ON invoices (pay_token) WHERE pay_token IS NOT NULL;
CREATE TABLE invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('manual', 'online')),
  charge_id TEXT,
  amount NUMERIC(14,3) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'paid', 'failed', 'cancelled')),
  provider_status TEXT,
  failure_message TEXT,
  payer_email TEXT,
  needs_refund BOOLEAN NOT NULL DEFAULT false,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoice_payments_charge_key ON invoice_payments (charge_id) WHERE charge_id IS NOT NULL;
CREATE INDEX invoice_payments_invoice_idx ON invoice_payments (invoice_id, created_at DESC);
`
  },
  {
    version: 19,
    name: 'lead_intake',
    sql: `
ALTER TABLE leads ADD COLUMN intake JSONB;
ALTER TABLE leads ADD COLUMN intake_model TEXT;
ALTER TABLE leads ADD COLUMN intake_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN urgency TEXT CHECK (urgency IN ('urgent', 'soon', 'routine'));
ALTER TABLE leads ADD COLUMN conflicts JSONB;
ALTER TABLE leads ADD COLUMN replied_at TIMESTAMPTZ;
`
  },
  {
    version: 20,
    name: 'whatsapp_reminders',
    sql: `
ALTER TABLE organizations ADD COLUMN wa_token_sealed TEXT;
ALTER TABLE organizations ADD COLUMN wa_phone_number_id TEXT;
ALTER TABLE organizations ADD COLUMN wa_display_phone TEXT;
ALTER TABLE organizations ADD COLUMN wa_connected_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN wa_settings JSONB NOT NULL DEFAULT '{}';
ALTER TABLE clients ADD COLUMN language TEXT CHECK (language IN ('en', 'ar'));
ALTER TABLE clients ADD COLUMN whatsapp_opt_in_at TIMESTAMPTZ;
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hearing', 'invoice', 'documents', 'test')),
  entity_id UUID,
  ref TEXT NOT NULL DEFAULT '',
  to_phone TEXT NOT NULL,
  template TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  wamid TEXT,
  error TEXT,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_messages_once ON whatsapp_messages (kind, entity_id, ref) WHERE entity_id IS NOT NULL;
CREATE INDEX whatsapp_messages_org_idx ON whatsapp_messages (org_id, created_at DESC);
`
  },
  {
    version: 21,
    name: 'blog_media',
    sql: `
CREATE TABLE blog_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  file_name TEXT,
  alt TEXT,
  source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'ai')),
  data BYTEA NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE blog_media ALTER COLUMN data SET STORAGE EXTERNAL;
CREATE INDEX blog_media_org_idx ON blog_media (org_id, created_at DESC);
ALTER TABLE blog_posts ADD COLUMN cover_media_id UUID REFERENCES blog_media(id) ON DELETE SET NULL;
ALTER TABLE blog_posts ADD COLUMN cover_alt TEXT;
`
  },
  {
    version: 22,
    name: 'document_translation',
    sql: `
ALTER TABLE documents ADD COLUMN translated_from UUID REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN translation_status TEXT CHECK (translation_status IN ('running', 'done', 'failed'));
ALTER TABLE documents ADD COLUMN translation_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN translation_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN translation_error TEXT;
ALTER TABLE documents ADD COLUMN translation_heartbeat TIMESTAMPTZ;
CREATE INDEX documents_translated_from_idx ON documents (translated_from);
CREATE TABLE glossary_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  term_en TEXT NOT NULL,
  term_ar TEXT NOT NULL,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX glossary_terms_org_en_idx ON glossary_terms (org_id, lower(term_en));
`
  },
  {
    version: 23,
    name: 'client_credentials',
    sql: `
CREATE TABLE client_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('power_of_attorney', 'civil_id', 'passport', 'residence', 'commercial_registration', 'trade_licence', 'other')),
  label TEXT,
  number TEXT,
  issued_by TEXT,
  issued_on DATE,
  expires_on DATE,
  scope TEXT,
  all_cases BOOLEAN NOT NULL DEFAULT true,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  notes TEXT,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES client_credentials(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_credentials_client_idx ON client_credentials (client_id);
CREATE INDEX client_credentials_expiry_idx ON client_credentials (org_id, expires_on) WHERE revoked_at IS NULL AND replaced_by IS NULL;
CREATE TABLE client_credential_cases (
  credential_id UUID NOT NULL REFERENCES client_credentials(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  PRIMARY KEY (credential_id, case_id)
);
CREATE INDEX client_credential_cases_case_idx ON client_credential_cases (case_id);
`
  },
  {
    version: 24,
    name: 'client_kyc',
    sql: `
CREATE TABLE client_kyc (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  identity_verified BOOLEAN NOT NULL DEFAULT false,
  identity_method TEXT,
  nationality TEXT,
  residence_country TEXT,
  occupation TEXT,
  purpose TEXT,
  source_of_funds TEXT,
  source_of_wealth TEXT,
  pep BOOLEAN NOT NULL DEFAULT false,
  pep_details TEXT,
  high_risk_country BOOLEAN NOT NULL DEFAULT false,
  cash_involved BOOLEAN NOT NULL DEFAULT false,
  complex_structure BOOLEAN NOT NULL DEFAULT false,
  non_face_to_face BOOLEAN NOT NULL DEFAULT false,
  beneficial_owners JSONB NOT NULL DEFAULT '[]',
  sanctions_checked_on DATE,
  sanctions_lists TEXT,
  sanctions_match BOOLEAN NOT NULL DEFAULT false,
  sanctions_notes TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  risk_override TEXT CHECK (risk_override IN ('low', 'medium', 'high')),
  override_reason TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'approved', 'rejected')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  next_review_on DATE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_kyc_org_idx ON client_kyc (org_id, status, next_review_on);
`
  },
  {
    version: 25,
    name: 'client_funds',
    sql: `
CREATE TABLE client_fund_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'disbursement', 'applied', 'refund')),
  delta NUMERIC(14,3) NOT NULL,
  currency TEXT NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  method TEXT CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'card', 'other')),
  reference TEXT,
  receipt_no TEXT,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  reversal_of UUID REFERENCES client_fund_entries(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_fund_entries_client_idx ON client_fund_entries (client_id, currency, entry_date, created_at);
CREATE INDEX client_fund_entries_org_idx ON client_fund_entries (org_id, created_at DESC);
CREATE UNIQUE INDEX client_fund_entries_reversal_key ON client_fund_entries (reversal_of) WHERE reversal_of IS NOT NULL;
CREATE UNIQUE INDEX client_fund_entries_receipt_key ON client_fund_entries (org_id, receipt_no) WHERE receipt_no IS NOT NULL;
ALTER TABLE organizations ADD COLUMN fund_receipt_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_method_check;
ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_method_check CHECK (method IN ('manual', 'online', 'client_funds'));
`
  },
  {
    version: 26,
    name: 'clause_bank_playbook',
    sql: `
CREATE TABLE clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  body_en TEXT,
  body_ar TEXT,
  note TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (body_en IS NOT NULL OR body_ar IS NOT NULL)
);
CREATE INDEX clauses_org_idx ON clauses (org_id, category, lower(title));
CREATE TABLE playbook_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  topic TEXT NOT NULL,
  standard_position TEXT NOT NULL,
  fallback_position TEXT,
  red_flags TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  clause_id UUID REFERENCES clauses(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX playbook_rules_org_idx ON playbook_rules (org_id, active, category);
CREATE TABLE playbook_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_version INTEGER NOT NULL,
  language TEXT NOT NULL,
  acting_for TEXT,
  result JSONB NOT NULL,
  model TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX playbook_reviews_doc_idx ON playbook_reviews (document_id, created_at DESC);
`
  },
  {
    version: 27,
    name: 'engagement_letters',
    sql: `
CREATE TABLE engagement_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'ar')),
  terms JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX engagement_letters_case_idx ON engagement_letters (case_id, created_at DESC);
CREATE INDEX engagement_letters_org_idx ON engagement_letters (org_id, created_at DESC);
`
  },
  {
    version: 28,
    name: 'onboarding_checks',
    sql: `
ALTER TABLE organizations ADD COLUMN onboarding_checks TEXT[] NOT NULL DEFAULT ARRAY['conflict', 'kyc', 'poa', 'engagement'];
`
  },
  {
    version: 29,
    name: 'hearing_attendee',
    sql: `
ALTER TABLE events ADD COLUMN attendee_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX events_org_kind_start_idx ON events (org_id, kind, starts_at);
`
  },
  {
    version: 30,
    name: 'judgments_enforcement',
    sql: `
CREATE TABLE case_judgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  judgment_date DATE NOT NULL,
  court TEXT,
  degree TEXT NOT NULL DEFAULT 'first_instance' CHECK (degree IN ('first_instance', 'appeal', 'supreme', 'arbitration', 'other')),
  judgment_no TEXT,
  result TEXT NOT NULL CHECK (result IN ('won', 'partial', 'lost', 'other')),
  summary TEXT,
  currency TEXT NOT NULL,
  amount_awarded NUMERIC(18,3) NOT NULL DEFAULT 0,
  costs_awarded NUMERIC(18,3) NOT NULL DEFAULT 0,
  appeal_deadline DATE,
  appeal_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  appeal_decision TEXT NOT NULL DEFAULT 'pending' CHECK (appeal_decision IN ('pending', 'appeal', 'no_appeal', 'appealed_by_other')),
  enforcement_status TEXT NOT NULL DEFAULT 'not_started' CHECK (enforcement_status IN ('not_started', 'filed', 'in_progress', 'collected', 'unenforceable', 'closed')),
  enforcement_file_no TEXT,
  enforcement_court TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX case_judgments_case_idx ON case_judgments (case_id, judgment_date DESC);
CREATE INDEX case_judgments_org_idx ON case_judgments (org_id, enforcement_status);
CREATE TABLE judgment_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  judgment_id UUID NOT NULL REFERENCES case_judgments(id) ON DELETE CASCADE,
  collected_on DATE NOT NULL,
  amount NUMERIC(18,3) NOT NULL CHECK (amount > 0),
  source TEXT,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX judgment_collections_judgment_idx ON judgment_collections (judgment_id, collected_on);
`
   },
  {
    version: 31,
    name: 'time_capture',
    sql: `
ALTER TABLE time_entries ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX time_entries_source_key ON time_entries (user_id, source_key) WHERE source_key IS NOT NULL;
CREATE TABLE time_suggestion_dismissals (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
`
  },
  {
    version: 32,
    name: 'client_updates',
    sql: `
CREATE TABLE case_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('en', 'ar')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  ai_drafted BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  emailed INT NOT NULL DEFAULT 0,
  read_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX case_updates_case_idx ON case_updates (case_id, created_at DESC);
CREATE INDEX case_updates_published_idx ON case_updates (org_id, case_id, published_at DESC) WHERE status = 'published';
`
  },
  {
    version: 33,
    name: 'legal_notices',
    sql: `
CREATE TABLE legal_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
  party TEXT NOT NULL,
  subject TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('notary', 'court_bailiff', 'courier', 'registered_mail', 'email', 'whatsapp', 'hand', 'other')),
  reference_no TEXT,
  notice_date DATE NOT NULL,
  delivered_on DATE,
  response_days INT CHECK (response_days BETWEEN 1 AND 365),
  response_due DATE,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'responded', 'no_response', 'failed', 'withdrawn', 'closed')),
  response_on DATE,
  response_summary TEXT,
  amount NUMERIC(16, 3),
  currency TEXT,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  deadline_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX legal_notices_case_idx ON legal_notices (case_id, notice_date DESC);
CREATE INDEX legal_notices_open_idx ON legal_notices (org_id, response_due) WHERE status IN ('sent', 'delivered');
`
  },
  {
    version: 34,
    name: 'expert_referrals',
    sql: `
CREATE TABLE expert_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  expert_name TEXT,
  expert_type TEXT NOT NULL DEFAULT 'accounting' CHECK (expert_type IN ('accounting', 'engineering', 'medical', 'real_estate', 'it', 'other')),
  expert_contact TEXT,
  court_ref TEXT,
  referral_date DATE NOT NULL,
  scope TEXT,
  fee_amount NUMERIC(16, 3),
  currency TEXT,
  fee_payer TEXT NOT NULL DEFAULT 'client' CHECK (fee_payer IN ('client', 'other_party', 'shared', 'court')),
  fee_due DATE,
  fee_paid_on DATE,
  memo_due DATE,
  report_due DATE,
  report_filed_on DATE,
  report_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  report_result TEXT CHECK (report_result IN ('favourable', 'partly', 'unfavourable')),
  report_summary TEXT,
  objection_days INT CHECK (objection_days BETWEEN 1 AND 365),
  objection_due DATE,
  objections_filed_on DATE,
  closed BOOLEAN NOT NULL DEFAULT false,
  event_ids JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expert_referrals_case_idx ON expert_referrals (case_id, referral_date DESC);
CREATE INDEX expert_referrals_open_idx ON expert_referrals (org_id) WHERE NOT closed;
`
  },
  {
    version: 35,
    name: 'whatsapp_case_updates',
    sql: `
ALTER TABLE whatsapp_messages DROP CONSTRAINT whatsapp_messages_kind_check;
ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_kind_check CHECK (kind IN ('hearing', 'invoice', 'documents', 'case_update', 'test'));
`
  },
  {
    version: 36,
    name: 'client_originals',
    sql: `
CREATE TABLE client_originals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_no INT NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('cheque', 'contract', 'title_deed', 'poa', 'id_document', 'certificate', 'court_document', 'other')),
  description TEXT NOT NULL,
  reference_no TEXT,
  amount NUMERIC(16, 3),
  currency TEXT,
  copies INT NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 999),
  received_on DATE NOT NULL,
  received_from TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'lodged', 'returned')),
  lodged_with TEXT,
  returned_on DATE,
  returned_to TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, receipt_no)
);
CREATE INDEX client_originals_client_idx ON client_originals (client_id, received_on DESC);
CREATE INDEX client_originals_case_idx ON client_originals (case_id);
CREATE TABLE original_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  original_id UUID NOT NULL REFERENCES client_originals(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('received', 'moved', 'lodged', 'retrieved', 'returned')),
  on_date DATE NOT NULL,
  location TEXT,
  party TEXT,
  note TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX original_movements_original_idx ON original_movements (original_id, created_at);
`
  },
  {
    version: 37,
    name: 'matter_closing',
    sql: `
ALTER TABLE organizations ADD COLUMN retention_years INT NOT NULL DEFAULT 10 CHECK (retention_years BETWEEN 1 AND 50);
ALTER TABLE cases ADD COLUMN closing_outcome TEXT CHECK (closing_outcome IN ('won', 'partly_won', 'lost', 'settled', 'withdrawn', 'advice_given', 'transaction_completed', 'other'));
ALTER TABLE cases ADD COLUMN closing_note TEXT;
ALTER TABLE cases ADD COLUMN closed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cases ADD COLUMN retain_until DATE;
UPDATE cases SET retain_until = closed_on + interval '10 years' WHERE status = 'closed' AND closed_on IS NOT NULL;
CREATE INDEX cases_retention_idx ON cases (org_id, retain_until) WHERE status = 'closed';
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
