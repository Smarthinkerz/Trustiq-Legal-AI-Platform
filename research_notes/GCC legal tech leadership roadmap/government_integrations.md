# Government, court and infrastructure integrations for a GCC legal practice management app (state as of October 2026)

Research note: about 16 web searches were run on 2026-10-16. The developer portal developers.najiz.sa could not be fetched directly (DNS failure from the research sandbox), so its details come from search snippets. Many findings come from law-firm alerts or vendor blogs rather than primary government pages; each source is labelled. Statements marked "background knowledge" were not re-verified in this session and should be checked before publication.

## 1. Court e-services: what lawyers can do online, and whether third-party APIs exist

### Takeaway
Saudi Arabia is the only GCC jurisdiction with a published judicial developer programme: the Najiz Developers platform. Even so, the catalog entries visible in search results were marked Staging v1.0, and no public evidence was found that private law-firm software can get production credentials. In the UAE (MOJ, Dubai, ADJD, DIFC, ADGM), Oman, Qatar, Kuwait and Bahrain, courts offer full lawyer portals and apps for e-filing, fees, case status and remote hearings. No public API or approved-integrator scheme was found for any of them. Integration today means deep links, document preparation and manual or assisted filing, not system-to-system filing.

### Cited Findings
**Saudi Arabia (MOJ / Najiz)**
- The Minister of Justice launched the "Najiz Developers Platform", described as "a unified interface for secure integration of government and private entities with judicial services" (announced around mid-2025). — [Saudi MOJ on X](https://x.com/MojKsa_EN/status/1939743353886679098)
- The developer site developers.najiz.sa describes itself as a data-exchange platform. It has an API catalog that lists a judicial case-management API and a multi-party power-of-attorney service, both marked Staging, version 1.0. The integration contact listed is takamul@moj.gov.sa. — [Najiz Developers](https://developers.najiz.sa/en); [API Catalog](https://developers.najiz.sa/en/api-catalog) (seen only through search snippets; the page could not be fetched)
- Najiz has four portals: individuals, businesses, government agencies and lawyers. The lawyer portal serves licensed lawyers, trainees and people licensed to plead for legal persons. — [Saudipedia](https://saudipedia.com/en/what-is-najiz-e-platform)
- "Najiz Business" offers companies a range of judicial services. — [Saudi MOJ on X](https://x.com/MojKsa_EN/status/1947342657707249934)
- Foreign law firm licensing applications are made through Najiz. — [Saudi Gazette](https://saudigazette.com.sa/article/629177/SAUDI-ARABIA/Saudi-Justice-Ministry-Licensing-of-foreign-law-firms-enabled-on-Najiz-portal)
- Taradhi (taradhi.moj.gov.sa) handles remote reconciliation across tracks including commercial, real estate, labour-type financial and IP disputes. Its conciliation certificates are enforceable instruments through the enforcement judiciary. — [Riyadh Daily](https://alriyadhdaily.com/article/26d2881b49e546d5a1930bd0411a0074); [Ajel](https://english.ajel.sa/news/saudi-arabia/saudi-conciliation-platform-serves-over-19-million-clients-since-its-launch)
- Reported Taradhi volumes differ by source and date: over 2 million sessions in one report, about 600,000 remote sessions in another. — [Amlak](https://amlak.net.sa/en/69497/); [Arab News](https://arab.news/rjrza)

**UAE (federal MOJ, Dubai Courts, ADJD)**
- The UAE has no single unified judicial platform. Ajman, Umm Al Quwain and Fujairah use the federal MOJ systems. Dubai, Abu Dhabi and Ras Al Khaimah run their own. Lawyers get professional accounts approved by the relevant authority (for example, Dubai's Legal Affairs Department with Dubai Courts, the MOJ, or ADJD). — [Mondaq: E-Justice in the UAE](https://www.mondaq.com/civil-law/1844298/e-justice-in-the-uae-how-smart-justice-systems-have-transformed-judicial-procedures)
- The Dubai Courts "Smart Petitions" app handles submission, review, follow-up, fee payment and decisions for case petitions. Its users are litigants, lawyer offices and typing offices. — [Dubai Courts Smart Apps](https://www.dc.gov.ae/PublicServices/SmartApps.aspx?lang=en); [Google Play](https://play.google.com/store/apps/details?id=ae.gov.dcpetitions.mobile.iphone&hl=en)
- The ADJD app shows civil and criminal case status, power of attorney (POA) status, and case deposits and disbursements. — [ADJD app, Google Play](https://play.google.com/store/apps/details?id=com.ADJD&hl=en)
- The UAE runs virtual litigation: parties and counsel join hearings by live video. — [u.ae Virtual litigation](https://u.ae/en/information-and-services/justice-safety-and-the-law/Law/litigation-procedures/virtual-litigation); [u.ae eFiling system](https://beta.government.ae/en/information-and-services/justice-safety-and-the-law/litigation-procedures/the-efiling-system)
- ADJD launched remote lawyer-client video consultations, requested through the ADJD app, the website, law offices or typing centres. — [Dubai Standard](https://www.dubaistandard.com/abu-dhabi-launches-video-consultation-service-connecting-lawyers-and-clients-remotely/)

**DIFC Courts and ADGM Courts**
- DIFC Courts moved to a new Case Management System on 30 September 2024. It covers registration, filing, fee payment, case events and reporting for the Small Claims Tribunal, Court of First Instance, Court of Appeal, arbitration and enforcement. eServices were suspended from 26 to 30 September 2024 for the switch. — [Lexis Middle East](https://www.lexis.ae/2024/09/19/difc-case-management-system-upgrade/)
- The earlier DIFC system was built in-house and integrated with the Emirates Identity Authority to verify users by Emirates ID. — [DIFC Courts ICCE newsletter 2018](https://www.difccourts.ae/wp-content/uploads/2018/01/ICCE-Newsletter-January-2018.pdf)
- ADGM Courts Practice Direction 1 requires all documents to be filed through the "eCourts Platform". Anyone may register without having a case, and filing is open 24/7, subject to fees. — [ADGM PD1](https://assets.adgm.com/download/assets/Practice_Direction_1_-_General_-_30112023.pdf/5c94ecf845ca11ef85d2d62f372d3f2f)
- The ADGM eCourts platform was built with Microsoft on Azure and includes Dynamics 365 elements. — [ADGM Courts digital](https://www.adgm.com/adgm-courts/digital-approach)

**Oman**
- The Supreme Judicial Council (SJC) lists a "Court Portal (Qadhaa)" among its e-services. In early October 2026 the SJC reported more than 137,000 active users. — [SJC Oman](https://www.sjc.gov.om/?culture=en)
- At the opening of the 2026–2027 judicial year, the Qadha portal had more than 137,000 active users and more than 760,000 electronically registered cases. — [Gulf Observer](https://thegulfobserver.com/oman-begins-new-judicial-year-2026-2027-advances-digital-transformation-of-justice-system/)
- An SJC announcement (gov.om archive, around February 2025) describes an Omani "Najiz" e-services portal covering case registration, filing of submissions and documents, and enforcement requests. Note that Oman's portal shares the Najiz name with Saudi Arabia's. — [gov.om](https://gov.om/en/w/supreme-judicial-council-launches-najiz-e-services-portal)
- The Court of Investment and Commerce has been in force since 1 October 2025. It runs a dedicated electronic system covering filing, fee payment, service, pleadings and video appearances. — [GCC BDI](https://gccbdi.org/legal-updates/omans-court-investment-and-commerce-now-force-oman)
- The Simplification of Judicial Proceedings Law provides the legal framework for electronic filing and registration of submissions. — [Al Tamimi](https://www.tamimi.com/law-update-articles/simplification-of-judicial-proceedings-law/)

**Qatar**
- Under the SJC's Al-Mahakem e-filing system, actions and appeals can no longer be started in person except in very limited cases. Lawyers register by application with supporting documents, including a POA. Approval takes about one to two weeks. — [Al Ansari & Associates](https://alansarilaw.com/newsletter/al-mahakem-qatar-courts-new-e-filing-system)
- The Qatar International Court (QFC Civil and Commercial Court) runs a separate eCourt system for issuing and managing cases. — [QICDRC User Guide](https://www.qicdrc.gov.qa/sites/default/files/2023-12/User%20Guide%20-%20QICDRC%20final.pdf)
- Rules issued in 2026 recognise electronic signatures and virtual verification at Qatar's Enforcement Court. — [Lawbridge Qatar](https://lawbridgeqatar.com/qatars-enforcement-court-goes-digital-what-it-means-for-creditors-in-2026/)
- The Qatar Ministry of Justice launched a new package of online services in October 2024. — [Lexis Middle East](https://www.lexis.ae/2024/10/25/qtr-launches-new-package-of-online-services/)

**Kuwait**
- The MOJ e-services portal lets lawyers and litigants file cases electronically. It relies on Kuwait Mobile ID (Hawiyyati) for authentication, and the MOJ offers an "Online Court" for remote attendance. — [YLF Kuwait blog](https://ylf.com.kw/blogs/e-litigation-kuwait?lang=en) (law-firm blog, not verified against MOJ)
- The MOJ runs a "Justice Gate" e-services mobile app. — [Google Play](https://play.google.com/store/apps/details?id=com.moj.moj_gate)

**Bahrain**
- The Ministry of Justice, Islamic Affairs and Waqf site lists e-services such as electronic marriage contracts and judicial information inquiries. No lawyer e-filing detail or API was surfaced. — [moj.gov.bh](https://www.moj.gov.bh/en/)

**Public APIs**
- No public developer API, integration specification or approved-integrator scheme was found for UAE MOJ, Dubai Courts, ADJD, DIFC, ADGM, Oman SJC, Qatar SJC, Kuwait MOJ or Bahrain MOJ. Access runs through the portals and approved professional accounts. — [Mondaq](https://www.mondaq.com/civil-law/1844298/e-justice-in-the-uae-how-smart-justice-systems-have-transformed-judicial-procedures); search across DIFC and ADGM materials above

### Inferences
- The only realistic near-term court integration route is Saudi Arabia, by applying to Najiz Developers (takamul@moj.gov.sa) for case status, hearing dates and e-POA verification. Treat it as a partnership track with uncertain eligibility, not a self-serve API.
- Everywhere else, the competitive features are:
  - deep links and guided checklists into each court portal;
  - structured capture of case number, court, next hearing and judgment, entered by the lawyer or parsed from portal notifications, emails or PDFs;
  - fee tracking;
  - bilingual document assembly in each court's required format.
- Scraping authenticated court portals is not advisable. It would likely breach portal terms and national cybercrime laws, and national-ID logins are tied to the individual lawyer.
- DIFC and ADGM are common-law, English-language courts with relatively modern case management systems built with Microsoft at ADGM. If either courts opens a partner integration, it would be the most natural early target.

### Gaps
- Whether Najiz Developers APIs are open to private law firms or software vendors, what is in production versus staging, and the fees and approval process. The portal could not be fetched.
- Whether any legal-tech vendor is officially integrated with any GCC court. None was found.
- Bahrain's lawyer e-filing system: its name, scope and authentication. Not found.
- Whether Oman's "Najiz" (2025) and the "Qadha" portal are the same system. Unclear.

## 2. Notary, registries and power of attorney e-services

### Takeaway
Saudi Arabia offers fully electronic POA issuance through Najiz/my.gov.sa, with an e-POA API listed in Najiz Developers (staging). Coverage found for UAE, Oman, Qatar, Kuwait and Bahrain notary and registry e-services was thin. Commercial registry API access (Wathiq, Invest Easy) could not be confirmed in this session.

### Cited Findings
- Saudi individual POA issuance is an electronic service on the unified government portal, and it removes the need to visit a notary. — [my.gov.sa service 19916](https://my.gov.sa/en/services/19916)
- In Najiz e-POA, the agent must accept the POA before it takes effect. A third party verifies a POA by document number and date. — [Wathim guide](https://www.wathim.com/blog/saudi-najiz-poa-for-expats-online); [Mahami Saudi](https://www.mahamisaudi.com/en/services/najiz/) (third-party guides)
- The Najiz Developers catalog includes a multi-party POA service (Staging v1.0). — [API Catalog](https://developers.najiz.sa/en/api-catalog)
- The ADJD app shows POA status inquiries. — [ADJD app](https://play.google.com/store/apps/details?id=com.ADJD&hl=en)

### Inferences
- POA verification is the highest-value "registry" integration for a legal app in Saudi Arabia. Intake can check a client's POA to the firm through Najiz, which matters because pleading requires a valid e-POA.
- Background knowledge, not verified this session:
  - Saudi Wathiq (wathq.sa, run by the Ministry of Commerce) offers paid commercial-registration and business-data APIs to the private sector.
  - The UAE MOJ and Dubai Courts provide remote notary services using UAE Pass and video.
  - Oman's Invest Easy (MOCIIP) handles CR issuance online.
  These should be verified before inclusion.

### Gaps
- Wathiq API product list and pricing, UAE federal/Dubai e-notary details, Oman Invest Easy API availability, real-estate registry (Saudi Real Estate Registry / Ejar, Dubai Land Department, Oman MOHUP) integration routes, and Qatar/Kuwait/Bahrain notary e-services. None of these surfaced in the searches run.

## 3. Digital identity and e-signature

### Takeaway
UAE Pass is the best-documented and most open national ID for private-sector integration. It has public developer docs, a defined onboarding process for private entities with a UAE trade licence, and signing at qualified level for verified users. Saudi Nafath is integrable through Elm/SDAIA, but official terms are not public. Oman runs a mature national PKI with mobile ID that has been integrated with dozens of systems, through an MTCIT/ITA onboarding route. Bahrain's eKey 2.0 (EKEY-B) is already used by private banks. Kuwait Mobile ID and Qatar Tawtheeq have little documented private-sector integration.

### Cited Findings
**UAE Pass**
- Service providers request integration through the UAE Pass Developer Portal and declare whether they are a government or private entity. Private entities must provide a valid UAE trade licence. An emirate-specific onboarding team handles the process. — [UAE Pass docs: Initiation Phase](https://docs.uaepass.ae/getting-onboarded-with-uae-pass/onboarding-process-for-uae-pass-service-providers/initiation-phase)
- Onboarding has four phases: Initiation, Development, Assessment and Go-live. It requires feature questionnaires (authentication, digital signature, hash signing, eSeal), a workflow diagram and UI wireframes. Non-standard use cases need management approval. — [UAE Pass docs](https://docs.uaepass.ae)
- Signing eligibility depends on account tier:
  - unverified accounts cannot sign;
  - SOP2-type verified accounts may get advanced-level signing;
  - fully verified accounts get qualified-level signatures. — [UAE Pass docs: signing guide](https://docs.uaepass.ae/feature-guides/signature-integration-guide/digital-signature-single-document/signing-guide)
- Available features include single- and multi-document signing, bulk hash signing, eSeal, LTV, and a SOAP signature-verification API that can verify signing time and signer for up to 3 years. — [Verification process](https://docs.uaepass.ae/feature-guides/signature-integration-guide/digital-signature-single-document/signing-guide/document-signature-verification-process); [Hash signing](https://docs.uaepass.ae/feature-guides/hash-signing/bulk-hash-signing-multiple-documents/quick-setup); [eSeal](https://docs.uaepass.ae/feature-guides/eseal)

**Saudi Nafath**
- Nafath is run by SDAIA. A third-party guide reports 530 connected platforms and more than 23.5 million users as of November 2024. Fees, the attribute list and onboarding lead times are not published. — [Didit](https://didit.me/blog/nafath-integration/)
- Community SDKs say credentials (APP_ID and APP_KEY) are obtained from Elm or the Nafath developer portal. — [laravel-nafath](https://root.packagist.org/packages/devmahmoudmustafa/laravel-nafath); [Nafath.Net](https://github.com/arahimx/Nafath.Net)
- No official SDAIA developer documentation was found in search.

**Oman PKI and Mobile ID (MTCIT/ITA)**
- The national PKI issues certificates to individuals, government, commercial users and devices. Organisations can join as a Registration Authority or Sub-CA. It follows ETSI standards, including PAdES. — [DPI Global: Oman PKI](https://www.dpi.global/globaldpi/oman_pki); [ETSI workshop deck](https://docbox.etsi.org/workshop/2019/201905_MiddleEast_AfricaWS_GlobalisationofTrustServices/Oman%20National%20PKI_ETSI%20workshop_Dubai.pdf)
- ITA/MTCIT runs a signature validation service as a Trusted Third Party. — [ETSI workshop deck](https://docbox.etsi.org/workshop/2019/201905_MiddleEast_AfricaWS_GlobalisationofTrustServices/Oman%20National%20PKI_2019.pdf)
- The PKI was integrated with about 77 electronic systems and has handled more than 24 million e-transactions since 2013. It provides multi-factor authentication, legally binding e-signatures and e-stamps. — [ITU WSIS 2024](https://itu.int/net4/wsis/stocktaking/Prizes/2024/Details/15743091629475936)
- Oman legally recognises mobile digital ID as official identification. Vodafone Oman launched PKI-enabled eSIMs. — [Mobile ID World](https://mobileidworld.com/oman-legally-recognizes-mobile-digital-id-as-official-identification/); [Telecom Review](https://www.telecomreview.com/?p=26380)
- PKI integration contacts are pki@mtcit.gov.om and pkisupport@mtcit.gov.om. — [DPI Global](https://www.dpi.global/globaldpi/oman_pki)

**Bahrain eKey 2.0**
- EKEY-B, part of eKey 2.0, is a business identity service. KFH Bahrain, GFH and CFI Financial launched it, and NBB was the first bank with a fully integrated EKEY-B process. This shows private-sector integration is possible. — [Biometric Update, Jan 2026](https://www.biometricupdate.com/202601/bahrain-financial-services-deploy-biometric-kyc-and-idv-with-new-ekey-for-business); [Time Out Bahrain](https://www.timeoutbahrain.com/living-in-bahrain/bahrain-new-apps)

**Kuwait Mobile ID and Qatar Tawtheeq**
- Kuwait Mobile ID (PACI) is described as supporting private-sector authentication such as banking. These sources are vendor blogs. — [eMudhra](https://emudhra.com/en/blog/kuwait-mobile-id-features-benefits-usage-guid)
- Qatar uses Tawtheeq for login and the Qatar Digital ID app as a credential wallet. The QCB e-KYC Regulation took effect in October 2023 and requires prior approval. Qatar Digital ID adoption was cited at about 5% (vendor figure). — [Shufti Pro GCC eKYC guide](https://shuftipro.com/resources/whitepapers-reports/docless-identity-verification-middle-east/)

### Inferences
- Integration priority: UAE Pass (login plus qualified e-signature for engagement letters and POAs) is first, because it is documented and open to trade-licensed private entities. Nafath login and verification through an Elm agreement is second. Oman PKI/Mobile ID signing through MTCIT is third. Bahrain EKEY-B fourth.
- A non-UAE SaaS will need a UAE legal entity or partner holding a trade licence to onboard to UAE Pass.
- Legal status, from background knowledge (not re-verified this session):
  - UAE Federal Decree-Law 46/2021 on Electronic Transactions and Trust Services recognises simple, advanced and qualified e-signatures.
  - Saudi Electronic Transactions Law (2007) gives e-signatures legal effect.
  - Oman Electronic Transactions Law (Royal Decree 69/2008).
  - Qatar Decree-Law 16/2010.
  - Bahrain Law 54/2018 on Electronic Communications and Transactions.
  - Kuwait Law 20/2014.
  All broadly recognise e-signatures, with exceptions such as some personal status and real-property instruments. The report writer should verify these before citing them.

### Gaps
- Official Nafath onboarding terms and fees, the Qatar Tawtheeq private-sector integration route, and Kuwait Mobile ID SDK availability for third parties.
- Electronic transactions law texts were not retrieved in this session.

## 4. Payments and recurring billing

### Takeaway
Tap Payments (KSA, UAE, Kuwait, Bahrain, Qatar, Oman) and Moyasar (KSA) both document card tokenisation for merchant-initiated recurring charges, including mada recurring through Tap. Thawani (Oman) advertises recurring payments for subscriptions. Recurring support for KNET and BenefitPay was not confirmed. Debit schemes are generally not usable for tokenised recurring charges without specific scheme support.

### Cited Findings
- Tap documents a mada recurring flow: the first charge saves the card, then a recurring token is used for merchant-initiated charges with `customer_initiated=false`. — [Tap API: mada recurring](https://developers.tap.company/docs/mada-recurring)
- Tap KSA advertises recurring payment flows for subscriptions, memberships and retainers. Its mada gateway certification includes card tokenisation. — [Tap KSA](https://www.tap.company/en-sa); [Tap blog](https://blog.tap.company/mada-payment-gateway-certification/)
- Moyasar can create a token with `save_card=true` when the merchant has Tokenization enabled. Tokens are charged later without re-authentication, and only active tokens work. — [Moyasar docs: tokenized cards](https://docs.moyasar.com/guides/tokenization/tokenized-cards); [Create Payment](https://docs.moyasar.com/api/payments/01-create-payment)
- Moyasar also offers payment links by SMS or email for one-off or recurring requests. — [Moyasar Accept Payments](https://moyasar.com/en/products/accept-payments/)
- Thawani's developer portal provides API references, a sandbox and webhooks, and advertises recurring payments for subscriptions and memberships. — [Thawani payment gateway](https://thawani.om/payment-gateway)
- KNET is Kuwait's national debit network, comparable to mada. Tap supports mada, KNET, Apple Pay and cards natively. — [PaymentProviders.io](https://paymentproviders.io/blog/best-payment-gateways-uae-saudi-arabia)

### Inferences
- Tap is the best single gateway for a pan-GCC SaaS with subscriptions: it covers 6 countries and offers mada recurring. This matches the codebase's existing Tap subscription integration.
- Moyasar is a strong KSA-only alternative or backup. Thawani is the Oman-local option, and OmanNet debit coverage needs checking.
- For KNET and BenefitPay, plan for invoice and payment-link renewals instead of silent auto-debit, and confirm with Tap.
- Background knowledge, not verified this session: HyperPay and Checkout.com also support tokenised recurring card payments in KSA/UAE, and STC Pay and Apple Pay are accepted through these gateways.

### Gaps
- Recurring support for KNET, BenefitPay and OmanNet. HyperPay, Checkout.com, STC Pay and Fawry (Egypt) recurring capabilities were not researched in this session.

## 5. E-invoicing obligations for law-firm billing software

### Takeaway
Saudi ZATCA Phase 2 (integration) now extends to small firms: Wave 25 covers VAT-taxable revenue above SAR 187,500, with a deadline of 1 February 2027. The UAE's Peppol-based (PINT AE) mandate starts 1 January 2027 for businesses with AED 50M+ revenue and 1 July 2027 for others. Oman's Fawtara pilot began in August 2026, but the date mandatory obligations start conflicts between sources. Qatar approved an e-invoicing law in May 2026, while Bahrain is consulting and Kuwait has no announcement.

### Cited Findings
**Saudi Arabia**
- ZATCA published Wave 25 criteria on 24 July 2026. In scope are taxpayers with VAT-taxable revenue above SAR 187,500 in any of 2022–2025, with integration due by 1 February 2027. ZATCA gives at least six months' notice per wave. — [KPMG, Jul 2026](https://kpmg.com/us/en/taxnewsflash/news/2026/07/saudi-arabia-e-invoicing-mandatory-for-taxpayers-with-revenue-above-sar-187500.html); [Grant Thornton KSA](https://www.grantthornton.sa/globalassets/_markets_/sau/media/pdfs/gtksa_zatca-wave-25-e-invoicing-english-arabic.pdf)
- Wave 24 used a SAR 375,000 threshold with a 30 June 2026 deadline. Sources differ on its reference years. — [Fiscal Solutions](https://www.fiscal-requirements.com/news/5753-saudi-arabia-zatca-announces-24th-wave-for-e-invoicing-integration-phase-deadline-30-june-2026); [Comarch](https://www.comarch.com/trade-and-services/data-management/legal-regulation-changes/saudi-arabia-announces-wave-25-of-e-invoicing-integration/)
- SAR 187,500 is the mandatory VAT registration threshold, so Wave 25 effectively brings nearly all VAT-registered firms into Phase 2. — [Noqta](https://noqta.tn/en/news/zatca-wave-25-e-invoicing-threshold-halved-2026)

**UAE**
- Ministerial Decisions 243 and 244 of 2025 set the timeline:
  - voluntary adoption from 1 July 2026;
  - businesses with AED 50M+ revenue appoint an Accredited Service Provider (ASP) by 31 July 2026 and go live 1 January 2027;
  - businesses under AED 50M appoint an ASP by 31 March 2027 and go live 1 July 2027;
  - government entities go live 1 October 2027. — [KPMG Oct 2025](https://kpmg.com/us/en/taxnewsflash/news/2025/10/uae-framework-scope-implementation-e-invoicing-system.html); [Fiscal Solutions](https://www.fiscal-requirements.com/news/5848-uae-moves-toward-mandatory-e-invoicing-with-2027-phased-rollout)
- Vatit gives an outlier "October 2026" go-live. — [vatit](https://vatit.com/?p=90686)
- The UAE model is Peppol-based DCTCE (5-corner) using PINT AE. The FTA issued technical guidance on mandatory fields on 23 February 2026. — [Sovos](https://sovos.com/vat/tax-rules/uae-e-invoicing/); [KPMG Feb 2026](https://kpmg.com/us/en/taxnewsflash/news/2026/02/uae-technical-guidance-mandatory-e-invoicing-fields.html)

**Oman (Fawtara)**
- Phase 1 (pilot) started in August 2026 with about 100 large VAT taxpayers. Older schedules put Phase 2 in February 2027 and Phase 3 in August 2027, with full rollout by August 2028. — [Deloitte](https://www.deloitte.com/middle-east/en/services/tax/perspectives/ota-initiates-the-implementation-of-its-e-invoicing-program.html); [e-invoice.app](https://www.e-invoice.app/country/OM); [Alvarez & Marsal](https://www.alvarezandmarsal.com/node/95831)
- A newer report says Tax Authority Decision No. 189/2026 (3 August 2026) formalised the framework, with mandatory phased implementation beginning April 2027. Not confirmed against an official OTA source. — [Banqup Oman compliance pulse](https://resources.banqup.com/resources/compliance-pulse/oman)

**Qatar, Bahrain and Kuwait**
- Qatar's cabinet approved an e-invoicing law in May 2026, with compliance expected from 2027. Qatar has no VAT. — [Banqup GCC](https://www.banqup.com/resources/blog/e-invoicing-in-the-gcc-a-region-in-digital-transformation); [ClearTax](https://www.cleartax.com/ae/gcc-multi-country-e-invoicing). A May 2026 PwC deck still listed no official announcement: [PwC](https://www.pwc.com/m1/en/events/2026/docs/qatar-e-invoicing-preparing-for-the-new-digital-tax-era.pdf)
- Bahrain's National Bureau for Revenue (NBR) is in public consultation, and its system is expected to resemble the KSA model. There is no date. Kuwait has no VAT and no e-invoicing announcement. — [Banqup GCC](https://www.banqup.com/resources/blog/e-invoicing-in-the-gcc-a-region-in-digital-transformation); [ClearTax](https://www.cleartax.com/ae/gcc-multi-country-e-invoicing)

### Inferences
- What law-firm billing software must support:
  - **KSA:** ZATCA Phase 2. That means UBL 2.1 XML with QR code, cryptographic stamp, invoice hash chaining and UUID, device onboarding (CSID), and clearance for B2B or reporting for B2C through the Fatoora APIs. Wave 25 makes this effectively mandatory for almost every Saudi VAT-registered law firm by February 2027.
  - **UAE:** PINT AE output through an accredited Peppol ASP, with the provider partnership in place before mid-2027 for SME law firms. The app can partner with an ASP or become one.
  - **Oman:** monitor Fawtara. Law firms are unlikely to be in the first 100-taxpayer pilot.
- Data model needs: seller and buyer VAT/TRN, Arabic invoice fields, credit notes linked to the original invoice, and disbursement versus fee VAT treatment.

### Gaps
- Official OTA confirmation of Oman's mandatory start date. Qatar's executive regulation details and model (clearance or reporting).

## 6. Messaging: WhatsApp Business API and SMS sender ID rules

### Takeaway
Across the GCC, A2P SMS needs pre-registered alphanumeric sender IDs, and promotional traffic needs "AD" markers (KSA "-AD" suffix, UAE "AD-" prefix, Kuwait "AD"). WhatsApp Business API is the practical two-way client channel, especially in KSA where two-way A2P SMS is not available. No official 2026 regulator guidance on WhatsApp use by law firms was found.

### Cited Findings
- **Saudi Arabia:** sender IDs must be registered before traffic delivers, with a lead time of about 14 business days. Marketing sender IDs carry an "-AD" suffix within the 11-character limit. Marketing sends are restricted overnight and to do-not-disturb numbers. Two-way SMS is not available on standard A2P, and WhatsApp is suggested instead. — [Vonage KSA](https://api.support.vonage.com/hc/en-us/articles/204017033-Saudi-Arabia-SMS-Features-and-Restrictions); [D7 Networks](https://d7networks.com/sms/saudi-arabia/sms-regulations/); [sent.dm KSA](https://sent.dm/en/resources/sms-compliance/sa-sms-guidance)
- **UAE:** sender ID registration and TDRA compliance are mandatory (guidance updated for Cabinet Decision 56/2024). Promotional sender IDs use an "AD-" prefix. — [sent.dm UAE](https://sent.dm/es/resources/sms-compliance/ae-sms-guidance); [sms.to](https://support.sms.to/support/solutions/articles/43000513909)
- **Kuwait:** promotional sender IDs must include "AD". **Oman:** sender ID registration is required. — [sms.to](https://support.sms.to/support/solutions/articles/43000513909); [MSG91](https://msg91.com/help/sender-id/country-wise-sms-and-sender-id-rules)

### Inferences
- Use WhatsApp Business Platform utility templates for hearing reminders, document requests and invoice links. Use registered transactional SMS sender IDs per country for OTP and fallback. Do not mix marketing and legal-service messages.
- Client confidentiality and data protection laws (KSA PDPL, UAE PDPL, Oman PDPL) should govern what content goes over WhatsApp. These laws were not researched in this session.

### Gaps
- Official CST, TDRA, Oman TRA and Kuwait CITRA texts. All findings here come from SMS vendor guides.
- No source on bar or regulator positions about lawyer-client WhatsApp communication.
