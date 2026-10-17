# Retention schedule (draft)

Defaults built into the platform today, and the policy to confirm with counsel and with each firm.

| Data | Kept by the platform | How it is removed | To confirm |
| --- | --- | --- | --- |
| Expired sessions | Deleted hourly after expiry | Automatic | |
| Password reset and invitation tokens | 30 days after expiry | Automatic | |
| Website chatbot transcripts | 90 days after the last message | Automatic | |
| Payment webhook audit rows | `WEBHOOK_AUDIT_RETENTION_DAYS` | Automatic | Period [●] |
| Rate-limit counters (multi-instance mode) | 24 hours | Automatic | |
| Matters, documents, billing, client data | Until the firm deletes them or asks for deletion | Firm action, or a deletion request approved by the platform team | Firms set a retention date when closing a matter; deletion of financial records follows tax rules [●: years] |
| Files in object storage | Removed within an hour of the row being deleted | Database trigger queue and sweeper | Bucket versioning keeps deleted versions for [●] days |
| AI use log | With the matter or document | With the matter | |
| Backups | Daily 30 days, monthly 12 months, yearly 7 years (planned) | Expiry on the backup system | Confirm against legal duties; deleted data remains in backups until they expire |
| Firm workspace after cancellation | Read-only access, then deletion on request | Deletion request | Grace period and final deletion [●] |

Data subject requests: firms (controllers) receive requests from their clients. The platform supports access (data export from Settings, per firm), correction (editing), and deletion (firm deletes records, or the owner asks for deletion of a client's data or the whole workspace from Settings). The platform team answers firm requests within [●] days.
