# Oman digital identity (THEQA) and court integration: plan

Status: planning only. Nothing here is built. Section 1 was checked against MTCIT's own pages on October 16, 2026 (sources below). Section 2 still comes only from notes the owner shared and must be confirmed with the Supreme Judicial Council before any work starts.

## 1. THEQA (ثقة), Oman's digital identity

### Confirmed from MTCIT (October 16, 2026)

- THEQA is run by the Electronic Authentication Department of Oman National CERT, part of MTCIT. It works with the national ID card, the residency card, or the THEQA mobile app.
- It is established under the Electronic Transactions Law, Royal Decree 39/2025. MTCIT says THEQA signatures have "full legal validity" and legal recognition equal to a handwritten signature.
- **Private companies can integrate.** MTCIT offers these services to "government and private entities":
  1. **Identity portal (unified sign-in)**: people authenticate in the entity's own system with their civil ID or the THEQA app.
  2. **Digital signature portal**: an electronic portal the entity uses in its system so people can sign transactions electronically.
  3. **Signature verification**: entities can check that a digital signature is valid.
- **How to apply**: email the national PKI center at pki@mtcit.gov.om. MTCIT's page names no public SDK or self-service developer portal.
- Users sign in to a service provider either by approving a push notification or by scanning a QR code in the THEQA app, then entering their PIN. To sign documents, a user must first upgrade their identity to the "High" verification level.
- Signing in with the physical ID card in a browser needs a small helper program on the user's computer. The app route (push or QR) needs nothing installed.
- A private company has already done this: Ooredoo Oman integrated THEQA in its app for customer identity checks in November 2025, built with Oman National CERT.
- The national PKI also offers server signing (an entity's digital stamp), time stamping, and corporate PKI tokens.

Sources:
- THEQA Application User Guide, MTCIT, February 22, 2026: https://mtcit.gov.om/library-3/guidelines-documentation-7/guidelines-68/theqa-application-user-guide-1259
- Digital Trust, MTCIT: https://mtcit.gov.om/media-4/projects-initiatives-12/initiative-91/digital-trust-1063
- Verification of electronic signatures, MTCIT: https://mtcit.gov.om/services-5/services-13/services-92/verification-of-electronic-signatures-845
- Ooredoo Oman press release, November 23, 2025: https://www.ooredoo.om/en/press-release/click-verify-connect-ooredoo-launches-theqa-digital-id-in-app/

### What it would mean for TrustiqLegal

- **Signatures**: today the app records a typed or drawn signature with an audit trail. A THEQA signature is a certified signature under Royal Decree 39/2025, which is much stronger evidence in Omani courts. It would be offered next to the current method when sending a document for signature, for signers with an Omani ID.
- **Client onboarding (KYC)**: clients would prove their identity with THEQA instead of uploading an ID photo.
- **Sign in**: lawyers and portal clients could sign in with THEQA (push or QR).
- **Firm seal**: server signing could stamp documents issued by the firm.

### Still to ask pki@mtcit.gov.om

1. Which agreement, fees and security review apply to a private software company serving law firms?
2. Is there a test environment, and what are the technical interfaces (for example OpenID Connect or SAML for sign-in, and the request format for signing)?
3. What does a signed document look like (for example a PAdES signed PDF), and how is it verified later?
4. Must the integrating system or its data be hosted in Oman?

A draft email is below. It has not been sent.

> Subject: Request to integrate THEQA authentication and digital signature (TrustiqLegal)
>
> Dear Electronic Authentication team,
>
> SmarThinkerz operates TrustiqLegal, a practice management system for law firms in Oman. We would like to offer our users THEQA sign-in, and certified electronic signatures for engagement letters, powers of attorney and other legal documents, through your identity portal and digital signature portal services, and to verify signatures through your verification service.
>
> Could you please tell us the steps to apply as a private entity, the agreement and any fees, the technical documentation and test environment, the security requirements, and whether the integrating system must be hosted in Oman?
>
> Kind regards,
> [Name, title, company, phone]

## 2. Court integration (Supreme Judicial Council)

The owner's notes say:

- there is no public open API for the courts;
- integration goes through the government integration platform run by MTCIT, with approval from the Supreme Judicial Council or the Ministry of Justice and Legal Affairs;
- access is limited to government bodies and approved entities, which may include law firms;
- identity and signatures would go through the national PKI (THEQA, see section 1);
- connections may need a private network link (MPLS or an approved VPN) rather than the public internet;
- security testing by the Omani authorities comes before production access.

One point in the notes looks wrong and must not be relied on: they mention aligning with "Najiz e-services". Najiz is Saudi Arabia's Ministry of Justice platform, not Oman's.

Proposed order of work, once access is confirmed:

1. Write to the Supreme Judicial Council and MTCIT describing the uses: case status lookup, hearing dates, and later filing. Ask what a law firm's software provider can be approved for.
2. Agree the data each use needs and map it to TrustiqLegal's cases, hearings and court roll.
3. Build a separate connector service so the main app never holds network credentials for the government link.
4. Complete the security review and penetration test that the authorities require.
5. Start with read-only case status and hearing dates; filing only later.

## 3. Dependencies on other roadmap items

- Hosting customer data in Oman (see the GCC roadmap report) will very likely be required before any government integration is approved.
- An information security certification (ISO 27001) will likely be asked for during the security review.
