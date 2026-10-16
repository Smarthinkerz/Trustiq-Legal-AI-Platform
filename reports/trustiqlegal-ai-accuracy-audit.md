# TrustiqLegal: AI accuracy and hallucination audit (Phase 1)

Date: October 16, 2026. Scope: every place the product calls an AI model, on `main` at commit 89b9227 (after PR 78). Read only: no code was changed for this audit.

Standard used: no unsourced claim reaches a user, every claim is traceable to a source, and errors are caught by code, tests and monitoring before release. No AI system can be guaranteed never to hallucinate.

## 1. Summary

- About 25 AI call sites were found. Rated by use (document analysis and OCR are rated separately for their riskier uses), that gives **28 items: 12 High, 13 Medium, 3 Low**.
- Only two features have code-level citation checking today: research chat and drafting (added in PR 78). Even there, a failed check is shown to the lawyer but never blocks or regenerates the answer.
- **No feature has a real abstain path in code.** "Say you don't know" is a prompt instruction everywhere. Research chat in library-only mode still calls the model when the library returns nothing.
- **No date, amount, name, ID or quoted clause is checked against its source by code** in any feature. Several features turn AI-read dates directly into calendar deadlines.
- **Logging:** only chat, draft, analysis and case brief write the AI use log, and it stores a hash of the output, not the output. 18 call sites record token counts only. The public homepage help chat and the firm website chat store nothing.
- **No "report a problem" control** exists on any AI output.
- **Copy:** no "100% accurate", "never wrong" or "guaranteed" claims were found in English or Arabic. Four claims go further than the code supports (section 5).

## 2. High risk items (fix first)

| # | Feature | Where | Who sees it | Why High |
|---|---|---|---|---|
| H1 | Research chat | src/routes/ai.ts:124 | Lawyers | Answers from general knowledge by default when the library has nothing; a failed citation check still returns the answer; temperature default 0.2 |
| H2 | Drafting | src/routes/ai.ts:168 | Lawyers; drafts can be shared with clients or filed | Temperature 0.3; check result not shown when the draft is created; placeholders and unverified law references can survive |
| H3 | Document analysis (compliance, risk, review) | src/routes/ai.ts:212 | Lawyers | Statutory claims come from model memory: no library grounding, no citation or quote check; quoted clauses not checked against the document |
| H4 | Contract playbook review | src/routes/playbook.ts:166 | Lawyers; AI wording can be inserted into the document | The quoted clause is never checked against the contract; contracts over 60,000 characters are cut silently, so later clauses can be reported "missing"; no AI label |
| H5 | Judgment reader | src/routes/judgments.ts:268 | Lawyers; deadlines on the calendar; summaries feed client updates | AI-read judgment date plus appeal days becomes a calendar appeal deadline with no check against the judgment text |
| H6 | Notice reader | src/routes/notices.ts:251 | Lawyers; calendar | AI-read notice date and response days become a response deadline; the model alone decides incoming or outgoing |
| H7 | Arbitration timetable reader | src/routes/arbitration.ts:286 | Lawyers; calendar; hearing steps visible in the client portal | Dates (including Hijri to Gregorian conversion done by the model) go to the calendar with no check against the order |
| H8 | Power of attorney and credential reader | src/routes/credentials.ts:173 | Lawyers and staff | Expiry date, scope and ID number pre-filled without checking the document; only a toast warns; the route has no role check |
| H9 | Client update writer | src/routes/client-updates.ts:95 | Clients by portal, email and WhatsApp | Temperature 0.3; internal next-step notes are passed to the model; no check of facts or dates; drafts even with zero facts; no review gate before publishing; clients see no AI label |
| H10 | Blog article writer | src/routes/website.ts:316 | Public visitors of firm websites | Temperature 0.4; no sources; law and article references unchecked; posts still containing [verify] can be published; not labeled as AI written |
| H11 | Firm website chatbot | src/routes/firm-site.ts:227 | Anonymous public visitors, no review | Temperature 0.3; grounded only in firm profile and blog excerpts (themselves unchecked); no output filter; replies not stored; visitors can forge earlier assistant turns, which land in the lead record |
| H12 | OCR into the law library | src/routes/library.ts:156, src/services/library-import.ts:493, src/services/extract.ts:103 | Every firm (shared library) | Unreviewed OCR text becomes the "source" the citation check trusts; direct uploads keep no OCR flag |

## 3. Medium and Low risk items

| Feature | Where | Risk | Main gap |
|---|---|---|---|
| Document analysis (summary) | src/routes/ai.ts:212 | Medium | Grounded in the document but no check of names, dates, amounts |
| Case brief | src/routes/ai.ts:265 | Medium | Grounded in the case file; dates and names not checked; empty overview rejected |
| Voice note dictation | src/routes/ai.ts:346, 355 | Medium | AI-computed dates go to the calendar; the client update part goes to portal and email after lawyer review |
| Document OCR | src/routes/documents.ts:161 | Medium | Misreads change the text other AI features rely on |
| Document translation | src/services/translation.ts:127 | Medium (near High) | No check that numbers, dates and glossary terms survive; output cut at the token limit is not detected |
| Corporate resolutions | src/routes/resolutions.ts:247 | Medium | Text gets signed; [●] placeholders not blocked before signing or Word export |
| Engagement letter scope | src/routes/engagements.ts:125 | Medium | Client contract text; only checked for being non-empty |
| Document comparison summary | src/routes/compare.ts:85 | Medium | Points are not tied to a change number, so claims cannot be traced |
| Hearing preparation note | src/routes/hearing-prep.ts:45 | Medium | No per-claim references; Word export has no AI label |
| Website lead intake | src/services/lead-intake.ts:115 | Medium | AI urgency orders the inbox; AI-extracted opposing parties are the only input to the conflict check, so a missed party means a missed conflict |
| Lead reply email draft | src/routes/website.ts:396 | Medium | Sent under the lawyer's name after review; no-fees and no-advice rules are prompt only |
| Practice insights | src/routes/reports.ts:114 | Medium | Numbers in the text not checked against the computed figures |
| Homepage help chat | src/routes/help.ts:42 | Medium | Public; temperature 0.3; history can be forged; nothing stored |
| Clause translation | src/routes/clauses.ts:104 | Low | Lawyer reviews before saving |
| Blog cover image | src/routes/website.ts:247 | Low | Decorative image |
| GCC evaluation runner | src/services/legal-eval.ts:42 | Low | Platform admins only; temperature 0 |

## 4. Findings that apply everywhere

1. Grounding and "don't invent" rules are prompt instructions; code only checks JSON shape, lengths, enums and date formats (normalize functions).
2. No abstain path in code: no feature refuses to call the model, or replaces the answer, when sources are missing or checks fail.
3. No code check of dates, amounts, names, ID numbers or quoted clauses against the source text, in any feature.
4. Temperatures: 0 to 0.1 for the readers; 0.2 for chat, analysis and brief; 0.3 for drafting, client updates, chatbots and lead replies; 0.4 for blog articles.
5. Logging: `ai_use_log` only for chat, draft, analysis and brief, with a hash of the output and a 1,000-character prompt excerpt; everything else records token counts only.
6. No "report a problem" control on any AI output.
7. Silent input truncation (12k to 60k characters) in most readers; only compare tells the user.
8. Client-role users cannot call these AI routes (src/app.ts:181), which is correct.

## 5. Copy claims

No "100% accurate", "never wrong", "error-free" or "guaranteed" wording was found (the "١٠٠" hit at src/landing.ts:163 is a plan quota). These go further than the code supports:

| Where | Text | Problem |
|---|---|---|
| README.md:36 | "Court-grade checks on AI output: every answer and draft is checked" | Only research chat and drafting are checked |
| src/landing.ts:35, Arabic at :114 | "The AI answers from your library and cites the exact article" | Chat still answers from general knowledge when the library has nothing |
| README.md:44, public/static/app/locales/en.js:2849 | The website chatbot "never gives legal advice" | Prompt instruction only |
| README.md:87 | "never returns fake answers" | Means "no stub replies when AI is off", but reads as an accuracy claim |

Good existing disclaimers: src/pages/legal.ts:14 and en.js:1955.

## 6. Proposed Phase 2 (waiting for approval)

Branch only; no merge or production deploy without written approval; no changes to Tap payments, webhooks, orders or subscriptions.

1. **Shared guard layer** used by every feature: structured JSON output with a source reference per claim, schema validation, code checks of every citation, quote, date, amount, name and ID against the source text, one regeneration on failure, then a real abstain response ("I could not find this in the available sources").
2. **Research chat**: abstain in code when the library has nothing (general knowledge only as an explicit, labeled opt-in), block and regenerate on failed checks, temperature 0.
3. **Drafting and analysis**: ground compliance and risk analysis in library passages; verify every quoted clause against the document; show the check result on creation; temperature 0 to 0.1.
4. **Date readers (judgments, notices, arbitration, credentials, dictation)**: each date must be found in the source text (with Hijri conversion done by code, not the model) before it can become a deadline; unverified dates are left empty for the lawyer; add the missing role check on the credential reader.
5. **Client updates**: remove internal notes from the input, abstain when there are no facts, check dates and facts against the case record, require lawyer confirmation before publishing, and label AI assistance.
6. **Public outputs (blog writer, website chatbot, help chat)**: block publishing while [verify] markers or unverified law references remain; label AI-written posts; the chatbot answers only from the stored firm profile, stores every reply, ignores client-supplied assistant turns, and filters legal advice by code.
7. **OCR**: flag OCR sources, require review before an OCR source is used as a citation source, and mark OCR passages in citations.
8. **Monitoring**: log every AI output with its sources (no secrets, minimal personal data) for every feature, and a "report a problem" button wherever AI output is shown, feeding an admin review list.
9. **Copy**: fix the four claims in section 5.
10. **Evaluation sets**: at least 50 cases per AI feature, including "not in the sources" traps, non-existent items and edge cases, with a runner and pass-rate report. I will give the cost of a full run before running it. Rough estimate: about 22 features times 50 cases is about 1,100 AI requests; at the configured GPT-4.1 prices ($2 input, $8 output per million tokens) and about 4,000 input and 800 output tokens each, about USD 15 to 25 per full run.

## Appendices

The appendices below are the detailed per-call-site notes (file and line, settings, grounding, validation, abstain behavior, logging, disclaimer, risk, gaps).

## Appendix A: research, drafting, analysis, brief, dictation, OCR, translation, help and website chat

### Audit A: AI call sites (read-only)

Client: `src/services/ai.ts`. `complete()` defaults are maxTokens 2000 and temp 0.2 (ai.ts:102). JSON mode is `response_format: json_object` only, with no schema. The model is `OPENAI_MODEL`, default gpt-4.1 (config.ts:16), and no call site overrides it. Transcription uses `OPENAI_TRANSCRIBE_MODEL`, default gpt-4o-transcribe (config.ts:19).

Cross-cutting findings:
- Repo-wide grep finds **no "report a problem" or feedback control** on any AI output, in the SPA, the portal or the public widgets.
- `ai_use_log` (ai-log.ts:16-39) stores only a 1000-char prompt excerpt and a **SHA-256 of the output, not the output itself**.
- `verifyAnswer` (verify.ts) only checks `[S#]` citations, quotes, article numbers, in-force status and jurisdiction. It does not check names, amounts or dates, and it never blocks output.

---

##### 1. POST /api/ai/chat (research assistant): routes/ai.ts:124
- **Settings:** default model, temp 0.2 (default), maxTokens 3000, plain text.
- **Generates:** legal research answer with inline [S#] citations.
- **Who sees it:** lawyers and staff (assistant.js). The answer can be attached to a document's AI log (ai.ts:390).
- **Grounding:** `groundQuestion` (grounding.ts:28) supplies up to 14 library passages, plus case context (ai.ts:31-51) and the last 20 history messages. The prompt says "base your answer on them first" (legal-prompts.ts:52). **By default (`library_only` false) it allows general knowledge** in an "Outside the library (unverified)" section, or entirely when there are 0 sources (legal-prompts.ts:59,64).
- **Validation:** `verifyAnswer` (ai.ts:126) and `citedRefs` filter (ai.ts:128). The result is stored and shown in `verificationPanel` (ai-verify.js:21), which opens when the status is failed. **Output is returned even when status=failed.** The "unverified" section is not checked at all.
- **No-answer:** prompt only. With 0 sources and library_only, the model is still called (legal-prompts.ts:63). There is no code abstain path.
- **Logging:** ai_messages stores the full text, cited sources and verification. ai_use_log stores sources and verification, with the output as a hash only (ai.ts:131-141). ai_usage is also written.
- **Disclaimer:** `aiDisclaimer()` under the input (assistant.js:79), plus the verification badge and a "mark reviewed" button.
- **Risk: HIGH.** Answers get pasted into filings. General-knowledge fallback is the default, and failed verification does not block the answer.
- **Gaps:**
  - Make library-only the default, or abstain in code when `sources.length===0`.
  - Block or redact sentences with errors when status is failed.
  - The output is prose with no per-claim JSON structure.
  - Store the output in ai_use_log.
  - Add a "report a problem" control.

##### 2. POST /api/ai/draft (document drafting): routes/ai.ts:168
- **Settings:** temp **0.3**, maxTokens 6000, plain text.
- **Generates:** a full contract, pleading or letter, saved as a document with source='ai'.
- **Who sees it:** lawyers and staff. **It can reach the client** if the document is marked `shared_with_client` (portal.ts:58). It can also be filed in court.
- **Grounding:** up to 8 library passages, plus instructions and case context. The prompt says not to cite anything outside the sources and to use a placeholder otherwise (legal-prompts.ts:141).
- **Validation:** `verifyAnswer` with `implicitRefs:true` (ai.ts:179). **The UI discards the verification result:** documents.js:100-103 only shows a toast. Findings are visible only in the document's AI-log panel (documents.js:320). Placeholders and party names/amounts are not checked.
- **No-answer:** prompt placeholders only.
- **Logging:** ai_use_log stores the used sources and verification, output hashed (ai.ts:187). The full document is stored.
- **Disclaimer:** `aiDisclaimer()` in the draft modal (documents.js:86). The document is marked with an AI source icon (documents.js:169).
- **Risk: HIGH.** An invented or wrong article in a pleading is a fake citation in a filing.
- **Gaps:**
  - Use temp ≤0.2.
  - Show the verification on create, and warn before sharing or export when it failed.
  - Check names, dates and amounts in the draft against the instructions.
  - Add a "report a problem" control.

##### 3. POST /api/ai/documents/:id/analyze: routes/ai.ts:212
- **Settings:** temp 0.2 (default), maxTokens 4000, json:true.
- **Generates:** summary, risk_score, issues and missing clauses. The types are summary, risk, compliance and review.
- **Who sees it:** lawyers and staff (documents.js:206-231). The analysis is not in the portal.
- **Grounding:** document text only (truncated at 60k, legal-prompts.ts:105). **No library passages.** The `compliance` type asks the model to judge compliance with jurisdiction law (legal-prompts.ts:82) from memory.
- **Validation:** `parseJsonObject` and `normalizeAnalysis` (legal-prompts.ts:154-191) only clamp shape and enums. **No citation verification.** Parties, amounts and dates are not checked against the document text. The 0-100 risk score is model-invented.
- **No-answer:** the only code path is a 502 on unparseable JSON (ai.ts:220).
- **Logging:** ai_use_log without sources or verification (ai.ts:229). The full JSON is in document_analyses.
- **Disclaimer:** `aiDisclaimer()` (documents.js:304).
- **Risk: HIGH** for compliance and risk, MEDIUM for summary. Statutory claims are made with no grounding and no verification.
- **Gaps:**
  - Ground compliance and risk in library passages and run `verifyAnswer`.
  - Add per-issue `clause` quotes, verified with `quoteMatch` against the document.
  - Check key_terms values appear in the source.

##### 4. POST /api/ai/cases/:id/brief: routes/ai.ts:265
- **Settings:** temp 0.2, maxTokens 3000, json:true.
- **Generates:** a one-page case brief.
- **Who sees it:** lawyers and staff. It can be saved as a document (ai.ts:287), which can then be shared with the client.
- **Grounding:** `gatherCaseFile` (case-brief.ts:16-59) supplies case fields, hearings, events, tasks, notes, 6 doc excerpts and fees. The prompt says "Use ONLY the information in the <case> block" (case-brief.ts:65).
- **Validation:** `normalizeBrief` (case-brief.ts:91) checks shape only. **Deadline and procedural dates, party names and amounts are not checked** against the case file.
- **No-answer:** a real code path returns 502 if `overview` is empty (ai.ts:272). Missing info goes to `open_questions` (prompt only).
- **Logging:** ai_use_log without sources or verification (ai.ts:278). The full content is in case_briefs. There is a staleness flag (ai.ts:250).
- **Disclaimer:** `brief.disclaimer` (case-brief.js:57).
- **Risk: MEDIUM.** It is an internal summary, but an invented deadline could be acted on.
- **Gaps:**
  - Require per-item source refs (event or note id) and validate the dates against the gathered rows.
  - Log the source ids.

##### 5. POST /api/ai/cases/:id/dictation: transcribe at routes/ai.ts:346 and complete at :355
- **Settings:** transcribe uses the transcribe model with case names as a hint prompt. complete uses temp **0.1**, maxTokens 3000, json:true.
- **Generates:** transcript, file note, tasks, calendar events and a **client update**.
- **Who sees it:** the lawyer reviews it in a modal. The save at cases.ts:215 writes notes, tasks and events, and **sends `client_message` to the client portal and email** (cases.ts:244-248).
- **Grounding:** transcript only. The prompt says "Use ONLY what the lawyer said" (dictation.ts:71). The model converts relative dates to absolute ones.
- **Validation:** `normalizeDictation` (dictation.ts:44) checks date and time format only. **Computed dates are not checked against the transcript.** On save, zod validates format only.
- **No-answer:** an empty transcript returns 422 (ai.ts:351). An empty note falls back to the raw transcript (ai.ts:366).
- **Logging:** **ai_usage only** (ai.ts:350,359). There is **no ai_use_log entry** and the AI output is not stored. Only the reviewed save is stored.
- **Disclaimer:** an intro text about the review step. No aiDisclaimer.
- **Risk: MEDIUM.** It is reviewed by the lawyer, but a wrong hearing date enters the calendar and the AI-written text goes to the client.
- **Gaps:**
  - Show the transcript phrase each date was derived from.
  - Add an ai_use_log entry.
  - Label the client update as AI-drafted.

##### 6. legal-eval runEvalCase: services/legal-eval.ts:42
- **Settings:** temp 0, maxTokens 2000.
- **Generates:** evaluation answers that are scored.
- **Who sees it:** platform admins only (admin.ts:15-18,132). Results go to legal_eval_runs.
- **Grounding:** the same as chat, with `libraryOnly:false`.
- **Validation:** `verifyAnswer` plus trap and expected-citation scoring.
- **No-answer:** none. A coverage gap is computed in code.
- **Logging:** ai_usage and legal_eval_runs.results. No ai_use_log, which is fine.
- **Risk: LOW.** Internal QA only. Note it uses temp 0 while production chat uses 0.2, and maxTokens 2000 versus 3000, so the eval does not exactly mirror production.

##### 7. OCR transcribePdf: ai.ts:24 via extract.ts:103,110
- **Settings:** temp 0, maxTokens 16000. Input is the PDF file part.
- **Generates:** OCR text that replaces the extracted text.
- **Callers and who sees it:**
  - documents.ts:161: staff documents. The text feeds analysis, translation and briefs.
  - library.ts:156: library sources, including **platform-scope sources shared with every firm** (library.ts:163).
  - library-import.ts:493: URL imports.
- **Validation:** only a length heuristic `useful` (≥200 chars, extract.ts:122). Failed batches insert `[Pages x–y could not be read]`. There are no confidence or page-count checks.
- **No-answer:** best-effort. It falls back to the text layer (extract.ts:124-127).
- **Logging:** ai_usage 'ocr' only.
- **Disclaimer and labeling:**
  - Documents: an `ocr` flag and badge (documents.js:258).
  - Import: notes "OCR – please spot-check" (library-import.ts:459).
  - **Direct library upload: only a toast** (library.js:73). Nothing is persisted on the source.
- **Risk:** MEDIUM for documents. **HIGH for library sources**, because OCR text becomes the authoritative passage that `verifyAnswer` trusts. A misread article number or figure would then "pass" verification.
- **Gaps:**
  - Persist an `ocr` flag on library_sources.
  - Require a review or approval state before OCR'd sources are used for grounding.
  - Surface the OCR origin in citations.

##### 8. Document translation: translation.ts:127 (runTranslation, background)
- **Settings:** temp 0, maxTokens 8000, chunks of 5k chars, glossary injected.
- **Generates:** a new translated document (source='ai', documents.ts:302-308).
- **Who sees it:** staff. It can be shared to the portal. Bilingual Word export exists.
- **Grounding:** the source chunk plus glossary terms. Faithful translation is a prompt rule (translation.ts:77).
- **Validation:** `cleanTranslation` strips wrappers only. **No check that numbers, dates, amounts, IDs and article refs survive.** Glossary compliance is not checked. Truncation at maxTokens is not detected (finish_reason is ignored in ai.ts:139).
- **No-answer:** prompt says mark gaps [unclear]. Failure status is handled in code.
- **Logging:** ai_usage 'translate' only. No ai_use_log.
- **Disclaimer:** translation status badges. No aiDisclaimer on the translated document.
- **Risk: MEDIUM** (bordering on High). A dropped or altered amount in a contract translation could be filed or shared.
- **Gaps:**
  - Compare digit sequences between source and target.
  - Check glossary terms in the output.
  - Detect `finish_reason=length`.
  - Add ai_use_log.

##### 9. Clause translation: routes/clauses.ts:104
- **Settings:** temp 0.1, maxTokens 4000.
- **Who sees it:** editors. The lawyer reviews the text before saving the clause.
- **Validation:** empty-check only (clauses.ts:107).
- **Logging:** ai_usage only.
- **Disclaimer:** `aiDisclaimer()` (clauses.js:351).
- **Risk: LOW-MEDIUM.**
- **Gaps:** same number and glossary checks as #8, and add ai_use_log.

##### 10. Platform help chat: routes/help.ts:42 (public homepage `/help/chat`)
- **Settings:** temp **0.3**, maxTokens 500.
- **Generates:** answers about TrustiqLegal features and pricing.
- **Who sees it:** **anonymous public visitors**.
- **Grounding:** the static `platformKnowledge` doc. The prompt says "Answer only from <platform>" and forbids legal advice (platform-help.ts:117-118).
- **Validation:** none. Output is truncated to 3000 chars. **The client supplies the full history, including `assistant` turns** (help.ts:15), so they can be forged.
- **No-answer:** prompt only. A fallback message exists only for AI outages and caps (help.ts:39-47).
- **Logging:** only `log.info` token counts (help.ts:43). **No ai_usage, no ai_use_log, output not stored.**
- **Disclaimer:** "Automated assistant… Not legal advice." (landing.ts chat.note, chat.js:40).
- **Risk: MEDIUM.** Visitors could be misled about prices or features, but this is not legal advice.
- **Gaps:**
  - Use low temp.
  - Store transcripts for review.
  - Check any price in the output against the plan table.
  - Add "report a problem".

##### 11. Firm website chatbot: routes/firm-site.ts:227 (public `/f/:slug/chat`)
- **Settings:** temp **0.3**, maxTokens 400.
- **Generates:** answers to public visitors on behalf of a law firm.
- **Who sees it:** **public website visitors**. The transcript is also attached to the lead (firm-site.ts:168-173) and fed to AI lead intake.
- **Grounding:** firm profile fields, free-text `chat_knowledge` (8k) and blog excerpts (website.ts:103-121). The prompt says "Answer only from <firm>", give no legal advice, and quote no laws or deadlines (website.ts:124-127).
- **Validation:** **none.** Nothing detects article numbers, deadlines, prices or legal-advice phrasing in the output. History comes from the client, and assistant turns are forgeable (firm-site.ts:199). Those forged "Assistant:" lines then land in the lead record.
- **No-answer:** prompt only. `chatFallback` is used only for outages, limits or expiry (firm-site.ts:214-222).
- **Logging:** **ai_usage only** (firm-site.ts:231). The output is not stored or reviewable by the firm except via a transcript submitted by the client.
- **Disclaimer:** "Automated assistant. General information only, not legal advice." (pages/firm-site.ts:64), plus a site footer disclaimer.
- **Risk: HIGH.** A member of the public could be given an invented fee, deadline or legal position in the firm's name, and the firm has no record of it.
- **Gaps:**
  - Server-side transcript and ai_use_log.
  - Lower temp.
  - A code filter that blocks or replaces replies containing article numbers, legal deadlines or currency amounts not present in <firm>.
  - Do not trust client-supplied assistant turns.
  - Add "report a problem".

---

#### High-risk summary
1. **/api/ai/chat:** answers fall back to unverified general knowledge by default, and failed verification never blocks the answer (ai.ts:124-142).
2. **/api/ai/draft:** temp 0.3, verification computed but hidden from the UI on create, and the draft can be shared or filed (ai.ts:168-194, documents.js:100).
3. **Document analysis (compliance/risk):** no library grounding and no citation or quote verification, so statutory claims come from model memory (ai.ts:212, legal-prompts.ts:82).
4. **Firm website chatbot:** public, temp 0.3, no output filter, no stored output (ai_usage only), and forgeable history (firm-site.ts:197-236).
5. **Library OCR:** unreviewed OCR text becomes the "authoritative" source the verifier trusts, including platform-wide sources, with no persisted OCR flag on direct upload (library.ts:156, extract.ts:122).

## Appendix B: document readers, playbook, resolutions, engagements, compare, hearing prep, client updates

### Audit B: AI call sites (read-only)

These points apply to all 10 call sites:
- **Logging:** each site writes only `recordAiUsage` (`src/services/usage.ts:63`), which records the feature, model and token counts in `ai_usage`. None of them calls `logAiUse` (`ai_use_log`): only `src/routes/ai.ts` imports it. No site stores the prompt or the source references.
- **Report a problem:** none of these sites has a "report a problem" or feedback control.
- **Verification:** none calls `src/services/verify.ts`. No site checks AI output against the source by code.
- **Access:** portal clients are blocked from all these routes by `src/app.ts:181` (`clientAllowed`).
- **Parsing:** `parseJsonObject` (`src/services/legal-prompts.ts:154`) falls back to a greedy `{...}` regex. Failures raise a real 502 `ai_bad_output`.
- **Silent truncation:** `truncate` (`legal-prompts.ts:5`) cuts input at 12k, 15k or 60k characters. Only `compare` tells the UI that its input was truncated.

---

#### 1. Arbitration timetable: `src/routes/arbitration.ts:286`, `POST /case/:id/timetable/read`
- **Settings:** temp 0, maxTokens 2500, json.
- **Generates:** dated procedural steps (kind, title, party, due_on, notes) and a `skipped` list.
- **Who sees it:** lawyers, in a confirm table (`views/arbitration.js:280-292`). On confirm the steps are POSTed with `source:'ai'` (`:205`). `syncStepEvent` (`services/arbitration.ts:47`) then creates calendar events. Steps of kind `hearing` become `events.kind='hearing'`, and the portal shows those to clients (`portal.ts:81`).
- **Grounding:** order text or a matter document (`timetableMessages`, `services/arbitration.ts:68`), truncated silently at 15k. The prompt says "Use ONLY what is written".
- **Validation:** `normalizeTimetable` (`:90`) checks only that kind and party are in their enums, the title is not empty, and due_on is a valid YYYY-MM-DD. Nothing checks that a date or title appears in the order. The model is asked to convert Hijri dates to Gregorian itself and only to "say so in notes"; no code checks the conversion.
- **No-answer:** a real path. Undated steps are dropped and `skipped` is shown. An empty list shows `arb.nothing_found`.
- **Logging:** `ai_usage` only. `arbitration_steps.source='ai'` records provenance.
- **Label:** `arb.check_ai` ("Check every date and title against the order…"). Each row has a checkbox and editable fields.
- **Risk: HIGH.** A wrong deadline or hearing date goes into the calendar (and hearings into the client portal) with one click. Truncated orders lose later steps without warning, and Hijri conversions are not verified.
- **Gaps:**
  - No source quote or offset per step.
  - Dates are not matched against the text.
  - No truncation flag.
  - No `ai_use_log`.
  - No report control.

#### 2. Credential extraction: `src/routes/credentials.ts:173`, `POST /extract`
- **Settings:** temp 0, maxTokens 800, json.
- **Generates:** POA/ID fields: kind, number, holder, issuer, issued_on, expires_on, scope, notes.
- **Who sees it:** staff (pre-fills the form, `views/credentials.js:129`). The saved expiry drives the staff daily digest (`expiringForDigest`). The route has **no `requireRole`**, so any firm role, including read-only roles, can call it.
- **Grounding:** document OCR text (`extractMessages`, `services/credentials.ts:54`, truncated at 12k). "Use ONLY what is written… never guess numbers or dates."
- **Validation:** `normalizeExtraction` (`:78`) checks only enums, string lengths and date format. Nothing checks that the ID number or the dates appear in the text. Hijri dates are converted by the model.
- **No-answer:** prompt only (`""`). Code fills only non-empty fields.
- **Logging:** `ai_usage` only. The saved credential has no marker that it came from AI.
- **Label:** a toast, `cred.read_done` ("…Please check them"). The toast disappears and fields are not highlighted.
- **Risk: HIGH.** A wrong POA expiry or scope affects whether the firm has authority to act, and a hallucinated ID number is saved as fact.
- **Gaps:**
  - No match between the extracted values and the source text.
  - No per-field source span.
  - No lasting AI marker.
  - No role check.
  - No `ai_use_log`.

#### 3. Judgment reading: `src/routes/judgments.ts:268`, `POST /case/:id/read`
- **Settings:** temp 0, maxTokens 900, json.
- **Generates:** judgment_date, court, degree, number, result, operative-part summary, amounts, currency.
- **Who sees it:** lawyers and staff (form pre-fill through `wireReadBar`, `views/ai-read.js`). On save, the appeal deadline = judgment_date + appeal_days (UI default 30, `judgments.js:112`). That date becomes a calendar event (`syncAppealEvent`). The summary and result later feed the client-update AI (`services/client-updates.ts:43`).
- **Grounding:** document text (`judgmentMessages`, `services/ai-read.ts:19`, truncated at 15k), plus the client and opponent names from the case. "Use ONLY what is written."
- **Validation:** `normalizeJudgment` (`ai-read.ts:68`) checks enums, date format, and amounts as numbers ≥ 0 and < 1e13. Nothing checks that the amounts or date are in the text. The model also judges whether the client won, lost or partly won (`result`), and code does not check it.
- **No-answer:** prompt (`""`/null). The UI fills only non-empty fields.
- **Logging:** `ai_usage` only. Nothing marks the saved judgment as AI-read.
- **Label:** `read.check` (`ai-read.js:15`) plus highlighted fields.
- **Risk: HIGH.** A wrong judgment_date shifts the appeal deadline in the calendar. A wrong award amount flows into the enforcement register and into updates to the client.
- **Gaps:**
  - No date or amount match against the text.
  - No quote of the operative part to verify against.
  - No provenance on the saved record.
  - No `ai_use_log`.

#### 4. Notice reading: `src/routes/notices.ts:251`, `POST /case/:id/read`
- **Settings:** temp 0, maxTokens 900, json.
- **Generates:** direction, party, subject, notice_date, reference, method, response_days, amount, and demands (merged into notes).
- **Who sees it:** lawyers and staff (form pre-fill). On save, `responseDue` (`:59`) computes notice_date (or delivery date) + response_days, and `syncDeadline` (`:77-102`) creates a calendar deadline.
- **Grounding:** document text (`noticeMessages`, `ai-read.ts:38`, truncated at 15k). "Use ONLY what is written."
- **Validation:** `normalizeNotice` (`:77`) checks enums and date format, and requires response_days to be an integer from 1 to 365. Nothing checks these values against the text. The model alone decides `direction` (incoming or outgoing).
- **No-answer / logging / label:** same as item 3.
- **Risk: HIGH.** A wrong notice_date or response_days sets a wrong response deadline in the calendar. A flipped direction mislabels who must respond.
- **Gaps:** same as item 3.

#### 5. Resolution items: `src/routes/resolutions.ts:247`, `POST /client/:id/ai`
- **Settings:** temp 0.2, maxTokens 1500, json.
- **Generates:** operative items of a corporate resolution, in both English and Arabic.
- **Who sees it:** lawyers (editor). After editing, the items are saved, printed to DOCX on the letterhead and signed by the company. That makes them a client and third-party deliverable.
- **Grounding:** a free-text description from the user only (`itemsMessages`, `services/resolutions.ts:167`). "Use only names, numbers, amounts and dates given in <request>… write [●]".
- **Validation:** `normalizeItems` (`:183`) checks shape and length only. Nothing checks that names and amounts in the items appear in the request. Nothing checks that the Arabic matches the English. Nothing blocks `[●]` placeholders at save, sign or DOCX (grep found none).
- **No-answer:** real for an empty list (502). Missing details rely on the prompt only.
- **Logging:** `ai_usage` only. Not stored as AI output.
- **Label:** a toast, `res.ai_done` ("Check both languages").
- **Risk: MEDIUM.** A lawyer edits it before signature, but the output is a binding corporate document and can carry an invented amount or name, or unfilled `[●]`.
- **Gaps:**
  - No match of entities against the request.
  - No `[●]` gate.
  - No lasting AI marker.
  - No `ai_use_log`.

#### 6. Playbook review: `src/routes/playbook.ts:166`, `POST /review`
- **Settings:** temp 0.1, maxTokens 6000, json.
- **Generates:** per-rule status, clause number, quoted `found` text, issue, suggestion, overview and score.
- **Who sees it:** lawyers and staff (`views/clauses.js:330-400`). The suggestion can be inserted straight into the document (`data-insert`).
- **Grounding:** contract text, truncated at 60k with only an inline marker, plus the firm's rules (`reviewMessages`, `services/playbook.ts:28`). "Base every finding on the contract text only. Quote… exactly."
- **Validation:** `normalizeReview` (`:69`) maps R# to rules. A rule the model skipped becomes `deviates` with "Check it manually". The status is checked against its enum. **Nothing checks that the `found` quote appears in the contract.** A `missing` verdict for text past the truncation point is not detected.
- **No-answer:** a real path for rules the model skipped. None for a "not found" verdict.
- **Logging:** the full result is stored in `playbook_reviews` (with model and document version), plus `ai_usage` and an audit entry. No `ai_use_log`, and no sources stored.
- **Label:** no AI disclaimer. The only flag shown is an "outdated version" badge.
- **Risk: HIGH.** A clause quote that is not in the contract, or a false "missing" verdict on a long contract, can drive the negotiation, and the AI suggestion is inserted into the contract.
- **Gaps:**
  - The quote is not verified by substring or fuzzy match.
  - No truncation flag.
  - No disclaimer.
  - No `ai_use_log`.
  - No report control.

#### 7. Engagement scope: `src/routes/engagements.ts:125`, `POST /case/:id/scope`
- **Settings:** temp 0.2, maxTokens 1500, json.
- **Generates:** the scope and exclusions text of the engagement letter.
- **Who sees it:** lawyers (form pre-fill). The text becomes the client's engagement letter (a document with the client's ID).
- **Grounding:** case title, description, court and opposing party (`scopeMessages`, `services/engagement.ts:137`). "Do not invent facts…". The prompt itself asks the model to produce tasks and exclusions beyond those inputs.
- **Validation:** checks only that `scope` is a non-empty string (`:132-135`).
- **No-answer:** a 502 on empty output.
- **Logging:** `ai_usage` only.
- **Label:** a toast, `eng.ai_review`.
- **Risk: MEDIUM.** The lawyer edits it, but it is contractual text sent to the client.
- **Gaps:** no source refs, no `ai_use_log`, and no lasting marker.

#### 8. Compare summary: `src/routes/compare.ts:85`, `POST /summary`
- **Settings:** temp 0.1, maxTokens 3000, json.
- **Generates:** an overview, per-change items (clause, change, impact, severity, recommendation) and questions.
- **Who sees it:** firm users (no `requireRole`). Not stored.
- **Grounding:** diff hunks only (at most 80, each truncated at 1500, `services/compare.ts:112`). "Base everything on the <change> blocks only."
- **Validation:** `normalizeSummary` (`:135`) checks only enums and lengths. Items carry **no hunk number**, so a claim cannot be traced to a change. Clause numbers are not checked.
- **No-answer:** identical texts are rejected before the call (`:77`). `truncated` is returned and shown (`compare.js:102`).
- **Logging:** `ai_usage` plus an audit entry. The output is not stored.
- **Label:** a truncation note only. No AI disclaimer.
- **Risk: MEDIUM.** It is an internal summary that a lawyer reviews, and the redline is shown beside it.
- **Gaps:** add a `change n` reference to each item and validate it, no `ai_use_log`, and no report control.

#### 9. Hearing prep: `src/routes/hearing-prep.ts:45`, `POST /:id/ai`
- **Settings:** temp 0.2 (the default), maxTokens 2500, json.
- **Generates:** an internal note (summary, objectives, arguments, requests, bring, risks, open questions) plus checklist items.
- **Who sees it:** lawyers and staff. It is stored in `hearing_preps` and exported to DOCX.
- **Grounding:** `gatherPrep`: the case record, the last hearing, tasks, originals, notices, offers, and matter documents (each truncated at 2500). "Use ONLY… no article numbers… put missing in open_questions."
- **Validation:** `normalizePrep` (`services/hearing-prep.ts:108`) checks only array and string shape. Arguments and laws are not checked against the sources, and the model cannot cite a source.
- **No-answer:** prompt only (`open_questions`). A 502 if the note is empty.
- **Logging:** stored with the model in `hearing_preps`, plus `ai_usage` and an audit entry.
- **Label:** `prep.ai_note` in the UI. **The DOCX export has no AI label** (`prepText`).
- **Risk: MEDIUM.** It is internal, but a lawyer may argue invented points in court.
- **Gaps:** no per-claim source refs, no AI label in the DOCX, and temperature 0.2 for factual content.

#### 10. Client update: `src/routes/client-updates.ts:95`, `POST /case/:id/draft`
- **Settings:** **temp 0.3**, maxTokens 1500, json.
- **Generates:** the title and body (120–300 words) of a progress update to the client.
- **Who sees it:** **the firm's clients.** The update is saved as an `ai_drafted` draft. Publishing (`:136`) sends it to the portal (`portal.ts:89`), emails the **full body** (`:159-165`), and sends the AI-written **title** by WhatsApp (`:174`). The portal does not show `ai_drafted`.
- **Grounding:** `gatherClientFacts` (`services/client-updates.ts:17`): hearings, judgments (including the AI-read summary), events, documents, requests, signatures, the previous update, plus the lawyer's optional points. "Use ONLY… Do not invent facts, dates…". It also passes `h.next_steps`, the lawyer's internal notes, while the prompt says not to reveal internal notes.
- **Validation:** `normalizeUpdate` (`:97`) only tidies whitespace and wraps dates for right-to-left display. **Dates are not checked against the facts**, even though the prompt asks for dates written in words, which makes code matching harder.
- **No-answer:** none. With `facts=0` it still drafts ("matter is progressing"), and an empty body only raises a 502.
- **Logging:** stored in `case_updates` (`ai_drafted=true`), plus `ai_usage` and an audit entry. No sources stored, no `ai_use_log`.
- **Label:** `cu.check_ai` in the editor only. Publishing does not require the draft to have been edited or confirmed.
- **Risk: HIGH.** A client-facing message can contain invented facts or wrong hearing dates, can leak internal next_steps, and goes out by email and WhatsApp.
- **Gaps:**
  - No date or fact verification against `facts`.
  - No abstain path when nothing happened.
  - Temperature is 0.3.
  - Internal notes are sent to the model.
  - No review gate before publish.
  - No AI marker for the client.
  - No report control.

## Appendix C: blog writer, website chatbot, lead intake and reply, insights, and copy claims

### Audit C: website/blog, lead intake, practice insights AI + accuracy claims in copy

Read-only. No repo files changed. None of these sites write to `ai_use_log`: `logAiUse` is called only from src/routes/ai.ts (137, 187, 229, 278). They all go through `recordAiUsage`, which stores token counts only. None of them call the verifier (`verifyAnswer` is used only at ai.ts:126 chat and 179 draft). There is no "report a problem" control anywhere in the app.

#### Part 1: AI call sites

##### 1. AI blog writer: POST /api/website/writer (src/routes/website.ts:296, call 316)
- Params: temp 0.4, maxTokens 4000 (600 for titles/excerpt), json mode on.
- Generates: full 700-1000 word public legal articles (draft), plus improve, translate, titles and excerpt (src/services/website.ts:150-212).
- Who sees it: the lawyer in the editor first, then public visitors at /f/<slug>/blog/<slug> once published (src/pages/firm-site.ts:294 renderArticle). The output also feeds the public chatbot's knowledge (firm-site.ts:223).
- Grounding: none. The model gets only the topic, practice area, jurisdiction and audience, and writes from its own memory. The prompt (WRITER_RULES, website.ts:166) says "Never invent statutes, article numbers..." and asks it to mark doubtful points with [verify]. This is a prompt instruction only.
- Validation: `normalizeWriterResult` (website.ts:214) only type-checks strings and truncates them (title 200, excerpt 500, body 60000). It does not check law citations or article numbers against the library, and it does not look for [verify] markers. Publishing (website.ts:103/154/181) has no gate, so a post that still contains [verify] or an invented article number can be published as is.
- No-answer behavior: none. A parse failure gives a 400 error (website.ts:322).
- Logging: `recordAiUsage('blog_writer')` only. The output is not stored, and blog_posts does not mark a post as AI-written.
- Disclaimer: in the editor, 'web.ai_review_note' (en.js:2816, "AI drafts may contain errors... check... [verify], before publishing"). On the public site there is a generic footer, "general and is not legal advice" (firm-site.ts:61/160). Nothing tells readers that AI wrote the content.
- **Risk: HIGH.** An ungrounded article at temp 0.4 can cite non-existent law or wrong articles on the firm's public site under the firm's name. No code check, and no publish gate.
- Gaps: no library grounding, no citation verifier, no [verify] block on publish, temp too high for factual text, no ai_use_log entry or AI flag on the post, no report-a-problem control.

##### 2. AI image: POST /api/website/media/generate (website.ts:228, call 247)
- generateImage. The prompt comes from coverPrompt (src/services/blog-media.ts:60) and says "no text... no identifiable real people". The image is checked only with sniffMedia (a valid image). It is stored in blog_media with source='ai' and shown publicly on posts.
- Logging: recordAiUsage('cover_image') with 0 tokens, plus audit 'ai.blog_image'.
- **Risk: LOW.** Decorative only, no factual claims. Gap: no AI-image label on the public page.

##### 3. Lead reply draft: POST /api/website/leads/:id/reply-draft (website.ts:384, call 396); sent via /leads/:id/reply (412)
- Params: temp 0.3, maxTokens 1200, json mode.
- Generates: a first email to a prospective client, written as the lawyer (src/services/lead-intake.ts:131 `replyMessages`).
- Who sees it: the lawyer reviews and edits it in a modal (views/website.js:274-305), then it is emailed to the prospective client. Nothing is sent automatically.
- Grounding: the enquiry text plus the AI intake summary and questions. The prompt says not to give advice, quote fees, promise anything or invent facts. Prompt only.
- Validation: `normalizeReply` (lead-intake.ts:151) only trims and truncates. An empty body returns 502. No check for fees, advice or promises.
- Logging: recordAiUsage('lead_reply') only. The sent email is noted in leads.notes and the audit log, but the AI draft is not stored.
- Disclaimer: 'intake.reply_hint' (en.js:3001), "Review and edit before sending".
- **Risk: MEDIUM.** It goes to a prospective client under the lawyer's name, but a human must press Send. If the intake summary is wrong, the error carries into the email.

##### 4. Lead intake: runLeadIntake (src/services/lead-intake.ts:115). Auto-run on every public form or chat submission (src/routes/firm-site.ts:177) and on manual leads (website.ts:357); re-run via POST /leads/:id/intake (website.ts:362)
- Params: temp 0.1, maxTokens 1500, json mode.
- Generates: summary_en/ar, practice_area, jurisdiction, urgency, opposing_parties, key_dates, amount, questions, case_title and red_flags (prompt at lead-intake.ts:20).
- Who sees it: lawyers only (views/website.js:25-53). It is also prefilled into case creation (website.js:226-229).
- Grounding: the enquiry text only. The prompt says "Use ONLY what the enquiry says". Prompt only.
- Validation: `normalizeIntake` (lead-intake.ts:61) checks practice_area, jurisdiction and urgency against enum lists and caps the lengths of the other fields. It does not check that party names, dates or amounts actually appear in the enquiry text, and it does not normalize dates.
- Consequences in code:
  - The AI's `urgency` sets leads.urgency, which drives inbox ordering (website.ts:337).
  - `opposing_parties` is the only input to the conflict check against clients (lead-intake.ts:99). If the AI misses a party, the conflict check silently misses it.
- No-answer behavior: fields are left empty and urgency defaults to 'routine'. If AI is not configured or over quota, intake is null and the conflict check still runs on the enquirer's own details.
- Logging: recordAiUsage('lead_intake'). The output is stored in leads.intake with intake_model. Not in ai_use_log.
- Disclaimer: 'intake.disclaimer' (en.js:2991).
- **Risk: MEDIUM.** Internal only, but an urgency set to 'routine' by mistake, or a missed opposing party, can hide a deadline or a conflict. Gaps: no check that extracted names, dates and amounts appear in the source text, no conflict check on names the AI did not extract (raw text), no per-field quotes.

##### 5. Public website chatbot: POST /f/:slug/chat (src/routes/firm-site.ts:202, call 227). Not listed in the brief but in scope.
- Params: temp 0.3, maxTokens 400, json mode off. Prompt: siteChatMessages (src/services/website.ts:102).
- Generates: free-text replies to anonymous public visitors.
- Grounding: firm profile, the firm's own chat_knowledge, and the titles and excerpts of published blog posts, which may themselves be ungrounded AI text. The prompt says "Answer only from <firm>... never quote laws, article numbers or deadlines". Prompt only.
- Validation: only `.trim().slice(0, 2000)` (firm-site.ts:231). No filter for statute references, prices or advice.
- No-answer behavior: the prompt asks it to say it lacks the information. The code falls back to `chatFallback` only on errors, quota or plan limits.
- Logging: recordAiUsage('site_chat', userId null). Replies are not stored, apart from a transcript if the visitor later submits the form (firm-site.ts:168).
- Disclaimer: widget note "Automated assistant. General information only, not legal advice." (firm-site.ts:64).
- **Risk: HIGH.** Anonymous public users, no human review, and nothing in code enforces the no-law or no-advice rule. Gaps: no output filter (law and article patterns, fee amounts), no reply log for review, no report-a-problem control in the widget.

##### 6. Practice insights summary: POST /api/reports/insights/summary (src/routes/reports.ts:101, call 114)
- Params: temp 0.2, maxTokens 1500, json mode.
- Generates: a headline, 4-7 points and 2-4 actions for the partners (src/services/practice-insights.ts:152).
- Who sees it: owners and admins only (views/reports.js:232-240).
- Grounding: the full computed PracticeInsights JSON. The prompt says "Use ONLY the figures in <data>. Never invent numbers". Prompt only.
- Validation: `normalizeSummary` (practice-insights.ts:168) only handles strings and arrays. Numbers, names and percentages in the points are not checked against `data`, and points carry no references to the fields they rely on.
- No-answer behavior: a 502 error if there is no headline and no points (reports.ts:119).
- Logging: recordAiUsage('partner_summary') plus audit 'ai.partner_summary'. The output is not stored.
- Disclaimer: 'insights.ai_note' (en.js:3076), "Written by AI from the figures above. Check before acting on it."
- **Risk: MEDIUM.** An invented or miscomputed figure, such as a wrong realisation percentage or lockup days, or a mis-attributed lawyer, could drive partner decisions. Gaps: no extraction of numbers from the text or matching them against `data`, no `{text, refs:[field paths]}` structure, no stored output.

#### Part 2: copy claims about AI accuracy

No literal "never wrong", "100% accurate", "error-free", "guaranteed", "hallucination-free", "لا يخطئ", "مضمون" or "دقة 100%" claims were found in the files searched. "١٠٠" at landing.ts:163 is a quota ("100 AI requests"). The AI-related claims are:

| file:line | text | true given code? |
|---|---|---|
| README.md:36 | "Court-grade checks on AI output: every answer and draft is checked after generation..." | **Overstated.** verifyAnswer runs only on research chat (ai.ts:126) and drafting (ai.ts:179). It does not run on blog writer, site chatbot, intake, reply, insights, document analysis, case brief or client updates. Change to "every research answer and document draft". "Court-grade" is marketing puffery; suggest removing it. |
| README.md:124 | "Verifier ... runs on every research answer and AI draft." | True if "AI draft" means /api/ai/draft. Ambiguous because the blog writer also produces "drafts"; clarify. |
| README.md:44 | "website chatbot answers visitors from the firm's own information (never legal advice)" | **Prompt-only.** Nothing in code enforces it (firm-site.ts:231). Suggest "is instructed not to give legal advice". |
| en.js:2849 'web.chatbot_hint' | "Answers visitors' questions from your website content... never gives legal advice" | Same as above: prompt-only. Soften. |
| README.md:87 | "it never returns fake answers" (when OPENAI_API_KEY is unset) | True in context (it means no stub responses). Wording could be misread as an accuracy claim; suggest "never returns placeholder answers". |
| landing.ts:35 / Arabic at :114 | "The AI answers from your library and cites the exact article." / "يجيب المساعد الذكي من مكتبتك مستشهدًا بالمادة بعينها" | **Partly true.** Chat answers even when retrieval finds no sources (library_only is optional, ai.ts:121). The verifier then reports 'unverified' ("No library citations", en.js:1880). Suggest "can answer from your library and cite the article". |
| landing.ts:36 / Arabic at :115 | "verification checklist on every answer" | True for research chat (a verification result is shown for every chat answer). OK. |
| landing.ts:25, :34 | "AI contract reviews grounded in the jurisdiction you practise in"; "every issue rated by severity and a recommended fix" | Analysis (ai.ts:197-229) is not run through the verifier. "Grounded" is loose. Low priority. |
| landing.ts:49 | "documents are never used to train AI models" | Not an accuracy claim; it depends on the provider's API terms. Out of scope. |
| src/pages/legal.ts:14 | "Output generated by AI features may be incomplete, outdated or incorrect..." | Good, accurate disclaimer. |
| en.js:1955 'ai.disclaimer' | "AI output can be inaccurate..." | Good. |
| en.js:908 'cu.ai_intro' | "Internal notes, risks and fees are never included." | Not checked here (client-updates is out of scope). It is a data-selection claim; verify separately. |

src/pages/platform-blog.ts, src/routes/platform-blog.ts and public/static/site/* contain no AI accuracy claims ("never" hits there are about pricing and layout).

#### Summary
1. HIGH: The AI blog writer (website.ts:316, temp 0.4) publishes ungrounded legal articles to public firm sites. There is no citation verifier and no block on [verify] markers at publish, and posts are not flagged as AI-written.
2. HIGH: The public website chatbot (firm-site.ts:227) answers anonymous visitors with no human review and no output filter, and its replies are not logged. Its knowledge includes unverified blog excerpts.
3. MEDIUM: Lead intake (it drives urgency sort and the conflict check through opposing_parties), lead reply emails, and partner insights (numbers not checked against data). None write ai_use_log, none store sources, and nothing has a report-a-problem control.
4. Copy to fix: README.md:36 "every answer and draft is checked" / "Court-grade" (narrow to research chat and drafts); landing.ts:35/:114 "answers from your library and cites the exact article" (can answer without library sources).
5. Copy to soften: README.md:44 and en.js:2849 "never gives legal advice" (prompt-only); README.md:87 "never returns fake answers". No literal "100% accurate" or "never wrong" claims found.
