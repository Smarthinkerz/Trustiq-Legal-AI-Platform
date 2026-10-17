# Personal data breach response runbook (draft)

Goal: contain the breach, decide quickly whether it must be notified, and give each affected firm (the controller) what it needs to notify the authority and individuals within the legal deadline. Reported regulation text sets **72 hours** for notifying the authority; confirm the current rule with counsel. Count the clock from when TrustiqLegal becomes aware.

## Roles
- **Incident lead:** [●] (decides, keeps the timeline)
- **Technical lead:** [●] (containment, evidence, fixes)
- **Data protection officer:** [●] (legal assessment, notices, contact with firms and the authority)
- **Communications:** [●] (messages to firms)

## First hour
1. Open an incident record: time noticed, who noticed, what was seen. Keep every note with timestamps.
2. Contain without destroying evidence: revoke exposed keys and sessions (sessions are stored in the database and can be deleted per user or for everyone), rotate `ENCRYPTION_KEY`-protected secrets if exposure is possible, block the source, take the affected service offline if needed.
3. Preserve evidence: copy application logs (JSON, with request IDs), database audit log (`audit_log`), webhook audit rows and provider logs.

## Within 24 hours
4. Scope: which firms, which data categories (see the record of processing), how many people, whether data was read, changed, deleted or only exposed. Use the audit log (downloads, exports, AI use) and request logs.
5. Assess the risk to the people concerned (special categories, financial data, identity documents, legal privilege raise it).
6. Tell each affected firm what is known so far, by email and phone to the owner, even if facts are incomplete.

## Within 72 hours
7. Give each affected firm a written notice they can use for their own notification: nature of the breach, categories and approximate number of people and records, likely consequences, measures taken and proposed, DPO contact.
8. Where TrustiqLegal itself must notify the authority (as processor or for its own data, such as user accounts), file the notice through [●: authority channel].
9. Record the decision either way, with reasons.

## After
10. Root cause and fix; test the fix; check backups were not affected.
11. Written report within 14 days: timeline, impact, causes, fixes, lessons. Share the summary with affected firms.
12. Update this runbook and the sub-processor list if a sub-processor was involved.

## Contacts
- Authority: [●]
- Hosting provider security contact: [●]
- AI provider security contact: [●]
- Cyber insurance: [●]
