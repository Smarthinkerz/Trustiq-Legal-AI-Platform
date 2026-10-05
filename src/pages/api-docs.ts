import { esc, head } from './layout'

type Endpoint = [method: string, path: string, description: string]

const SECTIONS: { title: string; intro?: string; endpoints: Endpoint[] }[] = [
  {
    title: 'Account',
    endpoints: [['GET', '/me', 'The organization, the team member the key acts as, and the key\'s access level. Use it to test a key.']]
  },
  {
    title: 'Clients',
    endpoints: [
      ['GET', '/clients', 'List clients. Query: q (search), archived=true|false, page, pageSize (max 100).'],
      ['GET', '/clients/{id}', 'A client with their cases and documents.'],
      ['POST', '/clients', 'Create a client. Body: name (required), kind (individual|company), name_ar, email, phone, id_number, address, notes.'],
      ['PATCH', '/clients/{id}', 'Update any of the fields above, or archived=true|false.'],
      ['DELETE', '/clients/{id}', 'Delete a client (owner, admin or lawyer keys).'],
      ['GET', '/clients/{id}/messages', 'Client-portal message thread.'],
      ['POST', '/clients/{id}/messages', 'Send a message to the client\'s portal. Body: body, case_id.']
    ]
  },
  {
    title: 'Cases',
    endpoints: [
      ['GET', '/cases', 'List cases. Query: q, status (active|pending|under_review|on_hold|closed|open), priority, client_id, assigned_to, page, pageSize.'],
      ['GET', '/cases/{id}', 'A case with documents, events and activity.'],
      ['POST', '/cases', 'Create a case. Body: title, jurisdiction (required: oman, uae, ksa, qatar, kuwait, bahrain, difc, adgm, gcc, egypt, jordan, lebanon, iraq, morocco, tunisia, algeria, libya, international), client_id, title_ar, practice_area, status, priority, court, opposing_party, assigned_to, estimated_value, currency, opened_on, description.'],
      ['PATCH', '/cases/{id}', 'Update any of the fields above.'],
      ['POST', '/cases/{id}/notes', 'Add a note to the case timeline. Body: body.'],
      ['DELETE', '/cases/{id}', 'Delete a case.']
    ]
  },
  {
    title: 'Documents',
    endpoints: [
      ['GET', '/documents', 'List documents. Query: q, case_id, client_id, status (draft|review|final), page, pageSize.'],
      ['GET', '/documents/{id}', 'A document with its text content and metadata.'],
      ['POST', '/documents', 'Create a text document. Body: title, content, doc_type, language (en|ar), case_id, client_id, status, shared_with_client.'],
      ['POST', '/documents/upload', 'Upload a PDF, Word (.docx) or text file as multipart/form-data: file (required), title, doc_type, language, case_id, client_id. Scanned PDFs are read with OCR.'],
      ['PATCH', '/documents/{id}', 'Update title, content, status, case_id, client_id or shared_with_client. Content changes create a new version.'],
      ['GET', '/documents/{id}/file', 'Download the original uploaded file.'],
      ['GET', '/documents/{id}/export', 'Download as Word on the firm letterhead. Query: format=docx|txt, letterhead=true|false.'],
      ['DELETE', '/documents/{id}', 'Delete a document.']
    ]
  },
  {
    title: 'Time, expenses and invoices',
    endpoints: [
      ['GET', '/billing/time', 'Time entries. Query: case_id, user_id, from, to (YYYY-MM-DD), unbilled=true, page, pageSize.'],
      ['POST', '/billing/time', 'Log time. Body: case_id, minutes, description, work_date, rate, billable.'],
      ['GET', '/billing/expenses', 'Expenses (same filters as time).'],
      ['POST', '/billing/expenses', 'Add an expense. Body: case_id, amount, description, incurred_on, billable.'],
      ['GET', '/billing/invoices', 'Invoices. Query: status (draft|issued|paid|void|outstanding|overdue), client_id, case_id, q, page, pageSize.'],
      ['GET', '/billing/invoices/{id}', 'An invoice with its lines.'],
      ['POST', '/billing/invoices', 'Create a draft invoice. Body: client_id, case_id, time_entry_ids, expense_ids, fixed_lines [{description, quantity, unit_price}], currency, vat_rate, notes.'],
      ['POST', '/billing/invoices/{id}/issue', 'Issue a draft (assigns the invoice number).'],
      ['POST', '/billing/invoices/{id}/payments', 'Record a payment. Body: amount.'],
      ['GET', '/billing/invoices/{id}/export', 'Download the tax invoice as Word. Query: lang=en|ar.']
    ]
  },
  {
    title: 'Tasks and calendar',
    endpoints: [
      ['GET', '/tasks', 'Tasks. Query: scope=mine|all, status=active|open|in_progress|done, case_id.'],
      ['POST', '/tasks', 'Create a task. Body: title, case_id, assigned_to, due_date, priority, description.'],
      ['PATCH', '/tasks/{id}', 'Update a task, e.g. status=done.'],
      ['GET', '/events', 'Hearings, deadlines and meetings. Query: from, to (ISO 8601 date-times, e.g. 2026-10-01T00:00:00Z), case_id, limit.'],
      ['POST', '/events', 'Create an event. Body: title, kind (hearing|deadline|filing|meeting|reminder), starts_at (ISO), ends_at, all_day, location, case_id, notes.']
    ]
  }
]

const METHOD_COLORS: Record<string, string> = { GET: 'bg-emerald-100 text-emerald-800', POST: 'bg-sky-100 text-sky-800', PATCH: 'bg-amber-100 text-amber-800', DELETE: 'bg-red-100 text-red-700', PUT: 'bg-violet-100 text-violet-800' }

export function apiDocsPage(opts: { assetVersion: string; appUrl: string }) {
  const base = `${opts.appUrl}/api/v1`
  const code = (s: string) => `<pre class="bg-slate-900 text-slate-100 rounded-lg p-4 text-sm overflow-x-auto" dir="ltr"><code>${esc(s)}</code></pre>`
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>${head({ title: 'API documentation – TrustiqLegal', description: 'REST API for TrustiqLegal: clients, cases, documents, time, invoices, tasks and calendar.', assetVersion: opts.assetVersion })}</head>
<body class="bg-white text-slate-800">
  <header class="border-b border-slate-200">
    <div class="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 font-bold text-brand-900"><i class="fas fa-scale-balanced"></i> TrustiqLegal <span class="text-slate-400 font-normal">· API</span></a>
      <a href="/app#/settings?tab=api" class="text-sm font-medium text-brand-700 hover:underline">Manage API keys</a>
    </div>
  </header>
  <main class="prose-legal max-w-4xl mx-auto px-4 py-12">
    <h1>TrustiqLegal API</h1>
    <p class="muted">Version 1 · JSON over HTTPS</p>
    <p>Connect TrustiqLegal to your accounting system, website intake forms, document tools or automation platforms such as Zapier and Make. The API gives programmatic access to the same clients, cases, documents, time entries, invoices, tasks and calendar events your team sees in the app.</p>

    <h2>1. Create an API key</h2>
    <p>An owner or admin creates keys in <a href="/app#/settings?tab=api">Settings → API keys</a>. Choose <strong>Read only</strong> unless the integration needs to create or change records. The full key is shown once — store it in your integration's secret settings. Revoke a key at any time; it stops working immediately.</p>
    <ul>
      <li>A key acts with the permissions of the team member who created it, limited to read-only if created that way. If that person is removed from the firm, their keys stop working.</li>
      <li>Keep keys on servers only. Never put a key in a website, mobile app or browser code, and never share it by email or chat.</li>
      <li>Every change made with a key is recorded in the audit log with the key's name.</li>
    </ul>

    <h2>2. Authenticate</h2>
    <p>Send the key in the <code>Authorization</code> header on every request. Browser cookies are not accepted on the API.</p>
    ${code(`curl ${base}/me \\\n  -H "Authorization: Bearer tq_live_your_key_here"`)}

    <h2>3. Examples</h2>
    <p>List open cases for a client:</p>
    ${code(`curl "${base}/cases?status=open&client_id=CLIENT_UUID" \\\n  -H "Authorization: Bearer $TRUSTIQ_API_KEY"`)}
    <p>Create a client (requires a read &amp; write key):</p>
    ${code(`curl -X POST ${base}/clients \\\n  -H "Authorization: Bearer $TRUSTIQ_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"kind":"company","name":"Gulf Trading LLC","name_ar":"شركة الخليج للتجارة","email":"legal@gulftrading.example"}'`)}
    <p>Upload a document to a case:</p>
    ${code(`curl -X POST ${base}/documents/upload \\\n  -H "Authorization: Bearer $TRUSTIQ_API_KEY" \\\n  -F "file=@contract.pdf" -F "case_id=CASE_UUID" -F "language=ar"`)}

    <h2>4. Responses, paging and errors</h2>
    <p>Lists return <code>{"items": [...], "total": 42, "page": 1, "pageSize": 25}</code>. Use <code>page</code> and <code>pageSize</code> (up to 100) to page through results. Dates are ISO 8601; money amounts are numbers in the record's currency.</p>
    <p>Errors return an HTTP status and <code>{"error": {"code": "...", "message": "...", "details": [...]}, "requestId": "..."}</code>:</p>
    <ul>
      <li><strong>400</strong> invalid input (see <code>details</code> for each field) · <strong>401</strong> missing, invalid, expired or revoked key · <strong>402</strong> trial or subscription ended (read access continues)</li>
      <li><strong>403</strong> read-only key or insufficient role · <strong>404</strong> not found in your organization · <strong>409</strong> conflict · <strong>429</strong> rate limit (120 requests per minute per key; honour <code>Retry-After</code>)</li>
    </ul>

    <h2>5. Endpoints</h2>
    <p>Base URL: <code>${esc(base)}</code></p>
    ${SECTIONS.map((s) => `
      <h3 class="text-base font-bold mt-6 mb-2 text-slate-900">${esc(s.title)}</h3>
      <table class="w-full text-sm border border-slate-200 rounded-lg overflow-hidden mb-2">
        <tbody>${s.endpoints.map(([m, p, d]) => `<tr class="border-b border-slate-100 align-top">
          <td class="p-2 w-20"><span class="badge ${METHOD_COLORS[m] ?? ''}">${m}</span></td>
          <td class="p-2 font-mono text-xs whitespace-nowrap" dir="ltr">${esc(p)}</td>
          <td class="p-2 text-slate-600">${esc(d)}</td></tr>`).join('')}</tbody>
      </table>`).join('')}

    <h2>6. Support</h2>
    <p>Questions or a missing endpoint? Contact your TrustiqLegal administrator or our support team, and include the <code>requestId</code> from any error response.</p>
  </main>
</body>
</html>`
}
