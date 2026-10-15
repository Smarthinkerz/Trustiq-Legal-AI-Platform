# TrustiqLegal: standard legal wording for lawyer review

**Date:** October 15, 2026

**Items listed:** 45

This document lists the standard legal wording that the TrustiqLegal application generates or displays, so that an Omani lawyer can review it before launch. For each item it gives where the wording appears (the source file and function or key, and the screen where a user sees it), the language, the exact wording, and what we would like the lawyer to check.

The wording was collected from the code in the repository (the server in src/ and the app in public/static/app/, including the English and Arabic text files en.js and ar.js). Long generated documents are quoted for their fixed clauses; the parts the app fills in are shown in curly brackets, for example {client name}.

Reading notes: (1) English text in the app sometimes uses a long dash as a separator; in this document it is shown as a plain hyphen. The same applies to the few Arabic strings that use one. All other Arabic wording is copied exactly from the code. (2) Some pricing and plan files were being changed in the working copy on October 15, 2026 and are not yet released. Those items are marked "working copy, not yet released". (3) Nothing in this document is a legal conclusion. The points in "What to check" and in the priority questions are questions for the reviewing lawyer.

## Contents

- Priority questions for the reviewing lawyer (6 questions)
- 1. Platform terms, privacy and consent (items 1 to 5)
- 2. Data retention, export and deletion (items 6 to 10)
- 3. AI disclaimers and AI processing (items 11 to 13)
- 4. Pricing, plans and fair use (items 14 to 19)
- 5. Engagement and client onboarding (items 20 to 22)
- 6. Generated letters and instruments (items 23 to 32)
- 7. Arbitration (item 33)
- 8. GCC starter playbook (items 34 to 35)
- 9. Electronic signatures (items 36 to 38)
- 10. Invoices, VAT and payments (items 39 to 40)
- 11. Client communications (items 41 to 45)
- Wording that looks risky or inconsistent (12 points)

## Priority questions for the reviewing lawyer

### 1. Data retention

Planned behavior: the app will keep each firm's data for 10 years by default. The period is configurable per firm. The app offers a data export and a deletion request process. Today the app already stores a firm setting "retention_years" with a default of 10 (allowed range 1 to 50 years), suggests a "keep the file until" date when a matter is closed, and lists closed files past their date in Cases > File retention. A deletion request process (for the whole workspace or for one client) is being added in the working copy, but it has no user-facing wording yet.

The published Terms of Service (section 10) and Privacy Policy (section 7) currently say that Customer Data is deleted from active systems within thirty days after termination. The renewal reminder email and the in-app banners say that after a plan ends "your data is safe and read-only" with no time limit. These statements do not match each other or the planned 10 year default (see items 1, 2, 6 to 10).

Questions: Is a 10 year default consistent with the Personal Data Protection Law (Royal Decree 6/2022) and its Executive Regulations, in particular the principles that personal data is kept only as long as needed for its purpose? Are there record-keeping duties for advocates in Oman (for example under the law and professional rules governing advocates), or under the AML law (Royal Decree 30/2016), the Commercial Code or the tax laws, that set a minimum period for client files, KYC records, invoices or accounting records? What default do you recommend, and should it differ by record type (client files, KYC records, invoices, audit logs, AI conversations)? How should the Terms, the Privacy Policy and the closing letter describe retention, export and deletion, and who (the firm as controller or TrustiqLegal as processor) decides deletion?

### 2. Enterprise fair use

Planned behavior: the pricing page shows "Unlimited" open cases, new documents and AI requests for Enterprise. The terms will contain a fair use limit of 400 AI requests and 80 new documents per lawyer per month, with a minimum of 10,000 AI requests and 2,000 documents a month for the firm. Exceeding the limit only triggers soft alerts to the TrustiqLegal team; the firm is never blocked automatically. The working copy already calculates these figures (firm-pricing.js, limitsFor) and the homepage assistant describes them (platform-help.ts), but the published Terms of Service contain no fair use clause yet (see items 1, 15, 17).

Questions: Can "Unlimited" be used on the pricing page if the terms contain a fair use limit, and what qualifier or footnote is needed next to "Unlimited" (for example under consumer protection or advertising rules, even though customers are businesses)? Please propose the fair use wording for the Terms (definition of a lawyer, how the minimum applies, what happens when the limit is exceeded, the right to discuss an upgrade, and the statement that access is never blocked automatically). Should the Arabic pricing page use the same qualifier?

### 3. Generated letters and instruments

The lease notice letter (item 25), the returned cheque demand letter (item 24), the legal notice drafting (item 23), the power of attorney drafts (item 26) and the corporate resolutions (item 27) contain fixed bilingual wording. Questions: Is the fixed English and Arabic wording correct and suitable for use in Oman? Are the Arabic legal terms the ones Omani courts, notaries (الكاتب بالعدل) and the Ministry of Commerce, Industry and Investment Promotion expect? In particular: the use of "without prejudice" in English next to "دون إخلال بأي من حقوق موكلنا" in Arabic on demand and lease letters; the payment period and "without further notice" wording in the cheque demand; the list of special powers that must be stated expressly in a power of attorney (الإقرار، الصلح، التنازل وترك الخصومة، الإبراء، الاتفاق على التحكيم، القبض); and the legal form names used in resolutions and registers (for example "شركة تضامن أو توصية" for a partnership).

### 4. Arbitration institution names in Arabic

The arbitration module lists twelve institutions with English and Arabic names (item 33). The GCC starter playbook names the Omani centre differently (item 34). Questions: Are the official Arabic names correct, in particular "مركز عُمان للتحكيم التجاري" (arbitration module) versus "مركز عُمان للتوفيق والتحكيم التجاري" and the English "Oman Commercial Centre for Dispute Resolution (OCCDRC)" (playbook)? Which single name should the app use for the Omani centre in both languages? Is "مركز قطر الدولي" in the playbook rule acceptable or should it be the full name?

### 5. GCC starter playbook positions and clauses

Owners can load a starter playbook of 10 negotiation rules (standard position, fallback, red flags) and 6 bilingual clauses: governing law (Oman), arbitration (Muscat, three arbitrators, Arabic), limitation of liability, confidentiality, force majeure, and payment terms (items 34 and 35). Questions: Are the positions reasonable as a starting point for Omani practice? Are the clauses enforceable under Omani law, for example the exclusion of "loss of profit" and the carve-out for "gross negligence" in the liability cap (compare the Civil Transactions Law, Royal Decree 29/2013), the three-year survival of confidentiality, and the 72-hour breach notice reference in the personal data rule? Is the Arabic wording of each clause correct and consistent with the English?

### 6. Engagement letter

The engagement letter (item 20) is a fixed template in English or Arabic with the fee arrangement (hourly, fixed, capped or success fee), advance payment, expenses, VAT, payment, client responsibilities, confidentiality and conflicts, personal data, termination, governing law and acceptance. Questions: Does the template meet the requirements for fee agreements between an advocate and a client in Oman (for example under the Advocacy and Legal Consultancy Law and the professional conduct rules), including whether a success fee expressed as a percentage of the amount recovered is permitted and in what form? Is referring fee disputes to "the competent courts" correct, or should another body be named? Is the personal data clause sufficient under Royal Decree 6/2022? Is the Arabic wording correct?

## 1. Platform terms, privacy and consent

TrustiqLegal's own legal pages and the consent steps that show them.

### Item 1. Terms of Service page

**Category:** Platform terms

| | |
|---|---|
| **Where it appears** | src/pages/legal.ts, function terms() rendered by legalPage('terms') at /terms<br>Homepage footer > Legal > Terms of Service (English and Arabic homepages both link to the same English page); signup and invite screens link to it. |
| **Language** | EN only (no Arabic version exists) |
| **What to check** | - Is an Arabic version required or advisable for Omani customers, and which language should prevail?<br>- Section 6 has no fair use clause, although Enterprise is sold as "Unlimited" (see priority question 2).<br>- Section 10 (export for thirty days, then deletion) conflicts with the planned 10 year default retention and with the "data is safe and read-only" emails (see priority question 1).<br>- Is the liability cap in section 9 (fees paid in the previous twelve months, no indirect loss) enforceable under Omani law?<br>- Section 11: are "the competent courts of Muscat" the right forum, or should arbitration be offered?<br>- Missing topics to consider: annual prepayment and refunds ("pay 10 months, get 12"), suspension for non-payment, changes to the Terms, AI feature limits and overage packs, support staff seats.<br>- The code comment says these texts are a starting point that must be approved by counsel before launch. "Last updated" is 30 September 2026. |

**Wording**

*Fixed text (full)*

> Terms of Service. Last updated: 30 September 2026.

> These Terms govern access to and use of the TrustiqLegal platform (the "Service") by the organization that registers an account (the "Customer") and its authorized users. By creating an account or using the Service, the Customer agrees to these Terms.

> 1. The Service. TrustiqLegal provides software for legal practice management, including matter and client records, document storage, calendaring, and AI-assisted drafting, research and document review. The Service is a tool for qualified legal professionals.

> 2. No legal advice. TrustiqLegal is not a law firm and does not provide legal advice. Output generated by AI features may be incomplete, outdated or incorrect, and may reference provisions that must be verified. The Customer and its users remain solely responsible for reviewing all output and for any advice given to their own clients.

> 3. Accounts and users. The Customer is responsible for its users, for keeping credentials confidential, and for all activity under its account. Account owners and administrators control who may access the Customer's workspace.

> 4. Customer data. The Customer retains all rights in the data and documents it uploads or creates ("Customer Data"). We process Customer Data only to provide, secure and support the Service, as described in our Privacy Policy. Customer Data is not used to train AI models. The Customer can export its data at any time from the workspace settings.

> 5. Acceptable use. The Customer must not use the Service unlawfully, upload content it has no right to process, attempt to breach security or access other customers' data, or resell the Service without our written agreement.

> 6. Trials, plans and fees. New workspaces receive a free trial. After the trial, continued write access requires a paid plan. Fees, plan limits and billing terms are set out in the applicable order form or pricing page. Fees are exclusive of applicable taxes, including VAT.

> 7. Availability and support. We aim to keep the Service available and will make reasonable efforts to schedule maintenance outside business hours in the Gulf region. Service levels, where agreed, are set out in the Customer's order form.

> 8. Confidentiality and security. Each party will protect the other's confidential information with reasonable care. We apply technical and organizational measures appropriate to legal data, including encryption in transit, access controls and audit logging.

> 9. Liability. To the maximum extent permitted by law, neither party is liable for indirect or consequential loss, and each party's total liability is limited to the fees paid by the Customer in the twelve months before the claim, except for liability that cannot be limited by law.

> 10. Termination. The Customer may stop using the Service at any time. Either party may terminate for material breach not cured within thirty days of notice. On termination, the Customer may export its data for thirty days, after which it will be deleted from active systems.

> 11. Governing law. These Terms are governed by the laws of the Sultanate of Oman. Disputes will be submitted to the competent courts of Muscat, unless the parties agree otherwise in writing.

> 12. Contact. Questions about these Terms: {support email}.

### Item 2. Privacy Policy page

**Category:** Privacy and data protection

| | |
|---|---|
| **Where it appears** | src/pages/legal.ts, function privacy() rendered by legalPage('privacy') at /privacy<br>Homepage footer > Legal > Privacy Policy; linked from signup and invite screens. |
| **Language** | EN only (no Arabic version exists) |
| **What to check** | - Does the policy meet the notice requirements of the Personal Data Protection Law (Royal Decree 6/2022) and its Executive Regulations (identity of the controller, purposes, legal basis, recipients, transfers, retention, rights, complaints to the competent authority)?<br>- Is the controller/processor split in section 1 correct for a law firm SaaS, and is a separate data processing agreement with each firm needed?<br>- Section 6 (international transfers) is general. Does Omani law require specific conditions or approvals for transfers outside Oman, including to the AI model provider?<br>- Section 7 (deletion within thirty days after termination) conflicts with the planned 10 year default retention (priority question 1).<br>- Should the sub-processor list be published rather than "available on request"?<br>- Is an Arabic version required? |

**Wording**

*Fixed text (full)*

> Privacy Policy. Last updated: 30 September 2026.

> This policy explains how TrustiqLegal processes personal data in connection with the Service, including under the Personal Data Protection Law of the Sultanate of Oman (Royal Decree 6/2022) and other applicable GCC data-protection laws.

> 1. Roles. For account information about our customers' users, we act as controller. For Customer Data (clients, matters, documents), the Customer is the controller and we act as its processor, following the Customer's instructions.

> 2. Data we process. Account data: names, email addresses, roles, language preference, hashed passwords. Security data: sign-in times, IP addresses, browser user agent, and an audit trail of actions in the workspace. Customer Data: information the Customer enters or uploads about its clients, matters and documents.

> 3. How we use it. To provide and secure the Service, authenticate users, send service emails (such as invitations and password resets), provide support, and meet legal obligations. We do not sell personal data and we do not use Customer Data to train AI models.

> 4. AI processing. When a user invokes an AI feature, the relevant text (for example, the question, the case summary or the document being reviewed) is sent to our AI model provider solely to generate the response. Providers are contractually restricted from using this data to train their models.

> 5. Sub-processors. We use hosting, database, email-delivery and AI-model providers. A current list is available on request from {support email}.

> 6. International transfers. Where data is processed outside the Customer's country, we rely on the transfer mechanisms and safeguards required by applicable law.

> 7. Retention. Customer Data is kept for the life of the account and deleted from active systems within thirty days after termination, subject to backup cycles. Security logs are retained for up to twelve months.

> 8. Security. Passwords are stored as salted hashes, traffic is encrypted in transit, access is role-based, and administrative actions are logged.

> 9. Your rights. Individuals may request access to, correction of, or deletion of their personal data, or object to its processing. Requests about Customer Data should be directed to the relevant Customer (law firm); we will assist them. Other requests: {support email}.

> 10. Changes. We will notify account owners of material changes to this policy.

### Item 3. Signup and invitation: acceptance of the terms

**Category:** Consent

| | |
|---|---|
| **Where it appears** | public/static/app/locales/en.js and ar.js, keys auth.accept_terms_html, auth.accept_invite_terms_html, auth.must_accept_terms; server check in src/routes/auth.ts (accept_terms must be true)<br>App > Register (checkbox); App > Accept invitation (statement above the button). |
| **Language** | EN and AR |
| **What to check** | - Is a tick box on registration, and a "by joining you agree" statement for invited users, sufficient to bind the firm and its users?<br>- The server records the registration in the audit log but does not store which version of the Terms was accepted. Should it?<br>- The Arabic labels link to the English-only Terms and Privacy Policy pages. |

**Wording**

> I agree to the Terms of Service and Privacy Policy.

<blockquote dir="rtl" lang="ar">أوافق على شروط الخدمة وسياسة الخصوصية.</blockquote>

> By joining you agree to the Terms of Service and Privacy Policy.

<blockquote dir="rtl" lang="ar">بانضمامك فإنك توافق على شروط الخدمة وسياسة الخصوصية.</blockquote>

> Please accept the Terms of Service to continue.

<blockquote dir="rtl" lang="ar">يرجى الموافقة على شروط الخدمة للمتابعة.</blockquote>

Note: Server error message if the box is not ticked (English only): "You must accept the terms of service".

### Item 4. Cookie or tracking consent

**Category:** Consent

| | |
|---|---|
| **Where it appears** | Searched src/ and public/static/ for cookie banners or consent text. None found.<br>The app uses a session cookie for sign-in. The API documentation page says: "Browser cookies are not accepted on the API." (src/pages/api-docs.ts). |
| **Language** | Not applicable |
| **What to check** | - Is a cookie notice or consent needed for the homepage, the app, the client portal and the firm websites (/f/{firm}) under Omani law, given that only a strictly necessary session cookie appears to be used?<br>- Should the Privacy Policy mention the session cookie? |

**Wording**

Note: No cookie or tracking consent wording exists in the app.

### Item 5. Client portal: invitation, terms and message notice

**Category:** Client portal

| | |
|---|---|
| **Where it appears** | Invitation email: src/routes/clients.ts (portal invite, link valid 14 days). Portal notes: en.js/ar.js keys portal.subtitle, portal.message_note, portal.powered_by.<br>Client page > Portal access > Invite (email to the client); Client portal > Messages. |
| **Language** | EN and AR |
| **What to check** | - Portal users (the firm's clients) are not asked to accept any terms or privacy notice. Should the portal show terms of use and a privacy notice, and whose (the firm's or TrustiqLegal's)?<br>- Is "Messages are private between you and the firm" accurate, given that TrustiqLegal as processor stores them?<br>- Arabic uses "بوابة الموكلين" here and "بوابة العملاء" in the document request email (item 43). Which term is preferred? |

**Wording**

*Invitation email (subject and body)*

> Subject: {firm} invited you to your secure client portal

> {firm} has given you access to a secure client portal where you can follow your matters, download documents and invoices, and message your lawyer. Set up your account within 14 days: {link}

<blockquote dir="rtl" lang="ar">دعاك {firm} إلى بوابة الموكلين الآمنة لمتابعة قضاياك وتنزيل المستندات والفواتير ومراسلة محاميك. افتح الرابط أعلاه لإنشاء حسابك.</blockquote>

*Portal notes*

> Your secure portal with {firm}.

> Messages are private between you and the firm. For urgent matters, please call.

<blockquote dir="rtl" lang="ar">الرسائل خاصة بينك وبين المكتب. للأمور العاجلة يرجى الاتصال.</blockquote>

> Secure client portal · TrustiqLegal

## 2. Data retention, export and deletion

Where the app tells firms and clients how long data is kept, how to export it and what happens when a plan ends.

### Item 6. Matter file retention setting (default 10 years)

**Category:** Data retention

| | |
|---|---|
| **Where it appears** | Database: organizations.retention_years, default 10, allowed 1 to 50 (src/db/migrations.ts). API: PUT /closing/settings (src/routes/closing.ts). Labels: en.js/ar.js keys close.retain_until, close.retain_hint, close.years, close.years_value, close.register, close.register_subtitle, close.empty_help, close.dash_title, close.dash_help.<br>Cases > File retention (owners and admins set the period); Case page > Close matter (suggested "Keep the file until" date); Dashboard alert for files past their date. |
| **Language** | EN and AR |
| **What to check** | - See priority question 1: is 10 years the right default and is it lawful for all record types?<br>- The app prompts the firm to "destroy" files after the date. Are there rules in Oman on how client files must be destroyed, or that require notice to the client first?<br>- Arabic grammar: "{n} سنوات" is correct for 3 to 10 but not for 11 or more (which needs "سنة"). Should the wording change? |

**Wording**

> Keep the file until

<blockquote dir="rtl" lang="ar">الاحتفاظ بالملف حتى</blockquote>

> Firm policy: {n} years after closing.

<blockquote dir="rtl" lang="ar">سياسة المكتب: {n} سنوات بعد الإغلاق.</blockquote>

> Keep files for (years)

<blockquote dir="rtl" lang="ar">مدة الاحتفاظ (سنوات)</blockquote>

> Files are kept for {n} years.

<blockquote dir="rtl" lang="ar">يُحتفظ بالملفات {n} سنوات.</blockquote>

> File retention. Closed matters by the date their file can be returned or destroyed.

<blockquote dir="rtl" lang="ar">الاحتفاظ بالملفات. الملفات المغلقة حسب تاريخ جواز إعادتها أو إتلافها.</blockquote>

> When a matter is closed it gets a retention date from the firm policy.

<blockquote dir="rtl" lang="ar">عند إغلاق الملف يُحدد له تاريخ احتفاظ وفق سياسة المكتب.</blockquote>

> {n} closed files are past their retention date. Review them: return them to the client or destroy them in line with your policy.

<blockquote dir="rtl" lang="ar">{n} من الملفات المغلقة تجاوزت مدة الاحتفاظ. راجعها: أعدها للموكل أو أتلفها وفق سياستكم.</blockquote>

Note: Server message if the chosen date is in the past: "The retention date is in the past." Platform help (src/services/platform-help.ts) describes it as "the firm's retention period, 10 years by default".

### Item 7. Closing letter to the client (retention paragraph)

**Category:** Data retention / client letter

| | |
|---|---|
| **Where it appears** | src/services/closing.ts, function closingLetter()<br>Case page > Close matter > "Prepare a closing letter" (saved as a document, optionally shared in the portal). |
| **Language** | EN or AR (one language per letter) |
| **What to check** | - Is it acceptable to tell the client the file "may be destroyed" after the retention period, and is the client's right to ask for the file back correctly stated?<br>- Should the letter mention personal data rights or the firm's retention policy in more detail?<br>- Arabic number agreement for 11 years or more (see item 6). |

**Wording**

*English*

> {date}. Dear {client name}, Re: {matter title} ({reference}). We write to confirm that our work on the above matter is complete and that we have now closed our file. {optional closing summary} [If originals were returned:] All original documents you entrusted to us have been returned to you. We will keep our file for {n} years, until {date}. After that it may be destroyed in line with our file retention policy, unless you ask us before then to return any part of it. Thank you for instructing us. Please do not hesitate to contact us if we can be of any further assistance. Yours sincerely, {lawyer} {firm}

*Arabic*

<blockquote dir="rtl" lang="ar">السادة/ {اسم الموكل} المحترمين. الموضوع: {عنوان القضية} ({المرجع}). تحية طيبة وبعد، نود إفادتكم بأننا أنجزنا أعمالنا في الموضوع المشار إليه أعلاه، وقد أغلقنا ملفه لدينا.</blockquote>

<blockquote dir="rtl" lang="ar">وقد سلّمناكم جميع أصول المستندات التي أودعتموها لدينا.</blockquote>

<blockquote dir="rtl" lang="ar">وسنحتفظ بملف الموضوع لمدة {n} سنوات حتى {التاريخ}، ويجوز بعدها إتلافه وفق سياسة الاحتفاظ بالملفات لدينا، ما لم تطلبوا استرداد أي جزء منه قبل ذلك.</blockquote>

<blockquote dir="rtl" lang="ar">نشكركم على ثقتكم بنا، ولا تترددوا في التواصل معنا متى احتجتم إلى أي مساعدة. وتفضلوا بقبول فائق الاحترام،</blockquote>

### Item 8. Data export

**Category:** Data portability

| | |
|---|---|
| **Where it appears** | UI text: en.js/ar.js keys settings.export_title, settings.export_text, settings.export_button. Export: src/routes/org.ts GET /org/export (owner only). Marketing: src/landing.ts security card "Your data stays yours"; Terms section 4 and 10.<br>Settings > Export your data (owner); Homepage > Security. |
| **Language** | EN and AR |
| **What to check** | - The export contains the organization, users, clients, cases, case activity, document text and metadata, versions, analyses, events and AI conversations. It does not include uploaded files (binary documents), invoices, time entries, client funds, KYC files, originals, signatures and other registers. Is the wording "Download all clients, cases, documents ..." and "Export your workspace at any time" accurate enough, or should the export be extended or the wording qualified?<br>- Does the export meet any data portability right under Royal Decree 6/2022? |

**Wording**

> Export your data. Download all clients, cases, documents, events and AI conversations as JSON. [Button: Download export]

<blockquote dir="rtl" lang="ar">تصدير بياناتك. نزّل جميع الموكلين والقضايا والمستندات والمواعيد ومحادثات الذكاء الاصطناعي بصيغة JSON.</blockquote>

> Your data stays yours. Export your workspace at any time. Your documents are never used to train AI models.

<blockquote dir="rtl" lang="ar">بياناتك ملكك. صدّر بيانات مساحة العمل في أي وقت. لا تُستخدم مستنداتك أبداً لتدريب نماذج الذكاء الاصطناعي.</blockquote>

### Item 9. Account and data deletion

**Category:** Data deletion

| | |
|---|---|
| **Where it appears** | Working copy, not yet released: a deletion_requests table (scope "workspace" or "client", decided by the platform team) is being added in src/db/migrations.ts. No screen, email or text exists for it yet.<br>Existing related wording: Terms section 10, Privacy Policy sections 7 and 9 (items 1 and 2). |
| **Language** | Not yet written |
| **What to check** | - What should the deletion request wording say: who may request it (owner only?), what is deleted, what must be kept (for example invoices, KYC records, audit logs) and for how long, how backups are handled, and how the firm and data subjects are informed?<br>- How should a request to delete one client's data be handled when the firm may have a legal duty to keep that client's file? |

**Wording**

Note: No user-facing wording yet. To be drafted.

### Item 10. Trial or subscription ended: "data is safe and read-only"

**Category:** Data retention / billing

| | |
|---|---|
| **Where it appears** | en.js/ar.js keys trial.expired and subscription.expired_banner; renewal reminder email in src/services/jobs.ts.<br>Banner at the top of the app after the trial or plan ends; email to owners and admins before and after the end date. |
| **Language** | EN and AR |
| **What to check** | - These messages promise that data stays available read-only with no end date, while the Terms say data is deleted thirty days after termination. Which is correct, and should the messages state a period? |

**Wording**

> Your free trial has ended. Your data is safe and read-only until you choose a plan.

> Your subscription has ended. Your data is safe and read-only until you renew.

*Renewal reminder email*

> Subject: Your TrustiqLegal subscription ends on {date} / Your TrustiqLegal subscription has ended. Body: Hello {name}, The {plan} plan for {firm} ends (ended) on {date}. [Before:] Renew now to avoid any interruption. [After:] Your data is safe and still viewable, but changes are paused until you renew.

<blockquote dir="rtl" lang="ar">مرحباً {الاسم}، سينتهي (انتهى) اشتراك {المكتب} ({الباقة}) بتاريخ {التاريخ}. جدّد الآن لتجنب انقطاع الخدمة. / بياناتك محفوظة ويمكنك عرضها، لكن التعديل متوقف حتى التجديد.</blockquote>

## 3. AI disclaimers and AI processing

Statements that AI output is not legal advice, and the fixed rules given to the AI model.

### Item 11. Homepage disclaimer and assistant notes

**Category:** AI disclaimer

| | |
|---|---|
| **Where it appears** | src/landing.ts, copy.en.disclaimer and copy.ar.disclaimer (Security section), copy.*.chat.note (homepage chat); src/services/platform-help.ts (assistant rules and fallback).<br>Homepage > Security section; Homepage chat window. |
| **Language** | EN and AR |
| **What to check** | - Is the disclaimer sufficient and prominent enough?<br>- The homepage assistant is instructed not to give legal advice. Is the note "Not legal advice" adequate for a public chatbot? |

**Wording**

> TrustiqLegal is a tool for legal professionals and does not provide legal advice. AI output must be reviewed by a qualified lawyer.

<blockquote dir="rtl" lang="ar">TrustiqLegal أداة للمهنيين القانونيين ولا تقدم استشارات قانونية. يجب أن يراجع محامٍ مؤهل مخرجات الذكاء الاصطناعي.</blockquote>

> Automated assistant about the TrustiqLegal platform. Not legal advice.

<blockquote dir="rtl" lang="ar">مساعد آلي حول منصة TrustiqLegal. لا يقدّم استشارات قانونية.</blockquote>

*Assistant rule (instruction to the AI, not shown to users)*

> You are not a lawyer and do not give legal advice. If asked a legal question, explain briefly that TrustiqLegal is software for law firms and that its AI Assistant helps qualified lawyers with research and drafting.

### Item 12. In-app AI disclaimers

**Category:** AI disclaimer

| | |
|---|---|
| **Where it appears** | en.js/ar.js keys ai.disclaimer, ai.no_library_matches, brief.disclaimer, intake.disclaimer, translate.review_hint, web.ai_review_note, deadlines.disclaimer.<br>AI Assistant and AI analysis screens; Case page > AI case brief; Website & leads > enquiry summary; Document > Translate; Website & leads > Blog; Deadline calculator. |
| **Language** | EN and AR |
| **What to check** | - Are these disclaimers adequate for lawyers relying on AI output, and should the translation hint state that AI translations are not certified (sworn) translations as the help text does? |

**Wording**

> AI output can be inaccurate or out of date and is not legal advice. Verify statutes and citations against official sources before relying on them.

<blockquote dir="rtl" lang="ar">قد تكون مخرجات الذكاء الاصطناعي غير دقيقة أو قديمة ولا تُعد استشارة قانونية. تحقّق من النصوص والمراجع من مصادرها الرسمية قبل الاعتماد عليها.</blockquote>

> No matching articles in your law library - verify this answer against the official text.

<blockquote dir="rtl" lang="ar">لا توجد مواد مطابقة في مكتبتك القانونية - تحقّق من هذه الإجابة مقابل النص الرسمي.</blockquote>

> Written by AI only from what is recorded on this case. Check it before relying on it or sharing it.

<blockquote dir="rtl" lang="ar">كتبه الذكاء الاصطناعي اعتمادًا فقط على ما سُجّل في هذه القضية. راجعه قبل الاعتماد عليه أو مشاركته.</blockquote>

> AI summary of what the enquirer wrote. Check it before relying on it.

<blockquote dir="rtl" lang="ar">ملخص آلي لما كتبه صاحب الاستفسار. تحقّق منه قبل الاعتماد عليه.</blockquote>

> Have a qualified translator or lawyer review it before filing or signing.

> AI drafts may contain errors. A lawyer must check every legal statement, especially anything marked [verify], before publishing.

<blockquote dir="rtl" lang="ar">قد تحتوي مسودات الذكاء الاصطناعي على أخطاء. يجب أن يراجع محامٍ كل معلومة قانونية، خاصة ما وُسم بـ [verify]، قبل النشر.</blockquote>

> Check the period against the governing law and any court-specific rules before relying on it.

<blockquote dir="rtl" lang="ar">تحقق من المدة وفق القانون الواجب التطبيق وقواعد المحكمة قبل الاعتماد عليها.</blockquote>

### Item 13. Fixed rules given to the AI for research, review and drafting

**Category:** AI processing

| | |
|---|---|
| **Where it appears** | src/services/legal-prompts.ts, constant SAFETY and functions chatSystemPrompt(), analysisMessages(), draftMessages()<br>Used by AI Assistant, Document > AI review, Documents > New with AI. Not shown to users, but it shapes every AI answer and draft. |
| **Language** | EN (instructions; output follows the user's language) |
| **What to check** | - Are these safeguards adequate for professional use in Oman? Should any rule be added (for example on confidentiality, or on citing Omani legislation by Royal Decree number)?<br>- The drafter is told to include "language precedence where relevant" and to follow "the customary order of an Arab court pleading". Is that order right for Omani courts? |

**Wording**

> Rules: You assist qualified legal professionals. Your output is a draft for their review, not legal advice to a layperson. Never invent statutes, article numbers, case citations or court decisions. If you are not certain a provision exists or of its number, say so explicitly and tell the user what to verify. State assumptions, flag where the law differs between GCC or Arab states, and flag anything that may have changed recently. If the question is outside the stated jurisdiction or needs facts you do not have, say what is missing.

> Research answers end with a brief "Verify" list. Without library sources the AI must say it is answering from general knowledge; extra general knowledge goes under the heading "Outside the library (unverified)". Drafts use placeholders such as [PARTY A NAME] and [LEGAL BASIS - ARTICLE TO BE CONFIRMED].

> Pleading structure: court heading; the parties with their capacities, addresses for service and the advocate acting for each; the subject of the claim; the facts in numbered paragraphs; the legal grounds; the requests (الطلبات) as a numbered list including costs and advocate fees; the advocate signature block; and a list of attached documents.

## 4. Pricing, plans and fair use

Price and limit statements on the public pricing page, in the firm quote form and in the app. Items 19 and 20 include working copy changes made on October 15, 2026.

### Item 14. Pricing section heading: "Prices exclude VAT"

**Category:** Pricing / VAT

| | |
|---|---|
| **Where it appears** | src/landing.ts, copy.en.pricingSub and copy.ar.pricingSub<br>Homepage > Pricing. |
| **Language** | EN and AR |
| **What to check** | - Is "Prices exclude VAT" (with VAT at 5% in Oman added on payment) a sufficient price display for business customers?<br>- Prices also appear in USD "outside Oman". Is a USD price for non-Omani firms acceptable as stated? |

**Wording**

> Simple, transparent pricing. Every plan includes the bilingual workspace, all GCC and Arab jurisdictions, version history and the audit log. Prices exclude VAT.

<blockquote dir="rtl" lang="ar">أسعار واضحة وبسيطة. تشمل جميع الباقات مساحة العمل ثنائية اللغة وجميع الولايات القضائية الخليجية والعربية وسجل الإصدارات وسجل التدقيق. الأسعار لا تشمل ضريبة القيمة المضافة.</blockquote>

> OMR 199 /month (Starter), OMR 649 /month (Professional), "or USD {n} outside Oman".

<blockquote dir="rtl" lang="ar">١٩٩ ر.ع. /شهرياً، ٦٤٩ ر.ع. /شهرياً، "أو {n} دولار أمريكي خارج عُمان".</blockquote>

### Item 15. Plan cards and Enterprise "Unlimited"

**Category:** Plan limits / fair use

| | |
|---|---|
| **Where it appears** | src/landing.ts, landingPage() pricing cards, copy.*.lines and copy.*.unlimited; limits from src/lib/plans.ts (PLANS)<br>Homepage > Pricing > Starter, Professional, Enterprise cards. |
| **Language** | EN and AR |
| **What to check** | - Enterprise shows "Unlimited open cases", "Unlimited new documents / month" and "Unlimited AI requests / month" with no qualifier, while a fair use limit is planned (priority question 2).<br>- Professional shows "Unlimited open cases". Is any qualifier needed there? |

**Wording**

> Starter: For solo practitioners and boutique firms. 3 lawyer seats included; 5 open cases; 50 new documents / month; 300 AI requests / month; AI drafting, research and summaries; Email support. (Not included: AI risk, compliance and full reviews.)

> Professional: For growing law firms. 10 lawyer seats included; Unlimited open cases; 500 new documents / month; 3,000 AI requests / month; AI drafting, research and summaries; AI risk, compliance and full reviews; Priority support.

> Enterprise: For large firms and in-house legal teams. Custom. Unlimited open cases; Unlimited new documents / month; Unlimited AI requests / month; AI risk, compliance and full reviews; Custom limits and service levels; Dedicated onboarding and data migration. [Button: Contact sales]

<blockquote dir="rtl" lang="ar">المؤسسات: للمكاتب الكبيرة والإدارات القانونية. حسب الطلب. غير محدود قضايا مفتوحة؛ غير محدود مستند جديد شهرياً؛ غير محدود طلب ذكاء اصطناعي شهرياً؛ مراجعات المخاطر والامتثال والمراجعة الشاملة؛ حدود ومستويات خدمة مخصصة؛ إعداد مخصص ونقل البيانات.</blockquote>

Note: The Arabic cards build each line from a pattern such as "{n} قضايا مفتوحة" with {n} = "غير محدود". The resulting phrase "غير محدود قضايا مفتوحة" may read awkwardly in Arabic.

### Item 16. Firms card and firm quote form (annual billing, support staff, VAT)

**Category:** Pricing / billing terms

| | |
|---|---|
| **Where it appears** | src/landing.ts, copy.*.firm and copy.*.firm.form; prices and rules in public/static/site/firm-pricing.js (quoteFirm, ANNUAL_MONTHS_BILLED = 10); form script public/static/site/firm-quote.js; server src/routes/firms.ts.<br>Homepage > Pricing > Firms > "Get a firm quote" (live quote form). |
| **Language** | EN and AR |
| **What to check** | - "Pay 10 months, get 12": what terms are needed for annual prepayment (refund on cancellation, price changes during the year, renewal)? The Terms of Service do not mention annual billing.<br>- "Support staff seats included free" with limited access: the landing form says support staff "cannot use AI drafting", while the working copy of the platform help says "no AI". Which is correct, and should the Terms define support staff?<br>- The released text says "Starter or Professional plus extra lawyer seats". The working copy (not yet released) changes this to "Starter Plus or Professional, priced for your team", adds a Starter Plus card (quoted below) and an optional AI pack of 500 requests (OMR 25 / USD 65). Please review the working copy wording, which is expected to go live. |

**Wording**

> Firms. Have more lawyers on your team? Live quote. Up to 25 lawyers, priced instantly; Starter or Professional plus extra lawyer seats; Support staff seats included free; Annual billing: pay 10 months, get 12. [Button: Get a firm quote]

<blockquote dir="rtl" lang="ar">المكاتب. هل في فريقك محامون أكثر؟ عرض سعر فوري. حتى ٢٥ محامياً بسعر فوري؛ الباقة الأساسية أو الاحترافية مع مقاعد محامين إضافية؛ مقاعد الموظفين المساندين مجانية؛ الاشتراك السنوي: ادفع ١٠ أشهر واحصل على ١٢</blockquote>

*Quote form*

> Price for your firm. The price updates as you type. Prices exclude VAT. ... Billing: Monthly / Annual (pay 10 months, get 12). ... {price} a year (12 months for the price of 10). {price} due monthly. Prices exclude VAT. Support staff can view, upload and organize. They cannot use AI drafting. Unlimited open cases, 500 new documents a month and all AI analyses. 5 open cases and 50 new documents a month, shared across the firm.

<blockquote dir="rtl" lang="ar">سعر مكتبك. يتحدث السعر مع كل تغيير. الأسعار لا تشمل ضريبة القيمة المضافة. ... سنوياً (ادفع ١٠ أشهر واحصل على ١٢). {السعر} سنوياً (١٢ شهراً بسعر ١٠). الأسعار لا تشمل ضريبة القيمة المضافة. يستطيع الموظفون المساندون العرض والرفع والتنظيم، دون صياغة بالذكاء الاصطناعي.</blockquote>

> More than 25 lawyers. We will prepare an Enterprise quote for your firm. Send your details and our team will reply by email.

> Thank you. We have your details and will email {email} with your payment link and next steps.

<blockquote dir="rtl" lang="ar">شكراً لك. وصلتنا بياناتك وسنرسل إلى {email} رابط الدفع والخطوات التالية.</blockquote>

*Working copy, not yet released (src/landing.ts)*

> Starter Plus: For firms with 4 to 10 lawyers. from OMR 234 /month. 4 lawyers, OMR 35 per additional lawyer. or from USD 609 outside Oman (USD 90 per additional lawyer). 5 open cases per lawyer; 15 new documents per lawyer / month; 100 AI requests per lawyer / month.

<blockquote dir="rtl" lang="ar">الأساسية بلس: للمكاتب التي تضم من ٤ إلى ١٠ محامين. من ٢٣٤ ر.ع. ٤ محامين، و٣٥ ر.ع. لكل محامٍ إضافي. ٥ قضايا مفتوحة لكل محامٍ؛ ١٥ مستنداً جديداً لكل محامٍ شهرياً؛ ١٠٠ طلب ذكاء اصطناعي لكل محامٍ شهرياً.</blockquote>

> Firms card line: Starter Plus or Professional, priced for your team. Form: Do you need any of these? They come with Professional. Limits are shared across the firm.

<blockquote dir="rtl" lang="ar">الأساسية بلس أو الاحترافية بسعر يناسب فريقك. هل تحتاج إلى أي من هذه؟ متوفرة في الباقة الاحترافية. الحدود مشتركة لجميع أعضاء المكتب.</blockquote>

### Item 17. Homepage assistant: plans, fair use and support staff (platform knowledge)

**Category:** Plan limits / fair use

| | |
|---|---|
| **Where it appears** | src/services/platform-help.ts, function platformKnowledge(), section "Plans (prices exclude VAT)" (working copy, not yet released)<br>Homepage chat assistant answers from this text. |
| **Language** | EN (the assistant answers in the visitor's language) |
| **What to check** | - This is currently the only place where the Enterprise fair use figures appear. Please confirm the wording and that it matches the Terms once a fair use clause is added (priority question 2).<br>- It says "each payment extends the plan by one month", which does not fit annual billing. |

**Wording**

> Enterprise: custom price from the sales team ({sales email}); unlimited usage under a fair use policy (400 AI requests and 80 new documents per lawyer a month, at least 10,000 and 2,000), onboarding and agreed service levels.

> Firms: ... Support staff (paralegals, secretaries) are free with limited access: view, upload and organize, no AI. Annual billing: pay 10 months, get 12.

> Extra AI requests: a pack of 500 AI requests costs OMR 25 (USD 65) and adds to the current month's allowance (Settings > Plan & usage).

> Payment: self-serve monthly payment by card through Tap Payments in Settings > Plan & usage; each payment extends the plan by one month. Enterprise is invoiced.

Note: Code (working copy) in public/static/site/firm-pricing.js, limitsFor(): Enterprise documents = max(2000, 80 x lawyers), AI requests = max(10000, 400 x lawyers). Comment: "Enterprise limits are fair use only: they raise alerts to the team and never block the firm."

### Item 18. Subscription payment notes, receipt and billing note

**Category:** Billing terms

| | |
|---|---|
| **Where it appears** | en.js/ar.js keys subscription.note and settings.billing_note; receipt email in src/services/tap.ts.<br>Settings > Plan & usage; email to the person who paid. |
| **Language** | EN and AR |
| **What to check** | - The two in-app notes contradict each other ("invoiced monthly by our sales team" versus "pay by card ... each payment extends your plan by one month").<br>- The payment email is called a "receipt". Does TrustiqLegal also need to issue a VAT tax invoice to Omani firms for the subscription under the VAT Law (Royal Decree 121/2020), and what must it contain? |

**Wording**

> Pay securely by card, Apple Pay or local debit via Tap Payments. Each payment extends your plan by one month. VAT: {vat}%.

<blockquote dir="rtl" lang="ar">ادفع بأمان بالبطاقة أو Apple Pay أو البطاقات المحلية عبر Tap Payments. كل دفعة تمدد باقتك شهرًا واحدًا. الضريبة: {vat}%.</blockquote>

> Plans are invoiced monthly by our sales team. Prices exclude VAT.

<blockquote dir="rtl" lang="ar">تُصدر فواتير الباقات شهرياً من فريق المبيعات. الأسعار لا تشمل ضريبة القيمة المضافة.</blockquote>

*Payment receipt email*

> Subject: Payment receipt - TrustiqLegal. Hello {name}, Thank you - your payment was received. Organization: {firm} Plan: {plan} Amount: {amount} {currency} Active until: {date} Transaction reference: {charge id}

<blockquote dir="rtl" lang="ar">إيصال الدفع - TrustiqLegal. مرحباً {الاسم}، تم استلام دفعتك بنجاح. المؤسسة: {المكتب} الباقة: {الباقة} المبلغ: {المبلغ} صالحة حتى: {التاريخ} مرجع العملية: {المرجع}</blockquote>

### Item 19. Firm subscription emails, renewals and limit messages

**Category:** Billing terms / plan limits

| | |
|---|---|
| **Where it appears** | Working copy, not yet released: src/services/firm-billing.ts (welcome and renewal failure emails, 7 day grace period), src/services/seats.ts (seat limit messages), src/services/usage.ts (AI limit and support staff messages).<br>Email to the firm contact after the first payment; email to admins when a renewal payment fails; error messages in the app when a limit is reached. |
| **Language** | EN and AR (emails); EN (in-app messages) |
| **What to check** | - The code renews subscriptions and handles failed "renewal payments". If cards are charged automatically, what consent and pre-renewal notice wording is needed at checkout and in the Terms?<br>- Is a 7 day grace period before the workspace becomes read only acceptable, and should it be in the Terms?<br>- Professional and Starter plans block AI use when the monthly allowance is used up, while Enterprise is planned to receive only soft alerts. Should the Terms state this difference? |

**Wording**

> Subject: Welcome to TrustiqLegal: set up {firm}. Hello {name}, Thank you for subscribing. The {firm} workspace is ready and you are its admin. Choose your password with this link within {n} hours: {link} Then invite your team in Settings > Team. Seats: {n} lawyers and {n} support staff. Your subscription is active until {date}.

<blockquote dir="rtl" lang="ar">مرحباً بكم في TrustiqLegal: إعداد حساب {المكتب}. مرحباً {الاسم}، شكراً لاشتراككم. تم إنشاء مساحة عمل {المكتب} وأنت مسؤولها. اختر كلمة المرور من هذا الرابط خلال {n} ساعة. بعد ذلك ادعُ فريقك من الإعدادات > الفريق. المقاعد: {n} محامين و{n} موظفين مساندين. الاشتراك ساري حتى {التاريخ}.</blockquote>

> Subject: Your TrustiqLegal renewal payment did not go through. Hello {name}, The renewal payment for {firm} did not go through. All your data is kept. If payment is not made by {date}, the workspace becomes read only until the subscription is renewed. For help, email {email}.

<blockquote dir="rtl" lang="ar">تعذر تجديد اشتراك TrustiqLegal. مرحباً {الاسم}، تعذر تحصيل دفعة تجديد اشتراك {المكتب}. بياناتكم محفوظة بالكامل. إذا لم تتم الدفعة بحلول {التاريخ} ستصبح مساحة العمل للقراءة فقط حتى التجديد.</blockquote>

> All {n} lawyer seats are in use. Add lawyer seats to your subscription, or remove a member or a pending invitation.

> All {n} support staff seats are in use. Ask us to add support seats (they are free), or remove a member or a pending invitation.

> AI features are not included in support staff seats. Ask a lawyer or an admin.

> You have used all {n} AI requests included this month. Buy an extra pack or upgrade your plan for more.

## 5. Engagement and client onboarding

Documents and checks before the firm acts for a client.

### Item 20. Engagement letter

**Category:** Generated document (client agreement)

| | |
|---|---|
| **Where it appears** | src/services/engagement.ts, function renderEngagementLetter(); AI scope drafting in scopeMessages(); route src/routes/engagements.ts.<br>Case page > banner "Engagement letter" > Prepare engagement letter (saved to the matter documents, then sent for e-signature). |
| **Language** | EN or AR (one language per letter, chosen by the lawyer) |
| **What to check** | - See priority question 6. Is the template compliant with Omani rules on advocate fee agreements, and are success fees (percentage of the amount recovered) permitted?<br>- Default exclusions and the six-minute time unit: are they appropriate?<br>- Is "client account" (حساب أموال الموكلين) the right term for money held for clients in Oman?<br>- Governing law and disputes: the law and courts of {jurisdiction}, defaulting to Oman. Is the court forum right for fee disputes?<br>- Personal data clause: is it enough under Royal Decree 6/2022?<br>- Is the Arabic wording correct and equivalent to the English? |

**Wording**

*Heading and opening (English)*

> ENGAGEMENT LETTER. Date: {date}. Our reference: {case reference}. To: {client} {client address}. Re: {matter title}. Dear {client}, Thank you for instructing {firm} in the matter above. This letter sets out the terms on which we will act for you. Please read it carefully and sign it to confirm your agreement.

*Heading and opening (Arabic)*

<blockquote dir="rtl" lang="ar">خطاب تكليف. التاريخ: {التاريخ}. المرجع: {المرجع}. إلى: {الموكل}. الموضوع: {عنوان القضية}. تحية طيبة وبعد، نشكركم على تكليف {المكتب} في الموضوع المشار إليه أعلاه. يحدد هذا الخطاب الشروط التي سنمثلكم بموجبها، فنرجو قراءته بعناية والتوقيع عليه تأكيداً لموافقتكم.</blockquote>

*Numbered sections (fixed text; variable parts in curly brackets)*

> 1. Scope of our work: {scope written by the lawyer, optionally drafted by AI}.

> 2. Matters outside the scope: {exclusions}, or by default: Any work not described above, including appeals, enforcement of judgments and related or new matters, is outside this engagement and will require a written extension or a separate engagement letter.

<blockquote dir="rtl" lang="ar">ما يخرج عن نطاق العمل: لا يشمل هذا التكليف أي عمل غير مذكور أعلاه، بما في ذلك الطعون وتنفيذ الأحكام والمسائل المرتبطة أو الجديدة، ويتطلب ذلك تمديداً كتابياً أو خطاب تكليف مستقلاً.</blockquote>

> 3. Our fees (one of four versions). Hourly: Our fees are based on the time spent on your matter at the rate of {rate} per hour, recorded in units of six minutes. (Without a rate: ... at the firm's standard hourly rates, which we will confirm to you in writing before work begins.) Fixed: We will charge a fixed fee of {amount} for the work described in the scope above. Work outside the scope is not covered by the fixed fee. Capped: Our fees are based on the time spent [at {rate} per hour], and will not exceed {cap} for the work described in the scope above without your prior written approval. Success fee: Our fee will be {percent}% of the amount actually recovered for you in this matter[, in addition to a fixed fee of {amount}]. If nothing is recovered, no success fee is payable.

<blockquote dir="rtl" lang="ar">الأتعاب: تُحتسب أتعابنا على أساس الوقت المستغرق في العمل على موضوعكم بسعر {السعر} للساعة، ويُسجَّل الوقت بوحدات مدتها ست دقائق. / نتقاضى أتعاباً مقطوعة قدرها {المبلغ} عن العمل المحدد في نطاق العمل أعلاه، ولا تشمل الأتعاب المقطوعة أي عمل خارج هذا النطاق. / تُحتسب أتعابنا على أساس الوقت المستغرق، ولن تتجاوز {السقف} عن العمل المحدد في نطاق العمل أعلاه إلا بموافقتكم الكتابية المسبقة. / تكون أتعابنا بنسبة {النسبة}% من المبالغ التي يتم تحصيلها فعلياً لصالحكم في هذا الموضوع. ولا تستحق أتعاب النجاح إذا لم يتم تحصيل أي مبلغ.</blockquote>

> Advance payment (if set): Before we begin, please pay an advance of {amount}. We will hold it in our client account and apply it to our invoices and to expenses paid on your behalf. Any unused balance will be refunded to you at the end of the engagement.

<blockquote dir="rtl" lang="ar">الدفعة المقدمة: يُرجى سداد دفعة مقدمة قدرها {المبلغ} قبل بدء العمل، نحتفظ بها في حساب أموال الموكلين لدينا ونخصم منها فواتيرنا والمصروفات المدفوعة نيابةً عنكم، ويُرد إليكم أي رصيد متبقٍ عند انتهاء التكليف.</blockquote>

> Expenses and official fees: Court fees, government and notary fees, sworn translation, experts' fees, courier and travel costs are not included in our fees and are payable by you. We will ask for your approval before incurring any significant expense.

<blockquote dir="rtl" lang="ar">المصروفات والرسوم الرسمية: لا تشمل أتعابنا الرسوم القضائية والحكومية ورسوم الكاتب بالعدل والترجمة المعتمدة وأتعاب الخبراء ومصاريف البريد والسفر، وتكون على نفقتكم. وسنطلب موافقتكم قبل تكبد أي مصروف كبير.</blockquote>

> Value added tax: Our fees are subject to value added tax at {rate}%, which will be added to our invoices. (If 0%: Our fees are stated exclusive of any value added tax that may become applicable, which will be added to our invoices where required by law.)

<blockquote dir="rtl" lang="ar">ضريبة القيمة المضافة: تخضع أتعابنا لضريبة القيمة المضافة بنسبة {النسبة}%، وتُضاف إلى فواتيرنا. / الأتعاب المذكورة لا تشمل ضريبة القيمة المضافة التي قد تصبح مستحقة، وتُضاف إلى فواتيرنا متى أوجبها القانون.</blockquote>

> Invoices and payment: We will invoice you monthly, with a summary of the work done (fixed fee: We will invoice the fixed fee in accordance with the stages of the work). Invoices are payable within {n} days of their date.

<blockquote dir="rtl" lang="ar">الفواتير والسداد: نصدر فواتيرنا شهرياً مع بيان بالأعمال المنجزة (أو: نصدر فواتير الأتعاب المقطوعة وفقاً لمراحل العمل)، وتُستحق الفواتير خلال {n} يوماً من تاريخها.</blockquote>

> Your responsibilities: You agree to give us complete and accurate information and documents promptly, to give us clear instructions, and to tell us at once of any change that may affect the matter. Our advice depends on the information you provide.

<blockquote dir="rtl" lang="ar">التزاماتكم: تلتزمون بتزويدنا بمعلومات ومستندات كاملة وصحيحة دون تأخير، وبإعطائنا تعليمات واضحة، وبإبلاغنا فوراً بأي تغيير قد يؤثر في الموضوع. وتعتمد مشورتنا على المعلومات التي تقدمونها.</blockquote>

> Confidentiality and conflicts of interest: We will keep your information confidential, except where disclosure is required by law or by a competent authority. We have checked that we have no conflict of interest in acting for you, and we will tell you if one arises.

<blockquote dir="rtl" lang="ar">السرية وتعارض المصالح: نلتزم بالمحافظة على سرية معلوماتكم إلا إذا أوجب القانون أو جهة مختصة الإفصاح عنها. وقد تحققنا من عدم وجود تعارض في المصالح يمنعنا من تمثيلكم، وسنبلغكم إذا نشأ أي تعارض.</blockquote>

> Personal data: We process personal data only to act for you and to meet our legal obligations, in accordance with the personal data protection law applicable in {the Sultanate of Oman or other jurisdiction}.

<blockquote dir="rtl" lang="ar">البيانات الشخصية: نعالج البيانات الشخصية لغرض تمثيلكم والوفاء بالتزاماتنا القانونية فقط، وفقاً لقانون حماية البيانات الشخصية المعمول به في {سلطنة عُمان}.</blockquote>

> Ending the engagement: You may end this engagement at any time by written notice. We may stop acting for you, subject to our professional obligations, if invoices remain unpaid, if a conflict arises or if we cannot obtain proper instructions. Fees and expenses up to the date of termination remain payable.

<blockquote dir="rtl" lang="ar">إنهاء التكليف: يجوز لكم إنهاء هذا التكليف في أي وقت بإخطار كتابي. ويجوز لنا التوقف عن تمثيلكم، مع مراعاة التزاماتنا المهنية، إذا لم تُسدَّد الفواتير أو نشأ تعارض في المصالح أو تعذر الحصول على تعليمات مناسبة. وتظل الأتعاب والمصروفات المستحقة حتى تاريخ الإنهاء واجبة السداد.</blockquote>

> Governing law and disputes: This letter is governed by the laws of {the Sultanate of Oman}. Any dispute arising from it shall be referred to the competent courts of {the Sultanate of Oman}.

<blockquote dir="rtl" lang="ar">القانون الواجب التطبيق والنزاعات: يخضع هذا الخطاب لقوانين {سلطنة عُمان}، ويُحال أي نزاع ينشأ عنه إلى المحاكم المختصة في {سلطنة عُمان}.</blockquote>

> Additional terms (if entered): {notes}.

*Signature and acceptance*

> Yours sincerely, For {firm} Name: {signatory} Signature: ________ ACCEPTANCE I agree to the terms of this letter. Client: {client} Signature: ________ Date: ________

<blockquote dir="rtl" lang="ar">وتفضلوا بقبول فائق الاحترام، عن {المكتب} الاسم: {الموقع} التوقيع: ________ الموافقة أوافق على الشروط الواردة في هذا الخطاب. الموكل: {الموكل} التوقيع: ________ التاريخ: ________</blockquote>

### Item 21. Conflict of interest check

**Category:** Professional conduct

| | |
|---|---|
| **Where it appears** | en.js/ar.js keys conflicts.*; matching rules in src/services/conflicts.ts; onboarding register keys onb.*.<br>Clients > New client and Cases > New case (warning dialog); Reports > Conflict check log; Cases > Matter onboarding. |
| **Language** | EN and AR |
| **What to check** | - Does the process (block, then partner override with a recorded reason) meet the conflict rules that apply to advocates in Oman?<br>- Is the engagement letter statement "We have checked that we have no conflict of interest" safe when a partner has overridden a match? |

**Wording**

> Possible conflict of interest. Possible conflict: this name appears as an opposing party. Possible matches - check for a conflict of interest:

> Reason for proceeding. Recorded in the conflict log with your name, e.g. "different person: other CR number, confirmed with the client".

> Only a partner (owner or admin) can approve this. Ask a partner to review the matches and create it.

> Conflict check log: New clients and cases that matched an existing client or opposing party, and every override with its reason.

> Matter onboarding: Every open matter against the checks your firm requires before acting: conflict check, client due diligence (KYC), power of attorney and signed engagement letter.

### Item 22. Client due diligence (KYC / AML)

**Category:** AML compliance

| | |
|---|---|
| **Where it appears** | src/services/kyc.ts (risk score, review periods, approval blockers BLOCKER_TEXT); en.js/ar.js keys kyc.*; platform-help.ts description.<br>Client page > Due diligence (KYC / AML); Clients > KYC register. |
| **Language** | EN and AR |
| **What to check** | - The code states that GCC lawyers are designated non-financial businesses under the AML laws and cites "Oman Royal Decree 30/2016". Is that the correct and current Omani law and are the duties described correctly?<br>- Are the review periods (high risk 1 year, medium 2, low 3), the 25% beneficial ownership threshold and the scoring reasonable for Omani requirements?<br>- Is the statement that the app does not query sanctions lists itself clear enough to users?<br>- Arabic terms: العناية الواجبة المعززة، شاغل منصب عام رفيع، المستفيد الحقيقي (the app uses "كل من يملك أو يسيطر في النهاية"). |

**Wording**

> Identity, beneficial owners, PEP and sanctions checks, and the client's risk rating.

> Politically exposed person (PEP): Senior public office holder, or a close family member or associate of one.

<blockquote dir="rtl" lang="ar">شاغل منصب عام رفيع أو أحد أفراد أسرته أو المقربين منه.</blockquote>

> Everyone who ultimately owns or controls 25% or more, or otherwise controls the company.

<blockquote dir="rtl" lang="ar">كل من يملك أو يسيطر في النهاية على 25% أو أكثر، أو يسيطر على الشركة بطريقة أخرى.</blockquote>

> High-risk country: e.g. on the FATF list of high-risk or monitored jurisdictions.

<blockquote dir="rtl" lang="ar">مثل الدول المدرجة على قوائم مجموعة العمل المالي (فاتف).</blockquote>

> Enhanced due diligence: why the firm accepts this high-risk client

<blockquote dir="rtl" lang="ar">العناية الواجبة المعززة: سبب قبول المكتب لهذا الموكل عالي المخاطر</blockquote>

> Approval blockers: Verify the client's identity first. Record the sanctions screening first. A possible sanctions match is recorded. Resolve it or reject the client. Record the source of funds first. List the company's beneficial owners first.

> KYC register: Due diligence status and risk of every active client, ready for a compliance review or regulator inspection.

<blockquote dir="rtl" lang="ar">حالة العناية الواجبة ومخاطر كل موكل نشط، جاهز لمراجعة الالتزام أو تفتيش الجهة الرقابية.</blockquote>

Note: Platform help: "The app does not query sanctions lists itself." Lists placeholder: "e.g. UN, local terrorist list, OFAC".

## 6. Generated letters and instruments

Word documents and drafts the app produces with fixed bilingual wording. Each is laid out English on the left and Arabic on the right unless stated.

### Item 23. Legal notices (الإنذارات): register and drafting

**Category:** Legal notice

| | |
|---|---|
| **Where it appears** | Register: src/routes/notices.ts and en.js/ar.js keys ntc.*. Drafting: Documents > New with AI using template "legal_notice" (src/services/reference.ts DOCUMENT_TEMPLATES and src/services/legal-prompts.ts draftStructure()).<br>Case page > Legal notices > Record notice / Draft notice; Cases > Legal notices (register). |
| **Language** | EN and AR |
| **What to check** | - There is no fixed legal notice template: the text is drafted by AI from the lawyer's instructions as a "letter" with date, reference, addressee and signature block. Should the app provide a fixed Omani notice template (for example for service through the notary public)?<br>- Are the service methods and their Arabic names correct for Oman (for example "مندوب الإعلان بالمحكمة" for court bailiff)? Can a notice validly be served by email or WhatsApp in Oman?<br>- The response deadline is counted from the delivery date. Is that the right default? |

**Wording**

> Legal notices. Notices sent to and received from other parties, with their response deadlines.

<blockquote dir="rtl" lang="ar">الإنذارات والإخطارات. الإنذارات الموجهة إلى الأطراف الأخرى أو الواردة منها، مع مواعيد الرد.</blockquote>

> Service methods: Notary public; Court bailiff; Courier; Registered mail; Email; WhatsApp; By hand; Other.

<blockquote dir="rtl" lang="ar">الكاتب بالعدل؛ مندوب الإعلان بالمحكمة؛ البريد السريع؛ البريد المسجل؛ البريد الإلكتروني؛ واتساب؛ تسليم باليد؛ أخرى.</blockquote>

> Check the period against the notice itself and the applicable law; the deadline goes on the calendar.

<blockquote dir="rtl" lang="ar">تحقق من المهلة في الإنذار نفسه وفي القانون المطبق؛ يُضاف الموعد إلى التقويم.</blockquote>

> Calendar entries: "Reply to notice due - {reference}": Last day to reply to the notice from {party}: {subject}. "Notice response period ends - {reference}": The period given to {party} to respond ends. Decide the next step (claim, payment order, follow-up). Notice: {subject}

> Template name: Legal Notice / Demand Letter.

<blockquote dir="rtl" lang="ar">إنذار قانوني / خطاب مطالبة</blockquote>

### Item 24. Returned cheque demand letter

**Category:** Generated document (demand letter)

| | |
|---|---|
| **Where it appears** | src/services/cheques.ts, function renderDemandDocx(); return reasons in REASON; route src/routes/cheques.ts (payment period default 7 days, range 1 to 90); review note key chq.demand_review.<br>Case page > Returned cheques > Demand letter (Word download). |
| **Language** | EN and AR side by side |
| **What to check** | - Is the wording suitable as a pre-action demand for dishonored cheques in Oman (civil claim and the criminal complaint route under the Commercial Code)? Is a default period of 7 days appropriate?<br>- English "without prejudice" usually means a communication cannot be shown to the court. On a demand letter that the client may want to rely on, is this phrase appropriate? The Arabic "دون إخلال بأي من حقوق موكلنا" means a reservation of rights, which is different.<br>- Is "without further notice and at your cost" (دون حاجة إلى إنذار آخر، مع تحميلكم كافة المصاريف) enforceable or appropriate?<br>- Arabic return reasons: are they the terms Omani banks use? |

**Wording**

> Demand for payment of returned cheques. Date: {date}. Our ref.: {reference}. To: {drawer}.

<blockquote dir="rtl" lang="ar">إنذار بسداد قيمة شيكات مرتجعة. التاريخ: {التاريخ}. مرجعنا: {المرجع}. إلى: {الساحب}.</blockquote>

> We write on behalf of our client, {client}. The cheques listed below, drawn by you in our client's favour, were presented for payment and returned unpaid by the bank.

<blockquote dir="rtl" lang="ar">نكتب إليكم بالنيابة عن موكلنا {الموكل}. إن الشيكات المبينة أدناه، المسحوبة منكم لصالح موكلنا، قُدمت للصرف وأعادها البنك دون صرف.</blockquote>

Note: Table: Cheque no. / رقم الشيك; Bank / البنك; Date / التاريخ; Returned / تاريخ الإرجاع; Reason / السبب; Unpaid / المبلغ المستحق.

> Reasons: Insufficient funds; Account closed; Signature irregular; Payment stopped by drawer; Irregular cheque; Other.

<blockquote dir="rtl" lang="ar">عدم كفاية الرصيد؛ الحساب مغلق؛ عدم مطابقة التوقيع؛ إيقاف الصرف من الساحب؛ شيك غير مستوفٍ للبيانات؛ أخرى.</blockquote>

> The total unpaid is {total}. We demand that you pay this amount to our client within {days} days of receiving this letter. Failing that, our client will take the legal action available to it to recover the amount, without further notice and at your cost.

<blockquote dir="rtl" lang="ar">ويبلغ إجمالي المبلغ المستحق {الإجمالي}. ونطالبكم بسداد هذا المبلغ لموكلنا خلال {الأيام} يوماً من تاريخ استلامكم هذا الإنذار، وإلا فسيتخذ موكلنا الإجراءات القانونية المتاحة له لاستيفاء المبلغ، دون حاجة إلى إنذار آخر، مع تحميلكم كافة المصاريف.</blockquote>

> This letter is without prejudice to any of our client's rights, all of which are reserved.

<blockquote dir="rtl" lang="ar">ويُعد هذا الإنذار دون إخلال بأي من حقوق موكلنا الأخرى، والتي يحتفظ بها كاملة.</blockquote>

> For {firm} ______

<blockquote dir="rtl" lang="ar">عن {المكتب} ______</blockquote>

*Note shown in the app before download*

> Standard wording. Review it before sending, and send it in the way the law requires (for example by a notary or the court).

<blockquote dir="rtl" lang="ar">صياغة نموذجية. راجعها قبل الإرسال، وأرسلها بالطريقة التي يتطلبها القانون (مثل الكاتب بالعدل أو المحكمة).</blockquote>

### Item 25. Lease notice letter (non-renewal or renewal on new terms)

**Category:** Generated document (lease notice)

| | |
|---|---|
| **Where it appears** | src/services/leases.ts, function renderNoticeDocx(); calendar notes in syncLeaseEvents(); review note key lease.notice_review.<br>Client page > Leases > lease > Notice (Word download). |
| **Language** | EN and AR side by side |
| **What to check** | - Is the wording appropriate for Omani tenancies (for example the Royal Decree 6/89 regime on landlord and tenant relations and municipality registration), including the notice period and how notice must be served?<br>- For a landlord's non-renewal: can a landlord in Oman refuse renewal of a residential or commercial lease simply by notice, and is the demand to vacate correctly worded?<br>- The same "without prejudice" issue as the cheque demand.<br>- Arabic terms: العين المؤجرة، مبلغ التأمين، المسجل برقم. |

**Wording**

> Notice of non-renewal of lease / Notice of renewal terms. Date: {date}. To: {other party}.

<blockquote dir="rtl" lang="ar">إخطار بعدم تجديد عقد الإيجار / إخطار بشروط تجديد عقد الإيجار. التاريخ: {التاريخ}. إلى: {الطرف الآخر}.</blockquote>

> We write on behalf of our client, {client}, {the landlord / the tenant} under the lease of {property} (registration no. {number}), which expires on {date}.

<blockquote dir="rtl" lang="ar">نكتب إليكم بالنيابة عن موكلنا {الموكل}، {المؤجر / المستأجر} بموجب عقد إيجار {العقار} (المسجل برقم {الرقم})، والذي ينتهي في {التاريخ}.</blockquote>

*Non-renewal*

> Our client hereby gives notice that it does not wish to renew the lease when it expires.

<blockquote dir="rtl" lang="ar">ويخطركم موكلنا بموجب هذا بعدم رغبته في تجديد العقد عند انتهائه.</blockquote>

> Landlord client: You are therefore requested to vacate the property and hand it over in good condition, with all utility bills settled, on or before {date}.

<blockquote dir="rtl" lang="ar">وعليه نطلب منكم إخلاء العين المؤجرة وتسليمها بحالة جيدة مع سداد جميع فواتير الخدمات في موعد أقصاه {التاريخ}.</blockquote>

> Tenant client: Our client will vacate and hand over the property on {date} and asks that the security deposit be returned on hand-over.

<blockquote dir="rtl" lang="ar">وسيقوم موكلنا بإخلاء العين المؤجرة وتسليمها في {التاريخ}، ويطلب رد مبلغ التأمين عند التسليم.</blockquote>

*Renewal on new terms*

> Our client is willing to renew the lease on the following terms: an annual rent of {amount}; {other terms}. Please confirm your acceptance in writing before the lease expires. Failing agreement, the lease will end on its expiry date.

<blockquote dir="rtl" lang="ar">ويبدي موكلنا استعداده لتجديد العقد وفق الشروط التالية: أجرة سنوية قدرها {المبلغ}؛ {الشروط}. نرجو تأكيد موافقتكم كتابةً قبل انتهاء العقد، وفي حال عدم الاتفاق ينتهي العقد في تاريخ انتهائه.</blockquote>

*Closing (both kinds)*

> This notice is without prejudice to any of our client's rights. For {firm} ______

<blockquote dir="rtl" lang="ar">ويُعد هذا الإخطار دون إخلال بأي من حقوق موكلنا. عن {المكتب} ______</blockquote>

*Notes in the app and calendar*

> Standard wording. Check the notice period and the way it must be served under the lease and the law.

<blockquote dir="rtl" lang="ar">صياغة نموذجية. تحقق من مدة الإخطار وطريقة إعلانه وفق العقد والقانون.</blockquote>

> Calendar: Last day to notify {other party} of non-renewal or new terms ({n} days before expiry, as recorded on the lease). Check the period against the lease and the applicable law.

### Item 26. Power of attorney draft (مسودة وكالة)

**Category:** Generated document (power of attorney)

| | |
|---|---|
| **Where it appears** | src/services/poa.ts, functions scopeClause(), poaText(), renderPoaDocx(), SPECIAL_TEXT; title in src/routes/poa.ts; labels en.js/ar.js keys poa.*.<br>Client page > Powers of attorney & IDs > Draft POA; Case page > power of attorney warning > Draft POA (Word download for the notary). |
| **Language** | EN and AR side by side |
| **What to check** | - Is the structure acceptable to Omani notaries (الكاتب بالعدل), and should the app follow the notary's standard form more closely?<br>- Are the six special powers the ones Omani law requires to be stated expressly (compare the Civil and Commercial Procedure Law and the Civil Transactions Law on agency), and are the Arabic terms correct? Is "release debtors" a fair English rendering of "الإبراء"?<br>- Is "الادعاء العام" (public prosecution) correctly used, and should the general litigation scope also mention specific courts or bodies?<br>- Company principal: "represented by {name} in their capacity as {role}". Are the role words (مديراً، عضواً في مجلس الإدارة، مفوضاً بالتوقيع، شريكاً) correct?<br>- Delegation clause and validity wording (until a date, or until revoked).<br>- The app hint says special powers "must be stated expressly to be valid" (يجب النص عليها صراحةً لتكون نافذة). Is that statement accurate? |

**Wording**

> Power of attorney (draft)

<blockquote dir="rtl" lang="ar">وكالة (مسودة)</blockquote>

*Opening*

> Individual: I, {name}, holder of ID no. {number} ("the principal"), hereby appoint the advocate(s) {names} (advocate registration no. {number}) of {firm}[, jointly or severally,] as my attorney(s):

<blockquote dir="rtl" lang="ar">أنا {الاسم}، حامل الهوية رقم {الرقم} ("الموكل")، أوكل بموجب هذا المحامي/المحامين {الأسماء} (قيد محاماة رقم {الرقم}) من {المكتب}، مجتمعين أو منفردين، وذلك من أجل:</blockquote>

> Company: {company}, commercial registration no. {number}, represented by {name} in their capacity as {role} (ID no. {number}) ("the principal") hereby appoints the advocate(s) ... as its attorney(s):

<blockquote dir="rtl" lang="ar">إن {الشركة}، المقيدة في السجل التجاري برقم {الرقم}، ويمثلها {الاسم} بصفته {الصفة} (هوية رقم {الرقم}) ("الموكلة")، توكل بموجب هذا ... وذلك من أجل:</blockquote>

*1. Scope (one of six)*

> General litigation: to represent the principal before all courts of every type and level, the public prosecution, the police and all judicial and administrative bodies, as claimant or defendant; to file and answer claims, submit pleadings and memoranda, attend hearings, apply for and challenge judgments by every method of appeal, and follow up their enforcement

<blockquote dir="rtl" lang="ar">تمثيل الموكل أمام جميع المحاكم على اختلاف أنواعها ودرجاتها، والادعاء العام، والشرطة، وجميع الجهات القضائية والإدارية، مدعياً أو مدعى عليه، ورفع الدعاوى والرد عليها، وتقديم اللوائح والمذكرات، وحضور الجلسات، وطلب الأحكام والطعن فيها بجميع طرق الطعن، ومتابعة تنفيذها</blockquote>

> Specific case: to represent the principal in case no. {number} before {court} against {opponent}, and in every appeal, objection and enforcement arising from it; to submit pleadings and memoranda, attend hearings and take every step the case requires

<blockquote dir="rtl" lang="ar">تمثيل الموكل في الدعوى رقم {الرقم} أمام {المحكمة} ضد {الخصم}، وفي كل ما يتفرع عنها من طعون واعتراضات وتنفيذ، وتقديم اللوائح والمذكرات، وحضور الجلسات، واتخاذ جميع الإجراءات التي تتطلبها الدعوى</blockquote>

> Company representation: to represent the principal before ministries, government departments, the commercial registry, chambers of commerce and industry, municipalities and all public and private bodies, and to sign and submit applications, forms and documents for that purpose

<blockquote dir="rtl" lang="ar">تمثيل الموكل أمام الوزارات والدوائر الحكومية والسجل التجاري وغرف التجارة والصناعة والبلديات وجميع الجهات العامة والخاصة، وتوقيع الطلبات والنماذج والمستندات وتقديمها لهذا الغرض</blockquote>

> Real estate: to represent the principal before the land registry and all real estate authorities in respect of the property described as: {property}; to apply for and receive title documents and certificates, and to complete the procedures relating to the property

<blockquote dir="rtl" lang="ar">تمثيل الموكل أمام السجل العقاري وجميع الجهات المختصة بالعقارات بخصوص العقار الموصوف بأنه: {العقار}، وطلب سندات الملكية والشهادات واستلامها، وإتمام الإجراءات المتعلقة بالعقار</blockquote>

> Debt collection: to claim and collect the amounts owed to the principal by {debtor}; to send notices and demands, file claims and complaints including those relating to returned cheques, and follow up enforcement

<blockquote dir="rtl" lang="ar">مطالبة {المدين} بالمبالغ المستحقة للموكل وتحصيلها، وإرسال الإنذارات والمطالبات، ورفع الدعاوى وتقديم الشكاوى بما فيها المتعلقة بالشيكات المرتجعة، ومتابعة التنفيذ</blockquote>

> Arbitration: to represent the principal in arbitration proceedings before any arbitral institution or tribunal; to appoint arbitrators, file statements and evidence, attend hearings, and apply to set aside, recognise or enforce arbitral awards

<blockquote dir="rtl" lang="ar">تمثيل الموكل في إجراءات التحكيم أمام أي مركز أو هيئة تحكيم، وتعيين المحكمين، وتقديم المذكرات والبينات، وحضور الجلسات، وطلب إبطال أحكام التحكيم أو الاعتراف بها أو تنفيذها</blockquote>

*2. Special powers (only those ticked)*

> The attorney(s) is/are expressly authorised to: admit claims; settle and conciliate; waive claims and withdraw proceedings; release debtors; agree to arbitration; receive money, cheques and documents on the principal's behalf and give receipts.

<blockquote dir="rtl" lang="ar">وللوكيل (وللوكلاء) صراحةً حق: الإقرار، الصلح، التنازل وترك الخصومة، الإبراء، الاتفاق على التحكيم، قبض المبالغ والشيكات والمستندات باسم الموكل والتوقيع بالاستلام.</blockquote>

*Delegation, general power and validity*

> The attorney(s) may delegate all or part of these powers to another advocate. / The attorney(s) may not delegate these powers to anyone else.

<blockquote dir="rtl" lang="ar">وللوكيل حق توكيل الغير من المحامين في كل أو بعض ما ذُكر. / وليس للوكيل حق توكيل الغير.</blockquote>

> To sign all documents and take all steps needed for the above.

<blockquote dir="rtl" lang="ar">وتوقيع جميع المستندات واتخاذ جميع الإجراءات اللازمة لما تقدم.</blockquote>

> This power of attorney is valid until {date}. / This power of attorney remains valid until it is revoked.

<blockquote dir="rtl" lang="ar">تسري هذه الوكالة حتى {التاريخ}. / تسري هذه الوكالة ما لم يتم إلغاؤها.</blockquote>

*Signature block and footer*

> Principal / الموكل: {name} Signature / التوقيع: ________ Date / التاريخ: ________. Box: For the notary public / خاص بالكاتب بالعدل.

> Draft prepared by the firm for notarisation. The notary's own form and requirements prevail.

<blockquote dir="rtl" lang="ar">مسودة أعدها المكتب لغرض التوثيق، ويُعتمد نموذج الكاتب بالعدل ومتطلباته.</blockquote>

*Hint in the app*

> These must be stated expressly to be valid. Tick only what the client agrees to.

<blockquote dir="rtl" lang="ar">يجب النص عليها صراحةً لتكون نافذة. اختر فقط ما يوافق عليه الموكل.</blockquote>

### Item 27. Corporate resolutions (shareholders, board, sole owner)

**Category:** Generated document (corporate resolution)

| | |
|---|---|
| **Where it appears** | src/services/resolutions.ts, functions preamble(), buildItems(), renderResolutionDocx(), constants TITLE and FORM; AI drafting rules in itemsMessages().<br>Client page (company) > Resolutions > New resolution > Download (Word). |
| **Language** | EN and AR side by side |
| **What to check** | - Do the preambles meet the formal requirements of the Commercial Companies Law (Royal Decree 18/2019) for shareholder, board and sole owner resolutions (quorum, majority, place, date, minutes)? Should the preamble state the quorum or the majority required?<br>- Legal form names in Arabic, in particular "شركة تضامن أو توصية" (combines two distinct forms), "شركة الشخص الواحد", "شركة مساهمة مقفلة", "شركة منطقة حرة".<br>- Verbs: تعيين، عزل، تفويض، منح وكالة، اعتماد القوائم المالية المدققة. Is "عزل" the right word for removing a manager?<br>- The English uses "shareholders" for LLC partners (الشركاء). Is that acceptable? |

**Wording**

> Titles: Resolution of the shareholders / of the board of directors / of the sole owner No. {n}

<blockquote dir="rtl" lang="ar">قرار الشركاء / قرار مجلس الإدارة / قرار المالك الوحيد رقم {n}</blockquote>

*Preambles*

> The shareholders of {company}, {legal form}, commercial registration no. {CR}, holding together {percent}% of the share capital, met at {place} on {date} and resolved as follows:

<blockquote dir="rtl" lang="ar">اجتمع الشركاء في {الشركة}، {الشكل القانوني}، المقيدة في السجل التجاري برقم {الرقم}، والمالكون مجتمعين لنسبة {النسبة}% من رأس المال، في {المكان} بتاريخ {التاريخ}، وقرروا ما يلي:</blockquote>

> The board of directors of {company}, {legal form}, commercial registration no. {CR}, met at {place} on {date} and resolved as follows:

<blockquote dir="rtl" lang="ar">اجتمع مجلس إدارة {الشركة}، {الشكل القانوني}، المقيدة في السجل التجاري برقم {الرقم}، في {المكان} بتاريخ {التاريخ}، وقرر ما يلي:</blockquote>

> {owner}, the sole owner of {company}, {legal form}, commercial registration no. {CR}, resolved at {place} on {date} as follows:

<blockquote dir="rtl" lang="ar">قرر {المالك}، المالك الوحيد لـ {الشركة}، {الشكل القانوني}، المقيدة في السجل التجاري برقم {الرقم}، في {المكان} بتاريخ {التاريخ} ما يلي:</blockquote>

*Standard items*

> To appoint {person}, {nationality} national, holder of ID or passport no. {number}, as manager of the company with effect from {date}, with the following authority: {authority}.

<blockquote dir="rtl" lang="ar">تعيين {الشخص}، {الجنسية} الجنسية، حامل الهوية أو جواز السفر رقم {الرقم}، مديراً للشركة اعتباراً من {التاريخ}، وذلك بالصلاحيات التالية: {الصلاحيات}.</blockquote>

> To remove {name} from the position of manager of the company with effect from {date}.

<blockquote dir="rtl" lang="ar">عزل {الاسم} من منصب مدير الشركة اعتباراً من {التاريخ}.</blockquote>

> To authorise {person}, to sign on behalf of the company ...

<blockquote dir="rtl" lang="ar">تفويض {الشخص}، بالتوقيع نيابة عن الشركة ...</blockquote>

> To open an account in the name of the company with {bank}. To authorise {person}, to operate the account ...

<blockquote dir="rtl" lang="ar">فتح حساب باسم الشركة لدى {البنك}. تفويض {الشخص}، بتشغيل الحساب ...</blockquote>

> To grant a power of attorney to {person}, to {scope}.

<blockquote dir="rtl" lang="ar">منح وكالة إلى {الشخص}، وذلك من أجل {النطاق}.</blockquote>

> To change the registered address of the company to: {address}.

<blockquote dir="rtl" lang="ar">تغيير العنوان المسجل للشركة إلى: {العنوان}.</blockquote>

> To approve the audited financial statements of the company for the financial year ended {date}.

<blockquote dir="rtl" lang="ar">اعتماد القوائم المالية المدققة للشركة عن السنة المالية المنتهية في {التاريخ}.</blockquote>

> To authorise {name} to take all actions and sign all documents needed to give effect to these resolutions before the competent authorities.

<blockquote dir="rtl" lang="ar">تفويض {الاسم} باتخاذ جميع الإجراءات وتوقيع جميع المستندات اللازمة لتنفيذ هذه القرارات أمام الجهات المختصة.</blockquote>

Note: Signature blocks: {name / Arabic name}, {role} ({percent}%), Signature / التوقيع: ________. Other decisions can be drafted by AI in both languages; missing details are written as [●].

*Legal form names used in resolutions and registers*

> a limited liability company; a single-person company; a public joint stock company (SAOG); a closed joint stock company (SAOC); a partnership; a branch of a foreign company; a sole proprietorship; a free zone company; a company

<blockquote dir="rtl" lang="ar">شركة محدودة المسؤولية؛ شركة الشخص الواحد؛ شركة مساهمة عامة؛ شركة مساهمة مقفلة؛ شركة تضامن أو توصية (في السجل: شركة تضامن / توصية)؛ فرع شركة أجنبية؛ مؤسسة فردية؛ شركة منطقة حرة؛ شركة</blockquote>

### Item 28. Register of shareholders and officers

**Category:** Generated document (corporate register)

| | |
|---|---|
| **Where it appears** | src/services/corporate.ts, function renderRegisterDocx(); labels FORM_LABEL, ROLE_LABEL, KIND_LABEL; calendar note in syncObligationEvent().<br>Client page (company) > Company records > Download register (Word); Clients > Corporate filings. |
| **Language** | EN and AR |
| **What to check** | - Is the disclaimer that this is "not an official extract" adequate?<br>- Role terms: شريك / مساهم، عضو مجلس الإدارة، مدير، مفوض بالتوقيع، أمين السر، مراقب الحسابات. Filing terms: تجديد السجل التجاري، تجديد عضوية غرفة التجارة، اجتماع الجمعية العامة السنوي، إيداع الحسابات المدققة، الإقرار الضريبي. |

**Wording**

> Register of shareholders and officers. {company}. Legal form: {form}. Commercial registration: {CR} (registered {date}). Capital: {amount}, {n} shares. Registered address: {address}. As at {date}, according to the records held by {firm}.

<blockquote dir="rtl" lang="ar">سجل الشركاء والمسؤولين. الشكل القانوني: {الشكل}. السجل التجاري: {الرقم} (تاريخ القيد {التاريخ}). رأس المال: {المبلغ}، {n} حصة / سهم. العنوان المسجل: {العنوان}. كما في {التاريخ}، وفقاً للسجلات المحفوظة لدى {المكتب}.</blockquote>

> This register reflects the firm's records and is not an official extract. Check it against the commercial registry before relying on it.

<blockquote dir="rtl" lang="ar">يعكس هذا السجل ما هو مقيد لدى المكتب وليس مستخرجاً رسمياً، ويجب مطابقته مع السجل التجاري قبل الاعتماد عليه.</blockquote>

> Calendar note: Corporate filing for {client}. Check the date with the registry and the company's constitutional documents.

### Item 29. Receipt and return of original documents

**Category:** Generated document (receipt)

| | |
|---|---|
| **Where it appears** | src/services/originals.ts (receipt Word file).<br>Client or Case page > Original documents > Receive originals / Return originals. |
| **Language** | EN and AR side by side |
| **What to check** | - Is the safe custody and acknowledgement wording appropriate (يقر ... باستلامه ... لحفظها بأمانة لصالح الموكل)? |

**Wording**

> Receipt of original documents. Receipt no. {OR-00001}. Date: {date}. Client: {client}. Matter: {reference}. {firm} acknowledges receiving today from {person} the original documents listed below, to be held in safe custody for the client.

<blockquote dir="rtl" lang="ar">إيصال استلام أصول. يقر {المكتب} باستلامه اليوم من {الشخص} الأصول المبينة أدناه، لحفظها بأمانة لصالح الموكل.</blockquote>

> Return of original documents. {firm} has today returned the original documents listed below to {person}, who acknowledges receiving them complete and in good order.

<blockquote dir="rtl" lang="ar">إيصال تسليم أصول. سلّم {المكتب} اليوم الأصول المبينة أدناه إلى {الشخص}، ويقر المستلم باستلامها كاملة وبحالة سليمة.</blockquote>

Note: Signature boxes: Received by (for the firm) / استلمها (عن المكتب); Handed over by / المسلِّم; Name / الاسم; Signature / التوقيع.

### Item 30. Client funds receipt voucher (سند قبض)

**Category:** Generated document (receipt)

| | |
|---|---|
| **Where it appears** | src/services/export.ts, function renderFundReceipt(); route src/routes/funds.ts.<br>Client page > Client funds > Receive money > Receipt (Word). |
| **Language** | EN and AR |
| **What to check** | - Are there Omani rules on holding client money (separate client account, use only for agreed fees and expenses) that this wording should reflect?<br>- Is "دفعة مقدمة تحت الحساب" the right term? |

**Wording**

> RECEIPT VOUCHER. Receipt no.; Date; Received from; Amount; Payment method; Reference; For; Matter; Held as: Client funds (advance on account).

<blockquote dir="rtl" lang="ar">سند قبض. رقم السند؛ التاريخ؛ استلمنا من؛ المبلغ؛ طريقة الدفع؛ المرجع؛ وذلك عن؛ القضية؛ أموال موكل (دفعة مقدمة تحت الحساب).</blockquote>

> {firm} - This amount is held on the client's behalf and applied only to their fees and expenses as agreed.

<blockquote dir="rtl" lang="ar">يُحتفظ بهذا المبلغ لحساب الموكل ولا يُستخدم إلا لسداد أتعابه ومصاريفه وفق الاتفاق.</blockquote>

### Item 31. Bilingual contract: language precedence clause

**Category:** Contract clause

| | |
|---|---|
| **Where it appears** | src/services/bilingual.ts, constant PREVAILING; option labels bil.prev_* in en.js/ar.js; default is Arabic prevails (src/routes/documents.ts).<br>Document > Bilingual version > Download Word > Language clause. |
| **Language** | EN and AR |
| **What to check** | - Is the clause effective in Oman, and is "Arabic prevails" the right default (for example for documents filed with Omani courts or authorities)? |

**Wording**

> This document is made in Arabic and English. In case of any conflict or difference between the two texts, the Arabic text shall prevail. (Or: the English text shall prevail.)

<blockquote dir="rtl" lang="ar">حُرر هذا المستند باللغتين العربية والإنجليزية، وفي حال وجود أي تعارض أو اختلاف بين النصين يُعتمد النص العربي.</blockquote>

<blockquote dir="rtl" lang="ar">حُرر هذا المستند باللغتين العربية والإنجليزية، وفي حال وجود أي تعارض أو اختلاف بين النصين يُعتمد النص الإنجليزي.</blockquote>

### Item 32. AI drafting templates, court names and practice checklists

**Category:** Templates and reference data

| | |
|---|---|
| **Where it appears** | src/services/reference.ts, DOCUMENT_TEMPLATES, COURTS, CHECKLISTS, PRACTICE_AREAS.<br>Documents > New with AI (template list); pleadings are addressed to the court tier; Case page > Apply checklist. |
| **Language** | EN and AR |
| **What to check** | - Arabic names of the 18 templates, for example "وكالة قانونية"، "صحيفة طعن بالنقض / التمييز"، "طلب استصدار أمر أداء"، "شكوى عمالية".<br>- Omani court tiers used to address pleadings: المحكمة الابتدائية، محكمة الاستئناف، المحكمة العليا. Are these correct and complete (for example for labour, commercial or administrative matters)?<br>- Checklist wording, for example "تقديم الشكوى لدى جهة العمل المختصة ضمن المهلة" and "حضور جلسة التسوية الودية" (employment). |

**Wording**

> Non-Disclosure Agreement; Service Agreement; Employment Contract; Sale and Purchase Agreement; Lease Agreement; Shareholders' Agreement; Memorandum of Understanding; Legal Fee Agreement; Power of Attorney; Legal Notice / Demand Letter; Settlement Agreement; Legal Memorandum; Statement of Claim; Statement of Defence; Statement of Appeal; Cassation / Supreme Court Appeal; Payment Order Application; Labour Complaint.

<blockquote dir="rtl" lang="ar">اتفاقية عدم إفصاح؛ اتفاقية تقديم خدمات؛ عقد عمل؛ اتفاقية بيع وشراء؛ عقد إيجار؛ اتفاقية مساهمين؛ مذكرة تفاهم؛ اتفاقية أتعاب محاماة؛ وكالة قانونية؛ إنذار قانوني / خطاب مطالبة؛ اتفاقية تسوية؛ مذكرة قانونية؛ صحيفة دعوى؛ مذكرة دفاع؛ صحيفة استئناف؛ صحيفة طعن بالنقض / التمييز؛ طلب استصدار أمر أداء؛ شكوى عمالية</blockquote>

<blockquote dir="rtl" lang="ar">عُمان: المحكمة الابتدائية؛ محكمة الاستئناف؛ المحكمة العليا</blockquote>

> Litigation checklist (excerpt): Conflict check and engagement letter signed; Obtain power of attorney; Assess limitation periods and jurisdiction; Report judgment to client and assess appeal deadline.

<blockquote dir="rtl" lang="ar">فحص تعارض المصالح وتوقيع خطاب التكليف؛ الحصول على الوكالة القانونية؛ تقييم مدد التقادم والاختصاص؛ إبلاغ الموكل بالحكم وتقييم مهلة الاستئناف</blockquote>

## 7. Arbitration

Institution names shown in the arbitration module.

### Item 33. Arbitration institution names

**Category:** Arbitration / terminology

| | |
|---|---|
| **Where it appears** | src/services/arbitration.ts, INSTITUTION_NAME (English, used in exports and calendar); en.js/ar.js keys arb.i_*; party labels arb.side_*.<br>Case page (arbitration matter) > Arbitration > Institution; Cases > Arbitrations. |
| **Language** | EN and AR |
| **What to check** | - See priority question 4. Are the Arabic names the official names?<br>- The English in arbitration.ts uses "Oman Commercial Arbitration Centre" while the playbook uses "Oman Commercial Centre for Dispute Resolution (OCCDRC)". Which is correct?<br>- Is "تحكيم حر" the right term for ad hoc arbitration, and "المحتكم / المحتكم ضده" for claimant and respondent? |

**Wording**

> Oman Commercial Arbitration Centre (OCAC)

<blockquote dir="rtl" lang="ar">مركز عُمان للتحكيم التجاري</blockquote>

> Dubai International Arbitration Centre (DIAC)

<blockquote dir="rtl" lang="ar">مركز دبي للتحكيم الدولي</blockquote>

> Abu Dhabi International Arbitration Centre (arbitrateAD)

<blockquote dir="rtl" lang="ar">مركز أبوظبي الدولي للتحكيم</blockquote>

> Saudi Center for Commercial Arbitration (SCCA)

<blockquote dir="rtl" lang="ar">المركز السعودي للتحكيم التجاري</blockquote>

> Qatar International Center for Conciliation and Arbitration (QICCA)

<blockquote dir="rtl" lang="ar">مركز قطر الدولي للتوفيق والتحكيم</blockquote>

> Bahrain Chamber for Dispute Resolution (BCDR)

<blockquote dir="rtl" lang="ar">غرفة البحرين لتسوية المنازعات</blockquote>

> Kuwait Commercial Arbitration Centre (KCAC)

<blockquote dir="rtl" lang="ar">مركز الكويت للتحكيم التجاري</blockquote>

> GCC Commercial Arbitration Centre

<blockquote dir="rtl" lang="ar">مركز التحكيم التجاري لدول مجلس التعاون الخليجي</blockquote>

> ICC International Court of Arbitration

<blockquote dir="rtl" lang="ar">محكمة التحكيم الدولية لغرفة التجارة الدولية</blockquote>

> LCIA

<blockquote dir="rtl" lang="ar">محكمة لندن للتحكيم الدولي</blockquote>

> Ad hoc

<blockquote dir="rtl" lang="ar">تحكيم حر</blockquote>

> Claimant / Respondent

<blockquote dir="rtl" lang="ar">المحتكم (المدعي) / المحتكم ضده (المدعى عليه)</blockquote>

> Rules placeholder: e.g. OCAC Rules 2023, UNCITRAL

<blockquote dir="rtl" lang="ar">مثل: قواعد المركز 2023، الأونسيترال</blockquote>

## 8. GCC starter playbook

Loaded by owners and admins from Documents > Clause bank > Playbook > "Load GCC starter playbook". Source: src/services/playbook.ts, STARTER_CLAUSES and STARTER_RULES. The app describes it as "10 rules based on GCC market practice and 6 bilingual clauses".

### Item 34. Starter clauses (six bilingual clauses)

**Category:** Contract clauses

| | |
|---|---|
| **Where it appears** | src/services/playbook.ts, STARTER_CLAUSES<br>Documents > Clause bank (after loading); Document > Insert clause; offered as the approved wording in playbook reviews. |
| **Language** | EN and AR |
| **What to check** | - See priority question 5. Enforceability under Omani law, especially the liability cap carve-outs and the exclusion of loss of profit, and whether "non-contractual obligations" has meaning in Omani law.<br>- Arbitration clause: the institution name (see item 33), three arbitrators as a default, Arabic as the language.<br>- Are the English and Arabic texts equivalent? |

**Wording**

*Governing law (GCC state) / القانون الواجب التطبيق*

> This Agreement and any non-contractual obligations arising out of or in connection with it shall be governed by and construed in accordance with the laws of the Sultanate of Oman.

<blockquote dir="rtl" lang="ar">يخضع هذا العقد وأي التزامات غير تعاقدية تنشأ عنه أو تتصل به لقوانين سلطنة عُمان، ويُفسَّر وفقاً لها.</blockquote>

*Arbitration (OCCDRC, Muscat) / التحكيم (مركز عُمان للتوفيق والتحكيم التجاري، مسقط)*

> Any dispute arising out of or in connection with this Agreement, including any question regarding its existence, validity or termination, shall be finally resolved by arbitration under the Rules of the Oman Commercial Centre for Dispute Resolution (OCCDRC). The tribunal shall consist of three arbitrators. The seat of arbitration shall be Muscat and the language of the arbitration shall be Arabic. The award shall be final and binding on the Parties.

<blockquote dir="rtl" lang="ar">يُسوّى نهائياً بطريق التحكيم أي نزاع ينشأ عن هذا العقد أو يتصل به، بما في ذلك أي مسألة تتعلق بوجوده أو صحته أو إنهائه، وفقاً لقواعد مركز عُمان للتوفيق والتحكيم التجاري. وتتشكل هيئة التحكيم من ثلاثة محكمين، ويكون مقر التحكيم مدينة مسقط، وتكون اللغة العربية لغة التحكيم. ويكون حكم التحكيم نهائياً وملزماً للطرفين.</blockquote>

*Limitation of liability / تحديد المسؤولية*

> Save in the case of fraud, wilful misconduct or gross negligence, the total aggregate liability of each Party under or in connection with this Agreement shall not exceed the total fees paid and payable under this Agreement in the twelve (12) months preceding the event giving rise to the claim. Neither Party shall be liable for any indirect or consequential loss, or for loss of profit, revenue or goodwill.

<blockquote dir="rtl" lang="ar">فيما عدا حالات الغش أو الخطأ العمدي أو الإهمال الجسيم، لا يجاوز إجمالي مسؤولية أي من الطرفين بموجب هذا العقد أو فيما يتصل به مجموع الأتعاب المدفوعة والمستحقة بموجبه خلال الاثني عشر (12) شهراً السابقة للواقعة المنشئة للمطالبة. ولا يُسأل أي من الطرفين عن أي خسارة غير مباشرة أو تبعية، أو عن فوات الربح أو الإيراد أو الشهرة التجارية.</blockquote>

*Confidentiality / السرية*

> Each Party shall keep confidential all information disclosed to it by the other Party in connection with this Agreement and shall not disclose it to any third party or use it for any purpose other than the performance of this Agreement, except where disclosure is required by law or by a competent authority. This obligation shall survive termination of this Agreement for three (3) years.

<blockquote dir="rtl" lang="ar">يلتزم كل طرف بالمحافظة على سرية جميع المعلومات التي يفصح عنها الطرف الآخر فيما يتصل بهذا العقد، وبعدم إفشائها لأي غير أو استعمالها لغير أغراض تنفيذ هذا العقد، إلا إذا كان الإفصاح واجباً بموجب القانون أو بطلب من جهة مختصة. ويظل هذا الالتزام سارياً لمدة ثلاث (3) سنوات بعد انتهاء هذا العقد.</blockquote>

*Force majeure / القوة القاهرة*

> Neither Party shall be liable for any delay or failure to perform caused by an event beyond its reasonable control, including natural disasters, epidemics, war, government action or interruption of public utilities, provided that it notifies the other Party in writing within seven (7) days and uses reasonable efforts to mitigate the effects. If the event continues for more than ninety (90) days, either Party may terminate this Agreement by written notice.

<blockquote dir="rtl" lang="ar">لا يُسأل أي من الطرفين عن أي تأخير أو إخلال في التنفيذ يرجع إلى سبب خارج عن إرادته المعقولة، بما في ذلك الكوارث الطبيعية والأوبئة والحرب والإجراءات الحكومية وانقطاع المرافق العامة، بشرط أن يخطر الطرف الآخر كتابةً خلال سبعة (7) أيام وأن يبذل العناية المعقولة للحد من آثاره. وإذا استمر السبب أكثر من تسعين (90) يوماً جاز لأي من الطرفين إنهاء هذا العقد بإخطار كتابي.</blockquote>

*Payment terms and late payment / شروط الدفع والتأخر في السداد*

> The Client shall pay each undisputed invoice within thirty (30) days of receipt. All amounts are exclusive of value added tax, which shall be added where applicable. If any amount remains unpaid fifteen (15) days after its due date, the Service Provider may suspend performance after giving seven (7) days written notice.

<blockquote dir="rtl" lang="ar">يلتزم العميل بسداد كل فاتورة غير متنازع عليها خلال ثلاثين (30) يوماً من تاريخ استلامها. وجميع المبالغ لا تشمل ضريبة القيمة المضافة التي تُضاف متى كانت مستحقة. وإذا ظل أي مبلغ غير مسدد بعد خمسة عشر (15) يوماً من تاريخ استحقاقه، جاز لمقدم الخدمة وقف التنفيذ بعد إخطار كتابي مدته سبعة (7) أيام.</blockquote>

### Item 35. Starter rules (ten negotiation positions)

**Category:** Negotiation positions

| | |
|---|---|
| **Where it appears** | src/services/playbook.ts, STARTER_RULES (each rule: topic, standard position, acceptable fallback, red flags; loaded in English or Arabic).<br>Documents > Clause bank > Playbook; Document > Review against playbook (Professional plan and above). |
| **Language** | EN or AR (chosen when loading) |
| **What to check** | - Are the positions reasonable defaults for a firm in Oman?<br>- Dispute resolution rule: "OCCDRC" and "مركز قطر الدولي" (incomplete name); reference to the New York Convention.<br>- Personal data rule: are the law references correct (Oman Royal Decree 6/2022, UAE Federal Decree-Law 45/2021, Saudi PDPL), and is a 72-hour breach notice a fair standard position? |

**Wording**

*Format: topic. Standard position. Fallback. Red flags.*

> Governing law (high). Laws of a GCC state where the client operates (Oman by default). Fallback: Laws of another GCC state, or DIFC or ADGM law where the counterparty insists. Red flags: Foreign law with no link to the deal; no governing law clause at all.

<blockquote dir="rtl" lang="ar">القانون الواجب التطبيق. قانون دولة خليجية يعمل فيها العميل (سلطنة عُمان افتراضياً). قانون دولة خليجية أخرى، أو قانون مركز دبي المالي العالمي أو سوق أبوظبي العالمي إذا أصر الطرف الآخر. قانون أجنبي لا صلة له بالصفقة، أو غياب شرط القانون الواجب التطبيق.</blockquote>

> Dispute resolution (high). Arbitration seated in the client's home GCC state under a recognised centre (OCCDRC, DIAC, SCCA, QICCA), or the courts of that state. Fallback: Arbitration seated in another GCC state party to the New York Convention, or at the ADGM Arbitration Centre. Red flags: Foreign courts with exclusive jurisdiction; unilateral option clauses for the counterparty only; no seat stated.

<blockquote dir="rtl" lang="ar">تسوية النزاعات. تحكيم مقره دولة العميل الخليجية لدى مركز معترف به (مركز عُمان للتوفيق والتحكيم التجاري، مركز دبي للتحكيم الدولي، المركز السعودي للتحكيم التجاري، مركز قطر الدولي)، أو محاكم تلك الدولة. تحكيم مقره دولة خليجية أخرى منضمة لاتفاقية نيويورك، أو لدى مركز التحكيم في سوق أبوظبي العالمي. اختصاص حصري لمحاكم أجنبية، أو شرط خيار لصالح الطرف الآخر وحده، أو عدم تحديد مقر التحكيم.</blockquote>

> Limitation of liability (high). Mutual cap at 100% of fees paid in the last 12 months; exclusion of indirect and consequential loss for both sides. Fallback: Cap up to 150% of annual fees, or a fixed amount agreed with the partner in charge. Red flags: Unlimited liability for our client; a cap that protects only the counterparty; no exclusion of consequential loss.

<blockquote dir="rtl" lang="ar">تحديد المسؤولية. سقف متبادل يعادل 100% من الأتعاب المدفوعة خلال آخر 12 شهراً، مع استبعاد الخسائر غير المباشرة والتبعية للطرفين. سقف حتى 150% من الأتعاب السنوية، أو مبلغ محدد يوافق عليه الشريك المسؤول. مسؤولية غير محدودة على عميلنا، أو سقف يحمي الطرف الآخر وحده، أو عدم استبعاد الخسائر التبعية.</blockquote>

> Indemnities (medium). Mutual indemnities limited to third party claims for breach of law, IP infringement and personal injury. Fallback: One way indemnity from our client limited to its own negligence and subject to the liability cap. Red flags: Broad indemnity "for any and all losses" by our client, outside the cap.

<blockquote dir="rtl" lang="ar">التعويض. تعويض متبادل يقتصر على مطالبات الغير الناشئة عن مخالفة القانون أو التعدي على الملكية الفكرية أو الإصابات الشخصية. تعويض من جانب عميلنا وحده يقتصر على إهماله ويخضع لسقف المسؤولية. تعويض واسع من عميلنا "عن أي وجميع الخسائر" خارج سقف المسؤولية.</blockquote>

> Payment terms (medium). Payment within 30 days of invoice; VAT on top; right to suspend for late payment. Fallback: Payment within up to 60 days. Red flags: Payment over 90 days, pay when paid, or set off rights only for the counterparty.

<blockquote dir="rtl" lang="ar">شروط الدفع. السداد خلال 30 يوماً من الفاتورة، مع إضافة ضريبة القيمة المضافة، وحق وقف التنفيذ عند التأخر. السداد خلال مدة لا تجاوز 60 يوماً. السداد بعد أكثر من 90 يوماً، أو شرط الدفع عند القبض، أو حق المقاصة للطرف الآخر وحده.</blockquote>

> Termination (medium). Either party may terminate for material breach not cured within 30 days, and for insolvency. Fallback: Termination for convenience on at least 60 days notice, with payment for work done. Red flags: Termination for convenience by the counterparty only, or on less than 30 days notice, or without payment for work done.

<blockquote dir="rtl" lang="ar">إنهاء العقد. يجوز لأي من الطرفين الإنهاء عند الإخلال الجوهري الذي لا يُعالج خلال 30 يوماً، وعند الإعسار أو الإفلاس. الإنهاء دون سبب بإخطار لا يقل عن 60 يوماً، مع سداد قيمة ما تم تنفيذه. حق الإنهاء دون سبب للطرف الآخر وحده، أو بإخطار أقل من 30 يوماً، أو دون سداد قيمة ما تم تنفيذه.</blockquote>

> Confidentiality (medium). Mutual confidentiality surviving at least 3 years, with the usual legal disclosure exceptions. Fallback: Survival of 2 years. Red flags: One way confidentiality binding only our client; no survival period.

<blockquote dir="rtl" lang="ar">السرية. التزام متبادل بالسرية يستمر 3 سنوات على الأقل بعد الانتهاء، مع الاستثناءات المعتادة للإفصاح القانوني. استمرار الالتزام لمدة سنتين. التزام بالسرية على عميلنا وحده، أو دون مدة استمرار بعد الانتهاء.</blockquote>

> Force majeure (low). Mutual force majeure covering epidemics and government action, with a right to terminate after 90 days. Fallback: Force majeure without a termination right. Red flags: Force majeure that excuses only the counterparty, or excludes payment obligations of the counterparty only.

<blockquote dir="rtl" lang="ar">القوة القاهرة. قوة قاهرة متبادلة تشمل الأوبئة والإجراءات الحكومية مع حق الإنهاء بعد 90 يوماً. قوة قاهرة دون حق الإنهاء. قوة قاهرة تعفي الطرف الآخر وحده، أو تستثني التزامات الدفع الخاصة به وحده.</blockquote>

> Assignment (low). No assignment without prior written consent, not to be unreasonably withheld; free assignment within the same group. Fallback: Consent required for all assignments. Red flags: Counterparty may assign freely while our client may not.

<blockquote dir="rtl" lang="ar">التنازل عن العقد. لا يجوز التنازل إلا بموافقة كتابية مسبقة لا تُحجب دون سبب معقول، مع جواز التنازل داخل المجموعة الواحدة. اشتراط الموافقة على جميع حالات التنازل. حق التنازل الحر للطرف الآخر دون عميلنا.</blockquote>

> Personal data (medium). Compliance with the applicable GCC personal data protection law (for example Oman Royal Decree 6/2022, UAE Federal Decree-Law 45/2021, Saudi PDPL); processing only on instructions; breach notice within 72 hours. Fallback: General compliance with law undertaking without detailed processing terms. Red flags: Transfers of personal data outside the GCC with no safeguards; no breach notification.

<blockquote dir="rtl" lang="ar">البيانات الشخصية. الالتزام بقانون حماية البيانات الشخصية المطبق في دولة الخليج المعنية (مثل المرسوم السلطاني رقم 6/2022 في عُمان، والمرسوم بقانون اتحادي رقم 45/2021 في الإمارات، ونظام حماية البيانات الشخصية السعودي)، والمعالجة وفق التعليمات فقط، والإخطار بالاختراق خلال 72 ساعة. تعهد عام بالالتزام بالقانون دون أحكام تفصيلية للمعالجة. نقل البيانات الشخصية خارج دول الخليج دون ضمانات، أو عدم الإخطار بالاختراق.</blockquote>

## 9. Electronic signatures

The signing page, the invitation email and the signed copy.

### Item 36. Signing page consent

**Category:** E-signature consent

| | |
|---|---|
| **Where it appears** | src/pages/sign-page.ts, copy en/ar (consent, legal, drawHint, stampLabel); public page /sign/{token}; script public/static/site/sign.js; server src/routes/sign.ts records "consent given" with time and IP.<br>Public signing page opened from the signing email (clients and other signers). |
| **Language** | EN and AR |
| **What to check** | - The consent says the electronic signature "has the same effect as my handwritten signature". Is that statement accurate for a simple electronic signature (typed name or drawn image, no certificate) under the Electronic Transactions Law (Royal Decree 69/2008)?<br>- Which documents should not be signed this way in Oman (for example powers of attorney, real estate dispositions, documents that need notarization)? Should the page warn about that?<br>- Is a typed name alone acceptable as a signature if the signer does not draw one? |

**Wording**

> Please read the document below carefully before signing.

<blockquote dir="rtl" lang="ar">يُرجى قراءة المستند أدناه بعناية قبل التوقيع.</blockquote>

> Type your full name to sign. Draw your signature (optional). If you do not draw, your typed name is used as your signature.

<blockquote dir="rtl" lang="ar">اكتب اسمك الكامل للتوقيع. ارسم توقيعك (اختياري). إذا لم ترسم توقيعًا فسيُستخدم اسمك المكتوب توقيعًا لك.</blockquote>

> I have read this document and agree to sign it electronically. I understand my electronic signature has the same effect as my handwritten signature.

<blockquote dir="rtl" lang="ar">قرأت هذا المستند وأوافق على توقيعه إلكترونيًا، وأدرك أن توقيعي الإلكتروني له أثر توقيعي الخطي نفسه.</blockquote>

> Simple electronic signature with an audit trail (time, IP address and document fingerprint).

<blockquote dir="rtl" lang="ar">توقيع إلكتروني بسيط مع سجل تدقيق (الوقت وعنوان IP والبصمة الرقمية للمستند).</blockquote>

> Thank you, your signature has been recorded. The firm has been notified. You will be able to download the signed copy once everyone has signed.

> Decline to sign. Reason (optional). You declined to sign this document. The firm has been notified.

### Item 37. Signing invitation email

**Category:** E-signature / email

| | |
|---|---|
| **Where it appears** | src/services/signatures.ts, function sendSigningInvitation()<br>Email to each signer when a document is sent for signature, and reminders. |
| **Language** | EN and AR in one email |
| **What to check** | - Is the wording adequate to identify the sender and the document, and to warn that the link is personal? |

**Wording**

> Subject: [Reminder: ]Please sign "{title}" - {firm}

> {firm} has sent you a document to sign electronically: "{title}". (Reminder: {firm} reminds you that a document is waiting for your signature.) Review and sign it here (the link is personal; do not forward it): {link} The link is valid until {date}.

<blockquote dir="rtl" lang="ar">{المكتب} أرسل إليك مستندًا لتوقيعه إلكترونيًا: «{العنوان}». للمراجعة والتوقيع افتح الرابط أعلاه (الرابط شخصي، يُرجى عدم مشاركته). صالح حتى {التاريخ}.</blockquote>

### Item 38. Signed copy: signature page and audit certificate

**Category:** E-signature evidence

| | |
|---|---|
| **Where it appears** | src/services/export.ts, constant SL and renderSignedDocx() (Word); src/services/signed-pdf.ts (PDF).<br>E-signatures > request > Download the signed copy; saved in the matter documents. |
| **Language** | EN and AR (Word); EN only (PDF) |
| **What to check** | - Is the audit trail (time in UTC, IP address, SHA-256 fingerprint) sufficient evidence in Omani courts, and should the certificate say anything else? |

**Wording**

> Signature page. Signer; Signed as; Signed at (UTC); IP address; Status; Document fingerprint (SHA-256); Original file; Audit trail; Completed (UTC).

<blockquote dir="rtl" lang="ar">صفحة التوقيعات. الموقّع؛ وقّع باسم؛ وقت التوقيع (UTC)؛ عنوان IP؛ الحالة؛ البصمة الرقمية للمستند (SHA-256)؛ الملف الأصلي؛ سجل التدقيق؛ اكتمل (UTC).</blockquote>

> Signed electronically through TrustiqLegal. Each signer opened a personal link, reviewed the document and confirmed their signature; the fingerprint above identifies the exact text that was signed.

<blockquote dir="rtl" lang="ar">تم التوقيع إلكترونيًا عبر TrustiqLegal. فتح كل موقّع رابطًا شخصيًا وراجع المستند وأكّد توقيعه، وتحدد البصمة أعلاه النص الذي تم توقيعه بالضبط.</blockquote>

> PDF footer: Signed electronically via TrustiqLegal - Ref {reference} - SHA-256 {hash}. PDF note: Each signer opened a personal link, reviewed this document and confirmed their signature. The fingerprint identifies the exact file that was signed.

## 10. Invoices, VAT and payments

Tax invoices issued by firms to their clients, and online payment wording.

### Item 39. Tax invoice (Word) and VAT labels

**Category:** Invoice / VAT

| | |
|---|---|
| **Where it appears** | src/services/export.ts, labels L and renderInvoiceDocx(); VAT rates and ZATCA QR (Saudi) in src/services/zatca.ts; UI keys billing.*, clients.vat_number_hint.<br>Billing > Invoices > invoice > Word; client portal invoices. |
| **Language** | EN and AR labels on every invoice |
| **What to check** | - Does the invoice meet the tax invoice content requirements of the Oman VAT Law (Royal Decree 121/2020) and its Executive Regulations (for example supplier VATIN, sequential number, date of supply, VAT amount in OMR)?<br>- The heading "Tax Invoice / فاتورة ضريبية" is printed even when the firm has not entered a VAT registration number. Should a firm that is not VAT registered be able to issue a document titled "Tax Invoice"?<br>- Is "VAT-compliant bilingual invoices" an acceptable marketing claim? |

**Wording**

> Tax Invoice / فاتورة ضريبية; Draft invoice / مسودة فاتورة; Simplified Tax Invoice / فاتورة ضريبية مبسطة (Saudi B2C); VOID / ملغاة.

> Invoice no. / رقم الفاتورة; Issue date / تاريخ الإصدار; Due date / تاريخ الاستحقاق; Bill to / إلى; Matter / القضية; VAT registration no. / الرقم الضريبي; Customer VAT no. / الرقم الضريبي للعميل; Description / البيان; Qty / hours / الكمية / الساعات; Rate / السعر; Amount / المبلغ; Subtotal / المجموع الفرعي; VAT ({rate}%) / ضريبة القيمة المضافة; Total / الإجمالي; Paid / المدفوع; Balance due / الرصيد المستحق; Payment details / بيانات الدفع; Notes / ملاحظات.

> Track time and expenses, and issue VAT-compliant bilingual invoices.

<blockquote dir="rtl" lang="ar">سجّل الوقت والمصروفات وأصدر فواتير ضريبية ثنائية اللغة.</blockquote>

Note: Platform help states the rates: Oman and UAE 5%, Saudi Arabia 15%, Bahrain 10%.

### Item 40. Invoice payment link email and payment page

**Category:** Payments

| | |
|---|---|
| **Where it appears** | Email: src/routes/billing.ts (payment link). Page: src/pages/pay-page.ts (public /pay/{token}). Firm notification: src/services/invoice-payments.ts.<br>Billing > invoice > Payment link > Email to client; public payment page; email to the firm when paid. |
| **Language** | EN and AR |
| **What to check** | - Is the statement that card details "are never shared with the firm or with TrustiqLegal" accurate and appropriate?<br>- Is anything required by Omani consumer or e-payment rules on this page (for example the merchant identity, refund contact)? |

**Wording**

> Subject: Invoice {number} from {firm} - pay online / فاتورة {number} من {firm}

> Dear {client}, Invoice {number} from {firm} has {amount} outstanding, due {date}. You can pay securely by card, mada, Apple Pay or KNET (where available) here: {link}

<blockquote dir="rtl" lang="ar">عزيزنا {الموكل}، المبلغ المستحق على الفاتورة رقم {الرقم} من {المكتب} هو {المبلغ}. يمكنك الدفع بأمان عبر البطاقة أو مدى أو Apple Pay أو كي-نت (حسب التوفر) من خلال الرابط أعلاه.</blockquote>

> You will be taken to Tap Payments to pay securely by card, mada, Apple Pay or KNET (where available). Your card details are never shared with the firm or with TrustiqLegal.

<blockquote dir="rtl" lang="ar">سيتم تحويلك إلى Tap Payments للدفع بأمان عبر البطاقة أو مدى أو Apple Pay أو كي-نت (حسب التوفر). لا تتم مشاركة بيانات بطاقتك مع المكتب أو مع TrustiqLegal.</blockquote>

> Test mode: no real money will be taken.

<blockquote dir="rtl" lang="ar">وضع الاختبار: لن يتم خصم أي مبلغ فعلي.</blockquote>

> Firm email: {client} paid {amount} online for invoice {number}. The invoice is now fully paid. / Action needed: online payment on {number} must be refunded ... Refund the extra amount from your Tap dashboard.

## 11. Client communications

Messages the app sends to clients and the public on the firm's behalf.

### Item 41. WhatsApp message templates and client consent

**Category:** Client messaging / consent

| | |
|---|---|
| **Where it appears** | src/services/whatsapp.ts, TEMPLATES (submitted by each firm to Meta for approval); consent keys clients.whatsapp_opt_in, clients.whatsapp_opt_in_hint, wa.help, cu.wa_no_opt_in.<br>Client page > tick "The client agreed to receive reminders on WhatsApp"; Settings > WhatsApp; automatic reminders. |
| **Language** | EN and AR |
| **What to check** | - Is a tick box recorded by the firm ("only tick this with the client's consent") sufficient evidence of consent under Royal Decree 6/2022 and telecom rules? Should the date and method of consent be recorded?<br>- Is it acceptable to send matter references, hearing dates and invoice amounts by WhatsApp, given confidentiality duties? |

**Wording**

> The client agreed to receive reminders on WhatsApp. Hearing, invoice and document reminders are sent to the phone number above. Only tick this with the client's consent.

<blockquote dir="rtl" lang="ar">وافق الموكل على تلقي التذكيرات عبر واتساب. تُرسل تذكيرات الجلسات والفواتير والمستندات إلى رقم الهاتف أعلاه. لا تحدد هذا الخيار إلا بموافقة الموكل.</blockquote>

> Hearing: Hello {{1}}, this is a reminder from {{2}} that the hearing in your matter {{3}} is on {{4}} at {{5}}. Please contact us if you have any questions.

<blockquote dir="rtl" lang="ar">مرحباً {{1}}، نذكّركم من {{2}} بأن جلسة قضيتكم {{3}} موعدها {{4}} في {{5}}. يُرجى التواصل معنا لأي استفسار.</blockquote>

> Invoice: Hello {{1}}, invoice {{2}} from {{3}} for {{4}} was due on {{5}}. You can view and pay it here: {{6}}

<blockquote dir="rtl" lang="ar">مرحباً {{1}}، الفاتورة رقم {{2}} من {{3}} بمبلغ {{4}} كانت مستحقة بتاريخ {{5}}. يمكنكم الاطلاع عليها وسدادها من هنا: {{6}}</blockquote>

> Documents: Hello {{1}}, {{2}} is still waiting for these documents for "{{3}}": {{4}}. You can upload them securely here: {{5}}

<blockquote dir="rtl" lang="ar">مرحباً {{1}}، ما زال {{2}} بانتظار المستندات التالية لطلب "{{3}}": {{4}}. يمكنكم رفعها بأمان من هنا: {{5}}</blockquote>

> Client update: Hello {{1}}, {{2}} has posted a new update on your matter {{3}}: "{{4}}". You can read it in your client portal: {{5}}

<blockquote dir="rtl" lang="ar">مرحباً {{1}}، نشر {{2}} تحديثاً جديداً على قضيتكم {{3}}: "{{4}}". يمكنكم قراءته في بوابة الموكلين: {{5}}</blockquote>

### Item 42. Client update emails and AI drafting rules

**Category:** Client messaging

| | |
|---|---|
| **Where it appears** | src/services/client-updates.ts (AI rules); src/routes/client-updates.ts (email).<br>Case page > Client updates > Draft with AI / Send to client. |
| **Language** | EN or AR |
| **What to check** | - If a client has no portal access, the full update is sent by plain email to the email on file. Is that acceptable for confidentiality?<br>- Are the AI rules (no fees, strategy or risk views; no predictions) appropriate? |

**Wording**

> Email: Subject: {update title} - {firm}. Body: {title} {reference} {update text} View your matter and reply in your client portal: {link}

<blockquote dir="rtl" lang="ar">يمكنكم الاطلاع على ملفكم والرد عبر بوابة الموكلين: {الرابط}</blockquote>

> AI rules (instruction, not shown): Use ONLY the information in the matter block and the lawyer's points. Do not invent facts, dates, amounts, laws or predictions of the outcome. Never mention internal matters: fees, strategy, risk assessments, or colleagues' internal notes.

### Item 43. Document request emails

**Category:** Client messaging

| | |
|---|---|
| **Where it appears** | src/services/document-requests.ts, requestEmailLines()<br>Client or Case page > Request documents (email to portal users). |
| **Language** | EN and AR in one email |
| **What to check** | - Arabic uses "بوابة العملاء" here but "بوابة الموكلين" elsewhere. Which is preferred? |

**Wording**

> {firm} has asked you for the following documents ("{title}"): ... Please upload them by {date}. Sign in to your client portal to upload them securely.

<blockquote dir="rtl" lang="ar">{المكتب} يطلب منك المستندات التالية («{العنوان}»): ... يُرجى رفعها قبل {التاريخ}. سجّل الدخول إلى بوابة العملاء لرفعها بأمان.</blockquote>

### Item 44. Settlement offers: "without prejudice" and client authority

**Category:** Professional conduct

| | |
|---|---|
| **Where it appears** | en.js/ar.js keys stl.wp, stl.wp_label, stl.confirm_outside; src/routes/settlement.ts.<br>Case page > Settlement negotiations. |
| **Language** | EN and AR |
| **What to check** | - Is "without prejudice (not to be shown to the court)" a correct description of the rule in Oman, and is "دون مساس بالحقوق" the right Arabic term? Compare the different Arabic used for "without prejudice" in the cheque and lease letters (items 24 and 25). |

**Wording**

> Without prejudice (not to be shown to the court)

<blockquote dir="rtl" lang="ar">دون مساس بالحقوق (لا يُقدَّم للمحكمة)</blockquote>

> This offer is outside the client's instructions. Accept it only if the client has agreed to it. [Button: The client agreed]

<blockquote dir="rtl" lang="ar">هذا العرض خارج تعليمات الموكل. لا تقبله إلا إذا وافق الموكل عليه.</blockquote>

### Item 45. Firm website: consultation form, privacy line and disclaimer

**Category:** Firm website / privacy

| | |
|---|---|
| **Where it appears** | src/pages/firm-site.ts, copy en/ar (contactIntro, privacy, disclaimer, chat.note); AI intake in src/services/lead-intake.ts.<br>Public firm website /f/{firm} > Request a consultation; footer; website chatbot. |
| **Language** | EN and AR |
| **What to check** | - The privacy line says details are used "only to respond to your request", but each enquiry is also summarized by AI and checked against the firm's clients for conflicts. Should the notice say so?<br>- Are there Omani rules on advocates advertising or publishing websites and blogs that the firm website or its wording should reflect?<br>- Does submitting the form create any lawyer-client relationship, and should the page say it does not? |

**Wording**

> Tell us briefly what you need and a lawyer will contact you. Please do not send confidential documents through this form.

<blockquote dir="rtl" lang="ar">أخبرنا باختصار بما تحتاجه وسيتواصل معك أحد المحامين. يُرجى عدم إرسال مستندات سرية عبر هذا النموذج.</blockquote>

> We use your details only to respond to your request.

<blockquote dir="rtl" lang="ar">نستخدم بياناتك فقط للرد على طلبك.</blockquote>

> The information on this website is general and is not legal advice. Contact the firm for advice on your situation.

<blockquote dir="rtl" lang="ar">المعلومات الواردة في هذا الموقع عامة ولا تُعد استشارة قانونية. تواصل مع المكتب للحصول على المشورة بشأن حالتك.</blockquote>

> Automated assistant. General information only, not legal advice.

<blockquote dir="rtl" lang="ar">مساعد آلي. معلومات عامة فقط وليست استشارة قانونية.</blockquote>

> Website chatbot setting: Answers visitors' questions from your website content and the information below, never gives legal advice, and invites visitors to request a consultation.

## Wording that looks risky or inconsistent

- Retention: Terms and Privacy Policy say data is deleted thirty days after termination; plan-ended messages say data stays "safe and read-only" with no limit; the app default for closed files is 10 years.
- Fair use: Enterprise is shown as "Unlimited" on the pricing page; the Terms have no fair use clause; only the homepage assistant (working copy) mentions the 400 / 80 per lawyer limits.
- Terms of Service and Privacy Policy are English only, and the Arabic homepage and Arabic signup link to them. Portal users (clients) accept no terms. There is no cookie notice.
- Export: the screen says "Download all clients, cases, documents ..." and the homepage says "Export your workspace at any time", but the export omits uploaded files, invoices, time entries, client funds, KYC, originals and other registers.
- "Without prejudice" is used in English on the cheque demand and lease notices (where it may suggest privilege) but rendered as a reservation of rights in Arabic; settlement uses a third Arabic term.
- E-signature consent says a simple electronic signature has "the same effect as my handwritten signature".
- Omani arbitration centre: "Oman Commercial Arbitration Centre / مركز عُمان للتحكيم التجاري" in the arbitration module versus "Oman Commercial Centre for Dispute Resolution (OCCDRC) / مركز عُمان للتوفيق والتحكيم التجاري" in the playbook; "مركز قطر الدولي" is truncated.
- Billing notes contradict each other ("invoiced monthly by our sales team" versus card payments that "extend your plan by one month"), and neither fits annual billing ("pay 10 months, get 12"), which the Terms do not cover.
- Support staff access: "cannot use AI drafting" (pricing form) versus "no AI" (assistant, working copy).
- Invoices are titled "Tax Invoice" even if the firm has no VAT number; the subscription payment email is a "receipt", not a tax invoice.
- Firm website privacy line ("only to respond to your request") does not mention AI summaries and conflict checks of enquiries.
- Minor Arabic issues: "{n} سنوات" is wrong for 11 years or more; "بوابة العملاء" versus "بوابة الموكلين"; "غير محدود قضايا مفتوحة" word order on the Arabic Enterprise card; "شركة تضامن أو توصية" merges two legal forms.
