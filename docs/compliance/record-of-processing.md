# Record of processing activities (draft)

TrustiqLegal acts as processor for each firm. This record lists the processing done on the firms' behalf. Firms keep their own record as controllers.

| Activity | Data subjects | Data categories | Purpose | Recipients (see sub-processors) | Retention | Security measures |
| --- | --- | --- | --- | --- | --- | --- |
| Matter and client management | Clients, opposing parties, witnesses, contacts | Names, contact details, ID and passport numbers, commercial registration, addresses, matter facts, KYC records, PEP and sanctions screening results | Running the firm's legal matters | Hosting, email | Firm's retention policy (matter closing sets a retention date), then deleted on request | Tenant isolation per firm, role-based access, audit log |
| Documents and files | As above | Contracts, court documents, scans of IDs and POAs, judgments | Document management, drafting, e-signature | Hosting, object storage (optional) | As above | Encrypted connections, access by role, download audit |
| Time, billing and client funds | Clients, firm staff | Invoices, payments, bank details on invoices, client fund ledger | Billing and accounting | Hosting, Tap (optional) | Accounting and tax retention [●: years] | Append-only funds ledger, payment verification with Tap |
| AI assistance | As above (only the data in each request) | Document text and facts sent with a request; the AI output and its check results | AI features for lawyer review | AI provider | AI use log kept with the matter | Code checks on output, AI use log, no-training terms [●] |
| Client portal and messages | Clients | Messages, uploaded files, read receipts | Communication with clients | Hosting, email, WhatsApp (optional) | With the matter | Separate client role limited to portal endpoints |
| E-signatures | Signers | Name, email, typed name, drawn signature, IP address, time, user agent | Signing documents | Hosting, email, WhatsApp (optional) | With the document | SHA-256 fingerprint of the signed text, signing audit trail |
| Firm website and leads | Website visitors, enquirers | Enquiry text, name, email, phone; chatbot conversations | Consultation requests | Hosting, AI provider (chatbot), email | Chat transcripts 90 days; leads with the firm's records | Rate limits, code filter on chatbot replies |
| Platform accounts | Firm users | Name, email, password hash, two-step secret (encrypted), sessions, audit entries | Access control | Hosting, email | While the account exists; sessions until expiry | bcrypt passwords, revocable sessions, two-step verification |

Security measures in general: HTTPS only, strict content security policy, per-firm data isolation tested automatically, secrets encrypted with AES-256-GCM, backups with point-in-time recovery [●: confirm with provider], audit log of sign-ins, changes, downloads and exports.
