# Sub-processors (draft)

Services that receive personal data when a firm uses TrustiqLegal. Firms are told at least 30 days before a new sub-processor is added (see the DPA). "Optional" means it is used only if the platform or the firm turns the feature on.

| Service | What it receives | Purpose | Location today | Notes |
| --- | --- | --- | --- | --- |
| Railway (application and PostgreSQL hosting) | All firm data: matters, clients, documents and files, users, audit log | Hosting the application and database | Outside the GCC [●: confirm region] | To be replaced by an Oman provider for Omani firms (hosting plan, section 6) |
| AI model provider (OpenAI-compatible API) [●: provider] | Text of the request: document text, matter facts, questions, law passages | AI features (research, drafting, readers, translation, summaries) | [●] | Contract must state no training on customer data and zero or minimal retention. Can be switched to an in-region or self-hosted endpoint by configuration |
| Speech-to-text (same AI provider) | Voice notes uploaded for dictation | Transcription | [●] | Only when a user records or uploads a voice note |
| Embeddings and reranker service (optional) | Law library passages and research questions (no client files) | Semantic search in the law library | Self-hosted or [●] | Recommended: self-hosted in Oman |
| Email provider (SMTP) [●] | Recipient names and emails, message content (invitations, digests, client notices) | Sending email | [●] | Choose an Oman or GCC relay when hosting moves |
| Tap Payments (optional) | Payer name, email, amount, card handled by Tap | Subscription payments; each firm's own invoice payments | GCC | Card data never reaches TrustiqLegal |
| Meta WhatsApp Cloud API (optional, per firm) | Client phone number and reminder text | Reminders to clients who agreed | Meta | Connected by each firm with its own number |
| Google Calendar (optional, per user) | Event titles, times, matter references | One-way calendar sync | Google | Only for users who connect their Google account |
| Object storage (optional) [●] | Uploaded files | File storage when `STORAGE_DRIVER=s3` | [●: Oman provider] | Planned for the Oman move |
| SmarThinkerz Hub (firm checkout) | Firm name, admin email, seat counts | Firm subscriptions | [●] | |

Not sub-processors: the firm's own clients and the public visiting a firm website.
